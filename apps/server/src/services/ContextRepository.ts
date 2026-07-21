import crypto from 'crypto';
import { dbService } from './DatabaseService';
import type { ContextEntry, ContextEntryType, ContextEntryCreator } from '@asterim/shared';

/** Row shape returned from the context_entries table. */
interface ContextEntryRow {
  id: string;
  context_id: string;
  thread_id: string;
  project_id: string;
  entry_type: string;
  path: string | null;
  label: string | null;
  content: string | null;
  status: string;
  created_by: string;
  position: number;
  created_at: number;
  updated_at: number;
  version: number;
}

/** Row shape returned from the contexts table. */
interface ContextRow {
  id: string;
  thread_id: string;
  project_id: string;
  created_at: number;
  updated_at: number;
  version: number;
}

/** Input for creating a new context entry. */
export interface CreateEntryInput {
  threadId: string;
  projectId: string;
  entryType: ContextEntryType;
  path?: string;
  label?: string;
  content?: string;
  status?: 'pinned' | 'active' | 'suggestion';
  createdBy?: ContextEntryCreator;
  position?: number;
}

/**
 * Repository layer for Context persistence.
 * Services depend on this — not on SQL directly.
 */
export class ContextRepository {
  /**
   * Ensures a Context aggregate exists for the given thread.
   * Returns the context ID.
   */
  public ensureContext(threadId: string, projectId: string): string {
    const db = dbService.getDb();
    const existing = db
      .prepare('SELECT id FROM contexts WHERE thread_id = ?')
      .get(threadId) as { id: string } | undefined;

    if (existing) return existing.id;

    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(
      'INSERT INTO contexts (id, thread_id, project_id, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(id, threadId, projectId, now, now);

    return id;
  }

  /**
   * Returns all entries for a thread's context, ordered by position.
   */
  public getEntries(threadId: string): ContextEntry[] {
    const db = dbService.getDb();
    const rows = db
      .prepare(
        'SELECT * FROM context_entries WHERE thread_id = ? ORDER BY position ASC, created_at ASC'
      )
      .all(threadId) as unknown as ContextEntryRow[];

    return rows.map(this.rowToEntry);
  }

  /**
   * Returns a single entry by ID.
   */
  public getEntry(entryId: string): ContextEntry | null {
    const db = dbService.getDb();
    const row = db
      .prepare('SELECT * FROM context_entries WHERE id = ?')
      .get(entryId) as unknown as ContextEntryRow | undefined;

    return row ? this.rowToEntry(row) : null;
  }

  /**
   * Adds a new entry to the context. Auto-creates the context aggregate if needed.
   * Returns the created entry.
   */
  public addEntry(input: CreateEntryInput): ContextEntry {
    const db = dbService.getDb();
    const contextId = this.ensureContext(input.threadId, input.projectId);
    const now = Date.now();

    // Auto-assign position if not specified: append to end
    let position = input.position;
    if (position === undefined) {
      const maxRow = db
        .prepare('SELECT MAX(position) as max_pos FROM context_entries WHERE context_id = ?')
        .get(contextId) as { max_pos: number | null } | undefined;
      position = (maxRow?.max_pos ?? -1) + 1;
    }

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO context_entries
        (id, context_id, thread_id, project_id, entry_type, path, label, content, status, created_by, position, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      id,
      contextId,
      input.threadId,
      input.projectId,
      input.entryType,
      input.path ?? null,
      input.label ?? null,
      input.content ?? null,
      input.status ?? 'pinned',
      input.createdBy ?? 'user',
      position,
      now,
      now
    );

    // Bump aggregate version
    this.bumpContextVersion(contextId);

    return this.getEntry(id)!;
  }

  /**
   * Removes an entry by ID.
   * Returns true if the entry existed and was deleted.
   */
  public removeEntry(entryId: string): boolean {
    const db = dbService.getDb();
    const entry = this.getEntry(entryId);
    if (!entry) return false;

    db.prepare('DELETE FROM context_entries WHERE id = ?').run(entryId);

    // Bump aggregate version
    const ctx = db
      .prepare('SELECT id FROM contexts WHERE thread_id = ?')
      .get(entry.threadId) as { id: string } | undefined;
    if (ctx) this.bumpContextVersion(ctx.id);

    return true;
  }

  /**
   * Removes all entries for a thread's context.
   */
  public clearEntries(threadId: string): void {
    const db = dbService.getDb();
    db.prepare('DELETE FROM context_entries WHERE thread_id = ?').run(threadId);

    const ctx = db
      .prepare('SELECT id FROM contexts WHERE thread_id = ?')
      .get(threadId) as { id: string } | undefined;
    if (ctx) this.bumpContextVersion(ctx.id);
  }

  /**
   * Updates an existing entry's mutable fields.
   */
  public updateEntry(
    entryId: string,
    updates: Partial<Pick<ContextEntry, 'status' | 'label' | 'content' | 'position'>>
  ): ContextEntry | null {
    const db = dbService.getDb();
    const existing = this.getEntry(entryId);
    if (!existing) return null;

    const now = Date.now();
    const newVersion = existing.version + 1;

    const fields: string[] = ['updated_at = ?', 'version = ?'];
    const values: any[] = [now, newVersion];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.label !== undefined) {
      fields.push('label = ?');
      values.push(updates.label);
    }
    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
    }
    if (updates.position !== undefined) {
      fields.push('position = ?');
      values.push(updates.position);
    }

    values.push(entryId);
    db.prepare(`UPDATE context_entries SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    // Bump aggregate version
    const ctx = db
      .prepare('SELECT id FROM contexts WHERE thread_id = ?')
      .get(existing.threadId) as { id: string } | undefined;
    if (ctx) this.bumpContextVersion(ctx.id);

    return this.getEntry(entryId);
  }

  // --- Private helpers ---

  private bumpContextVersion(contextId: string): void {
    const db = dbService.getDb();
    db.prepare('UPDATE contexts SET updated_at = ?, version = version + 1 WHERE id = ?').run(
      Date.now(),
      contextId
    );
  }

  private rowToEntry(row: ContextEntryRow): ContextEntry {
    return {
      id: row.id,
      threadId: row.thread_id,
      projectId: row.project_id,
      entryType: row.entry_type as ContextEntryType,
      path: row.path ?? undefined,
      label: row.label ?? undefined,
      content: row.content ?? undefined,
      status: row.status as 'pinned' | 'active' | 'suggestion',
      createdBy: row.created_by as ContextEntryCreator,
      position: row.position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version
    };
  }
}

export const contextRepository = new ContextRepository();
