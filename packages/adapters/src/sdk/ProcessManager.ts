import * as pty from 'node-pty';

/**
 * `ASTERIM_*` variables an agent subprocess is allowed to inherit.
 *
 * Everything else under that prefix is internal configuration — relay endpoints,
 * mode switches, anything added later — and an agent has no reason to read it.
 * The list is an allow-list rather than a deny-list because a deny-list only
 * protects against the variables someone remembered to name.
 */
export const INHERITABLE_ASTERIM_ENV = new Set(['ASTERIM_DATA_DIR']);

/**
 * Strips internal Asterim configuration from an environment.
 *
 * An agent runs arbitrary code the user asked for; it does not need the Core's
 * internals, and anything it can read it can also print into a transcript or
 * send to a model. `ASTERIM_DATA_DIR` is kept deliberately: an agent's own MCP
 * memory server resolves the database through it, so removing it would break
 * project memory for exactly the agents this exists to serve.
 */
export function sanitizeAgentEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('ASTERIM_') && !INHERITABLE_ASTERIM_ENV.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

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
            // Sanitized first, then the caller's explicit env: an adapter that
            // deliberately passes a variable is making a choice, and this must
            // not silently override it.
            ...sanitizeAgentEnv(process.env),
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
