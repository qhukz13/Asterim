import { BaseAdapter } from '../../sdk/BaseAdapter';
import { AdapterCapabilities, LaunchConfig, IParser } from '../../sdk/types';
import { AsterimEvent } from '@asterim/shared';

class AiderParser implements IParser {
  constructor(private onEvent: (event: AsterimEvent) => void) {}
  
  public processOutput(chunk: any): void {
    // Stub implementation
  }
}

export class AiderAdapter extends BaseAdapter {
  public readonly id = 'aider';
  
  public readonly capabilities: AdapterCapabilities = {
    supportsDiff: true,
    supportsTerminal: true,
    supportsInterrupt: true,
    supportsResume: false,
    supportsVision: false,
    supportsApproval: false,
    supportsNotifications: false,
    supportsContextFiles: true,
    supportsMultiSession: true,
    supportsRemoteExecution: false,
    supportsStreaming: false
  };

  public getLaunchCommand(config: LaunchConfig): { cmd: string; args: string[]; env?: Record<string, string> } {
    return {
      cmd: 'node',
      args: ['-e', 'console.log("Aider stub running")'],
      env: {}
    };
  }

  public createParser(onEvent: (event: AsterimEvent) => void): IParser {
    return new AiderParser(onEvent);
  }
}
