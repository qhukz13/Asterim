import { IAIProvider } from '../IAIProvider';
import { dbService } from '../../DatabaseService';
import { projectManager } from '../../ProjectManager';
import { execFile } from 'child_process';
import util from 'util';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = util.promisify(execFile);

export class ActiveAgentProvider implements IAIProvider {
  public readonly id = 'agent';

  configure(config: Record<string, string>): void {
    // No special config needed
  }

  private getProjectWorkspace(projectId?: string): string {
    if (!projectId) throw new Error('ActiveAgentProvider requires a projectId');
    const project = projectManager.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    return project.path;
  }

  private getActiveAgentType(projectId: string): string {
    try {
      const db = dbService.getDb();
      const session = db.prepare("SELECT agent_type FROM sessions WHERE project_id = ? AND status = 'running' LIMIT 1").get(projectId) as any;
      if (session && session.agent_type) {
        return session.agent_type;
      }
    } catch (err) {
      console.warn('[ActiveAgentProvider] Failed to query active session, defaulting to claude', err);
    }
    return 'claude';
  }

  private async runAgentHeadless(prompt: string, projectId?: string): Promise<string> {
    if (!projectId) throw new Error('projectId is required for ActiveAgentProvider');
    const workspace = this.getProjectWorkspace(projectId);
    const agentType = this.getActiveAgentType(projectId);

    const isWin = process.platform === 'win32';
    const tempFile = path.join(os.tmpdir(), `asterim-prompt-${Date.now()}-${Math.floor(Math.random() * 1000)}.txt`);
    
    let cmd = '';
    let args: string[] = [];

    switch (agentType) {
      case 'aider':
        await fs.writeFile(tempFile, prompt, 'utf8');
        cmd = isWin ? 'aider.cmd' : 'aider';
        args = ['--message-file', tempFile, '--no-auto-commits', '--yes'];
        break;
      case 'claude':
        cmd = isWin ? 'npx.cmd' : 'npx';
        args = ['@anthropic-ai/claude-code', '--print', prompt];
        break;
      case 'antigravity':
        cmd = isWin ? 'agy.cmd' : 'agy';
        args = ['-p', prompt];
        break;
      default:
        cmd = isWin ? 'npx.cmd' : 'npx';
        args = ['@anthropic-ai/claude-code', '--print', prompt];
        break;
    }

    try {
      console.log(`[ActiveAgentProvider] Running headless agent: ${agentType} in ${workspace}`);
      const { stdout, stderr } = await execFileAsync(cmd, args, { cwd: workspace, maxBuffer: 1024 * 1024 * 10 });
      if (agentType === 'aider') await fs.unlink(tempFile).catch(() => {});
      return stdout.trim() || stderr.trim();
    } catch (err: any) {
      if (agentType === 'aider') await fs.unlink(tempFile).catch(() => {});
      console.error('[ActiveAgentProvider] Failed to run agent headless:', err);
      if (err.stdout) return err.stdout.trim();
      throw new Error(`Failed to run active agent (${agentType}): ${err.message}`);
    }
  }

  async generateCommitMessage(diff: string, projectId?: string): Promise<string> {
    const prompt = `You are an expert developer. Write a concise, Conventional Commits style commit message for the following git diff. Respond ONLY with the commit message. No explanations, no markdown formatting blocks.\n\nDiff:\n${diff}`;
    const output = await this.runAgentHeadless(prompt, projectId);
    
    // basic cleanup
    const lines = output.split('\n').map(l => l.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim()).filter(Boolean);
    return lines[lines.length - 1] || 'Update files';
  }

  async explainDiff(diff: string, projectId?: string): Promise<string> {
    const prompt = `You are an expert code reviewer. Explain the following git diff concisely and clearly. Focus on the "why" and "what" of the changes. Format the explanation in Markdown. Keep it brief.\n\nDiff:\n${diff}`;
    const output = await this.runAgentHeadless(prompt, projectId);
    return output || 'No explanation generated.';
  }

  async reviewChanges(diff: string, projectId?: string): Promise<string> {
    const prompt = `You are an expert lead software engineer performing a thorough Code Review on the following git diff.
Identify potential bugs, edge cases, security vulnerabilities, performance bottlenecks, and code quality improvements.
Structure your review with the following sections in Markdown:
- **Summary**: Brief assessment of the changes.
- **Potential Issues**: Bugs, logic errors, or unhandled edge cases (if any).
- **Security & Performance**: Potential security flaws or performance bottlenecks (if any).
- **Suggestions**: Recommended improvements or best practices.

If the changes look great with no obvious issues, say so clearly in the summary.

Diff:
${diff}`;
    const output = await this.runAgentHeadless(prompt, projectId);
    return output || 'No review generated.';
  }

  async suggestFiles(task: string, fileTree: string[], projectId?: string): Promise<string[]> {
    const prompt = `You are an AI assistant helping a developer navigate a codebase. Given the following active task and the project's file tree, suggest up to 5 most relevant files that the developer should look at to accomplish the task. Respond ONLY with a JSON array of strings representing the file paths. Do not include any other text or markdown block formatting.\n\nActive Task:\n${task}\n\nFile Tree:\n${fileTree.join('\n')}`;
    const output = await this.runAgentHeadless(prompt, projectId);
    
    try {
      // Find the first '[' and last ']' to extract the JSON array
      const startIdx = output.indexOf('[');
      const endIdx = output.lastIndexOf(']');
      
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const jsonStr = output.substring(startIdx, endIdx + 1);
        const files = JSON.parse(jsonStr);
        if (Array.isArray(files)) return files.slice(0, 5);
      }
    } catch (err) {
      console.error('[ActiveAgentProvider] Failed to parse suggested files:', err, 'Output:', output);
    }
    return [];
  }

  async extractMission(history: string, projectId?: string): Promise<string> {
    const prompt = `You are an AI assistant analyzing a developer's chat history. Based on the following recent conversation, extract a concise, single-sentence "Mission" that describes the current overarching task the developer is trying to accomplish. Respond ONLY with the mission string. Do not include any other text or markdown block formatting.\n\nChat History:\n${history}`;
    const output = await this.runAgentHeadless(prompt, projectId);
    return output.replace(/^["']|["']$/g, '').trim() || 'No mission extracted.';
  }
}
