import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { Socket } from 'socket.io-client';

export function XTerminal({ socket, projectId }: { socket: Socket | null, projectId: string }) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current || !socket) return;

    if (!termInstance.current) {
      const term = new Terminal({
        theme: {
          background: 'transparent',
          foreground: '#f8f8f2'
        },
        fontFamily: 'monospace',
        fontSize: 14,
        disableStdin: false,
        convertEol: true
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      
      term.open(terminalRef.current);
      fit.fit();

      // Send input to the server
      term.onData(data => {
        socket.emit('client_event', {
          source: 'client',
          type: 'client.terminal_input',
          payload: { projectId, data }
        });
      });

      termInstance.current = term;
      fitAddon.current = fit;
      
      // Auto-focus
      setTimeout(() => term.focus(), 100);

      const handleResize = () => {
        fit.fit();
        socket.emit('client_event', {
          source: 'client',
          type: 'client.terminal_resize',
          payload: { projectId, cols: term.cols, rows: term.rows }
        });
      };
      
      window.addEventListener('resize', handleResize);
      
      // Spawn terminal
      socket.emit('client_event', {
        source: 'client',
        type: 'client.terminal_spawn',
        payload: { projectId, cols: term.cols, rows: term.rows }
      });

      return () => {
        window.removeEventListener('resize', handleResize);
        term.dispose();
        termInstance.current = null;
      };
    }
  }, [socket, projectId]);

  // Handle incoming data
  useEffect(() => {
    if (!socket || !termInstance.current) return;

    const handleData = (event: any) => {
      if (event.payload?.projectId === projectId && event.payload?.data) {
        termInstance.current?.write(event.payload.data);
      }
    };

    const handleLog = (event: any) => {
      if (event.payload?.message) {
        termInstance.current?.write(event.payload.message);
      }
    };

    socket.on('terminal.data', handleData);
    socket.on('agent.log', handleLog);

    return () => {
      socket.off('terminal.data', handleData);
      socket.off('agent.log', handleLog);
    };
  }, [socket, projectId]);

  return <div ref={terminalRef} style={{ width: '100%', height: '100%', overflow: 'hidden', padding: '10px' }} />;
}
