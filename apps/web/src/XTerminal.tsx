import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { Socket } from 'socket.io-client';

export function XTerminal({
  socket,
  projectId,
  sendInternalEvent
}: {
  socket: Socket | null;
  projectId: string;
  sendInternalEvent?: (type: string, payload: any) => void;
}) {
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
        if (sendInternalEvent) {
          sendInternalEvent('client.terminal_input', { data, projectId });
        } else {
          socket.emit('client_event', {
            source: 'client',
            type: 'client.terminal_input',
            payload: { projectId, data }
          });
        }
      });

      termInstance.current = term;
      fitAddon.current = fit;

      // Auto-focus
      setTimeout(() => term.focus(), 100);

      const handleResize = () => {
        fit.fit();
        if (sendInternalEvent) {
          sendInternalEvent('client.terminal_resize', {
            cols: term.cols,
            rows: term.rows,
            projectId
          });
        } else {
          socket.emit('client_event', {
            source: 'client',
            type: 'client.terminal_resize',
            payload: { projectId, cols: term.cols, rows: term.rows }
          });
        }
      };

      window.addEventListener('resize', handleResize);

      // Spawn terminal
      if (sendInternalEvent) {
        sendInternalEvent('client.terminal_spawn', { cols: term.cols, rows: term.rows, projectId });
      } else {
        socket.emit('client_event', {
          source: 'client',
          type: 'client.terminal_spawn',
          payload: { projectId, cols: term.cols, rows: term.rows }
        });
      }

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

    let writeBuffer = '';
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const THROTTLE_MS = 50; // 20 FPS throttle

    const flushBuffer = () => {
      if (writeBuffer && termInstance.current) {
        termInstance.current.write(writeBuffer);
      }
      writeBuffer = '';
      timeoutId = null;
    };

    const handleData = (event: any) => {
      if (event.payload?.projectId === projectId && event.payload?.data) {
        writeBuffer += event.payload.data;
        if (timeoutId === null) {
          timeoutId = setTimeout(flushBuffer, THROTTLE_MS);
        }
      }
    };

    const handleLog = (event: any) => {
      if (event.payload?.message) {
        writeBuffer += event.payload.message;
        if (timeoutId === null) {
          timeoutId = setTimeout(flushBuffer, THROTTLE_MS);
        }
      }
    };

    socket.on('terminal.data', handleData);
    socket.on('agent.log', handleLog);

    return () => {
      socket.off('terminal.data', handleData);
      socket.off('agent.log', handleLog);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [socket, projectId]);

  return (
    <div
      ref={terminalRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', padding: '10px' }}
    />
  );
}
