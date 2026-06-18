import { spawn } from 'child_process';
import crypto from 'crypto';
export class AiderAdapter {
    process = null;
    eventCallback;
    async start(config) {
        if (this.process) {
            throw new Error('Aider is already running');
        }
        const binPath = config.binaryPath || 'aider';
        const args = ['--no-auto-commits']; // Prevent auto commits for safer testing
        this.process = spawn(binPath, args, {
            cwd: config.workspace,
            env: { ...process.env, FORCE_COLOR: '1' } // Force color output for the dashboard
        });
        this.process.stdout?.on('data', (data) => {
            this.emitLog('info', data.toString());
        });
        this.process.stderr?.on('data', (data) => {
            this.emitLog('error', data.toString());
        });
        this.process.on('close', (code) => {
            this.emitStatus('idle', `Aider exited with code ${code}`);
            this.process = null;
        });
        this.emitStatus('working', 'Aider started');
    }
    async stop() {
        if (this.process) {
            this.process.kill('SIGINT');
            this.process = null;
            this.emitStatus('idle', 'Aider stopped');
        }
    }
    async sendCommand(command) {
        if (this.process && this.process.stdin) {
            this.process.stdin.write(`${command}\n`);
        }
        else {
            throw new Error('Aider process is not running');
        }
    }
    onEvent(callback) {
        this.eventCallback = callback;
    }
    emitLog(level, message) {
        if (!this.eventCallback)
            return;
        this.eventCallback({
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            source: 'adapter:aider',
            type: 'agent.log',
            payload: { level, message }
        });
    }
    emitStatus(status, message) {
        if (!this.eventCallback)
            return;
        this.eventCallback({
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            source: 'adapter:aider',
            type: 'agent.status',
            payload: { status, message }
        });
    }
}
