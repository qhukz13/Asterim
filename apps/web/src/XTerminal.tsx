import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { Socket } from 'socket.io-client';
import { useTerminalStore } from './stores/useTerminalStore';
import { useDebugLifecycle } from './utils/debug';
import { TerminalStreamThrottler } from './components/terminal/TerminalStreamThrottler';

export function XTerminal({
  socket,
  projectId,
  sendInternalEvent,
  threadId
}: {
  socket: Socket | null;
  projectId: string;
  sendInternalEvent?: (type: string, payload: any) => void;
  threadId?: string;
}) {
  useDebugLifecycle('XTerminal', { projectId, threadId });

  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  useEffect(() => {
    if (!terminalRef.current || !socket) return;
    
    let focusTimeoutId: ReturnType<typeof setTimeout> | null = null;

    if (!termInstance.current) {
      const term = new Terminal({
        theme: {
          background: 'transparent',
          foreground: '#f8f8f2'
        },
        fontFamily: 'monospace',
        fontSize: 14,
        disableStdin: false,
        convertEol: true,
        scrollback: 10000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);

      term.open(terminalRef.current);
      fit.fit();

      // Write existing buffer from store
      const existingBuffer = useTerminalStore.getState().getBuffer(threadId || projectId);
      if (existingBuffer) {
        term.write(existingBuffer);
        // Backend PTY is likely alive, just resize
        if (sendInternalEvent) {
          sendInternalEvent('client.terminal_resize', { cols: term.cols, rows: term.rows, projectId });
        } else {
          socket.emit('client_event', {
            source: 'client',
            type: 'client.terminal_resize',
            payload: { projectId, cols: term.cols, rows: term.rows }
          });
        }
      } else {
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
      }

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
      focusTimeoutId = setTimeout(() => {
        term.focus();
      }, 100);

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

      return () => {
        if (focusTimeoutId !== null) clearTimeout(focusTimeoutId);
        window.removeEventListener('resize', handleResize);
        term.dispose();
        termInstance.current = null;
      };
    }
  }, [socket, projectId, threadId]);

  // Handle incoming data with TerminalStreamThrottler
  useEffect(() => {
    if (!socket || !termInstance.current) return;

    const throttler = new TerminalStreamThrottler((data) => {
      if (termInstance.current) {
        termInstance.current.write(data);
        useTerminalStore.getState().appendBuffer(threadId || projectId, data);
      }
    });

    const handleData = (event: any) => {
      const isTarget = threadId 
        ? event.payload?.threadId === threadId 
        : event.payload?.projectId === projectId;
        
      if (isTarget && event.payload?.data) {
        throttler.push(event.payload.data);
      }
    };

    const handleLog = (event: any) => {
      if (event.payload?.message) {
        throttler.push(event.payload.message);
      }
    };

    socket.on('terminal.data', handleData);
    socket.on('agent.log', handleLog);

    return () => {
      socket.off('terminal.data', handleData);
      socket.off('agent.log', handleLog);
      throttler.clear();
    };
  }, [socket, projectId, threadId]);

  return (
    <div
      ref={terminalRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', padding: '10px' }}
    />
  );
}
