import { AsterimEvent } from '@asterim/shared';
import { IAgentProvider, LaunchConfig, IParser, AdapterCapabilities } from './types';
import { ProcessManager } from './ProcessManager';
import { SessionEventBus } from './EventBus';

export abstract class BaseAdapter implements IAgentProvider {
  public abstract readonly id: string;
  public abstract readonly capabilities: AdapterCapabilities;

  protected processManager: ProcessManager;
  protected eventBus: SessionEventBus;
  protected parser!: IParser;
  
  private sessionId: string;
  private commandQueue: string[] = [];
  private isBusy: boolean = true; // start as busy until initialized

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.processManager = new ProcessManager();
    this.eventBus = new SessionEventBus(sessionId);
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getEventBus(): SessionEventBus {
    return this.eventBus;
  }

  public abstract getLaunchCommand(config: LaunchConfig): { cmd: string; args: string[]; env?: Record<string, string> };
  public abstract createParser(onEvent: (event: AsterimEvent) => void): IParser;

  public async start(config: LaunchConfig & { onExit?: (code: number) => void }): Promise<void> {
    this.parser = this.createParser((event: AsterimEvent) => {
      // Intercept state changes to manage internal queue if needed
      if (event.type === 'agent.status' && event.payload) {
        if (event.payload.status === 'idle') {
          this.isBusy = false;
          this.flushQueue();
        } else if (event.payload.status === 'working' || event.payload.status === 'waiting_approval' || event.payload.status === 'waiting_question') {
          this.isBusy = true;
        }
      }
      this.eventBus.publish(event);
    });

    const launchParams = this.getLaunchCommand(config);

    await this.processManager.start({
      cmd: launchParams.cmd,
      args: launchParams.args,
      cwd: config.workspace,
      env: launchParams.env,
      onData: (data) => {
        this.parser.processOutput(data);
      },
      onExit: (exitCode) => {
        if (config.onExit) {
          config.onExit(exitCode);
        }
      }
    });
  }

  public async stop(): Promise<void> {
    this.processManager.kill();
  }

  public async sendCommand(command: string): Promise<void> {
    if (this.isBusy) {
      this.commandQueue.push(command);
    } else {
      this.isBusy = true;
      this.processManager.write(command + '\r\n');
    }
  }

  public writeStdin(data: string): void {
    this.processManager.write(data);
  }

  public getPid(): number | undefined {
    return this.processManager.getPid();
  }

  private flushQueue() {
    if (this.commandQueue.length > 0) {
      const nextCmd = this.commandQueue.shift();
      if (nextCmd) {
        this.isBusy = true;
        this.processManager.write(nextCmd + '\r\n');
      }
    }
  }
}
