import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
export class ProjectManager {
    configPath;
    projects = [];
    constructor() {
        this.configPath = path.resolve(process.cwd(), 'agentdeck.config.json');
        this.load();
    }
    load() {
        if (fs.existsSync(this.configPath)) {
            try {
                const data = fs.readFileSync(this.configPath, 'utf8');
                this.projects = JSON.parse(data);
            }
            catch (err) {
                console.error('Failed to load agentdeck.config.json', err);
            }
        }
    }
    save() {
        fs.writeFileSync(this.configPath, JSON.stringify(this.projects, null, 2), 'utf8');
    }
    getProjects() {
        return this.projects;
    }
    addProject(name, projectPath) {
        const newProject = {
            id: crypto.randomUUID(),
            name,
            path: projectPath
        };
        this.projects.push(newProject);
        this.save();
        return newProject;
    }
    removeProject(id) {
        this.projects = this.projects.filter(p => p.id !== id);
        this.save();
    }
}
export const projectManager = new ProjectManager();
