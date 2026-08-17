import { dbService } from '../DatabaseService';
import { secretVault } from '../security/SecretVaultService';
import { IAIProvider } from './IAIProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import { ActiveAgentProvider } from './providers/ActiveAgentProvider';
import { isSovereignMode, announceSovereignBlock } from '../SovereignMode';

class AiService {
  private activeProvider: IAIProvider | null = null;
  private providers = new Map<string, () => IAIProvider>();

  constructor() {
    this.registerProvider('gemini', () => new GeminiProvider());
    this.registerProvider('agent', () => new ActiveAgentProvider());
  }

  public registerProvider(id: string, factory: () => IAIProvider) {
    this.providers.set(id, factory);
  }

  public getProvider(): IAIProvider {
    this.ensureProviderConfigured();
    if (!this.activeProvider) {
      throw new Error('AI Provider could not be initialized.');
    }
    return this.activeProvider;
  }

  private ensureProviderConfigured() {
    try {
      const db = dbService.getDb();
      const query = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'ai_%'");
      const rows = query.all() as { key: string; value: string }[];
      
      // `ai_api_key` is held as a vault envelope (P9-01) while `ai_provider`
      // and `ai_model` are plain configuration, and both arrive in this one
      // result set — so every row is offered to the vault and only envelopes
      // are decrypted.
      const config: Record<string, string> = {};
      for (const row of rows) {
        config[row.key] = secretVault.decryptIfEnvelope(row.value, row.key);
      }

      // DEC-028 § 3: sovereign mode "enforces local CLI execution via
      // ActiveAgentProvider". GeminiProvider posts the diff — project source —
      // to Google, so a sovereign host must not be able to select it, whatever
      // the stored setting says. Not in this task's § 4 list, but an air-gap
      // that still permits an outbound LLM call is not an air-gap.
      const configuredProvider = config['ai_provider'] || 'agent';
      const providerId = isSovereignMode() && configuredProvider !== 'agent' ? 'agent' : configuredProvider;
      if (providerId !== configuredProvider) {
        announceSovereignBlock('AiService', `remote provider '${configuredProvider}' replaced by local agent execution.`);
      }

      // If provider changed or not initialized
      if (!this.activeProvider || this.activeProvider.id !== providerId) {
        const factory = this.providers.get(providerId);
        if (factory) {
          this.activeProvider = factory();
        } else {
          // Fallback
          this.activeProvider = new ActiveAgentProvider();
        }
      }

      this.activeProvider.configure(config);
    } catch (err) {
      console.error('[AiService] Failed to load config from database', err);
      // Fallback
      if (!this.activeProvider) {
        this.activeProvider = new ActiveAgentProvider();
      }
    }
  }
}

export const aiService = new AiService();
