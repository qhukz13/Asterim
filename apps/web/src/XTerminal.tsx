import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { AgentDeckEvent } from '@agentdeck/shared';

export function XTerminal({ events, onData }: { events: AgentDeckEvent<any>[], onData?: (data: string) => void }) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const renderedIndex = useRef(0);
  const onDataRef = useRef(onData);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    if (!terminalRef.current) return;

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

      term.onData(data => {
        if (onDataRef.current) {
          onDataRef.current(data);
        }
      });

      termInstance.current = term;
      fitAddon.current = fit;
      
      // Auto-focus so user can type immediately
      setTimeout(() => term.focus(), 100);

      const handleResize = () => fit.fit();
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
        term.dispose();
        termInstance.current = null;
      };
    }
  }, []);

  useEffect(() => {
    if (termInstance.current && events.length > 0) {
      // Write new events
      for (let i = renderedIndex.current; i < events.length; i++) {
        const msg = events[i].payload.message || '';
        termInstance.current.write(msg);
      }
      renderedIndex.current = events.length;
    } else if (events.length === 0 && renderedIndex.current > 0) {
      termInstance.current?.clear();
      renderedIndex.current = 0;
    }
  }, [events]);

  return <div ref={terminalRef} style={{ width: '100%', height: '100%', overflow: 'hidden', padding: '10px' }} />;
}
