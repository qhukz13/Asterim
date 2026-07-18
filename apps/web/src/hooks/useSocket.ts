import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  AsterimEvent,
  AgentStatusPayload,
  FileChangedPayload,
  ApprovalRequestPayload,
  QuestionRequestPayload
} from '@asterim/shared';
import {
  generateECDHKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedSecret,
  encryptPayload,
  decryptPayload
} from '@asterim/shared';

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
}

export function useSocket(
  projectId: string | null,
  threadId: string | null,
  activeBackendUrl?: string,
  relayUrl?: string
) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<AsterimEvent<any>[]>([]);

  const [agentStatus, setAgentStatus] = useState<AgentStatusPayload>({ status: 'idle' });
  const [approvalRequest, setApprovalRequest] = useState<
    (ApprovalRequestPayload & { timestamp?: number }) | null
  >(null);
  const [questionRequest, setQuestionRequest] = useState<
    (QuestionRequestPayload & { timestamp?: number }) | null
  >(null);
  const [fileChanges, setFileChanges] = useState<FileChangedPayload[]>([]);
  const [systemStatus, setSystemStatus] = useState<{
    binaries: { claude: boolean; aider: boolean; antigravity: boolean };
  } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const sharedSecretRef = useRef<CryptoKey | null>(null);
  const [isE2EReady, setIsE2EReady] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const connectedRef = useRef(false);

  // We keep the raw history from the server to re-filter when threadId changes without reconnecting
  const rawHistoryRef = useRef<AsterimEvent<any>[]>([]);

  const threadIdRef = useRef(threadId);
  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  const applyHistory = (historyEvents: AsterimEvent<any>[], currentThreadId: string | null) => {
    // file changes are global to project
    const fileEvents = historyEvents.filter(e => e.type === 'file.changed');
    const latestFiles = new Map<string, FileChangedPayload>();
    for (const fe of fileEvents) {
      latestFiles.set(fe.payload.filePath, fe.payload);
    }
    setFileChanges(Array.from(latestFiles.values()));

    // Filter others by threadId
    const threadEvents = historyEvents.filter(
      e => !e.payload?.threadId || e.payload.threadId === currentThreadId
    );

    const logs = threadEvents.filter(e => e.type === 'agent.log');
    setEvents(logs.slice(-1000));

    const statusEvents = threadEvents.filter(e => e.type === 'agent.status');
    if (statusEvents.length > 0) {
      setAgentStatus(statusEvents[statusEvents.length - 1].payload);
    } else {
      setAgentStatus({ status: 'idle' });
    }

    const chatEvents = threadEvents.filter(e => e.type === 'chat.message');
    const loadedMessages = chatEvents.map(e => ({
      id: e.id,
      role: e.payload.role,
      content: e.payload.content,
      timestamp: e.timestamp || Date.now()
    }));
    setMessages(loadedMessages);

    // Clear transient states
    setApprovalRequest(null);
    setQuestionRequest(null);
  };

  useEffect(() => {
    if (rawHistoryRef.current.length > 0) {
      applyHistory(rawHistoryRef.current, threadId);
    }
  }, [threadId]);

  useEffect(() => {
    if (!projectId) return;

    const isRelayMode = projectId.length === 6;
    let newSocket: Socket;
    let localKeyPair: CryptoKeyPair | null = null;

    const getStorageKey = () =>
      activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
    const tokenKey = getStorageKey();
    const token = localStorage.getItem(tokenKey);

    if (isRelayMode) {
      const url = relayUrl || 'http://localhost:4000';
      newSocket = io(url);
    } else {
      newSocket = io(activeBackendUrl || `http://localhost:3000`, {
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

    newSocket.on('connect_error', err => {
      console.error('[Socket] Connection error:', err.message);
      if (err.message === 'unauthorized') {
        localStorage.removeItem(tokenKey);
        window.location.reload();
      }
    });

    newSocket.on('tunnel_message', async (message: any) => {
      if (message.type === 'e2e_handshake_server' && localKeyPair) {
        const serverPubKey = await importPublicKey(message.publicKey);
        const secret = await deriveSharedSecret(localKeyPair.privateKey, serverPubKey);

        sharedSecretRef.current = secret;
        setIsE2EReady(true);

        const myJwk = await exportPublicKey(localKeyPair.publicKey);
        newSocket.emit('tunnel_message', {
          tunnelId: projectId,
          payload: {
            type: 'e2e_handshake_client',
            sourceClient: newSocket.id,
            publicKey: myJwk
          }
        });

        const pin = localStorage.getItem('asterim_remote_pin') || token;
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
        const secret = sharedSecretRef.current;
        if (!secret) return;
        try {
          const decryptedEvent = await decryptPayload(secret, message.encrypted);
          handleInternalEvent(decryptedEvent);
        } catch (err) {
          console.error('[E2E] Failed to decrypt payload:', err);
        }
      }
    });

    const handleInternalEvent = (event: AsterimEvent<any>) => {
      if (event.type === 'server.system_status') {
        setSystemStatus(event.payload);
        return;
      }
      if (event.type === 'server.auth_result') {
        if (event.payload.success) {
          if (event.payload.token) localStorage.setItem(tokenKey, event.payload.token);
        } else {
          setAgentStatus({
            status: 'error',
            message: event.payload.error || 'Authentication Failed'
          });
          localStorage.removeItem(tokenKey);
          window.location.reload();
        }
        return;
      }

      if (event.type === 'session.history') {
        const historyEvents = event.payload as AsterimEvent<any>[];
        rawHistoryRef.current = historyEvents;
        applyHistory(historyEvents, threadId);
        return;
      }

      if (event.type === 'file.changed') {
        rawHistoryRef.current.push(event);
        setFileChanges(prev => {
          const existingIdx = prev.findIndex(fc => fc.filePath === event.payload.filePath);
          if (existingIdx >= 0) {
            const next = [...prev];
            next[existingIdx] = event.payload;
            return next;
          }
          return [...prev, event.payload];
        });
        return;
      }

      // Thread-specific filtering
      if (event.payload?.threadId && event.payload.threadId !== threadIdRef.current) {
        rawHistoryRef.current.push(event); // keep in raw history for switching threads
        return;
      }

      rawHistoryRef.current.push(event);

      if (event.type === 'agent.log') {
        setEvents(prev => [...prev, event].slice(-1000));
      } else if (event.type === 'chat.message') {
        const payload = event.payload as any;
        setMessages(prev => [
          ...prev,
          {
            id: event.id,
            role: payload.role,
            content: payload.content,
            timestamp: event.timestamp
          }
        ]);
      } else if (event.type === 'agent.status') {
        setAgentStatus(event.payload);
        if (event.payload.status === 'error' && event.payload.message) {
          setMessages(prev => [
            ...prev,
            {
              id: event.id || Date.now().toString(),
              role: 'system',
              content: `⚠️ **System Error**: ${event.payload.message}`,
              timestamp: event.timestamp || Date.now()
            }
          ]);
        }
        if (event.payload.status !== 'waiting_approval') {
          setApprovalRequest(null);
        }
      } else if (event.type === 'agent.approval_request') {
        if (!event.payload) return;
        setApprovalRequest({ ...event.payload, timestamp: event.timestamp || Date.now() });
      } else if (event.type === 'agent.question_request') {
        if (!event.payload) return;
        setQuestionRequest({ ...event.payload, timestamp: event.timestamp || Date.now() });
      }
    };

    newSocket.on('disconnect', () => {
      setConnected(false);
      connectedRef.current = false;
      setAgentStatus({ status: 'idle', message: 'Disconnected' });
      sharedSecretRef.current = null;
      setIsE2EReady(false);
    });

    newSocket.on('session.history', (history: any) =>
      handleInternalEvent({ type: 'session.history', payload: history } as any)
    );
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
  }, [projectId]); // Don't reconnect on threadId change!

  const sendInternalEvent = async (type: string, payload: any) => {
    const sock = socketRef.current;
    if (!sock || !connectedRef.current || !projectId) return;

    const generateId = () => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    };

    const eventObj = {
      id: generateId(),
      timestamp: Date.now(),
      type,
      source: `remote:${sock.id}`,
      payload: { ...payload, threadId }
    };

    if (projectId.length === 6) {
      const secret = sharedSecretRef.current;
      if (!secret) return;
      const encrypted = await encryptPayload(secret, eventObj);
      sock.emit('tunnel_message', {
        tunnelId: projectId,
        payload: { type: 'encrypted_payload', sourceClient: sock.id, encrypted }
      });
    } else {
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

  const sendQuestionResponse = (
    questionId: string,
    selectedIndex: number,
    selectedText?: string
  ) => {
    sendInternalEvent('client.question_response', {
      questionId,
      selectedIndex,
      selectedText,
      projectId
    });
    setQuestionRequest(null);
  };

  const sendStdin = (data: string) => {
    sendInternalEvent('client.stdin', { data, projectId });
  };

  const clearMessages = () => {
    setMessages([]);
    setEvents([]);
    sendInternalEvent('client.clear_chat', { projectId });
    // Also remove from local raw history
    rawHistoryRef.current = rawHistoryRef.current.filter(e => e.payload?.threadId !== threadId);
  };

  const sendChatMessage = (message: string) => {
    sendInternalEvent('client.chat_message', { content: message, projectId });
  };

  return {
    socket,
    connected,
    isE2EReady,
    events,
    messages,
    agentStatus,
    approvalRequest,
    questionRequest,
    fileChanges,
    sendCommand,
    sendApproval,
    sendQuestionResponse,
    sendStdin,
    sendChatMessage,
    clearMessages,
    systemStatus,
    sendInternalEvent
  };
}
