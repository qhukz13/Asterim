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
      (q, opts) => this.handleQuestionRequired(q, opts)
    );
  }

  public processOutput(chunk: any): void {
    if (typeof chunk === 'string') {
      this.term.write(chunk, () => {
        this.processScreenTick();
      });
    }
  }

  public notifyCommandSent() {
    this.fsm.notifyCommandSent();
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

  private handleMessageComplete(message: string) {
    let cleanMsg = message.trim();
    if (cleanMsg === 'y' || cleanMsg === 'n' || cleanMsg === '') return;
    if (cleanMsg === this.lastEmittedMessage) return;
    
    this.lastEmittedMessage = cleanMsg;
    this.emitLog('agent', cleanMsg);
  }

  private handleApprovalRequired(desc: string, command: string) {
    this.onEvent({
      id: randomUUID(),
      timestamp: Date.now(),
      type: 'agent.approval_required', // Make sure to use the proper string from AsterimEvent definitions, we'll proxy it out
      source: 'agent',
      payload: { description: desc, command }
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

  private emitLog(role: 'agent' | 'user', content: string) {
    this.onEvent({
      id: randomUUID(),
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
