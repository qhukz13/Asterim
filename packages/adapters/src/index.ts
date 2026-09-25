// Export SDK
export * from './sdk';

// Export built-in providers
export * from './providers/antigravity/AntigravityAdapter';
export * from './providers/claude/ClaudeAdapter';
export * from './providers/claude/consequence';

// Automatically register built-in providers
import { globalProviderRegistry } from './sdk';
import { AntigravityAdapter } from './providers/antigravity/AntigravityAdapter';
import { ClaudeAdapter } from './providers/claude/ClaudeAdapter';

globalProviderRegistry.registerProvider(
  'claude',
  (sessionId) => new ClaudeAdapter(sessionId),
  {
    name: 'Claude Code',
    status: 'stable',
    description: "Anthropic's CLI agent. Asterim drives it headlessly and answers its permission prompts natively.",
    installCommand: 'npm install -g @anthropic-ai/claude-code'
  }
);

globalProviderRegistry.registerProvider(
  'antigravity',
  (sessionId) => new AntigravityAdapter(sessionId),
  {
    name: 'Antigravity — preview',
    status: 'preview',
    description: "Google's CLI agent, driven through its terminal interface.",
    installCommand: 'Install the Antigravity CLI (agy) from Google.'
  }
);

