import path from 'path';
import { BaseAdapter } from '../../sdk/BaseAdapter';
import { AdapterCapabilities, LaunchConfig, IParser } from '../../sdk/types';
import { AntigravityParser } from './AntigravityParser';
import { AsterimEvent } from '@asterim/shared';

export class AntigravityAdapter extends BaseAdapter {
  public readonly id = 'antigravity';
  
  public readonly capabilities: AdapterCapabilities = {
    supportsDiff: true,
    supportsTerminal: true,
    supportsInterrupt: true,
    supportsResume: false,
    supportsVision: false,
    supportsApproval: true,
    supportsNotifications: false,
    supportsContextFiles: true,
    supportsMultiSession: true,
    supportsRemoteExecution: false,
    supportsStreaming: false
  };

  private getRealAgyBinaryPath(): string | null {
    try {
      const { execSync } = require('child_process');
      const cmd = process.platform === 'win32' ? 'where agy' : 'which agy';
      const output = execSync(cmd, { stdio: 'pipe' }).toString().trim();
      if (output) {
        return output.split('\n')[0].trim();
      }
    } catch (err) {
      // Ignore
    }
    
    try {
      const userProfile = process.env.USERPROFILE || process.env.HOME;
      if (userProfile) {
        const defaultPath = path.join(userProfile, 'AppData', 'Local', 'agy', 'bin', 'agy.exe');
        const fs = require('fs');
        if (fs.existsSync(defaultPath)) {
          return defaultPath;
        }
      }
    } catch (err) {
      // Ignore
    }
    
    return null;
  }

  public getLaunchCommand(config: LaunchConfig): { cmd: string; args: string[]; env?: Record<string, string> } {
    const isMock = config.isMock || process.env.MOCK_AGENT === 'true';

    let spawnCmd = isMock ? 'node' : 'agy';
    let spawnArgs = isMock ? [path.join(__dirname, '..', '..', '..', 'mock-antigravity.js')] : [];
    if (!isMock) {
      if (config.hasHistory !== false) {
        spawnArgs.push('-c');
      } else {
        spawnArgs.push('--new-project');
      }
    }

    if (!isMock) {
      const realPath = this.getRealAgyBinaryPath();
      if (realPath) {
        spawnCmd = realPath;
      }
    }

    if (process.platform === 'win32') {
      // Force UTF-8 code page on Windows to avoid Cyrillic mojibake
      spawnArgs = ['/c', 'chcp', '65001', '>nul', '&&', spawnCmd, ...spawnArgs];
      spawnCmd = 'cmd.exe';
    }

    return {
      cmd: spawnCmd,
      args: spawnArgs,
      env: {}
    };
  }

  public createParser(onEvent: (event: AsterimEvent) => void): IParser {
    return new AntigravityParser(onEvent);
  }

  public async sendCommand(command: string): Promise<void> {
    const promise = super.sendCommand(command);
    if (this.parser instanceof AntigravityParser) {
      this.parser.notifyCommandSent(command);
    }
    return promise;
  }
}
