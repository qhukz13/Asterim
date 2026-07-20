import { dbService } from '../DatabaseService';
import { IAIProvider } from './IAIProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import { ActiveAgentProvider } from './providers/ActiveAgentProvider';

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
      
      const config: Record<string, string> = {};
      for (const row of rows) {
        config[row.key] = row.value;
      }

      const providerId = config['ai_provider'] || 'agent';

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
