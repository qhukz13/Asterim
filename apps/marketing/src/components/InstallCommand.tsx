import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export const InstallCommand: React.FC<{ command: string }> = ({ command }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked; the text is selectable.
    }
  };
  return (
    <span className="install">
      <span className="prompt" aria-hidden="true">
        $
      </span>
      <code>{command}</code>
      <button type="button" onClick={copy} aria-label="Copy command">
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
};
