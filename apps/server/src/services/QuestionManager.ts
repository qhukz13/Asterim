import { eventBus } from './EventBus';
import { AsterimEvent, ClientQuestionResponsePayload } from '@asterim/shared';
import crypto from 'crypto';

interface PendingQuestion {
  resolve: (value: number | string) => void;
  reject: (reason: any) => void;
  timeoutId: NodeJS.Timeout;
}

export class QuestionManager {
  private pendingQuestions = new Map<string, PendingQuestion>();

  constructor() {
    this.listenForResponses();
  }

  private listenForResponses() {
    eventBus.subscribe<ClientQuestionResponsePayload>('client.question_response', event => {
      const { questionId, selectedIndex, selectedText } = event.payload;

      const pending = this.pendingQuestions.get(questionId);

      if (pending) {
        clearTimeout(pending.timeoutId);
        pending.resolve(selectedText || selectedIndex);
        this.pendingQuestions.delete(questionId);
        console.log(
          `[QuestionManager] Question ${questionId} resolved with index ${selectedIndex}`
        );
      } else {
        console.log(
          `[QuestionManager] Question ${questionId} resolved via EventBus with index ${selectedIndex} (no active process resolver)`
        );
      }
    });
  }

  /**
   * Suspends execution and requests user to answer a question via the EventBus.
   */
  public requestQuestion(
    projectId: string,
    question: string,
    options: string[],
    timeoutMs: number = 300000 // 5 minutes default timeout for MVP
  ): Promise<number | string> {
    const questionId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      // 1. Setup the timeout fallback
      const timeoutId = setTimeout(() => {
        if (this.pendingQuestions.has(questionId)) {
          this.pendingQuestions.delete(questionId);
          console.log(`[QuestionManager] Question ${questionId} timed out.`);
          resolve(1); // Default to option 1 on timeout for safety
        }
      }, timeoutMs);

      // 2. Store the resolvers
      this.pendingQuestions.set(questionId, { resolve, reject, timeoutId });

      // 3. Publish the request to the EventBus
      console.log(`[QuestionManager] Requesting question for ${questionId}`);
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'system:question_manager',
        type: 'agent.question_request',
        payload: {
          projectId,
          questionId,
          question,
          options
        }
      });
    });
  }
}

export const questionManager = new QuestionManager();
