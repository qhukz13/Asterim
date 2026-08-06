import React, { useEffect, useRef, useState } from 'react';
import { useDebugLifecycle } from './utils/debug';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Prism } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  IconUser,
  IconBot,
  IconChevronRight,
  IconChevronDown,
  IconTerminal,
  IconFileCode,
  IconCheck,
  IconZap
} from './components/icons/Icons';

const SyntaxHighlighter = Prism as any;

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
}

interface ChatViewProps {
  messages: ChatMessage[];
  isWorking: boolean;
  onClearChat?: () => void;
}

interface ToolAccordionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  type?: 'thought' | 'tool' | 'diff';
  status?: 'success' | 'running' | 'failed';
}

function ToolAccordion({ title, children, defaultOpen = false, type = 'tool', status = 'success' }: ToolAccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const renderHeaderIcon = () => {
    if (type === 'thought') return <IconChevronRight size={12} color="var(--color-text-muted)" />;
    if (type === 'diff') return <IconFileCode size={12} color="var(--color-accent-primary)" />;
    return <IconTerminal size={12} color="var(--color-accent-primary)" />;
  };

  const renderStatusPill = () => {
    switch (status) {
      case 'running':
        return (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(6, 182, 212, 0.15)',
              color: '#06b6d4',
              border: '1px solid rgba(6, 182, 212, 0.3)',
              fontFamily: 'var(--font-family-mono)'
            }}
          >
            Running
          </span>
        );
      case 'failed':
        return (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#ef4444',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              fontFamily: 'var(--font-family-mono)'
            }}
          >
            Failed
          </span>
        );
      case 'success':
      default:
        return (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#10b981',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              fontFamily: 'var(--font-family-mono)'
            }}
          >
            Success
          </span>
        );
    }
  };

  return (
    <div
      style={{
        margin: 'var(--spacing-2) 0',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--color-border-subtle)',
        background: 'var(--color-surface-1)',
        overflow: 'hidden'
      }}
    >
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: 'var(--spacing-2) var(--spacing-3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          background: 'var(--color-surface-2)',
          fontSize: 'var(--font-size-xs)',
          fontFamily: 'var(--font-family-mono)',
          color: 'var(--color-text-secondary)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
          {renderHeaderIcon()}
          <span style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>
            {title}
          </span>
          {renderStatusPill()}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--color-text-muted)' }}>
          {isOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          <span>{isOpen ? 'Collapse' : 'Expand Log'}</span>
        </div>
      </div>
      {isOpen && (
        <div
          style={{
            padding: 'var(--spacing-3)',
            background: 'var(--color-surface-0)',
            fontFamily: 'var(--font-family-mono)',
            fontSize: 'var(--font-size-sm)',
            lineHeight: 'var(--line-height-code)',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--color-text-muted)',
            overflowX: 'auto',
            borderTop: '1px solid var(--color-border-subtle)'
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function DiffBlock({ code }: { code: string }) {
  const lines = code.split('\n');
  return (
    <div
      style={{
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        margin: 'var(--spacing-3) 0',
        border: '1px solid var(--color-border-subtle)',
        background: 'var(--color-surface-0)',
        fontFamily: 'var(--font-family-mono)',
        fontSize: 'var(--font-size-sm)',
        lineHeight: 'var(--line-height-code)'
      }}
    >
      <div
        style={{
          background: 'var(--color-surface-2)',
          padding: 'var(--spacing-1) var(--spacing-3)',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-text-muted)',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}
      >
        <span>DIFF EXCERPT</span>
      </div>
      <div style={{ padding: 'var(--spacing-2) 0' }}>
        {lines.map((line, idx) => {
          let bg = 'transparent';
          let color = 'var(--color-text-secondary)';
          if (line.startsWith('+') && !line.startsWith('+++')) {
            bg = 'rgba(16, 185, 129, 0.12)';
            color = '#34d399';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            bg = 'rgba(239, 68, 68, 0.12)';
            color = '#f87171';
          } else if (line.startsWith('@@')) {
            color = '#a78bfa';
          }

          return (
            <div
              key={idx}
              style={{
                padding: '0 var(--spacing-3)',
                background: bg,
                color: color,
                whiteSpace: 'pre-wrap',
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CodeBlock({ language, code, ...props }: { language: string; code: string; [key: string]: any }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      style={{
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        margin: 'var(--spacing-3) 0',
        border: '1px solid var(--color-border-subtle)'
      }}
    >
      <div
        style={{
          background: 'var(--color-surface-2)',
          padding: 'var(--spacing-1) var(--spacing-3)',
          fontSize: 'var(--font-size-xs)',
          fontFamily: 'var(--font-family-mono)',
          color: 'var(--color-text-muted)',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}
      >
        <span>{language}</span>
        <button
          onClick={handleCopy}
          style={{
            background: 'transparent',
            border: 'none',
            color: copied ? 'var(--color-state-completed)' : 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: 'var(--font-size-xs)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 6px',
            borderRadius: 'var(--radius-xs)',
            transition: 'color var(--transition-fast), background var(--transition-fast)'
          }}
          title="Copy code snippet"
        >
          {copied ? <IconCheck size={12} color="var(--color-state-completed)" /> : null}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
      <SyntaxHighlighter
        {...props}
        children={code}
        style={vscDarkPlus as any}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: '0',
          background: 'var(--color-surface-0)',
          padding: 'var(--spacing-3)',
          fontSize: 'var(--font-size-sm)',
          fontFamily: 'var(--font-family-mono)',
          lineHeight: 'var(--line-height-code)',
          fontVariantNumeric: 'tabular-nums'
        }}
      />
    </div>
  );
}

const markdownComponents = {
  code({ node, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    if (match && match[1] === 'diff') {
      return <DiffBlock code={codeString} />;
    }
    return match ? (
      <CodeBlock language={match[1]} code={codeString} {...props} />
    ) : (
      <code
        {...props}
        className={className}
        style={{
          fontFamily: 'var(--font-family-mono)',
          fontSize: '0.875em',
          background: 'var(--color-surface-2)',
          padding: '2px 6px',
          borderRadius: 'var(--radius-xs)',
          color: 'var(--color-accent-hover)',
          border: '1px solid var(--color-border-subtle)',
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {children}
      </code>
    );
  }
};

const renderMessageContent = (content: string) => {
  if (!content.includes('▸ Thought') && !content.includes('[Tool:')) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    );
  }

  const lines = content.split('\n');
  const blocks: { type: 'thought' | 'tool' | 'normal'; title: string; content: string[] }[] = [];
  let currentBlock: { type: 'thought' | 'tool' | 'normal'; title: string; content: string[] } | null = null;

  for (const line of lines) {
    const isThoughtStart = line.trim().startsWith('▸ Thought');
    const isToolStart = line.trim().startsWith('[Tool:');

    if (isThoughtStart || isToolStart) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = {
        type: isThoughtStart ? 'thought' : 'tool',
        title: isThoughtStart ? 'Agent Reasoning & Execution Steps' : line.trim(),
        content: []
      };
    } else {
      if (!currentBlock) {
        currentBlock = { type: 'normal', title: '', content: [] };
      }
      currentBlock.content.push(line);
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return (
    <div className="message-content-container">
      {blocks.map((block, idx) => {
        if (block.type === 'thought' || block.type === 'tool') {
          return (
            <ToolAccordion
              key={idx}
              title={block.title}
              type={block.type}
              defaultOpen={false}
            >
              {block.content.join('\n').trim() || '(No log payload)'}
            </ToolAccordion>
          );
        } else {
          const text = block.content.join('\n').trim();
          if (!text) return null;
          return (
            <div key={idx} style={{ margin: 'var(--spacing-2) 0' }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={markdownComponents}
              >
                {text}
              </ReactMarkdown>
            </div>
          );
        }
      })}
    </div>
  );
};

export const ChatView: React.FC<ChatViewProps> = ({ messages, isWorking }) => {
  const endRef = useRef<HTMLDivElement>(null);

  useDebugLifecycle('ChatView', { messagesCount: messages.length, isWorking });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isWorking]);

  return (
    <div
      className="chat-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-surface-0)',
        overflow: 'hidden'
      }}
    >
      <div
        className="chat-scroll-area"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--spacing-3) var(--spacing-4)'
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              padding: 'var(--spacing-6)',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--spacing-2)'
            }}
          >
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-text-muted)',
                marginBottom: 'var(--spacing-1)'
              }}
            >
              <IconTerminal size={20} color="var(--color-accent-primary)" />
            </div>
            <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>
              No messages in active thread
            </h3>
            <p style={{ fontSize: 'var(--font-size-xs)', maxWidth: '340px', margin: 0 }}>
              Dispatch an instruction to start working with your AI engineering assistant.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
            {messages.map(msg => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  gap: 'var(--spacing-3)',
                  alignItems: 'flex-start'
                }}
              >
                {/* Avatar Badge */}
                <div
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: 'var(--radius-xs)',
                    background: msg.role === 'user' ? 'var(--color-surface-3)' : 'var(--color-surface-2)',
                    color: msg.role === 'user' ? 'var(--color-text-primary)' : 'var(--color-accent-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    border: '1px solid var(--color-border-subtle)'
                  }}
                >
                  {msg.role === 'user' ? <IconUser size={14} /> : <IconBot size={14} />}
                </div>

                {/* Message Bubble Container */}
                <div
                  style={{
                    flex: 1,
                    background: msg.role === 'user' ? 'var(--color-surface-1)' : 'var(--color-surface-0)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--spacing-3) var(--spacing-4)',
                    maxWidth: '100%'
                  }}
                >
                  {/* Header Row */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 'var(--spacing-2)'
                    }}
                  >
                    <span
                      style={{
                        fontSize: 'var(--font-size-md)',
                        fontWeight: 'var(--font-weight-semibold)',
                        color: msg.role === 'user' ? 'var(--color-text-primary)' : 'var(--color-accent-hover)'
                      }}
                    >
                      {msg.role === 'user' ? 'Developer' : 'Agent Assistant'}
                    </span>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>

                  {/* Body Content */}
                  <div
                    style={{
                      fontSize: 'var(--font-size-md)',
                      lineHeight: 'var(--line-height-normal)',
                      color: 'var(--color-text-primary)'
                    }}
                  >
                    {msg.role === 'agent' ? renderMessageContent(msg.content) : msg.content}
                  </div>
                </div>
              </div>
            ))}

            {isWorking && (
              <div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'center' }}>
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: 'var(--radius-xs)',
                    background: 'var(--color-surface-2)',
                    color: 'var(--color-state-working)',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 'var(--font-weight-bold)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--color-border-subtle)'
                  }}
                >
                  A
                </div>
                <div
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-state-working)',
                    fontFamily: 'var(--font-family-mono)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <IconZap size={13} color="var(--color-state-working)" /> Agent working...
                </div>
              </div>
            )}
            <div ref={endRef} style={{ height: 1 }} />
          </div>
        )}
      </div>
    </div>
  );
};
