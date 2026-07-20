import { BaseAdapter } from './BaseAdapter';

export type AdapterFactory = (sessionId: string) => BaseAdapter;

export class ProviderRegistry {
  private factories = new Map<string, AdapterFactory>();

  public registerProvider(id: string, factory: AdapterFactory): void {
    if (this.factories.has(id)) {
      throw new Error(`Provider with id '${id}' is already registered.`);
    }
    this.factories.set(id, factory);
  }

  public createAdapter(id: string, sessionId: string): BaseAdapter {
    const factory = this.factories.get(id);
    if (!factory) {
      throw new Error(`Provider '${id}' not found in registry.`);
    }
    return factory(sessionId);
  }

  public listProviders(): string[] {
    return Array.from(this.factories.keys());
  }
}

export const globalProviderRegistry = new ProviderRegistry();
