import React, { useState, useEffect } from 'react';
import { BookOpen, Terminal, Layers, ShieldCheck, Cpu, Server, FileCode2, Lock, FileText, ChevronRight, Search } from 'lucide-react';

interface DocsPageProps {
  navigate: (path: string) => void;
}

export const DocsPage: React.FC<DocsPageProps> = ({ navigate }) => {
  const [activeTopic, setActiveTopic] = useState('quickstart');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const topic = params.get('topic');
    if (topic) {
      setActiveTopic(topic);
    }
  }, []);

  const selectTopic = (id: string) => {
    setActiveTopic(id);
    navigate(`/docs?topic=${id}`);
  };

  const topics = [
    { id: 'quickstart', label: 'Quickstart Guide', icon: Terminal, group: 'Getting Started' },
    { id: 'what-is-asterim', label: 'What is Asterim?', icon: BookOpen, group: 'Getting Started' },
    { id: 'environments', label: 'Environments & Isolation', icon: Layers, group: 'Core Concepts' },
    { id: 'agents', label: 'AI Agent Subprocesses', icon: Cpu, group: 'Core Concepts' },
    { id: 'security', label: 'AST Command Security', icon: ShieldCheck, group: 'Core Concepts' },
    { id: 'mcp-skills', label: 'MCP Tools & Skills', icon: Server, group: 'Core Concepts' },
    { id: 'architecture', label: 'System Architecture', icon: FileCode2, group: 'Technical Reference' },
    { id: 'cli', label: 'CLI Reference Guide', icon: Terminal, group: 'Technical Reference' },
    { id: 'privacy', label: 'Privacy Policy', icon: Lock, group: 'Legal & Compliance' },
    { id: 'terms', label: 'Terms of Service', icon: FileText, group: 'Legal & Compliance' },
    { id: 'license', label: 'Open Source MIT License', icon: FileCode2, group: 'Legal & Compliance' },
  ];

  const filteredTopics = topics.filter((t) =>
    t.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.group.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'calc(100vh - 80px)',
        maxWidth: '1280px',
        margin: '0 auto',
        width: '100%',
        padding: '32px 24px 64px',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(260px, 300px) 1fr',
          gap: '36px',
          alignItems: 'flex-start',
        }}
      >
        {/* Docs Sidebar */}
        <aside
          style={{
            background: '#0f172a',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            padding: '20px',
            position: 'sticky',
            top: '100px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {/* Search Box */}
          <div style={{ position: 'relative' }}>
            <Search
              size={16}
              style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }}
            />
            <input
              type="text"
              placeholder="Search documentation..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 36px',
                borderRadius: '8px',
                background: '#04070d',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#f8fafc',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            />
          </div>

          {/* Navigation List */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {['Getting Started', 'Core Concepts', 'Technical Reference', 'Legal & Compliance'].map((group) => {
              const groupTopics = filteredTopics.filter((t) => t.group === group);
              if (groupTopics.length === 0) return null;
              return (
                <div key={group}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '8px', paddingLeft: '8px' }}>
                    {group}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {groupTopics.map((t) => {
                      const Icon = t.icon;
                      const isActive = activeTopic === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => selectTopic(t.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            background: isActive ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                            border: isActive ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid transparent',
                            color: isActive ? '#34d399' : '#94a3b8',
                            fontSize: '0.88rem',
                            fontWeight: isActive ? 600 : 500,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Icon size={16} style={{ color: isActive ? '#10b981' : '#64748b' }} />
                            {t.label}
                          </span>
                          {isActive && <ChevronRight size={14} style={{ color: '#10b981' }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Content Viewer Main Body */}
        <main
          style={{
            background: '#0f172a',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            padding: '40px',
            color: '#cbd5e1',
            lineHeight: 1.7,
            minHeight: '600px',
          }}
        >
          {activeTopic === 'quickstart' && (
            <div>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', marginBottom: '16px' }}>
                Quickstart Guide
              </h1>
              <p style={{ fontSize: '1.1rem', color: '#94a3b8', marginBottom: '32px' }}>
                Get Asterim installed and start your first autonomous AI agent session in under 2 minutes.
              </p>

              <h2 style={{ fontSize: '1.4rem', color: '#f8fafc', margin: '32px 0 16px' }}>1. Global Installation</h2>
              <p>Install the Asterim CLI globally via NPM:</p>
              <pre style={codeStyle}>npm install -g asterim</pre>

              <h2 style={{ fontSize: '1.4rem', color: '#f8fafc', margin: '32px 0 16px' }}>2. Initialize Workstation</h2>
              <p>Start the local workstation daemon on default port 3000:</p>
              <pre style={codeStyle}>asterim start</pre>

              <h2 style={{ fontSize: '1.4rem', color: '#f8fafc', margin: '32px 0 16px' }}>3. Launch Desktop or Web UI</h2>
              <p>Open your browser at <code>http://localhost:3000</code> or open the Asterim Desktop App shell.</p>
            </div>
          )}

          {activeTopic === 'what-is-asterim' && (
            <div>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', marginBottom: '16px' }}>
                What is Asterim?
              </h1>
              <p style={{ fontSize: '1.1rem', color: '#94a3b8', marginBottom: '32px' }}>
                Asterim is a local-first AI engineering operating system and control plane designed specifically for developers who direct autonomous AI coding agents.
              </p>

              <h2 style={{ fontSize: '1.4rem', color: '#f8fafc', margin: '24px 0 16px' }}>Core Philosophy</h2>
              <p>
                Unlike traditional IDE extensions that rely on inline code suggestions, Asterim manages the complete subprocess lifecycle, terminal backpressure, real-time command security, and environment credential isolation.
              </p>
            </div>
          )}

          {activeTopic === 'environments' && (
            <div>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', marginBottom: '16px' }}>
                Environments & Workspace Isolation
              </h1>
              <p style={{ fontSize: '1.1rem', color: '#94a3b8', marginBottom: '32px' }}>
                Prevent credential leaks and isolate agent profiles across different projects.
              </p>
              <h2 style={{ fontSize: '1.4rem', color: '#f8fafc', margin: '24px 0 16px' }}>Presets Overview</h2>
              <ul>
                <li><strong>Personal (Local):</strong> Streamlined UX for single-developer side projects.</li>
                <li><strong>Company (Enterprise):</strong> Attached team MCP servers, RBAC governance, and audit streams.</li>
                <li><strong>Client (Sandbox):</strong> Isolated client credentials and restricted execution rights.</li>
              </ul>
            </div>
          )}

          {activeTopic === 'agents' && (
            <div>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', marginBottom: '16px' }}>
                AI Agent Subprocesses
              </h1>
              <p style={{ fontSize: '1.1rem', color: '#94a3b8', marginBottom: '32px' }}>
                Process tree management, PTY output backpressure throttling, and exponential backoff crash recovery.
              </p>
            </div>
          )}

          {activeTopic === 'security' && (
            <div>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', marginBottom: '16px' }}>
                AST Command Security Guard
              </h1>
              <p style={{ fontSize: '1.1rem', color: '#94a3b8', marginBottom: '32px' }}>
                Real-time shell AST syntax scanning and sandbox path traversal protection.
              </p>
            </div>
          )}

          {activeTopic === 'mcp-skills' && (
            <div>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', marginBottom: '16px' }}>
                MCP Tools & Skills
              </h1>
              <p style={{ fontSize: '1.1rem', color: '#94a3b8', marginBottom: '32px' }}>
                Model Context Protocol configuration and reusable task skill definitions.
              </p>
            </div>
          )}

          {activeTopic === 'architecture' && (
            <div>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', marginBottom: '16px' }}>
                System Architecture
              </h1>
              <p style={{ fontSize: '1.1rem', color: '#94a3b8', marginBottom: '32px' }}>
                Decoupled Core Engine, Agent Adapters, Client Shell, and Cloud Identity boundaries.
              </p>
            </div>
          )}

          {activeTopic === 'cli' && (
            <div>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', marginBottom: '16px' }}>
                CLI Command Reference
              </h1>
              <p style={{ fontSize: '1.1rem', color: '#94a3b8', marginBottom: '32px' }}>
                Complete reference guide for the <code>asterim</code> command-line utility.
              </p>
              <pre style={codeStyle}>asterim start --port 3000</pre>
            </div>
          )}

          {activeTopic === 'privacy' && (
            <div>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', marginBottom: '16px' }}>
                Privacy Policy
              </h1>
              <p style={{ fontSize: '1.1rem', color: '#94a3b8', marginBottom: '24px' }}>
                Asterim is designed with strict local-first data boundaries.
              </p>
              <p>Your source code, AST indexes, terminal outputs, and prompt logs remain 100% local to your machine unless routed through explicit user-configured relay tunnels.</p>
            </div>
          )}

          {activeTopic === 'terms' && (
            <div>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', marginBottom: '16px' }}>
                Terms of Service
              </h1>
              <p style={{ fontSize: '1.1rem', color: '#94a3b8', marginBottom: '24px' }}>
                Terms governing public usage of asterim.dev identity services and software downloads.
              </p>
            </div>
          )}

          {activeTopic === 'license' && (
            <div>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', marginBottom: '16px' }}>
                Open Source MIT License
              </h1>
              <p style={{ fontSize: '1.1rem', color: '#94a3b8', marginBottom: '24px' }}>
                Copyright (c) 2026 Asterim Authors.
              </p>
              <pre style={codeStyle}>
                {`Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software.`}
              </pre>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

const codeStyle: React.CSSProperties = {
  background: '#04070d',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '8px',
  padding: '16px 20px',
  fontFamily: 'var(--font-mono)',
  color: '#34d399',
  fontSize: '0.9rem',
  overflowX: 'auto',
  margin: '16px 0 24px',
};
