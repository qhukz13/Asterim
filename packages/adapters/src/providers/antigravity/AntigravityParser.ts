import { Terminal } from '@xterm/headless';
import { takeSnapshot, TerminalSnapshot } from './terminal/ScreenSnapshot';
import { diffScreens } from './terminal/ScreenDiff';
import { AntigravityFSM, AgentState } from './terminal/TerminalFSM';
import { IParser } from '../../sdk/types';
import { AsterimEvent } from '@asterim/shared';
import { randomUUID } from 'crypto';

export class AntigravityParser implements IParser {
  private term: Terminal;
  private fsm: AntigravityFSM;
  private previousSnapshot: TerminalSnapshot | null = null;
  private onEvent: (event: AsterimEvent) => void;
  private lastEmittedMessage: string = '';
  private isStartingUp: boolean = true;
  private currentMessageId: string | null = null;

  constructor(onEvent: (event: AsterimEvent) => void) {
    this.onEvent = onEvent;
    
    this.term = new Terminal({
      allowProposedApi: true,
      cols: 1000,
      rows: 24,
      scrollback: 10000
    });

    this.fsm = new AntigravityFSM(
      (message) => this.handleMessageComplete(message),
      (state, reason) => this.handleStateChange(state, reason),
      (desc, command) => this.handleApprovalRequired(desc, command),
      () => this.handleTrustRequired(),
      (q, opts) => this.handleQuestionRequired(q, opts),
      (message) => this.handleMessageChunk(message)
    );
  }

  public processOutput(chunk: any): void {
    const strData = typeof chunk === 'string' ? chunk : chunk?.toString ? chunk.toString('utf-8') : String(chunk);
    this.term.write(strData, () => {
      this.processScreenTick();
    });
  }

  public notifyCommandSent(command?: string) {
    if (command && command.trim() === '/clear') {
      this.term.clear();
      this.term.reset();
    }
    this.fsm.notifyCommandSent();
    this.currentMessageId = null;
    this.lastEmittedMessage = '';
  }

  private processScreenTick() {
    const currentSnapshot = takeSnapshot(this.term);
    let diff: import('./terminal/ScreenDiff').DiffResult = { newLines: [], modifiedLines: [], appendedText: '' };
    
    if (this.previousSnapshot) {
      diff = diffScreens(this.previousSnapshot, currentSnapshot);
    }
    
    this.previousSnapshot = currentSnapshot;
    this.fsm.process(diff, currentSnapshot);
  }

  private handleStateChange(state: AgentState, reason: string) {
    let internalState: 'idle' | 'working' | 'waiting_approval' | 'waiting_question' | 'error' | 'startup' = 'working';

    if (state === AgentState.Startup) internalState = 'startup';
    if (state === AgentState.Idle) internalState = 'idle';
    if (state === AgentState.WaitingApproval) internalState = 'waiting_approval';
    if (state === AgentState.WaitingQuestion) internalState = 'waiting_question';
    if (state === AgentState.Working) internalState = 'working';
    
    this.emitStatus(internalState, reason);

    if (state === AgentState.Idle && this.isStartingUp) {
      this.isStartingUp = false;
      console.log('[AntigravityParser] Startup complete. Ready for commands.');
    }
  }

  private isHeaderOrLogo(msg: string): boolean {
    const trimmed = msg.trim();
    if (!trimmed) return true;
    return (
      trimmed.includes("Hello! I'm Antigravity, your AI coding assistant") ||
      trimmed.includes("Welcome to Google Antigravity Agent") ||
      trimmed.includes("What would you like help with?") ||
      trimmed.includes("Initializing workspace...") ||
      trimmed.includes("Antigravity CLI") ||
      trimmed.includes("v.onashchuk@gmail.com") ||
      trimmed.includes("Claude Sonnet") ||
      trimmed.includes("Gemini 1.5") ||
      trimmed.includes("Gemini 2.0") ||
      trimmed.includes("Gemini 3.6")
    );
  }

  private handleMessageChunk(message: string) {
    let cleanMsg = message.trim();
    if (cleanMsg === 'y' || cleanMsg === 'n' || cleanMsg === '') return;
    if (cleanMsg === this.lastEmittedMessage) return;

    if (this.isHeaderOrLogo(cleanMsg)) {
      return;
    }
    
    this.lastEmittedMessage = cleanMsg;
    this.onEvent({
      id: this.currentMessageId || randomUUID(),
      timestamp: Date.now(),
      type: 'agent.stream',
      source: 'agent',
      payload: { role: 'agent', content: cleanMsg }
    });
  }

  private handleMessageComplete(message: string) {
    let cleanMsg = message.trim();
    if (cleanMsg === 'y' || cleanMsg === 'n' || cleanMsg === '') return;

    if (this.isHeaderOrLogo(cleanMsg)) {
      return;
    }
    
    this.lastEmittedMessage = cleanMsg;
    this.emitLog('agent', cleanMsg, false);
    this.currentMessageId = null;
  }

  private handleApprovalRequired(desc: string, command: string) {
    this.onEvent({
      id: randomUUID(),
      timestamp: Date.now(),
      type: 'agent.approval_request',
      source: 'agent',
      payload: { actionId: randomUUID(), description: desc, command }
    });
  }

  private handleTrustRequired() {
    // We emit an event that the adapter might catch and auto-approve or user approve
    this.onEvent({
      id: randomUUID(),
      timestamp: Date.now(),
      type: 'agent.trust_required',
      source: 'agent',
      payload: {}
    });
  }

  private handleQuestionRequired(question: string, options: string[]) {
    this.onEvent({
      id: randomUUID(),
      timestamp: Date.now(),
      type: 'agent.question_required',
      source: 'agent',
      payload: { questionId: randomUUID(), question, options }
    });
  }

  private emitLog(role: 'agent' | 'user', content: string, isChunk: boolean = false) {
    if (!this.currentMessageId) {
      this.currentMessageId = randomUUID();
    }
    const eventId = this.currentMessageId;
    this.onEvent({
      id: eventId,
      timestamp: Date.now(),
      type: 'chat.message',
      source: 'agent',
      payload: { role, content }
    });
  }

  private emitStatus(status: 'idle' | 'working' | 'waiting_approval' | 'waiting_question' | 'error' | 'startup', message: string) {
    this.onEvent({
      id: randomUUID(),
      timestamp: Date.now(),
      type: 'agent.status',
      source: 'agent',
      payload: { status, message }
    });
  }
}
