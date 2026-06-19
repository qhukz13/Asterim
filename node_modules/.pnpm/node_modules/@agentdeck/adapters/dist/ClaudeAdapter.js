import * as pty from 'node-pty';
import crypto from 'crypto';
export class ClaudeAdapter {
    ptyProcess = null;
    eventCallback;
    currentActionId = null;
    dataBuffer = '';
    pendingApproval = false;
    requestApprovalCallback;
    async start(config) {
        if (this.ptyProcess) {
            throw new Error('Claude Code is already running');
        }
        this.requestApprovalCallback = config.requestApproval;
        const binPath = config.binaryPath || 'claude';
        const args = [];
        const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
        const ptyArgs = process.platform === 'win32' ? ['/c', binPath, ...args] : ['-c', `${binPath} ${args.join(' ')}`];
        this.ptyProcess = pty.spawn(shell, ptyArgs, {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: config.workspace,
            env: { ...process.env, FORCE_COLOR: '1' }
        });
        this.ptyProcess.onData((data) => {
            this.emitLog('info', data);
            this.parseOutputForApprovals(data);
        });
        const onExitCallback = config.onExit;
        this.ptyProcess.onExit(({ exitCode }) => {
            this.emitStatus('idle', `Claude Code exited with code ${exitCode}`);
            this.ptyProcess = null;
            if (onExitCallback) {
                onExitCallback(exitCode);
            }
        });
        this.emitStatus('working', 'Claude Code started');
    }
    async stop() {
        if (this.ptyProcess) {
            this.ptyProcess.kill();
            this.ptyProcess = null;
            this.emitStatus('idle', 'Claude Code stopped');
        }
    }
    async sendCommand(command) {
        if (this.ptyProcess) {
            this.ptyProcess.write(`${command}\r`);
        }
        else {
            throw new Error('Claude Code process is not running');
        }
    }
    writeStdin(data) {
        if (this.ptyProcess) {
            this.ptyProcess.write(data);
        }
    }
    getPid() {
        return this.ptyProcess?.pid;
    }
    onEvent(callback) {
        this.eventCallback = callback;
    }
    async parseOutputForApprovals(data) {
        this.dataBuffer += data;
        if (this.dataBuffer.length > 1000) {
            this.dataBuffer = this.dataBuffer.slice(-1000);
        }
        // Claude Code often asks questions like "? Do you want to execute this command? (Y/n)"
        const approvalRegex = /\?\s*(.*?)\s*\([yY]\/[nN]\)/i;
        const match = this.dataBuffer.match(approvalRegex);
        if (match && !this.pendingApproval && this.requestApprovalCallback) {
            this.pendingApproval = true;
            this.emitStatus('waiting_approval', 'Claude Code needs approval');
            const desc = match[1].trim() || 'Action requires approval';
            const cmd = match[0].trim();
            this.dataBuffer = ''; // Clear buffer after match
            try {
                const approved = await this.requestApprovalCallback(desc, cmd);
                if (!this.ptyProcess)
                    return;
                if (approved) {
                    this.ptyProcess.write('y\r');
                    this.emitStatus('working', 'Action approved, continuing...');
                }
                else {
                    this.ptyProcess.write('n\r');
                    this.emitStatus('working', 'Action denied.');
                }
            }
            catch (err) {
                console.error('[ClaudeAdapter] Approval failed:', err);
                if (this.ptyProcess)
                    this.ptyProcess.write('n\r');
                this.emitStatus('working', 'Approval error, defaulted to denied.');
            }
            finally {
                this.pendingApproval = false;
            }
        }
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
