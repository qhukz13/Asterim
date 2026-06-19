import { execSync } from 'child_process';
import os from 'os';
import qrcode from 'qrcode-terminal';
import { dbService } from './DatabaseService';

export class StartupService {
  public checkFirstRun(port: number, pairingPin: string, tunnelId: string | null) {
    try {
      const db = dbService.getDb();
      const query = db.prepare("SELECT value FROM settings WHERE key = 'first_run_completed'");
      const row = query.get() as { value: string } | undefined;
      
      const isFirstRun = !row || row.value !== 'true';
      if (!isFirstRun) {
        return;
      }

      // 1. Detect local network IPv4 address
      const localIp = this.getLocalIpAddress();
      const host = localIp || 'localhost';
      const pairingUrl = `http://${host}:${port}/?pin=${pairingPin}`;

      // 2. Check binary paths
      const hasClaude = this.isBinaryOnPath('claude');
      const hasAider = this.isBinaryOnPath('aider');

      // 3. Draw welcome console frame
      console.log('\n==================================================');
      console.log('           WELCOME TO AGENTDECK v0.1');
      console.log('      AI Agent Control Plane is Initialized');
      console.log('==================================================');
      console.log(`  Local URL    : http://localhost:${port}`);
      if (localIp) {
        console.log(`  LAN URL      : http://${localIp}:${port}`);
      }
      console.log(`  Pairing PIN  : ${pairingPin}`);
      if (tunnelId) {
        console.log(`  Tunnel ID    : ${tunnelId}`);
      } else {
        console.log('  Tunnel ID    : Not connected to relay server');
      }
      console.log('==================================================\n');

      // Check warnings
      if (!hasClaude) {
        console.warn(`\x1b[33m⚠️  Warning: 'claude' CLI binary was not found on your PATH.
   Claude Code is required for the Claude Agent.
   Install via: npm install -g @anthropic-ai/claude-code\x1b[0m\n`);
      }
      if (!hasAider) {
        console.warn(`\x1b[33m⚠️  Warning: 'aider' CLI binary was not found on your PATH.
   Aider is required for the Aider Agent.
   Install via: pip install aider-chat\x1b[0m\n`);
      }

      // 4. Generate Pairing QR Code
      console.log('Scan this QR code with your mobile device to pair automatically:');
      qrcode.generate(pairingUrl, { small: true });
      console.log(`Pairing URL: ${pairingUrl}\n`);

    } catch (err) {
      console.error('[StartupService] Error executing first-run onboarding checks:', err);
    }
  }

  private getLocalIpAddress(): string | null {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
      const iface = interfaces[devName];
      if (!iface) continue;
      for (const alias of iface) {
        if (alias.family === 'IPv4' && !alias.internal) {
          return alias.address;
        }
      }
    }
    return null;
  }

  private isBinaryOnPath(binary: string): boolean {
    try {
      const cmd = process.platform === 'win32' ? `where ${binary}` : `which ${binary}`;
      execSync(cmd, { stdio: 'ignore' });
      return true;
    } catch (e) {
      return false;
    }
  }
}

export const startupService = new StartupService();
