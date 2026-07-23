export interface IAIProvider {
  /**
   * Unique identifier for this provider type (e.g. 'gemini', 'openai')
   */
  readonly id: string;

  /**
   * Initialize or update provider configuration (API keys, models)
   */
  configure(config: Record<string, string>): void;

  /**
   * Generates a concise commit message based on the provided diff
   */
  generateCommitMessage(diff: string, projectId?: string): Promise<string>;

  /**
   * Explains the provided diff in clear markdown
   */
  explainDiff(diff: string, projectId?: string): Promise<string>;

  /**
   * Performs an AI code review on the provided diff, highlighting issues and suggestions
   */
  reviewChanges(diff: string, projectId?: string): Promise<string>;

  /**
   * Suggests up to 5 relevant files for a given task, based on the file tree
   */
  suggestFiles(task: string, fileTree: string[], projectId?: string): Promise<string[]>;

  /**
   * Extracts a short mission statement from the recent chat history
   */
  extractMission(history: string, projectId?: string): Promise<string>;
}
