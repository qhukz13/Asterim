import React, { useEffect, useRef, useState } from 'react';
import { useDebugLifecycle } from './utils/debug';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Prism } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

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
}

function ToolAccordion({ title, children, defaultOpen = false, type = 'tool' }: ToolAccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const getHeaderIcon = () => {
    if (type === 'thought') return '▸';
    if (type === 'diff') return '📝';
    return '⚡';
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
          <span>{getHeaderIcon()}</span>
          <span style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>
            {title}
          </span>
        </div>
        <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
          {isOpen ? '▼ Collapse' : '▶ Expand Log'}
        </span>
      </div>
      {isOpen && (
        <div
          style={{
            padding: 'var(--spacing-3)',
            background: 'var(--color-surface-0)',
            fontFamily: 'var(--font-family-mono)',
            fontSize: 'var(--font-size-xs)',
            lineHeight: 1.5,
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

const markdownComponents = {
  code({ node, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    return match ? (
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
          <span>{match[1]}</span>
        </div>
        <SyntaxHighlighter
          {...props}
          children={String(children).replace(/\n$/, '')}
          style={vscDarkPlus as any}
          language={match[1]}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: '0',
            background: 'var(--color-surface-0)',
            padding: 'var(--spacing-3)',
            fontSize: 'var(--font-size-xs)',
            fontFamily: 'var(--font-family-mono)'
          }}
        />
      </div>
    ) : (
      <code
        {...props}
        className={className}
        style={{
          fontFamily: 'var(--font-family-mono)',
          fontSize: '0.85em',
          background: 'var(--color-surface-2)',
          padding: '1px 5px',
          borderRadius: 'var(--radius-xs)',
          color: 'var(--color-accent-hover)',
          border: '1px solid var(--color-border-subtle)'
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
            <div style={{ fontSize: '1.8rem' }}>💬</div>
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
                    color: msg.role === 'user' ? 'var(--color-text-primary)' : 'var(--color-state-working)',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 'var(--font-weight-bold)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    border: '1px solid var(--color-border-subtle)'
                  }}
                >
                  {msg.role === 'user' ? 'U' : 'A'}
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
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
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
                    fontFamily: 'var(--font-family-mono)'
                  }}
                >
                  ⚡ Agent working...
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
