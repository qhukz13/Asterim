import { AsterimEvent } from '@asterim/shared';

type EventListener = (event: AsterimEvent) => void;

/**
 * A session-scoped event bus.
 * Prevents event leakage between parallel agents.
 */
export class SessionEventBus {
  private listeners: Set<EventListener> = new Set();
  public readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  public subscribe(listener: EventListener): void {
    this.listeners.add(listener);
  }

  public unsubscribe(listener: EventListener): void {
    this.listeners.delete(listener);
  }

  public publish(event: AsterimEvent): void {
    // Ensure the event has the correct session metadata if not already set.
    const enrichedEvent = {
      ...event,
      payload: {
        ...event.payload,
        sessionId: this.sessionId
      }
    };
    
    for (const listener of this.listeners) {
      try {
        listener(enrichedEvent);
      } catch (err) {
        console.error(`[SessionEventBus:${this.sessionId}] Error in listener:`, err);
      }
    }
  }
}
