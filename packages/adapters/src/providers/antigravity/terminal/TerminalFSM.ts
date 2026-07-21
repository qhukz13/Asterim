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
  protected isTuiMode: boolean = false;
  // Store the screen snapshot when we enter Working state so we can diff later
  protected workingStartSnapshot: TerminalSnapshot | null = null;
  public hasSeenWorkingIndicator: boolean = false;

  public notifyCommandSent() {
    this.setState(AgentState.Working, 'Working...');
    this.hasSeenWorkingIndicator = false;
  }

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
    // Accumulate text for non-TUI mode
    if (this.state === AgentState.Working && !this.isTuiMode) {
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

  /**
   * Extract the last agent response from the TUI screen.
   *
   * The Antigravity TUI has this pattern:
   *   ❯ <user prompt>
   *
   *   ● Thought for Xs, N tokens
   *     <thought title>
   *
   *   ● Create(...) / Read(...) / etc
   *
   *   <agent response text>
   *
   *   ❯   (idle prompt, empty or with text)
   *
   *   ? for shortcuts ...
   *
   * We find the LAST pair of ❯-blocks and extract the response between them.
   */
  private extractLastResponse(curr: TerminalSnapshot): string {
    const lines = curr.lines;
    let idlePromptIdx = -1;
    let userPromptIdx = -1;

    // Search backwards to find the idle prompt, then the user prompt
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trimStart();
      // Look for the empty idle prompt (just > or ❯)
      if (idlePromptIdx === -1 && (trimmed === '>' || trimmed === '❯')) {
        idlePromptIdx = i;
      }
      // Once we found the idle prompt, the next line going backwards that starts with > is the user prompt
      else if (idlePromptIdx !== -1 && (trimmed.startsWith('>') || trimmed.startsWith('❯'))) {
        userPromptIdx = i;
        break;
      }
    }

    if (userPromptIdx !== -1 && idlePromptIdx !== -1) {
      // Exclude the user prompt line itself by starting at userPromptIdx + 1
      let response = '';
      for (let i = userPromptIdx + 1; i < idlePromptIdx; i++) {
        if (curr.isWrapped[i] && response.length > 0) {
          response += curr.lines[i];
        } else {
          if (response.length > 0) response += '\n';
          response += curr.lines[i];
        }
      }
      return response;
    }

    return '';
  }

  protected evaluateState(diff: DiffResult, curr: TerminalSnapshot): void {
    const fullText = curr.lines.join('\n');

    // 1. Check for interactive workspace trust prompt
    if (
      fullText.includes('Do you trust the contents of this project?') &&
      fullText.includes('Yes, I trust this folder')
    ) {
      if (this.state !== AgentState.WaitingApproval) {
        this.setState(AgentState.WaitingApproval, 'Trust Required');
        this.onTrustRequired();
      }
      return;
    }

    // Update TUI mode if we see known TUI elements
    const bottomLines = curr.lines.slice(Math.max(0, curr.lines.length - 5)).join('\n');
    if (
      bottomLines.includes('? for shortcuts') ||
      bottomLines.includes('esc to cancel') ||
      bottomLines.toLowerCase().includes('navigate') ||
      bottomLines.includes('Gemini')
    ) {
      this.isTuiMode = true;
    }

    if (this.state === AgentState.Working) {
      if (
        bottomLines.includes('esc to cancel') ||
        diff.appendedText.includes('●') ||
        diff.appendedText.includes('Thought') ||
        diff.appendedText.includes('Working')
      ) {
        this.hasSeenWorkingIndicator = true;
      }

      // If a new empty prompt appears in the appended text, the agent must have finished processing (even if it was so fast we didn't see an indicator).
      if (diff.appendedText.match(/(?:^|\n)\s*[❯>]\s*(?:\n|$)/)) {
        this.hasSeenWorkingIndicator = true;
      }
    }

    // 2. Check for Idle State FIRST
    let isIdle = false;

    if (this.isTuiMode) {
      const hasGemini = bottomLines.includes('Gemini');
      const hasEscToCancel = bottomLines.includes('esc to cancel');
      const hasShortcuts = bottomLines.includes('? for shortcuts');

      if (hasShortcuts) {
        isIdle = true;
      } else if (hasGemini && !hasEscToCancel) {
        // If the bottom bar is drawn but incomplete (e.g. due to chunking),
        // we verify if we are truly idle by checking the cursor position.
        // When the TUI is idle, the cursor rests exactly on the empty prompt line.
        const cursorLineIndex = curr.baseY + curr.cursorY;
        const cursorLine = curr.lines[cursorLineIndex];
        if (cursorLine && cursorLine.trimEnd().match(/^\s*[❯>]$/)) {
          isIdle = true;
        }
      }

      if (this.state === AgentState.Working && !this.hasSeenWorkingIndicator) {
        isIdle = false;
      }
    } else {
      let lastNonEmpty = '';
      for (let i = curr.lines.length - 1; i >= 0; i--) {
        if (curr.lines[i].trim().length > 0) {
          lastNonEmpty = curr.lines[i].trimEnd();
          break;
        }
      }

      if (
        lastNonEmpty.match(/^\s*[❯>]$/) ||
        lastNonEmpty.match(/^\s*antigravity>$/) ||
        lastNonEmpty.match(/^[A-Z]:\\.*?>\s*$/)
      ) {
        this.isTuiMode = false;
        isIdle = true;
      }
    }

    if (isIdle) {
      if (this.state === AgentState.Startup) {
        this.setState(AgentState.Idle, 'Ready');
      } else if (
        this.state === AgentState.Working ||
        this.state === AgentState.WaitingApproval ||
        this.state === AgentState.WaitingQuestion
      ) {
        const message = this.isTuiMode
          ? this.cleanMessage(this.extractLastResponse(curr)) // In TUI mode, extract the last response directly from the screen
          : this.cleanMessage(this.accumulatedText); // In non-TUI mode, use the accumulated diff text

        if (message.length > 0) {
          this.onMessageComplete(message);
        }

        this.accumulatedText = '';
        this.setState(AgentState.Idle, 'Ready');
      }
      return;
    }

    // 3. Check for Menus (Approval or Question)
    // We only search the bottom portion of the screen to avoid false positives in code blocks
    const searchArea = curr.lines.slice(Math.max(0, curr.lines.length - 15)).join('\n');
    const lastNonEmpty = curr.lines.filter(l => l.trim().length > 0).pop() || '';

    const hasYn =
      /Requesting permission for:[\s\S]*?\(y\/n\)/i.test(searchArea) ||
      /^\s*(?:Allow|Execute|Run|Proceed|Approve).*?\?\s*\(y\/n\)/im.test(searchArea) ||
      /\(y\/n\)\s*[>❯_]?\s*$/i.test(lastNonEmpty);

    const hasProceed =
      /^\s*Do you want to proceed\?/im.test(searchArea) || /^\s*[>❯*-]?\s*Yes, allow/im.test(searchArea);

    if (hasYn || hasProceed) {
      if (this.state !== AgentState.WaitingApproval) {
        let cmdToApprove = 'Unknown action';
        const reqPermMatch = searchArea.match(/Requesting permission for:\s*\n\s*(.*?)(?:\n|$)/);
        if (reqPermMatch) {
          cmdToApprove = reqPermMatch[1].trim();
        } else {
          for (let i = curr.lines.length - 1; i >= 0; i--) {
            if (
              curr.lines[i].includes('y/n') ||
              curr.lines[i].includes('Allow ') ||
              curr.lines[i].includes('Do you want to proceed')
            ) {
              for (let j = Math.max(0, i - 10); j <= i; j++) {
                if (curr.lines[j].match(/Execute|Run|bash|cmd|Allow /i)) {
                  cmdToApprove = curr.lines
                    .slice(j, i + 1)
                    .join('\n')
                    .trim();
                  break;
                }
              }
              break;
            }
          }
        }
        this.setState(AgentState.WaitingApproval, 'Antigravity needs approval');
        this.onApprovalRequired('Antigravity wants to perform an action', cmdToApprove);
      }
      return;
    }

    // Check for multiple choice questions
    const isMultipleChoice =
      (bottomLines.toLowerCase().includes('navigate') || bottomLines.includes('esc ')) &&
      (fullText.match(/>\s*1\.\s+/) || fullText.match(/Question \d+\/\d+:/));
    if (this.state !== AgentState.WaitingQuestion && isMultipleChoice) {
      let questionTitle = 'Action Required';
      const options: string[] = [];
      const lines = fullText.split('\n');
      let inOptions = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!inOptions && (line.match(/>\s*1\.\s+/) || line.match(/Question \d+\/\d+:/))) {
          inOptions = true;
          for (let j = i - 1; j >= 0; j--) {
            if (lines[j].trim().length > 0) {
              questionTitle = lines[j].trim();
              break;
            }
          }
        }
        if (inOptions) {
          if (line.includes('Navigate') || line.includes('esc ')) break;
          const optMatch = line.match(/^\s*(?:>\s*)?\d+\.\s+(.+)$/);
          if (optMatch) {
            options.push(optMatch[1].trim());
          }
        }
      }

      if (options.length > 0) {
        this.setState(AgentState.WaitingQuestion, 'Action Required');
        if (this.onQuestionRequired) {
          this.onQuestionRequired(questionTitle, options);
        }
        return;
      }
    }

    // If it was in a menu but the menu disappeared, go back to working
    const currentlyHasMenu = hasYn || hasProceed || isMultipleChoice;
    if (
      !currentlyHasMenu &&
      (this.state === AgentState.WaitingApproval || this.state === AgentState.WaitingQuestion)
    ) {
      this.setState(AgentState.Working, 'Working...');
    }

    // If we are idle but the idle state ended, transition to working
    if (this.state === AgentState.Idle) {
      let startedWorking = false;

      if (this.isTuiMode) {
        if (
          bottomLines.includes('esc to cancel') ||
          diff.appendedText.includes('●') ||
          diff.appendedText.includes('Thought') ||
          diff.appendedText.includes('Working')
        ) {
          startedWorking = true;
        }
      } else {
        if (
          diff.appendedText.includes('▸ Thought') ||
          diff.appendedText.includes('●') ||
          diff.appendedText.trim().length > 0
        ) {
          startedWorking = true;
        }
      }

      if (startedWorking) {
        this.setState(AgentState.Working, 'Working...');
        this.hasSeenWorkingIndicator = true;
      }
    }
  }

  private cleanMessage(message: string): string {
    return (
      message
        .replace(/Gemini \d+\.\d+ Flash(?: \(Medium\))?/gi, '')
        .replace(/\? for shortcuts/g, '')
        .replace(/esc to cancel/gi, '')
        .replace(/─{10,}/g, '')
        .replace(/v\.onashchuk@gmail\.com/g, '')
        .replace(/Antigravity CLI \d+\.\d+\.\d+/g, '')
        .replace(/^[A-Z]:\\.*?>\s*$/gm, '')
        .replace(/Accessing workspace:/g, '')
        .replace(/[❯>]\s*$/g, '')
        .replace(/.*?Navigate.*?enter Select.*?esc Skip/gi, '')
        // Remove spinner lines
        .replace(/^[^\w\s]*\s*(Working|Generating|Running|Thinking)(\.+|…)/gim, '')
        // Remove Tip lines
        .replace(/^[^\w\s]*\s*Tip:.*$/gim, '')
        // Remove ● lines (tools, thoughts, meta info)
        .replace(/●[^\n]*\n?/g, '')
        // Remove ▸ Thought blocks (title and summary)
        .replace(/▸\s*Thought[^\n]*\n[^\n]*\n?/g, '')
        .trim()
    );
  }
}
