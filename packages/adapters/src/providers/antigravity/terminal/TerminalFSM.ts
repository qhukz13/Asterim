import { TerminalSnapshot } from './ScreenSnapshot';
import { DiffResult } from './ScreenDiff';

// Terminal output is stripped of escape sequences and control characters
// before any textual match. Matching those characters is the whole purpose of
// these patterns, which is why the rule is silenced here rather than the
// patterns rewritten.
// eslint-disable-next-line no-control-regex -- ESC (0x1B) is the character being matched
const ANSI_ESCAPES = /\x1B(?:[@-Z\\-_]|\[[0-9?]*[ -/]*[@-~])/g;
// eslint-disable-next-line no-control-regex -- ESC (0x1B) is the character being matched
const ANSI_CSI_SEQUENCES = /\u001b\[[0-9;]*[a-zA-Z]/g;
// eslint-disable-next-line no-control-regex -- the C0/C1 ranges are the characters being matched
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

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

  protected isClearing: boolean = false;

  public notifyCommandSent(command?: string) {
    if (command && command.trim().startsWith('/clear')) {
      this.isClearing = true;
    }
    if ((this as any).idleDebounceTimer) {
      clearTimeout((this as any).idleDebounceTimer);
      (this as any).idleDebounceTimer = null;
    }
    this.setState(AgentState.Working, 'Working...');
    this.hasSeenWorkingIndicator = false;
    if (this.onWorkingStarted) this.onWorkingStarted();
  }

  constructor(
    protected onMessageComplete: (message: string) => void,
    protected onStateChange: (state: AgentState, reason: string) => void,
    protected onApprovalRequired: (desc: string, command: string) => void,
    protected onTrustRequired: () => void,
    protected onMessageChunk?: (message: string) => void,
    protected onWorkingStarted?: () => void
  ) {}

  public getState(): AgentState {
    return this.state;
  }

  public onData(data: string, curr: TerminalSnapshot) {
    this.accumulatedText += data;
  }

  public process(diff: DiffResult, curr: TerminalSnapshot): void {
    (this as any).latestSnapshot = curr;
    
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
    private onQuestionRequired?: (question: string, options: string[]) => void,
    protected onMessageChunk?: (message: string) => void,
    protected onWorkingStarted?: () => void
  ) {
    super(onMessageComplete, onStateChange, onApprovalRequired, onTrustRequired, onMessageChunk, onWorkingStarted);
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
    let userPromptIdx = -1;
    let endIdx = lines.length;

    // Search backwards for the last user prompt
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      
      const isDividerAbove = i > 0 && lines[i - 1].includes('─');
      const isDividerBelow = i < lines.length - 1 && lines[i + 1].includes('─');
      const isStrictPrompt = trimmed === '>' || trimmed === '❯';
      const isNamedPrompt = trimmed.startsWith('antigravity>') || trimmed.startsWith('agy>');
      const isFramedPrompt = (trimmed.startsWith('>') || trimmed.startsWith('❯')) && (isDividerAbove || isDividerBelow);

      if (isStrictPrompt || isNamedPrompt || isFramedPrompt) {
        if (isStrictPrompt && userPromptIdx === -1) {
          endIdx = i;
        } else if (!isStrictPrompt && userPromptIdx === -1) {
          userPromptIdx = i;
          break;
        }
      }
    }

    if (userPromptIdx !== -1 || endIdx !== lines.length) {
      const startIndex = userPromptIdx !== -1 ? userPromptIdx + 1 : 0;
      
      let response = '';
      for (let i = startIndex; i < endIdx; i++) {
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
      if (this.isTuiMode) {
        if (
          bottomLines.includes('esc to cancel') ||
          diff.appendedText.includes('●') ||
          diff.appendedText.toLowerCase().includes('thought') ||
          diff.appendedText.toLowerCase().includes('working') ||
          diff.appendedText.toLowerCase().includes('generating') ||
          diff.appendedText.toLowerCase().includes('running')
        ) {
          this.hasSeenWorkingIndicator = true;
        }
      } else {
        if (
          diff.appendedText.trim().length > 0 ||
          diff.appendedText.includes('●') ||
          diff.appendedText.toLowerCase().includes('thought') ||
          diff.appendedText.toLowerCase().includes('working')
        ) {
          this.hasSeenWorkingIndicator = true;
        }
      }

      if (!this.isTuiMode) {
        // If a new empty prompt appears in the appended text, the agent must have finished processing
        if (diff.appendedText.match(/(?:^|\n)\s*[❯>]\s*(?:\n|$)/)) {
          this.hasSeenWorkingIndicator = true;
        }
      }
    }

    // 2. Check for Idle State FIRST
    let isIdle = false;

    const lastNonEmpty = curr.lines.filter(l => l.trim().length > 0).pop() || '';
    const cleanLastLine = lastNonEmpty
      .replace(ANSI_ESCAPES, '')
      .replace(CONTROL_CHARACTERS, '')
      .trim();

    const lastNonEmptyBottom = bottomLines
      .split('\n')
      .filter(l => l.trim().length > 0)
      .pop() || '';

    const cleanLastBottom = lastNonEmptyBottom
      .replace(ANSI_ESCAPES, '')
      .replace(CONTROL_CHARACTERS, '')
      .toLowerCase();

    const hasEscToCancel = cleanLastBottom.includes('esc to cancel');
    let isPromptLine: boolean;

    if (this.isTuiMode) {
      let promptIdx = -1;
      let horizontalLineIdx = -1;
      let footerTextIdx = -1;

      for (let i = curr.lines.length - 1; i >= Math.max(0, curr.lines.length - 15); i--) {
        const clean = curr.lines[i]
          .replace(ANSI_ESCAPES, '')
          .replace(CONTROL_CHARACTERS, '')
          .trim();
          
        if (clean === '') continue; // Skip empty lines between elements

        if (footerTextIdx === -1) {
          if (clean.includes('─')) {
            // We found the horizontal line BEFORE any footer text. 
            // This means the screen is torn and the footer hasn't been drawn yet.
            break;
          } else {
            footerTextIdx = i;
          }
        } else if (horizontalLineIdx === -1) {
          if (clean.includes('─')) {
            horizontalLineIdx = i;
          } else {
            // It's not a horizontal line, so this isn't the TUI structure.
            break; 
          }
        } else if (promptIdx === -1) {
          if (clean === '>' || clean === '❯' || clean.startsWith('>') || clean.startsWith('❯') || /^[❯>]$/.test(clean)) {
            promptIdx = i;
            break;
          } else {
            // It's not the prompt, so this isn't the TUI structure.
            break;
          }
        }
      }
      isPromptLine = promptIdx !== -1 && horizontalLineIdx !== -1 && footerTextIdx !== -1;
    } else {
      isPromptLine = 
          /antigravity\s*>\s*$/i.test(cleanLastLine) ||
          /agy\s*>\s*$/i.test(cleanLastLine) ||
          /^[❯>]\s*$/.test(cleanLastLine) ||
          /^[A-Z]:\\.*?>\s*$/i.test(cleanLastLine);
    }

    if (this.state === AgentState.Working && !this.hasSeenWorkingIndicator) {
      // The agent has been commanded to work, but we haven't seen it start working yet.
      isIdle = false;
    } else if (isPromptLine && !hasEscToCancel) {
      isIdle = true;
    }



    if (isIdle) {
      if (this.state === AgentState.Startup) {
        this.setState(AgentState.Idle, 'Ready');
      } else if (
        this.state === AgentState.Working ||
        this.state === AgentState.WaitingApproval ||
        this.state === AgentState.WaitingQuestion
      ) {
        // Debounce the transition to Idle to prevent screen tearing/flickering from causing premature extraction
        if (!(this as any).idleDebounceTimer) {
          (this as any).idleDebounceTimer = setTimeout(() => {
            (this as any).idleDebounceTimer = null;
            
            if (this.isClearing) {
              this.isClearing = false;
              this.accumulatedText = '';
              this.setState(AgentState.Idle, 'Ready');
              return;
            }

            // Re-evaluate using the latest stored snapshot to ensure it's still idle
            const snapshot = (this as any).latestSnapshot || curr;
            const message = this.isTuiMode
              ? this.cleanMessage(this.extractLastResponse(snapshot))
              : this.cleanMessage(this.accumulatedText);

            if (message.length > 0) {
              this.onMessageComplete(message);
            }

            this.accumulatedText = '';
            this.setState(AgentState.Idle, 'Ready');
          }, 300);
        }
      }
      return;
    } else {
      // If we are not idle, clear the debounce timer
      if ((this as any).idleDebounceTimer) {
        clearTimeout((this as any).idleDebounceTimer);
        (this as any).idleDebounceTimer = null;
      }
    }

    // 3. Check for Menus (Approval or Question)
    const searchArea = curr.lines.slice(Math.max(0, curr.lines.length - 15)).join('\n');
    const promptLastLine = curr.lines.filter(l => l.trim().length > 0).pop() || '';

    const hasYn =
      /Requesting permission/i.test(searchArea) ||
      /^\s*(?:\?|\*|[❯>])?\s*(?:Allow|Execute|Run|Proceed|Approve|Create|Edit|Write|Modify)/im.test(searchArea) ||
      /\([yY]\/[nN]\)/i.test(searchArea) ||
      /\[[yY]\/[nN]\]/i.test(searchArea) ||
      /Do you want to/i.test(searchArea) ||
      /\(y\/n\)/i.test(searchArea) ||
      /\[y\/n\]/i.test(searchArea);

    const hasProceed =
      /Do you want to proceed/i.test(searchArea) ||
      /Yes,\s*(allow|proceed|approve|run|execute)/i.test(searchArea) ||
      /Allow\s+[^\n]+\?/i.test(searchArea) ||
      /^\s*>\s*(Yes|Allow|Approve|Proceed)\b/im.test(searchArea);

    if (hasYn || hasProceed) {
      if (this.state !== AgentState.WaitingApproval) {
        const { description, command } = this.extractActionDetails(curr, searchArea);
        this.setState(AgentState.WaitingApproval, 'Antigravity needs approval');
        this.onApprovalRequired(description, command);
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
        const lastNonEmptyBottom = bottomLines
          .split('\n')
          .filter(l => l.trim().length > 0)
          .pop() || '';
        const cleanLastBottom = lastNonEmptyBottom
          .replace(ANSI_CSI_SEQUENCES, '')
          .replace(CONTROL_CHARACTERS, '')
          .toLowerCase();

        if (cleanLastBottom.includes('esc to cancel')) {
          startedWorking = true;
        }
      } else {
        if (
          diff.appendedText.includes('▸ Thought') ||
          diff.appendedText.match(/(?:^|\n)●/)
        ) {
          startedWorking = true;
        }
      }

      if (startedWorking) {
        this.setState(AgentState.Working, 'Working...');
        this.hasSeenWorkingIndicator = true;
        if (this.onWorkingStarted) this.onWorkingStarted();
      }
    }

    if (this.state === AgentState.Working) {
      const snapshot = (this as any).latestSnapshot || curr;
      const message = this.isTuiMode
        ? this.cleanMessage(this.extractLastResponse(snapshot))
        : this.cleanMessage(this.accumulatedText);
      
      if (message.length > 0 && this.onMessageChunk) {
        this.onMessageChunk(message);
      }
    }
  }

  private cleanMessage(message: string): string {
    let lines = message.split('\n');

    // Filter out raw tool diff lines, file creation headers, and execution protocols
    lines = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return true; // keep blank line spacing within markdown

      // Filter CLI headers and banners
      if (/Gemini \d+\.\d+ Flash/i.test(trimmed)) return false;
      if (/Claude [^\n]*?\((Thinking|Code)\)?/i.test(trimmed)) return false;
      if (/\? for shortcuts/i.test(trimmed)) return false;
      if (/esc to cancel/i.test(trimmed)) return false;
      if (/─{5,}/.test(trimmed)) return false;
      if (/v\.onashchuk@gmail\.com/i.test(trimmed)) return false;
      if (/Antigravity CLI/i.test(trimmed)) return false;
      if (/^[A-Z]:\\.*?>\s*$/i.test(trimmed)) return false;
      if (/Accessing workspace:/i.test(trimmed)) return false;
      if (/^[❯>]\s*$/.test(trimmed)) return false;
      if (/.*Navigate.*enter Select.*esc Skip/i.test(trimmed)) return false;
      if (/^[^\w\s]*\s*(Working|Generating|Running|Thinking|Signing in)(\.+|…)?/i.test(trimmed)) return false;
      if (/^[^\w\s]*\s*Tip:.*$/i.test(trimmed)) return false;
      if (/Welcome to standard Antigravity/i.test(trimmed)) return false;
      if (/Welcome to the Antigravity CLI/i.test(trimmed)) return false;
      if (/You are currently not signed in/i.test(trimmed)) return false;
      if (/^[▄▀\s]+$/.test(trimmed)) return false;

      // Filter Tool bullet headers
      if (/^●\s*(Create|Read|Edit|Write|Delete|Grep|Search|Bash|Terminal|Command|Task)/i.test(trimmed)) return false;
      if (/^●[^\n]*/.test(trimmed)) return false;
      if (/^▸\s*Thought/i.test(trimmed)) return false;

      // Filter Raw Tool Execution Headers (e.g., "Create file", "Read file", "/path/to/file +388")
      if (/^(Create|Read|Edit|Write|Delete)\s+file\b/i.test(trimmed)) return false;
      if (/^\/[^\s]+\s+\+\d+$/i.test(trimmed)) return false;
      if (/^\/[^\s]+\s+\+\d+\s+-\d+$/i.test(trimmed)) return false;

      // Filter Raw Unified Diff / Code Output Lines (e.g. "1 + <!DOCTYPE html>", "42 - const old = 1;", "10 | code")
      if (/^\d+\s*[+-]\s*/.test(trimmed)) return false;
      if (/^\d+\s*\|\s*/.test(trimmed)) return false;

      return true;
    });

    const cleaned = lines
      .join('\n')
      // Remove braille and unicode spinner characters
      .replace(/[\u2800-\u28FF]/g, '')
      .replace(/[⣾⣽⣻⢿⡿⣟⣯⣷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '')
      .trim();

    const hasMeaningfulText = /[a-zA-Z0-9_{}[\]()<>$=#`+\-*/]/.test(cleaned);
    if (!hasMeaningfulText) {
      return '';
    }

    return cleaned;
  }

  private extractActionDetails(curr: TerminalSnapshot, searchArea: string): { description: string; command: string } {
    let description = '';
    let command = '';

    // Check for explicit "Requesting permission for: <action>"
    const reqPermMatch = searchArea.match(/Requesting permission for:\s*\n?\s*(.*?)(?:\n|\(y\/n\)|$)/i);
    if (reqPermMatch && reqPermMatch[1] && reqPermMatch[1].trim()) {
      description = reqPermMatch[1].trim();
      command = reqPermMatch[1].trim();
      return { description, command };
    }

    // Search backwards in screen lines for bullet headers (● Create...), file paths, and tool lines
    for (let i = curr.lines.length - 1; i >= Math.max(0, curr.lines.length - 25); i--) {
      const line = curr.lines[i].trim();
      if (!line) continue;

      // Ignore generic prompt lines
      if (
        line.toLowerCase().includes('do you want to proceed') ||
        line.toLowerCase().includes('esc to cancel') ||
        line.toLowerCase().includes('? for shortcuts')
      ) {
        continue;
      }

      // Check for ● bullet lines (e.g. "● Create calculator/index.html")
      if (line.startsWith('●') || line.startsWith('▸')) {
        const cleanLine = line.replace(/^[●▸]\s*/, '').trim();
        if (!description && cleanLine) {
          description = cleanLine;
        }
      }

      // Check for tool action lines (e.g. "Create file /home/...", "Run bash command", "Edit src/App.tsx")
      if (
        /^(Create|Read|Edit|Write|Delete|Execute|Run|Bash|Modify)\s+/i.test(line) &&
        !description
      ) {
        description = line;
      }

      // Check for file path or command lines (e.g. "/home/qhukz/Documents/.../calculator/index.html")
      if (
        (/^\/[^\s]+$/i.test(line) || /^[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+$/i.test(line)) &&
        !command
      ) {
        command = line;
      }
    }

    // Fallbacks
    if (!description) {
      const allowMatch = searchArea.match(/Allow\s+(.*?)\?/i);
      if (allowMatch && allowMatch[1]) {
        description = `Allow ${allowMatch[1].trim()}`;
      } else {
        description = 'Antigravity action approval required';
      }
    }

    if (!command) {
      command = description !== 'Antigravity action approval required'
        ? description
        : 'Do you want to proceed?';
    }

    return { description, command };
  }
}
