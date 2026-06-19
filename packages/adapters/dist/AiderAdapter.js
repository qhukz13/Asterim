import * as pty from 'node-pty';
import crypto from 'crypto';
export class AiderAdapter {
    ptyProcess = null;
    eventCallback;
    currentActionId = null;
    dataBuffer = '';
    pendingApproval = false;
    requestApprovalCallback;
    async start(config) {
        if (this.ptyProcess) {
            throw new Error('Aider is already running');
        }
        this.requestApprovalCallback = config.requestApproval;
        const binPath = config.binaryPath || 'aider';
        const args = ['--no-auto-commits'];
        // Use pty to spoof a real terminal
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
            this.emitStatus('idle', `Aider exited with code ${exitCode}`);
            this.ptyProcess = null;
            if (onExitCallback) {
                onExitCallback(exitCode);
            }
        });
        this.emitStatus('working', 'Aider started');
    }
    async stop() {
        if (this.ptyProcess) {
            this.ptyProcess.kill();
            this.ptyProcess = null;
            this.emitStatus('idle', 'Aider stopped');
        }
    }
    async sendCommand(command) {
        if (this.ptyProcess) {
            this.ptyProcess.write(`${command}\r`);
        }
        else {
            throw new Error('Aider process is not running');
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
        // Basic heuristic for Aider approval prompts, e.g. "Allow creation of new file? (y/N)"
        this.dataBuffer += data;
        // Keep buffer manageable
        if (this.dataBuffer.length > 1000) {
            this.dataBuffer = this.dataBuffer.slice(-1000);
        }
        const approvalRegex = /(Allow.*|Run command.*)\s*\([yY]\/[nN]\)/i;
        const match = this.dataBuffer.match(approvalRegex);
        if (match && !this.pendingApproval && this.requestApprovalCallback) {
            this.pendingApproval = true;
            this.emitStatus('waiting_approval', 'Aider needs approval');
            const desc = match[1].trim();
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
                console.error('[AiderAdapter] Approval failed:', err);
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
