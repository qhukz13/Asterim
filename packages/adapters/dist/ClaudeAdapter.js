import { spawn } from 'child_process';
import crypto from 'crypto';
export class ClaudeAdapter {
    process = null;
    eventCallback;
    async start(config) {
        if (this.process) {
            throw new Error('Claude Code is already running');
        }
        const binPath = config.binaryPath || 'claude';
        const args = [];
        this.process = spawn(binPath, args, {
            cwd: config.workspace,
            env: { ...process.env, FORCE_COLOR: '1' }
        });
        this.process.stdout?.on('data', (data) => {
            this.emitLog('info', data.toString());
        });
        this.process.stderr?.on('data', (data) => {
            this.emitLog('error', data.toString());
        });
        this.process.on('close', (code) => {
            this.emitStatus('idle', `Claude Code exited with code ${code}`);
            this.process = null;
        });
        this.emitStatus('working', 'Claude Code started');
    }
    async stop() {
        if (this.process) {
            this.process.kill('SIGINT');
            this.process = null;
            this.emitStatus('idle', 'Claude Code stopped');
        }
    }
    async sendCommand(command) {
        if (this.process && this.process.stdin) {
            this.process.stdin.write(`${command}\n`);
        }
        else {
            throw new Error('Claude Code process is not running');
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
            source: 'adapter:claude',
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
            source: 'adapter:claude',
            type: 'agent.status',
            payload: { status, message }
        });
    }
}
