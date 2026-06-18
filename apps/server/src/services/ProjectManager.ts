import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface ProjectConfig {
  id: string;
  name: string;
  path: string;
}

export class ProjectManager {
  private configPath: string;
  private projects: ProjectConfig[] = [];

  constructor() {
    this.configPath = path.resolve(process.cwd(), 'agentdeck.config.json');
    this.load();
  }

  private load() {
    if (fs.existsSync(this.configPath)) {
      try {
        const data = fs.readFileSync(this.configPath, 'utf8');
        this.projects = JSON.parse(data);
      } catch (err) {
        console.error('Failed to load agentdeck.config.json', err);
      }
    }
  }

  private save() {
    fs.writeFileSync(this.configPath, JSON.stringify(this.projects, null, 2), 'utf8');
  }

  public getProjects(): ProjectConfig[] {
    return this.projects;
  }

  public addProject(name: string, projectPath: string): ProjectConfig {
    const newProject: ProjectConfig = {
      id: crypto.randomUUID(),
      name,
      path: projectPath
    };
    this.projects.push(newProject);
    this.save();
    return newProject;
  }

  public removeProject(id: string): void {
    this.projects = this.projects.filter(p => p.id !== id);
    this.save();
  }
}

export const projectManager = new ProjectManager();
