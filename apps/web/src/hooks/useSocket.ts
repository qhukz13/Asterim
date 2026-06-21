import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { AgentDeckEvent, AgentStatusPayload, FileChangedPayload, ApprovalRequestPayload, ChatMessagePayload } from '@agentdeck/shared';
import { generateECDHKeyPair, exportPublicKey, importPublicKey, deriveSharedSecret, encryptPayload, decryptPayload } from '@agentdeck/shared';

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
}

export function useSocket(projectId: string | null, relayUrl?: string) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<AgentDeckEvent<any>[]>([]);

  const [agentStatus, setAgentStatus] = useState<AgentStatusPayload>({ status: 'idle' });
  const [approvalRequest, setApprovalRequest] = useState<(ApprovalRequestPayload & { timestamp?: number }) | null>(null);
  const [fileChanges, setFileChanges] = useState<FileChangedPayload[]>([]);
  const [systemStatus, setSystemStatus] = useState<{ binaries: { claude: boolean; aider: boolean; antigravity: boolean } } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // P0-007 FIX: Use useRef instead of useState for the shared secret.
  // Event handlers registered inside useEffect capture the closure at registration
  // time. useState values are stale in those closures; useRef.current is always live.
  const sharedSecretRef = useRef<CryptoKey | null>(null);
  // Separate boolean state so the UI can reflect E2E readiness if needed.
  const [isE2EReady, setIsE2EReady] = useState(false);

  // Also use a ref for the socket so sendInternalEvent (defined outside the effect)
  // always reads the current socket without needing it as a dependency.
  const socketRef = useRef<Socket | null>(null);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (!projectId) return;

    const isRelayMode = projectId.length === 6;
    let newSocket: Socket;
    let localKeyPair: CryptoKeyPair | null = null;

    const token = localStorage.getItem('agentdeck_token');

    if (isRelayMode) {
      // P0-008: Use the server-provided relay URL, not a hardcoded value.
      // Falls back to localhost:4000 only in dev when no relayUrl is passed.
      const url = relayUrl || 'http://localhost:4000';
      newSocket = io(url);
    } else {
      const protocol = window.location.protocol;
      const hostname = window.location.hostname;
      newSocket = io(`${protocol}//${hostname}:3000`, {
        auth: { token }
      });
    }

    newSocket.on('connect', async () => {
      setConnected(true);
      connectedRef.current = true;
      if (isRelayMode) {
        localKeyPair = await generateECDHKeyPair();
        newSocket.emit('join_tunnel', projectId);
      } else {
        newSocket.emit('join_project', projectId);
      }
    });

    newSocket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
      if (err.message === 'unauthorized') {
        localStorage.removeItem('agentdeck_token');
        window.location.reload();
      }
    });

    // Relay Mode E2E Handshake & Payload routing
    newSocket.on('tunnel_message', async (message: any) => {
      if (message.type === 'e2e_handshake_server' && localKeyPair) {
        // Server sent its public key — derive our shared AES secret.
        const serverPubKey = await importPublicKey(message.publicKey);
        const secret = await deriveSharedSecret(localKeyPair.privateKey, serverPubKey);

        // P0-007 FIX: Write to ref — this is immediately visible to all handlers
        // that subsequently call sharedSecretRef.current.
        sharedSecretRef.current = secret;
        setIsE2EReady(true);

        // Send our public key back to the server.
        const myJwk = await exportPublicKey(localKeyPair.publicKey);
        newSocket.emit('tunnel_message', {
          tunnelId: projectId,
          payload: {
            type: 'e2e_handshake_client',
            sourceClient: newSocket.id,
            publicKey: myJwk
          }
        });
        console.log('[E2E] Handshake complete — tunnel encrypted');

        // Immediately send auth credentials
        const pin = localStorage.getItem('agentdeck_remote_pin') || token;
        if (pin) {
          const authEvent = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            source: `remote:${newSocket.id}`,
            type: 'client.pair',
            payload: { pin }
          };
          const encrypted = await encryptPayload(secret, authEvent);
          newSocket.emit('tunnel_message', {
            tunnelId: projectId,
            payload: {
              type: 'encrypted_payload',
              sourceClient: newSocket.id,
              encrypted
            }
          });
        }

      } else if (message.type === 'encrypted_payload') {
        // P0-007 FIX: Read from ref — always the current value, never stale.
        const secret = sharedSecretRef.current;
        if (!secret) {
          console.warn('[E2E] Received encrypted payload before handshake complete — discarding');
          return;
        }
        try {
          const decryptedEvent = await decryptPayload(secret, message.encrypted);
          handleInternalEvent(decryptedEvent);
        } catch (err) {
          console.error('[E2E] Failed to decrypt payload:', err);
        }
      }
    });

    const handleInternalEvent = (event: AgentDeckEvent<any>) => {
      if (event.type === 'server.system_status') {
        setSystemStatus(event.payload);
        return;
      }

      if (event.type === 'server.auth_result') {
        if (event.payload.success) {
          console.log('[E2E] Authentication successful');
          if (event.payload.token) {
            localStorage.setItem('agentdeck_token', event.payload.token);
          }
        } else {
          console.error('[E2E] Authentication failed:', event.payload.error);
          setAgentStatus({ status: 'error', message: event.payload.error || 'Authentication Failed' });
        }
        return;
      }

      if (event.type === 'session.history') {
        const historyEvents = event.payload as AgentDeckEvent<any>[];
        const logs = historyEvents.filter(e => e.type === 'agent.log');
        setEvents(logs.slice(-1000));

        const statusEvents = historyEvents.filter(e => e.type === 'agent.status');
        if (statusEvents.length > 0) {
          setAgentStatus(statusEvents[statusEvents.length - 1].payload);
        }

        const fileEvents = historyEvents.filter(e => e.type === 'file.changed');
        const latestFiles = new Map<string, FileChangedPayload>();
        for (const fe of fileEvents) {
          latestFiles.set(fe.payload.filePath, fe.payload);
        }
        setFileChanges(Array.from(latestFiles.values()));

        const chatEvents = historyEvents.filter(e => e.type === 'chat.message');
        const loadedMessages = chatEvents.map(e => ({
          id: e.id,
          role: e.payload.role,
          content: e.payload.content,
          timestamp: e.timestamp || Date.now()
        }));
        setMessages(loadedMessages);

        return;
      }

      if (event.type === 'agent.log') {
        setEvents(prev => [...prev, event].slice(-1000));
      } else if (event.type === 'chat.message') {
        const payload = event.payload as ChatMessagePayload;
        setMessages(prev => [...prev, {
          id: event.id,
          role: payload.role,
          content: payload.content,
          timestamp: event.timestamp
        }]);
      } else if (event.type === 'agent.status') {
        setAgentStatus(event.payload);
        if (event.payload.status !== 'waiting_approval') {
          setApprovalRequest(null);
        }
      } else if (event.type === 'agent.approval_request') {
        setApprovalRequest({ ...event.payload, timestamp: event.timestamp || Date.now() });
      } else if (event.type === 'file.changed') {
        setFileChanges(prev => {
          const existingIdx = prev.findIndex(fc => fc.filePath === event.payload.filePath);
          if (existingIdx >= 0) {
            const next = [...prev];
            next[existingIdx] = event.payload;
            return next;
          }
          return [...prev, event.payload];
        });
      }
    };

    newSocket.on('disconnect', () => {
      setConnected(false);
      connectedRef.current = false;
      setAgentStatus({ status: 'idle', message: 'Disconnected' });
      // Clear the shared secret on disconnect — a fresh handshake is needed on reconnect.
      sharedSecretRef.current = null;
      setIsE2EReady(false);
    });

    // Local mode direct event bindings
    newSocket.on('session.history', (history: any) => handleInternalEvent({ type: 'session.history', payload: history } as any));
    newSocket.on('agent.log', handleInternalEvent);
    newSocket.on('chat.message', handleInternalEvent);
    newSocket.on('agent.status', handleInternalEvent);
    newSocket.on('agent.approval_request', handleInternalEvent);
    newSocket.on('file.changed', handleInternalEvent);
    newSocket.on('server.system_status', handleInternalEvent);

    socketRef.current = newSocket;
    setSocket(newSocket);

    return () => {
      newSocket.close();
      socketRef.current = null;
      sharedSecretRef.current = null;
      setIsE2EReady(false);
    };
  }, [projectId]);

  const sendInternalEvent = async (type: string, payload: any) => {
    const sock = socketRef.current;
    if (!sock || !connectedRef.current || !projectId) return;

    const eventObj = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type,
      source: `remote:${sock.id}`,
      payload
    };

    if (projectId.length === 6) {
      // Relay mode — P0-007 FIX: read from ref, not stale state.
      const secret = sharedSecretRef.current;
      if (!secret) {
        console.warn('[E2E] Cannot send: tunnel not established yet');
        return;
      }
      const encrypted = await encryptPayload(secret, eventObj);
      sock.emit('tunnel_message', {
        tunnelId: projectId,
        payload: {
          type: 'encrypted_payload',
          sourceClient: sock.id,
          encrypted
        }
      });
    } else {
      // Local mode — direct emit
      sock.emit('client_event', eventObj);
    }
  };

  const sendCommand = (cmd: string, agentType: string) => {
    sendInternalEvent('client.command', { command: cmd, projectId, agentType });
  };

  const sendApproval = (actionId: string, approved: boolean) => {
    sendInternalEvent('client.approval_response', { actionId, approved, projectId });
    setApprovalRequest(null);
  };

  const sendStdin = (data: string) => {
    sendInternalEvent('client.stdin', { data, projectId });
  };

  const sendChatMessage = (message: string) => {
    sendInternalEvent('client.chat_message', { content: message, projectId });
  };

  const clearMessages = () => {
    setMessages([]);
  };

  return { socket, connected, isE2EReady, events, messages, agentStatus, approvalRequest, fileChanges, sendCommand, sendApproval, sendStdin, sendChatMessage, clearMessages, systemStatus };
}
