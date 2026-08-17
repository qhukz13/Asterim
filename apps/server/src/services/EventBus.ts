import { EventEmitter } from 'events';
import { AsterimEvent } from '@asterim/shared';

export class EventBus {
  private static instance: EventBus;
  private emitter: EventEmitter;

  /**
   * Strips known secret values out of payloads before they are broadcast
   * (P9-01). Registered by `SecretVaultService` instead of imported, so this
   * module — which nearly every service depends on — does not pull the database
   * open just by being loaded. Null until a vault exists, and a no-op until one
   * has actually seen a secret.
   */
  private redactor: ((payload: unknown) => unknown) | null = null;

  private constructor() {
    this.emitter = new EventEmitter();
    // Increase max listeners since multiple websocket clients or adapters could subscribe
    this.emitter.setMaxListeners(100);
  }

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /** Installs the payload redactor. See `redactor`. */
  public setRedactor(fn: ((payload: unknown) => unknown) | null): void {
    this.redactor = fn;
  }

  /**
   * Publishes an event to the bus.
   *
   * The payload is passed through the redactor first: a credential the agent
   * echoed into its stdout would otherwise reach every subscriber, be persisted
   * to the event log, and be broadcast to the project room over Socket.IO.
   */
  public publish<T>(event: AsterimEvent<T>): void {
    let outgoing = event;
    if (this.redactor) {
      try {
        const payload = this.redactor(event.payload) as AsterimEvent<T>['payload'];
        if (payload !== event.payload) outgoing = { ...event, payload };
      } catch {
        /* Redaction must never be the reason an event is dropped. */
      }
    }
    this.emitter.emit(outgoing.type, outgoing);
    // Emit a catch-all for system-wide logging if necessary
    this.emitter.emit('*', outgoing);
  }

  /**
   * Subscribes to a specific event type.
   */
  public subscribe<T = any>(eventType: string, callback: (event: AsterimEvent<T>) => void): void {
    this.emitter.on(eventType, callback);
  }

  /**
   * Unsubscribes from a specific event type.
   */
  public unsubscribe<T = any>(eventType: string, callback: (event: AsterimEvent<T>) => void): void {
    this.emitter.off(eventType, callback);
  }
}

export const eventBus = EventBus.getInstance();
