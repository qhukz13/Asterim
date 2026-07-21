import React, { useEffect, useRef } from 'react';
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

const markdownComponents = {
  code({ node, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    return match ? (
      <div
        style={{
          borderRadius: '8px',
          overflow: 'hidden',
          margin: '14px 0',
          border: '1px solid rgba(255,255,255,0.1)'
        }}
      >
        <div
          style={{
            background: 'rgba(0,0,0,0.6)',
            padding: '6px 16px',
            fontSize: '0.75rem',
            color: '#9ca3af',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            justifyContent: 'space-between',
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
            background: 'rgba(0,0,0,0.4)',
            padding: '16px'
          }}
        />
      </div>
    ) : (
      <code {...props} className={className}>
        {children}
      </code>
    );
  }
};

const renderMessageContent = (content: string) => {
  if (!content.includes('▸ Thought')) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    );
  }

  const lines = content.split('\n');
  const blocks: { type: 'thought' | 'normal'; content: string[] }[] = [];
  let currentBlock: { type: 'thought' | 'normal'; content: string[] } | null = null;

  for (const line of lines) {
    const isThoughtStart = line.trim().startsWith('▸ Thought');

    if (isThoughtStart) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      blocks.push({ type: 'thought', content: [line.trim()] });
      currentBlock = { type: 'normal', content: [] };
    } else {
      if (!currentBlock || currentBlock.type === 'thought') {
        currentBlock = { type: 'normal', content: [] };
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
        if (block.type === 'thought') {
          return (
            <div key={idx} className="agent-thought">
              {block.content.map((t, i) => (
                <div key={i}>{t}</div>
              ))}
            </div>
          );
        } else {
          const text = block.content.join('\n').trim();
          if (!text) return null;
          return (
            <div key={idx} className="agent-normal-text">
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

export function ChatView({ messages, isWorking, onClearChat }: ChatViewProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isWorking]);

  return (
    <div className="chat-container">
      <div className="chat-scroll-area">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">💬</div>
            <h3>No messages yet</h3>
            <p>Send a message to start the conversation with the agent.</p>
          </div>
        ) : (
          <div className="chat-messages">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`chat-bubble-wrapper ${msg.role === 'user' ? 'user' : 'agent'}`}
              >
                <div className="chat-bubble-content-row">
                  <div className="chat-avatar">{msg.role === 'user' ? 'U' : 'A'}</div>
                  <div className="chat-bubble">
                    <div className="chat-role">{msg.role === 'user' ? 'You' : 'Agent'}</div>
                    <div className="chat-content">
                      {msg.role === 'agent' ? renderMessageContent(msg.content) : msg.content}
                    </div>
                    <div className="chat-time">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {isWorking && (
              <div className="chat-bubble-wrapper agent">
                <div className="chat-bubble-content-row">
                  <div className="chat-avatar">A</div>
                  <div className="chat-bubble typing">
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} style={{ height: 1 }} />
          </div>
        )}
      </div>
    </div>
  );
}
