import { GoogleGenAI } from '@google/genai';
import { IAIProvider } from './IAIProvider';

export class GeminiProvider implements IAIProvider {
  public readonly id = 'gemini';
  private client: GoogleGenAI | null = null;
  private model: string = 'gemini-2.0-flash';

  configure(config: Record<string, string>): void {
    const apiKey = config['ai_api_key'];
    const model = config['ai_model'];

    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    }
    if (model) {
      this.model = model;
    }
  }

  private ensureClient(): GoogleGenAI {
    if (!this.client) {
      throw new Error('GeminiProvider is not configured. Please set the Gemini API Key in Developer Settings.');
    }
    return this.client;
  }

  async generateCommitMessage(diff: string, projectId?: string): Promise<string> {
    const client = this.ensureClient();
    const prompt = `
You are an expert developer. Write a concise, Conventional Commits style commit message for the following git diff.
Respond ONLY with the commit message. No explanations, no markdown formatting blocks.

Diff:
${diff}
`;
    const response = await client.models.generateContent({
      model: this.model,
      contents: prompt,
    });
    return response.text?.trim() || 'Update files';
  }

  async explainDiff(diff: string, projectId?: string): Promise<string> {
    const client = this.ensureClient();
    const prompt = `
You are an expert code reviewer. Explain the following git diff concisely and clearly.
Focus on the "why" and "what" of the changes. Format the explanation in Markdown.
Keep it brief.

Diff:
${diff}
`;
    const response = await client.models.generateContent({
      model: this.model,
      contents: prompt,
    });
    return response.text || 'No explanation generated.';
  }

  async suggestFiles(task: string, fileTree: string[], projectId?: string): Promise<string[]> {
    const client = this.ensureClient();
    const prompt = `
You are an AI assistant helping a developer navigate a codebase.
Given the following active task and the project's file tree, suggest up to 5 most relevant files that the developer should look at to accomplish the task.

Respond ONLY with a JSON array of strings representing the file paths. Do not include any other text or markdown block formatting.

Active Task:
${task}

File Tree:
${fileTree.join('\n')}
`;
    const response = await client.models.generateContent({
      model: this.model,
      contents: prompt,
    });
    
    try {
      let text = response.text || '[]';
      // Basic cleanup just in case it wraps in markdown
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const files = JSON.parse(text);
      if (Array.isArray(files)) {
        return files.slice(0, 5);
      }
    } catch (err) {
      console.error('[GeminiProvider] Failed to parse suggested files json', err);
      return [];
    }
    return [];
  }

  async extractMission(history: string, projectId?: string): Promise<string> {
    const client = this.ensureClient();
    const prompt = `You are an AI assistant analyzing a developer's chat history. Based on the following recent conversation, extract a concise, single-sentence "Mission" that describes the current overarching task the developer is trying to accomplish. Respond ONLY with the mission string. Do not include any other text or markdown block formatting.\n\nChat History:\n${history}`;
    
    try {
      const response = await client.models.generateContent({
        model: this.model,
        contents: prompt,
      });
      const text = response.text || '';
      return text.replace(/^["']|["']$/g, '').trim() || 'No mission extracted.';
    } catch (err) {
      console.error('[GeminiProvider] extractMission failed:', err);
      return 'Failed to extract mission.';
    }
  }
}
