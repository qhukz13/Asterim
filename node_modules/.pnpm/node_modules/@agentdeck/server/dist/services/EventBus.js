import { EventEmitter } from 'events';
export class EventBus {
    static instance;
    emitter;
    constructor() {
        this.emitter = new EventEmitter();
        // Increase max listeners since multiple websocket clients or adapters could subscribe
        this.emitter.setMaxListeners(100);
    }
    static getInstance() {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus();
        }
        return EventBus.instance;
    }
    /**
     * Publishes an event to the bus.
     */
    publish(event) {
        this.emitter.emit(event.type, event);
        // Emit a catch-all for system-wide logging if necessary
        this.emitter.emit('*', event);
    }
    /**
     * Subscribes to a specific event type.
     */
    subscribe(eventType, callback) {
        this.emitter.on(eventType, callback);
    }
    /**
     * Unsubscribes from a specific event type.
     */
    unsubscribe(eventType, callback) {
        this.emitter.off(eventType, callback);
    }
}
export const eventBus = EventBus.getInstance();
