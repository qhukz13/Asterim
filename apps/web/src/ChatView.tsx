import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

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

const renderMessageContent = (content: string) => {
  if (!content.includes('▸ Thought')) {
    return <ReactMarkdown>{content}</ReactMarkdown>;
  }

  const lines = content.split('\n');
  const blocks: { type: 'thought' | 'normal', content: string[] }[] = [];
  let currentBlock: { type: 'thought' | 'normal', content: string[] } | null = null;

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
              {block.content.map((t, i) => <div key={i}>{t}</div>)}
            </div>
          );
        } else {
          const text = block.content.join('\n').trim();
          if (!text) return null;
          return (
            <div key={idx} className="agent-normal-text">
              <ReactMarkdown>{text}</ReactMarkdown>
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
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-bubble-wrapper ${msg.role === 'user' ? 'user' : 'agent'}`}>
                <div className="chat-bubble-content-row">
                  <div className="chat-avatar">
                    {msg.role === 'user' ? 'U' : 'A'}
                  </div>
                  <div className="chat-bubble">
                    <div className="chat-role">{msg.role === 'user' ? 'You' : 'Agent'}</div>
                    <div className="chat-content">
                      {msg.role === 'agent' ? renderMessageContent(msg.content) : msg.content}
                    </div>
                    <div className="chat-time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
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
