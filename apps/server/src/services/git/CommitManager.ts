import { GitProvider } from './GitProvider';

export class CommitManager {
  constructor(private provider: GitProvider) {}

  public async stageFile(projectPath: string, file: string): Promise<void> {
    await this.provider.exec(`git add "${file}"`, projectPath);
  }

  public async stageAll(projectPath: string): Promise<void> {
    await this.provider.exec(`git add -A`, projectPath);
  }

  public async unstageFile(projectPath: string, file: string): Promise<void> {
    await this.provider.exec(`git restore --staged "${file}"`, projectPath);
  }

  public async commit(projectPath: string, message: string): Promise<void> {
    if (!message || message.trim() === '') {
      throw new Error('Commit message cannot be empty');
    }
    
    // We must escape quotes in the commit message
    const escapedMessage = message.replace(/"/g, '\\"');
    await this.provider.exec(`git commit -m "${escapedMessage}"`, projectPath);
  }

  public async generateCommitMessage(projectPath: string): Promise<string> {
    let diffOutput = '';
    try {
      const { stdout } = await this.provider.exec('git diff --staged', projectPath);
      diffOutput = stdout.trim();
    } catch (e) {}

    if (!diffOutput) {
      try {
        const { stdout } = await this.provider.exec('git diff', projectPath);
        diffOutput = stdout.trim();
      } catch (e) {}
    }

    if (!diffOutput) {
      return 'chore: update workspace project files';
    }

    const lines = diffOutput.split('\n');
    const modifiedFiles = new Set<string>();
    for (const line of lines) {
      if (line.startsWith('+++ b/')) {
        modifiedFiles.add(line.replace('+++ b/', '').trim());
      }
    }

    const filesArray = Array.from(modifiedFiles);
    const primaryFile = filesArray[0] || 'code';
    const scope = primaryFile.split('/')[0] || 'core';

    let type = 'feat';
    if (diffOutput.includes('fix') || diffOutput.includes('bug') || diffOutput.includes('error')) {
      type = 'fix';
    } else if (diffOutput.includes('test') || diffOutput.includes('spec')) {
      type = 'test';
    } else if (diffOutput.includes('refactor') || diffOutput.includes('clean')) {
      type = 'refactor';
    } else if (diffOutput.includes('doc') || diffOutput.includes('README')) {
      type = 'docs';
    }

    const summary = filesArray.length === 1
      ? `update ${filesArray[0]}`
      : `update ${filesArray.length} files (${filesArray.slice(0, 2).join(', ')})`;

    return `${type}(${scope}): ${summary}`;
  }
}
