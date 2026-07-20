import { BaseAdapter } from '../../sdk/BaseAdapter';
import { AdapterCapabilities, LaunchConfig, IParser } from '../../sdk/types';
import { AsterimEvent } from '@asterim/shared';

class ClaudeParser implements IParser {
  constructor(private onEvent: (event: AsterimEvent) => void) {}
  
  public processOutput(chunk: any): void {
    // Stub implementation
  }
}

export class ClaudeAdapter extends BaseAdapter {
  public readonly id = 'claude';
  
  public readonly capabilities: AdapterCapabilities = {
    supportsDiff: false,
    supportsTerminal: false,
    supportsInterrupt: true,
    supportsResume: false,
    supportsVision: true,
    supportsApproval: true,
    supportsNotifications: false,
    supportsContextFiles: true,
    supportsMultiSession: true,
    supportsRemoteExecution: false,
    supportsStreaming: true
  };

  public getLaunchCommand(config: LaunchConfig): { cmd: string; args: string[]; env?: Record<string, string> } {
    return {
      cmd: 'node',
      args: ['-e', 'console.log("Claude stub running")'],
      env: {}
    };
  }

  public createParser(onEvent: (event: AsterimEvent) => void): IParser {
    return new ClaudeParser(onEvent);
  }
}
