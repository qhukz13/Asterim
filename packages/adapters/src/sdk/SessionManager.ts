import { BaseAdapter } from './BaseAdapter';
import { globalProviderRegistry } from './ProviderRegistry';
import { LaunchConfig } from './types';
import { AsterimEvent } from '@asterim/shared';

export class SessionManager {
  private activeSessions = new Map<string, BaseAdapter>();

  /**
   * Start a new agent session.
   * @param providerId The ID of the provider to use (e.g., 'antigravity')
   * @param sessionId A unique ID for this session
   * @param config Launch configuration
   * @param onEvent Callback for unified events from this session
   * @param onExit Optional callback when the process exits
   */
  public async startSession(
    providerId: string,
    sessionId: string,
    config: LaunchConfig,
    onEvent: (event: AsterimEvent) => void,
    onExit?: (code: number) => void
  ): Promise<void> {
    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is already active.`);
    }

    const adapter = globalProviderRegistry.createAdapter(providerId, sessionId);
    
    // Wire the session-scoped event bus up to the global listener
    adapter.getEventBus().subscribe(onEvent);

    try {
      await adapter.start({
        ...config,
        onExit: (code) => {
          this.activeSessions.delete(sessionId);
          if (onExit) onExit(code);
        }
      });
      this.activeSessions.set(sessionId, adapter);
    } catch (err) {
      adapter.getEventBus().unsubscribe(onEvent);
      throw err;
    }
  }

  public async stopSession(sessionId: string): Promise<void> {
    const adapter = this.activeSessions.get(sessionId);
    if (adapter) {
      await adapter.stop();
      this.activeSessions.delete(sessionId);
    }
  }

  public async sendCommand(sessionId: string, command: string): Promise<void> {
    const adapter = this.activeSessions.get(sessionId);
    if (adapter) {
      await adapter.sendCommand(command);
    } else {
      console.warn(`[SessionManager] Cannot send command: session ${sessionId} not found`);
    }
  }

  public writeStdin(sessionId: string, data: string): void {
    const adapter = this.activeSessions.get(sessionId);
    if (adapter) {
      adapter.writeStdin(data);
    }
  }

  public getSessionAdapter(sessionId: string): BaseAdapter | undefined {
    return this.activeSessions.get(sessionId);
  }
}
