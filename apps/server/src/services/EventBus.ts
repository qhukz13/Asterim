import { EventEmitter } from 'events';
import { AsterimEvent } from '@asterim/shared';

export class EventBus {
  private static instance: EventBus;
  private emitter: EventEmitter;

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

  /**
   * Publishes an event to the bus.
   */
  public publish<T>(event: AsterimEvent<T>): void {
    this.emitter.emit(event.type, event);
    // Emit a catch-all for system-wide logging if necessary
    this.emitter.emit('*', event);
  }

  /**
   * Subscribes to a specific event type.
   */
  public subscribe<T = any>(
    eventType: string, 
    callback: (event: AsterimEvent<T>) => void
  ): void {
    this.emitter.on(eventType, callback);
  }

  /**
   * Unsubscribes from a specific event type.
   */
  public unsubscribe<T = any>(
    eventType: string, 
    callback: (event: AsterimEvent<T>) => void
  ): void {
    this.emitter.off(eventType, callback);
  }
}

export const eventBus = EventBus.getInstance();
