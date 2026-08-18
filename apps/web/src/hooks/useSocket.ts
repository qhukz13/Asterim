import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  AsterimEvent,
  AgentStatusPayload,
  FileChangedPayload,
  ApprovalRequestPayload,
  McpServerEventPayload,
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
import { useTerminalStore } from '../stores/useTerminalStore';
import { useMemoryStore, isMemoryEvent } from '../stores/useMemoryStore';
import { MCP_EVENT_TYPES, useMcpStore } from '../stores/useMcpStore';
import { activeProfileIdForThread } from '../stores/useProfileStore';
import {
  DELEGATION_EVENT_TYPES,
  handleDelegationEvent,
  isDelegationEvent
} from '../stores/useProjectStore';
import {
  TEAM_TURN_EVENT_TYPES,
  handleTeamTurnEvent,
  isTeamTurnEvent
} from '../stores/useTeamAgentStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

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
    // Delegation briefs and outcomes are replayed so a reload still knows what
    // each child was asked to do and what came back. The two *live* states —
    // which child is running, and whether a parent is parked — are deliberately
    // not replayed: they describe sessions, and a session that was running when
    // the page was last open is not running now. Those come from
    // `GET /threads/:id/children`, which reads the Core's own memory.
    for (const event of historyEvents) {
      if (
        event.type === 'delegation.started' ||
        event.type === 'delegation.completed' ||
        // A fan-out's aggregate is a fact about work that is over, like the two
        // above it, so a reload still shows the card the operator was reading.
        event.type === 'delegation.batch_completed'
      ) {
        handleDelegationEvent(event.type, event.payload);
      }
    }

    // file changes are global to project
    const fileEvents = historyEvents.filter(e => e.type === 'file.changed');
    const latestFiles = new Map<string, FileChangedPayload>();
    for (const fe of fileEvents) {
      if (fe.payload?.filePath) {
        latestFiles.set(fe.payload.filePath, fe.payload);
      }
    }
    setFileChanges(Array.from(latestFiles.values()));

    // Filter thread-scoped events strictly by threadId
    const threadEvents = currentThreadId
      ? historyEvents.filter(e => e.payload?.threadId === currentThreadId)
      : historyEvents;

    const logs = threadEvents.filter(e => e.type === 'agent.log');
    setEvents(logs.slice(-1000));

    const statusEvents = threadEvents.filter(e => e.type === 'agent.status');
    if (statusEvents.length > 0) {
      setAgentStatus(statusEvents[statusEvents.length - 1].payload);
    } else {
      setAgentStatus({ status: 'idle' });
    }

    const chatEvents = threadEvents.filter(e => e.type === 'chat.message');
    const msgMap = new Map<string, ChatMessage>();
    for (const e of chatEvents) {
      if (e.payload?.role && e.payload?.content) {
        msgMap.set(e.id, {
          id: e.id,
          role: e.payload.role,
          content: e.payload.content,
          timestamp: e.timestamp || Date.now()
        });
      }
    }
    setMessages(Array.from(msgMap.values()));

    // Restore or clear transient states based on historical status
    const approvalEvents = threadEvents.filter(e => e.type === 'agent.approval_request');
    const latestApproval =
      approvalEvents.length > 0 ? approvalEvents[approvalEvents.length - 1] : null;
    const currentStatus =
      statusEvents.length > 0 ? statusEvents[statusEvents.length - 1].payload?.status : 'idle';

    if (currentStatus === 'waiting_approval' && latestApproval?.payload) {
      setApprovalRequest({
        ...latestApproval.payload,
        timestamp: latestApproval.timestamp || Date.now()
      });
    } else {
      setApprovalRequest(null);
    }

    const questionEvents = threadEvents.filter(e => e.type === 'agent.question_required');
    const latestQuestion =
      questionEvents.length > 0 ? questionEvents[questionEvents.length - 1] : null;

    if (currentStatus === 'waiting_question' && latestQuestion?.payload) {
      setQuestionRequest({
        ...latestQuestion.payload,
        timestamp: latestQuestion.timestamp || Date.now()
      });
    } else {
      setQuestionRequest(null);
    }
  };

  useEffect(() => {
    // When threadId changes, re-apply history strictly for the new thread
    if (rawHistoryRef.current.length > 0) {
      applyHistory(rawHistoryRef.current, threadId);
    } else {
      setMessages([]);
      setEvents([]);
      setApprovalRequest(null);
      setQuestionRequest(null);
    }
  }, [threadId]);

  useEffect(() => {
    if (!projectId) return;

    // Reset history buffer and state when project changes
    rawHistoryRef.current = [];
    setMessages([]);
    setEvents([]);
    setApprovalRequest(null);
    setQuestionRequest(null);

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
        // The team room is joined by the effect below rather than here: it has
        // to be re-joined when the active team changes as well as when the
        // socket is rebuilt, and one place deciding it is one place to be wrong.
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

      // Memory events are project-scoped, not thread-scoped, so they are routed
      // before the thread filter below — a decision belongs to the project whichever
      // thread happened to be open when an agent recorded it.
      if (isMemoryEvent(event)) {
        rawHistoryRef.current.push(event);
        useMemoryStore.getState().handleMemoryEvent(event);
        return;
      }

      // Delegation events describe a relationship *between* two threads, so
      // they are routed before the thread filter below — an event about a child
      // is exactly what the parent's view needs, and filtering it out because
      // its threadId is not the open one is how the waiting banner would never
      // appear.
      if (isDelegationEvent(event)) {
        rawHistoryRef.current.push(event);
        handleDelegationEvent(event.type, event.payload);
        return;
      }

      // Team turns are scoped to a collaborative thread rather than to the
      // thread open in this tab, so like delegation they are routed before the
      // thread filter below — a member watching the queue move is watching
      // somebody else's turn, by definition.
      if (isTeamTurnEvent(event)) {
        handleTeamTurnEvent(event.type, event.payload);
        return;
      }

      // Thread-specific filtering
      if (
        threadIdRef.current &&
        event.payload?.threadId &&
        event.payload.threadId !== threadIdRef.current
      ) {
        rawHistoryRef.current.push(event); // keep in raw history for switching threads
        return;
      }

      if (
        event.type === 'chat.message' &&
        threadIdRef.current &&
        event.payload?.threadId !== threadIdRef.current
      ) {
        rawHistoryRef.current.push(event);
        return;
      }

      rawHistoryRef.current.push(event);

      if (event.type === 'agent.log') {
        setEvents(prev => [...prev, event].slice(-1000));
      } else if (event.type === 'chat.message') {
        const payload = event.payload as any;
        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === event.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], content: payload.content };
            return next;
          }
          return [
            ...prev,
            {
              id: event.id,
              role: payload.role,
              content: payload.content,
              timestamp: event.timestamp
            }
          ];
        });
      } else if (event.type === 'agent.status') {
        console.log(
          `[PIPELINE_DEBUG] [STATUS_CHANGE] ts=${Date.now()} status=${event.payload?.status} message=${event.payload?.message}`
        );
        setAgentStatus(event.payload);
        if (event.payload.status === 'error' && event.payload.message) {
          setMessages(prev => [
            ...prev,
            {
              id: event.id || Date.now().toString(),
              role: 'system',
              content: `**System Error**: ${event.payload.message}`,
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
      } else if (event.type === 'terminal.data') {
        const thread = event.payload?.threadId || threadIdRef.current;
        if (thread && event.payload?.data) {
          useTerminalStore.getState().appendBuffer(thread, event.payload.data);
        }
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
    newSocket.on('agent.stream', handleInternalEvent);
    newSocket.on('chat.message', handleInternalEvent);
    newSocket.on('agent.status', handleInternalEvent);
    newSocket.on('agent.approval_request', handleInternalEvent);
    newSocket.on('file.changed', handleInternalEvent);
    newSocket.on('server.system_status', handleInternalEvent);
    newSocket.on('terminal.data', handleInternalEvent);
    // MCP servers belong to the workstation, so these arrive as broadcasts
    // rather than through a project room.
    for (const mcpType of MCP_EVENT_TYPES) {
      newSocket.on(mcpType, (event: AsterimEvent<McpServerEventPayload>) => {
        useMcpStore.getState().handleMcpEvent(event);
      });
    }

    // The four delegation lifecycle events (P7-02). They carry a projectId, so
    // they arrive through the project room like everything else.
    for (const delegationType of DELEGATION_EVENT_TYPES) {
      newSocket.on(delegationType, handleInternalEvent);
    }

    // The team turn transitions (P8-02) and approval resolutions (P8-03). They
    // arrive through the workspace room joined above, and carry a projectId as
    // well when the thread is bound to one.
    for (const turnType of TEAM_TURN_EVENT_TYPES) {
      newSocket.on(turnType, handleInternalEvent);
    }

    newSocket.on('memory.decision_created', handleInternalEvent);
    newSocket.on('memory.decision_superseded', handleInternalEvent);
    newSocket.on('memory.decision_updated', handleInternalEvent);
    newSocket.on('memory.rule_created', handleInternalEvent);
    newSocket.on('memory.intent_updated', handleInternalEvent);

    socketRef.current = newSocket;
    setSocket(newSocket);

    return () => {
      newSocket.close();
      socketRef.current = null;
      sharedSecretRef.current = null;
      setIsE2EReady(false);
    };
  }, [projectId]); // Don't reconnect on threadId change!

  // Switching team without switching project would otherwise leave the socket
  // in the old team's room, so a shared thread's queue would stop moving on
  // screen while it kept moving on the Core (P8-02). The socket itself is only
  // rebuilt on a project change, which is why this is its own effect.
  const activeTeamId = useWorkspaceStore(s => s.activeEnvironmentId);
  useEffect(() => {
    const sock = socketRef.current;
    if (!sock || !connected || !activeTeamId) return;
    if (projectId && projectId.length === 6) return; // relay tunnels have no rooms
    sock.emit('join_workspace', activeTeamId);
  }, [activeTeamId, connected, projectId]);

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
    // Read imperatively rather than subscribed: this is not a component, and a
    // subscription here would rebuild the socket's callbacks on every profile
    // change. Undefined when nothing is selected, in which case the Core falls
    // back to whatever the thread was last started under.
    const profileId = activeProfileIdForThread(threadIdRef.current);
    sendInternalEvent('client.command', { command: cmd, projectId, agentType, profileId });
  };

  const sendApproval = (actionId: string, approved: boolean) => {
    sendInternalEvent('client.approval_response', {
      actionId,
      approved,
      projectId,
      threadId: threadIdRef.current
    });
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
    sendInternalEvent('client.clear_chat', { projectId, threadId: threadIdRef.current });
    // Also remove from local raw history
    rawHistoryRef.current = rawHistoryRef.current.filter(e => e.payload?.threadId !== threadId);
  };

  const sendChatMessage = (message: string) => {
    console.log(`[PIPELINE_DEBUG] [INPUT] ts=${Date.now()} sending chat message`);
    sendInternalEvent('client.chat_message', {
      content: message,
      projectId,
      threadId: threadIdRef.current
    });
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
