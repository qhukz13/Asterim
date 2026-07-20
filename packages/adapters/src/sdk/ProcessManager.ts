import * as pty from 'node-pty';

export interface ProcessManagerOptions {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
}

export class ProcessManager {
  private ptyProcess: pty.IPty | null = null;
  private isShuttingDown: boolean = false;

  public async start(options: ProcessManagerOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ptyProcess = pty.spawn(options.cmd, options.args, {
          name: 'xterm-color',
          cols: 1000,
          rows: 24,
          cwd: options.cwd,
          env: {
            ...process.env,
            ...options.env,
            FORCE_COLOR: '1'
          }
        });

        this.ptyProcess.onData((data) => {
          options.onData(data);
        });

        this.ptyProcess.onExit(({ exitCode }) => {
          if (!this.isShuttingDown) {
             options.onExit(exitCode);
          }
        });

        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  public write(data: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
    }
  }

  public kill(): void {
    this.isShuttingDown = true;
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
  }

  public getPid(): number | undefined {
    return this.ptyProcess?.pid ?? undefined;
  }
}
