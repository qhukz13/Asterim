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
}

export class ProjectManager {
  public getProjects(workspaceId?: string): ProjectConfig[] {
    const db = dbService.getDb();
    try {
      if (workspaceId && workspaceId !== 'personal') {
        const query = db.prepare(
          'SELECT id, workspace_id, name, path, visibility, created_at FROM projects WHERE workspace_id = ? OR workspace_id IS NULL OR workspace_id = "" ORDER BY created_at DESC'
        );
        return query.all(workspaceId) as unknown as ProjectConfig[];
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
    const newProject: ProjectConfig = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      name,
      path: projectPath,
      visibility,
    };

    const insert = db.prepare('INSERT INTO projects (id, workspace_id, name, path, visibility) VALUES (?, ?, ?, ?, ?)');
    insert.run(newProject.id, workspaceId || null, newProject.name, newProject.path, visibility || 'private');

    // Automatically create a default thread
    this.createThread(newProject.id, 'Main Session');

    return newProject;
  }

  public removeProject(id: string): void {
    const db = dbService.getDb();
    const remove = db.prepare('DELETE FROM projects WHERE id = ?');
    remove.run(id);
  }

  public getThreads(projectId: string): ThreadConfig[] {
    const db = dbService.getDb();
    const query = db.prepare(
      'SELECT id, project_id, name, created_at FROM threads WHERE project_id = ? ORDER BY created_at ASC'
    );
    return query.all(projectId) as unknown as ThreadConfig[];
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
