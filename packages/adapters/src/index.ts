// Export SDK
export * from './sdk';

// Export built-in providers
export * from './providers/antigravity/AntigravityAdapter';
export * from './providers/claude/ClaudeAdapter';
export * from './providers/aider/AiderAdapter';

// Automatically register built-in providers
import { globalProviderRegistry } from './sdk';
import { AntigravityAdapter } from './providers/antigravity/AntigravityAdapter';
import { ClaudeAdapter } from './providers/claude/ClaudeAdapter';
import { AiderAdapter } from './providers/aider/AiderAdapter';

globalProviderRegistry.registerProvider('antigravity', (sessionId) => new AntigravityAdapter(sessionId));
globalProviderRegistry.registerProvider('claude', (sessionId) => new ClaudeAdapter(sessionId));
globalProviderRegistry.registerProvider('aider', (sessionId) => new AiderAdapter(sessionId));

