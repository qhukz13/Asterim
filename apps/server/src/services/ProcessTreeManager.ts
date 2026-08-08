import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ProcessInfo {
  threadId: string;
  pid: number;
  startTime: number;
}

export class ProcessTreeManager {
  private activeProcesses = new Map<string, ProcessInfo>(); // threadId -> ProcessInfo

  /**
   * Register a root process PID associated with a thread ID.
   */
  public registerProcess(threadId: string, pid: number): void {
    this.activeProcesses.set(threadId, {
      threadId,
      pid,
      startTime: Date.now(),
    });
    console.log(`[ProcessTreeManager] Registered process PID ${pid} for thread ${threadId}`);
  }

  /**
   * Unregister a process PID for a thread ID.
   */
  public unregisterProcess(threadId: string): void {
    const info = this.activeProcesses.get(threadId);
    if (info) {
      console.log(`[ProcessTreeManager] Unregistered process PID ${info.pid} for thread ${threadId}`);
      this.activeProcesses.delete(threadId);
    }
  }

  /**
   * Get registered process info for a thread.
   */
  public getProcessInfo(threadId: string): ProcessInfo | undefined {
    return this.activeProcesses.get(threadId);
  }

  /**
   * Get all child PIDs spawned by a parent PID using OS-level process tools.
   */
  public async getChildPids(parentPid: number): Promise<number[]> {
    const childPids: number[] = [];
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(`wmic process where ParentProcessId=${parentPid} get ProcessId`);
        const lines = stdout.trim().split('\r\n');
        for (const line of lines.slice(1)) {
          const pid = parseInt(line.trim(), 10);
          if (!isNaN(pid) && pid > 0) {
            childPids.push(pid);
          }
        }
      } else {
        const { stdout } = await execAsync(`pgrep -P ${parentPid}`);
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          const pid = parseInt(line.trim(), 10);
          if (!isNaN(pid) && pid > 0) {
            childPids.push(pid);
          }
        }
      }
    } catch (e) {
      // pgrep returns exit code 1 if no child processes exist
    }
    return childPids;
  }

  /**
   * Recursively get all descendant PIDs for a parent PID.
   */
  public async getAllDescendantPids(parentPid: number): Promise<number[]> {
    const descendants: number[] = [];
    const directChildren = await this.getChildPids(parentPid);
    for (const childPid of directChildren) {
      descendants.push(childPid);
      const subDescendants = await this.getAllDescendantPids(childPid);
      descendants.push(...subDescendants);
    }
    return descendants;
  }

  /**
   * Check if a process PID is currently alive on the system.
   */
  public isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Gracefully terminate a process and all its descendants:
   * Sends SIGTERM -> waits timeoutMs (default 3000ms) -> escalates to SIGKILL if still running.
   */
  public async killProcessTree(threadId: string, timeoutMs: number = 3000): Promise<void> {
    const info = this.activeProcesses.get(threadId);
    if (!info) return;

    const rootPid = info.pid;
    console.log(`[ProcessTreeManager] Initiating process tree termination for thread ${threadId} (PID ${rootPid})`);

    const allPids = [rootPid, ...(await this.getAllDescendantPids(rootPid))];

    // 1. Send SIGTERM to all processes in the tree
    for (const pid of allPids) {
      try {
        if (this.isProcessAlive(pid)) {
          process.kill(pid, 'SIGTERM');
        }
      } catch (e) {}
    }

    // 2. Wait up to timeoutMs for processes to exit gracefully
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const remaining = allPids.filter((p) => this.isProcessAlive(p));
      if (remaining.length === 0) {
        console.log(`[ProcessTreeManager] Clean SIGTERM termination completed for thread ${threadId}`);
        this.activeProcesses.delete(threadId);
        return;
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    // 3. Escalate to SIGKILL for any stubborn lingering processes
    const stubborn = allPids.filter((p) => this.isProcessAlive(p));
    if (stubborn.length > 0) {
      console.warn(`[ProcessTreeManager] Process tree for thread ${threadId} did not exit after ${timeoutMs}ms. Escalating to SIGKILL for PIDs:`, stubborn);
      for (const pid of stubborn) {
        try {
          if (this.isProcessAlive(pid)) {
            process.kill(pid, 'SIGKILL');
          }
        } catch (e) {}
      }
    }

    this.activeProcesses.delete(threadId);
  }

  /**
   * Sweep detached/orphaned processes that are no longer tracked.
   */
  public async sweepOrphanedProcesses(): Promise<number> {
    let sweptCount = 0;
    for (const [threadId, info] of Array.from(this.activeProcesses.entries())) {
      if (!this.isProcessAlive(info.pid)) {
        console.log(`[ProcessTreeManager] Swept dead process reference PID ${info.pid} for thread ${threadId}`);
        this.activeProcesses.delete(threadId);
        sweptCount++;
      }
    }
    return sweptCount;
  }
}

export const processTreeManager = new ProcessTreeManager();
