import { TerminalSnapshot } from './ScreenSnapshot';
import { DiffResult } from './ScreenDiff';

export enum AgentState {
  Startup = 'Startup',
  Idle = 'Idle',
  Working = 'Working',
  WaitingApproval = 'WaitingApproval',
  WaitingQuestion = 'WaitingQuestion'
}

export abstract class TerminalFSM {
  protected state: AgentState = AgentState.Startup;
  protected accumulatedText: string = '';

  constructor(
    protected onMessageComplete: (message: string) => void,
    protected onStateChange: (state: AgentState, reason: string) => void,
    protected onApprovalRequired: (desc: string, command: string) => void,
    protected onTrustRequired: () => void
  ) {}

  public getState(): AgentState {
    return this.state;
  }

  public process(diff: DiffResult, curr: TerminalSnapshot): void {
    // Accumulate text for the current message stream
    if (this.state === AgentState.Working) {
      this.accumulatedText += diff.appendedText;
    }

    this.evaluateState(diff, curr);
  }

  protected setState(newState: AgentState, reason: string) {
    if (this.state !== newState) {
      this.state = newState;
      this.onStateChange(newState, reason);
    }
  }

  protected abstract evaluateState(diff: DiffResult, curr: TerminalSnapshot): void;
}

export class AntigravityFSM extends TerminalFSM {
  constructor(
    protected onMessageComplete: (message: string) => void,
    protected onStateChange: (state: AgentState, reason: string) => void,
    protected onApprovalRequired: (desc: string, command: string) => void,
    protected onTrustRequired: () => void,
    private onQuestionRequired?: (question: string, options: string[]) => void
  ) {
    super(onMessageComplete, onStateChange, onApprovalRequired, onTrustRequired);
  }

  protected evaluateState(diff: DiffResult, curr: TerminalSnapshot): void {
    const fullText = curr.lines.join('\n');

    // 1. Check for interactive workspace trust prompt
    if (fullText.includes('Do you trust the contents of this project?') && fullText.includes('Yes, I trust this folder')) {
      this.onTrustRequired();
      return;
    }

    // 2. Check for approval prompt
    const hasYn = fullText.includes('(y/n)');
    const hasProceed = fullText.includes('Do you want to proceed?');
    
    if ((hasYn || hasProceed) && this.state !== AgentState.WaitingApproval) {
      // Find the command to approve
      let cmdToApprove = 'Unknown action';
      
      const reqPermMatch = fullText.match(/Requesting permission for:\s*\n\s*(.*?)(?:\n|$)/);
      if (reqPermMatch) {
        cmdToApprove = reqPermMatch[1].trim();
      } else if (hasYn) {
        for (let i = curr.lines.length - 1; i >= 0; i--) {
          if (curr.lines[i].includes('y/n')) {
            for (let j = Math.max(0, i - 10); j <= i; j++) {
              if (curr.lines[j].match(/Execute|Run|bash|cmd/i)) {
                cmdToApprove = curr.lines.slice(j, i).join('\n').trim();
                break;
              }
            }
            break;
          }
        }
      }

      this.setState(AgentState.WaitingApproval, 'Antigravity needs approval');
      // Pass whether it's the new menu style in the command string or we can just let adapter know
      this.onApprovalRequired('Antigravity wants to run a command', cmdToApprove);
      return;
    }

    // 3. Check for Question Menu
    const isQuestionMenu = fullText.match(/Question \d+\/\d+:/) && fullText.includes('esc Skip');
    if (isQuestionMenu && this.state !== AgentState.WaitingQuestion) {
      // Parse question and options
      let questionTitle = 'Multiple Choice Question';
      const options: string[] = [];
      const lines = fullText.split('\n');
      
      let inOptions = false;
      for (const line of lines) {
        if (line.match(/Question \d+\/\d+:/)) {
          questionTitle = line.trim();
          inOptions = true;
          continue;
        }
        
        if (inOptions) {
          if (line.includes('Navigate') && line.includes('esc Skip')) break;
          const optMatch = line.match(/^\s*(?:>\s*)?\d+\.\s+(.+)$/);
          if (optMatch) {
            options.push(optMatch[1].trim());
          }
        }
      }
      
      this.setState(AgentState.WaitingQuestion, 'Question Required');
      if (this.onQuestionRequired) {
        this.onQuestionRequired(questionTitle, options);
      }
      return;
    }

    // If the approval prompt disappeared, we are back to working
    if (!(hasYn || hasProceed || isQuestionMenu) && (this.state === AgentState.WaitingApproval || this.state === AgentState.WaitingQuestion)) {
      this.setState(AgentState.Working, 'Working...');
    }

    // 4. Check for prompt indicating readiness (Idle)
    // The most robust way to find the prompt in a TUI is to check the line where the cursor is currently resting.
    const cursorLineIndex = curr.baseY + curr.cursorY;
    const cursorLine = curr.lines[cursorLineIndex] || '';
    const trimmedCursorLine = cursorLine.trimEnd();
    
    let isPrompt = false;
    if (trimmedCursorLine.match(/^\s*[❯>]$/) || trimmedCursorLine.match(/^\s*antigravity>$/)) {
      isPrompt = true;
    }

    if (isPrompt) {
      if (this.state === AgentState.Startup) {
        this.setState(AgentState.Idle, 'Ready');
      } else if (this.state === AgentState.Working || this.state === AgentState.WaitingApproval || this.state === AgentState.WaitingQuestion) {
        let message = this.cleanMessage(this.accumulatedText);
        if (message.length > 0) {
          this.onMessageComplete(message);
        }
        
        this.accumulatedText = '';
        this.setState(AgentState.Idle, 'Ready');
      }
      return;
    }

    // If we are idle but got new text that isn't a prompt, we started working
    if (this.state === AgentState.Idle && diff.appendedText.length > 0) {
      this.setState(AgentState.Working, 'Working...');
      this.accumulatedText = diff.appendedText;
    }
  }

  private cleanMessage(message: string): string {
    return message
      .replace(/Gemini \d+\.\d+ Flash(?: \(Medium\))?/gi, '')
      .replace(/\? for shortcuts/g, '')
      .replace(/esc to cancel/gi, '')
      .replace(/────────────────────────────────────────────────────────────────────────────────/g, '')
      .replace(/v\.onashchuk@gmail\.com/g, '')
      .replace(/Antigravity CLI \d+\.\d+\.\d+/g, '')
      .replace(/C:\/Projects\/.*?$/gm, '')
      .replace(/Accessing workspace:/g, '')
      .replace(/[❯>]\s*$/g, '')
      .replace(/.*?Navigate.*?enter Select.*?esc Skip/g, '')
      .trim();
  }
}
