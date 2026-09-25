import { BaseAdapter } from './BaseAdapter';

export interface ProviderDescriptor {
  id: string;
  name: string;
  status: 'stable' | 'preview' | 'planned';
  description?: string;
  installCommand?: string;
}

export type AdapterFactory = (sessionId: string) => BaseAdapter;

export class ProviderRegistry {
  private factories = new Map<string, AdapterFactory>();
  private descriptors = new Map<string, ProviderDescriptor>();

  public registerProvider(
    id: string,
    factory: AdapterFactory,
    descriptor?: Partial<ProviderDescriptor>
  ): void {
    if (this.factories.has(id)) {
      throw new Error(`Provider with id '${id}' is already registered.`);
    }
    this.factories.set(id, factory);
    this.descriptors.set(id, {
      id,
      name: descriptor?.name || id,
      status: descriptor?.status || 'preview',
      description: descriptor?.description,
      installCommand: descriptor?.installCommand
    });
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

  public getProviderDescriptors(): ProviderDescriptor[] {
    return Array.from(this.descriptors.values());
  }
}

export const globalProviderRegistry = new ProviderRegistry();
