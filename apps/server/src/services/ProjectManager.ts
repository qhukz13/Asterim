import crypto from 'crypto';
import { dbService } from './DatabaseService';

export interface ProjectConfig {
  id: string;
  workspace_id?: string;
  name: string;
  path: string;
  visibility?: string;
  created_at?: string;
}

export interface ThreadConfig {
  id: string;
  project_id: string;
  name: string;
  created_at?: string;
  /** The thread that delegated this one, when it was delegated (P7-01). */
  parent_thread_id?: string | null;
  /** The child's brief and recorded outcome, as stored JSON (P7-01). */
  delegation_context_json?: string | null;
}

export class ProjectManager {
  public getProjects(workspaceId?: string): ProjectConfig[] {
    const db = dbService.getDb();
    try {
      if (workspaceId && workspaceId !== 'personal') {
        const wsRow = db.prepare('SELECT is_personal FROM workspaces WHERE id = ?').get(workspaceId) as any;
        const isPersonal = wsRow ? Boolean(wsRow.is_personal) : false;

        if (isPersonal) {
          const query = db.prepare(
            `SELECT DISTINCT p.id, p.workspace_id, p.name, p.path, p.visibility, p.created_at 
             FROM projects p 
             LEFT JOIN environment_project_attachments epa ON p.id = epa.project_id
             WHERE p.workspace_id = ? OR p.workspace_id IS NULL OR p.workspace_id = '' OR epa.environment_id = ?
             ORDER BY p.created_at DESC`
          );
          return query.all(workspaceId, workspaceId) as unknown as ProjectConfig[];
        } else {
          const query = db.prepare(
            `SELECT DISTINCT p.id, p.workspace_id, p.name, p.path, p.visibility, p.created_at 
             FROM projects p 
             LEFT JOIN environment_project_attachments epa ON p.id = epa.project_id
             WHERE p.workspace_id = ? OR epa.environment_id = ?
             ORDER BY p.created_at DESC`
          );
          return query.all(workspaceId, workspaceId) as unknown as ProjectConfig[];
        }
      }
      const query = db.prepare(
        'SELECT id, workspace_id, name, path, visibility, created_at FROM projects ORDER BY created_at DESC'
      );
      return query.all() as unknown as ProjectConfig[];
    } catch (e) {
      const query = db.prepare('SELECT id, name, path, created_at FROM projects ORDER BY created_at DESC');
      return query.all() as unknown as ProjectConfig[];
    }
  }

  public getProject(id: string): ProjectConfig | undefined {
    const db = dbService.getDb();
    try {
      const query = db.prepare('SELECT id, workspace_id, name, path, visibility, created_at FROM projects WHERE id = ?');
      return query.get(id) as unknown as ProjectConfig | undefined;
    } catch (e) {
      const query = db.prepare('SELECT id, name, path, created_at FROM projects WHERE id = ?');
      return query.get(id) as unknown as ProjectConfig | undefined;
    }
  }

  public addProject(name: string, projectPath: string, workspaceId?: string, visibility: string = 'private'): ProjectConfig {
    const db = dbService.getDb();

    // `projects.workspace_id` references `workspaces(id)`, and the dashboard
    // sends the environment it is showing. If that row is missing the insert
    // fails with a bare "FOREIGN KEY constraint failed" and a 500 — which is
    // exactly what a brand-new installation did on the very first project,
    // before the personal environment was seeded (found by the clean-machine
    // test, 2026-09-09). The environment is now seeded at boot; this keeps a
    // stale or unknown id from ever being fatal again: the project is created
    // unattached rather than refused.
    let effectiveWorkspaceId = workspaceId || null;
    if (effectiveWorkspaceId) {
      try {
        const exists = db
          .prepare('SELECT 1 AS ok FROM workspaces WHERE id = ?')
          .get(effectiveWorkspaceId) as { ok?: number } | undefined;
        if (!exists) {
          console.warn(
            `[ProjectManager] Environment ${effectiveWorkspaceId} does not exist; creating "${name}" unattached.`
          );
          effectiveWorkspaceId = null;
        }
      } catch {
        // A database old enough to lack the table cannot enforce the key either.
        effectiveWorkspaceId = null;
      }
    }

    const newProject: ProjectConfig = {
      id: crypto.randomUUID(),
      workspace_id: effectiveWorkspaceId ?? undefined,
      name,
      path: projectPath,
      visibility,
    };

    const insert = db.prepare('INSERT INTO projects (id, workspace_id, name, path, visibility) VALUES (?, ?, ?, ?, ?)');
    insert.run(newProject.id, effectiveWorkspaceId, newProject.name, newProject.path, visibility || 'private');

    if (effectiveWorkspaceId) {
      const workspaceId = effectiveWorkspaceId;
      try {
        const attachId = `epa_${crypto.randomUUID()}`;
        db.prepare('INSERT OR IGNORE INTO environment_project_attachments (id, environment_id, project_id, attached_at) VALUES (?, ?, ?, ?)')
          .run(attachId, workspaceId, newProject.id, Date.now());
      } catch {
        // The attachment table is absent in pre-workspace databases; the project
        // is still created and reachable through its workspace_id.
      }
    }

    // Automatically create a default thread
    this.createThread(newProject.id, 'Main Session');

    return newProject;
  }

  public removeProject(id: string): void {
    const db = dbService.getDb();
    const remove = db.prepare('DELETE FROM projects WHERE id = ?');
    remove.run(id);
  }

  /**
   * A project's threads, carrying the delegation link the dashboard draws the
   * hierarchy from (P7-02).
   *
   * The two delegation columns arrived as `ALTER TABLE` statements wrapped in
   * try/catch, so a database on which those never applied still has to open.
   * The fallback is the pre-delegation projection: a flat list, which is
   * exactly what the sidebar renders when nothing has been delegated anyway.
   */
  public getThreads(projectId: string): ThreadConfig[] {
    const db = dbService.getDb();
    try {
      const query = db.prepare(
        `SELECT id, project_id, name, created_at, parent_thread_id, delegation_context_json
           FROM threads WHERE project_id = ? ORDER BY created_at ASC`
      );
      return query.all(projectId) as unknown as ThreadConfig[];
    } catch {
      const query = db.prepare(
        'SELECT id, project_id, name, created_at FROM threads WHERE project_id = ? ORDER BY created_at ASC'
      );
      return query.all(projectId) as unknown as ThreadConfig[];
    }
  }

  public createThread(projectId: string, name: string): ThreadConfig {
    const db = dbService.getDb();
    const newThread: ThreadConfig = {
      id: crypto.randomUUID(),
      project_id: projectId,
      name
    };
    const insert = db.prepare('INSERT INTO threads (id, project_id, name) VALUES (?, ?, ?)');
    insert.run(newThread.id, newThread.project_id, newThread.name);
    return newThread;
  }
}

export const projectManager = new ProjectManager();
