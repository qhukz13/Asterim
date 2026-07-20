import crypto from 'crypto';
import { eventBus } from './EventBus';
import { contextRepository, CreateEntryInput } from './ContextRepository';
import type { ContextEntry } from '@asterim/shared';

/**
 * Business-logic layer for the Context domain aggregate.
 * Delegates persistence to ContextRepository and broadcasts changes via EventBus.
 */
export class ContextService {
  /**
   * Returns all context entries for a thread.
   */
  public getEntries(threadId: string): ContextEntry[] {
    return contextRepository.getEntries(threadId);
  }

  /**
   * Adds a new entry to a thread's context and broadcasts the update.
   */
  public addEntry(input: CreateEntryInput): ContextEntry {
    const entry = contextRepository.addEntry(input);
    this.broadcastUpdate(input.threadId, input.projectId);
    return entry;
  }

  /**
   * Removes an entry and broadcasts the update.
   * Returns true if the entry existed.
   */
  public removeEntry(entryId: string): boolean {
    const entry = contextRepository.getEntry(entryId);
    if (!entry) return false;

    const removed = contextRepository.removeEntry(entryId);
    if (removed) {
      this.broadcastUpdate(entry.threadId, entry.projectId);
    }
    return removed;
  }

  /**
   * Updates an existing entry's mutable fields and broadcasts the update.
   */
  public updateEntry(
    entryId: string,
    updates: Partial<Pick<ContextEntry, 'status' | 'label' | 'content' | 'position'>>
  ): ContextEntry | null {
    const entry = contextRepository.getEntry(entryId);
    if (!entry) return null;

    const updated = contextRepository.updateEntry(entryId, updates);
    if (updated) {
      this.broadcastUpdate(entry.threadId, entry.projectId);
    }
    return updated;
  }

  /**
   * Clears all entries for a thread's context and broadcasts the cleared event.
   */
  public clearEntries(threadId: string, projectId: string): void {
    contextRepository.clearEntries(threadId);

    eventBus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server:context',
      type: 'context.cleared',
      payload: { threadId, projectId }
    });
  }

  // --- Private helpers ---

  private broadcastUpdate(threadId: string, projectId: string): void {
    const entries = contextRepository.getEntries(threadId);

    eventBus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server:context',
      type: 'context.updated',
      payload: { threadId, projectId, entries }
    });
  }
}

export const contextService = new ContextService();
