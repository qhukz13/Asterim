import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import qrcode from 'qrcode-terminal';
import { dbService } from './DatabaseService';
import { printToConsole } from '../utils/logger';

export class StartupService {
  public checkFirstRun(port: number, pairingPin: string, tunnelId: string | null) {
    try {
      const db = dbService.getDb();
      const query = db.prepare("SELECT value FROM settings WHERE key = 'first_run_completed'");
      const row = query.get() as { value: string } | undefined;
      
      const isFirstRun = !row || row.value !== 'true';
      if (!isFirstRun) {
        // Still print the connection info even if it's not the first run
        const localIp = this.getLocalIpAddress();
        const host = localIp || 'localhost';
        printToConsole('\n==================================================');
        printToConsole(`  Local URL    : http://localhost:${port}`);
        if (localIp) {
          printToConsole(`  LAN URL      : http://${localIp}:${port}`);
        }
        if (tunnelId) {
          printToConsole(`  Tunnel ID    : ${tunnelId}`);
        }
        printToConsole('==================================================\n');
        return;
      }

      // 1. Detect local network IPv4 address
      const localIp = this.getLocalIpAddress();
      const host = localIp || 'localhost';
      const pairingUrl = `http://${host}:${port}/?pin=${pairingPin}`;

      // 2. Draw welcome console frame
      printToConsole('\n==================================================');
      printToConsole('           WELCOME TO ASTERIM v0.1');
      printToConsole('      AI Agent Control Plane is Initialized');
      printToConsole('==================================================');
      printToConsole(`  Local URL    : http://localhost:${port}`);
      if (localIp) {
        printToConsole(`  LAN URL      : http://${localIp}:${port}`);
      }
      printToConsole(`  Pairing PIN  : ${pairingPin}`);
      if (tunnelId) {
        printToConsole(`  Tunnel ID    : ${tunnelId}`);
      } else {
        printToConsole('  Tunnel ID    : Not connected to relay server');
      }
      printToConsole('==================================================\n');

      // 3. Generate Pairing QR Code
      printToConsole('Scan this QR code with your mobile device to pair automatically:');
      qrcode.generate(pairingUrl, { small: true });
      printToConsole(`Pairing URL: ${pairingUrl}\n`);

    } catch (err) {
      console.error('[StartupService] Error executing first-run onboarding checks:', err);
    }
  }

  public getAntigravityBinaryPath(): string | null {
    if (this.isBinaryOnPath('agy')) {
      return 'agy';
    }
    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const winPath = path.join(localAppData, 'agy', 'bin', 'agy.exe');
      if (fs.existsSync(winPath)) {
        return winPath;
      }
    } else {
      const unixPath = path.join(os.homedir(), '.agy', 'bin', 'agy');
      if (fs.existsSync(unixPath)) {
        return unixPath;
      }
    }
    return null;
  }

  public checkBinaries() {
    const hasClaude = this.isBinaryOnPath('claude');
    const hasAider = this.isBinaryOnPath('aider');
    const antigravityPath = this.getAntigravityBinaryPath();

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
    if (antigravityPath) {
      console.log(`\x1b[32mℹ️  Info: 'agy' CLI binary found at ${antigravityPath}.
   Asterim will run the real Antigravity agent process.\x1b[0m\n`);
    } else {
      console.log(`\x1b[32mℹ️  Info: 'agy' CLI binary was not found on your PATH or default location.
   Asterim will run in simulated mode using 'mock-antigravity.js'.\x1b[0m\n`);
    }
  }

  public getAgentBinariesStatus() {
    return {
      claude: this.isBinaryOnPath('claude'),
      aider: this.isBinaryOnPath('aider'),
      antigravity: this.getAntigravityBinaryPath() !== null || true
    };
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

  public isBinaryOnPath(binary: string): boolean {
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

