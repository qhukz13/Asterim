import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { AgentDeckEvent } from '@agentdeck/shared';

const SERVER_URL = 'http://localhost:3000'; // Target local node server

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<AgentDeckEvent<any>[]>([]);

  useEffect(() => {
    const newSocket = io(SERVER_URL);

    newSocket.on('connect', () => {
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
    });

    // Listen to generic logs for the dashboard
    newSocket.on('agent.log', (event: AgentDeckEvent<any>) => {
      setEvents(prev => [...prev, event].slice(-100)); // Keep only the last 100 events
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  const sendCommand = (cmd: string) => {
    if (socket && connected) {
      socket.emit('client_event', {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'client.command',
        payload: { command: cmd }
      });
    }
  };

  return { connected, events, sendCommand };
}
