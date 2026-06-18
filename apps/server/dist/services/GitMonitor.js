import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { eventBus } from './EventBus';
const execAsync = promisify(exec);
export class GitMonitor {
    activeProjectId = null;
    activeProjectPath = null;
    pollingInterval = null;
    lastDiffHash = '';
    /**
     * Starts polling the given path for git diff changes.
     */
    startWatching(projectId, projectPath) {
        this.stopWatching();
        this.activeProjectId = projectId;
        this.activeProjectPath = projectPath;
        // Poll every 3 seconds for the MVP
        this.pollingInterval = setInterval(() => this.poll(), 3000);
        this.poll(); // Trigger initial poll
        console.log(`[GitMonitor] Started watching project: ${projectId} at ${projectPath}`);
    }
    /**
     * Stops the current polling loop.
     */
    stopWatching() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        this.activeProjectId = null;
        this.activeProjectPath = null;
    }
    async poll() {
        if (!this.activeProjectPath || !this.activeProjectId)
            return;
        try {
            // Execute git diff to get unstaged changes.
            // In a more robust version, we would also check git status for untracked files.
            const { stdout } = await execAsync('git diff', { cwd: this.activeProjectPath });
            // Simple string comparison to prevent spamming the EventBus if the diff hasn't changed
            if (stdout !== this.lastDiffHash) {
                this.lastDiffHash = stdout;
                eventBus.publish({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    source: 'system:git',
                    type: 'git.diff',
                    payload: {
                        projectId: this.activeProjectId,
                        diff: stdout.trim().length > 0 ? stdout : null
                    }
                });
            }
        }
        catch (err) {
            // It might not be a git repository, or git isn't installed.
            // Ignore errors silently in the background to prevent server crash/log spam.
        }
    }
}
export const gitMonitor = new GitMonitor();
