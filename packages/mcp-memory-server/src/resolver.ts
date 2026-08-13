import path from 'path';
import { dbService } from 'asterim/src/services/DatabaseService';

/** A project resolved for this MCP process. `path` is normalized, not the raw stored value. */
export interface ResolvedProject {
  id: string;
  name: string;
  path: string;
}

export interface ResolveOptions {
  /** From `--project <id>`. Highest priority. */
  explicitProjectId?: string;
  /** From `--project-path <path>`. */
  explicitProjectPath?: string;
  /** Overrides `process.cwd()` for auto-detection. Primarily for tests. */
  cwd?: string;
}

/** Row shape returned from the projects table. */
interface ProjectRow {
  id: string;
  name: string;
  path: string;
}

/**
 * Resolves which Asterim project this MCP process is operating on.
 *
 * Priority:
 *   1. `explicitProjectId`      (`--project <id>`)
 *   2. `explicitProjectPath`    (`--project-path <path>`)
 *   3. `ASTERIM_PROJECT_ID`     (environment)
 *   4. Auto-detection from the current working directory
 *
 * Throws a descriptive error rather than guessing. Silently defaulting to some
 * project would let an agent write a decision into the wrong project's memory —
 * the one property Phase 5.0 enforces at every other layer.
 */
export function resolveProjectContext(options: ResolveOptions = {}): ResolvedProject {
  const projects = listProjects();

  // 1. Explicit project id.
  if (options.explicitProjectId) {
    const row = findById(projects, options.explicitProjectId);
    if (!row) {
      throw new Error(
        `[asterim-mcp-memory] --project '${options.explicitProjectId}' does not match any registered project.\n` +
          describeKnownProjects(projects)
      );
    }
    return toResolved(row);
  }

  // 2. Explicit project path. Matched with the same containment rules as CWD
  //    detection, so pointing at a subdirectory of a project also resolves.
  if (options.explicitProjectPath) {
    const target = path.resolve(options.explicitProjectPath);
    const row = matchByPath(projects, target);
    if (!row) {
      throw new Error(
        `[asterim-mcp-memory] --project-path '${target}' is not inside any registered project.\n` +
          describeKnownProjects(projects)
      );
    }
    return toResolved(row);
  }

  // 3. Environment variable.
  const envId = process.env.ASTERIM_PROJECT_ID;
  if (envId) {
    const row = findById(projects, envId);
    if (!row) {
      throw new Error(
        `[asterim-mcp-memory] ASTERIM_PROJECT_ID='${envId}' does not match any registered project.\n` +
          describeKnownProjects(projects)
      );
    }
    return toResolved(row);
  }

  // 4. Auto-detect from the working directory.
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const row = matchByPath(projects, cwd);
  if (!row) {
    throw new Error(
      `[asterim-mcp-memory] Could not determine the Asterim project for '${cwd}'.\n` +
        `Pass --project <id>, pass --project-path <path>, or set ASTERIM_PROJECT_ID.\n` +
        describeKnownProjects(projects)
    );
  }
  return toResolved(row);
}

/**
 * Extracts resolver options from an argv array.
 *
 * Accepts both `--project <value>` and `--project=<value>`. Unknown arguments are
 * ignored so the MCP client's own flags pass through harmlessly.
 */
export function parseResolveOptionsFromArgv(argv: string[] = process.argv.slice(2)): ResolveOptions {
  const options: ResolveOptions = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const read = (flag: string): string | undefined => {
      if (arg === flag) return argv[i + 1];
      if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
      return undefined;
    };

    const id = read('--project');
    if (id) {
      options.explicitProjectId = id;
      continue;
    }
    const projectPath = read('--project-path');
    if (projectPath) {
      options.explicitProjectPath = projectPath;
    }
  }

  return options;
}

// --- Internals ---

function listProjects(): ProjectRow[] {
  const db = dbService.getDb();
  return db.prepare('SELECT id, name, path FROM projects').all() as unknown as ProjectRow[];
}

function findById(projects: ProjectRow[], id: string): ProjectRow | undefined {
  return projects.find(p => p.id === id);
}

/**
 * Returns the most specific project containing `target`, or undefined.
 *
 * Containment is tested with `path.relative` rather than a string prefix: a raw
 * `startsWith` would match `/w/projects/asterim-core` against the sibling
 * `/w/projects/asterim-core-legacy`. When several projects contain the target —
 * the live database registers an ancestor directory alongside the repositories
 * inside it — the longest project path wins, since that is the most specific root.
 *
 * The project directory is never required to exist on disk; a stale row whose
 * folder was renamed must still resolve.
 */
function matchByPath(projects: ProjectRow[], target: string): ProjectRow | undefined {
  const candidates = projects
    .map(project => ({ project, normalized: path.resolve(project.path) }))
    .filter(({ normalized }) => {
      const rel = path.relative(normalized, target);
      // '' → target is the project root; otherwise it must descend into it.
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    })
    .sort((a, b) => b.normalized.length - a.normalized.length);

  return candidates[0]?.project;
}

function toResolved(row: ProjectRow): ResolvedProject {
  return {
    id: row.id,
    name: row.name,
    path: path.resolve(row.path)
  };
}

function describeKnownProjects(projects: ProjectRow[]): string {
  if (projects.length === 0) {
    return 'No projects are registered in Asterim yet. Add one in the dashboard first.';
  }
  const lines = projects.map(p => `  - ${p.name} [${p.id}] → ${path.resolve(p.path)}`);
  return `Registered projects:\n${lines.join('\n')}`;
}
