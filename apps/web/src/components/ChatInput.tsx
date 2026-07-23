import React, { useRef } from 'react';
import { useChatStore } from '../stores/useChatStore';
import { CustomDropdown } from './CustomDropdown';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  autoApproval: 'ask' | 'approve' | 'deny';
  setAutoApproval: (val: any) => void;
  threadId: string | null;
}

export function ChatInput({
  onSend,
  disabled,
  autoApproval,
  setAutoApproval,
  threadId
}: ChatInputProps) {
  const getDraft = useChatStore(s => s.getDraft);
  const setDraft = useChatStore(s => s.setDraft);
  
  const input = threadId ? getDraft(threadId) : '';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (input.trim()) {
      onSend(input.trim());
      if (threadId) setDraft(threadId, '');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  return (
    <>
      <div className="approval-dropdown-container">
        <CustomDropdown
          value={autoApproval}
          onChange={setAutoApproval}
          options={[
            { value: 'ask', label: '⚠️ Always Ask for Approval' },
            { value: 'approve', label: '✅ Auto-Approve Commands' },
            { value: 'deny', label: '❌ Auto-Deny Commands' }
          ]}
          dropup={true}
        />
      </div>
      <div className="input-container">
        <textarea
          ref={textareaRef}
          className="input-box"
          placeholder="Ask the agent to do something..."
          value={input}
          onChange={e => {
            if (threadId) setDraft(threadId, e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={disabled}
          rows={1}
        />
        <button className="btn-primary" onClick={handleSend} disabled={disabled}>
          Send
        </button>
      </div>
    </>
  );
}
