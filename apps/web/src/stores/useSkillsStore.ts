import { create } from 'zustand';
import { getAuthHeaders } from '../utils/auth';
import type { SkillDefinition } from '@asterim/shared';

/**
 * The skills library, as the dashboard sees it.
 *
 * Read-only, and deliberately so: a skill is a file in the developer's own
 * repository, and the place to change one is the editor, not this panel. So
 * there is nothing here that writes — no create, no delete, no optimistic
 * update to reconcile — and the store's whole job is to hold what the Core
 * found and which skill the user is looking at.
 *
 * Scoped by workspace *path* rather than id, because that is what the Core
 * scans: `.agents/skills` under the project directory, plus the workstation's
 * global set. Changing project therefore reloads, and `loadSkills` is called
 * with the new path rather than the list being filtered client-side — a skill
 * from another project was never fetched in the first place.
 */

interface SkillsState {
  skills: SkillDefinition[];
  /** The skill whose detail modal is open, if any. */
  activeSkillId: string | null;
  /** Free-text filter over name, description and path. */
  search: string;
  /** Scope filter; `all` is every scope. */
  scopeFilter: 'all' | 'workspace' | 'global';
  isLoading: boolean;
  error: string | null;

  loadSkills: (workspacePath?: string | null) => Promise<void>;
  /** Re-reads one skill, whose full instructions the list does not need. */
  loadSkill: (name: string, workspacePath?: string | null) => Promise<SkillDefinition | null>;
  setActiveSkill: (id: string | null) => void;
  setSearch: (search: string) => void;
  setScopeFilter: (scope: 'all' | 'workspace' | 'global') => void;
}

const BASE = '/api/v1/skills';

/** Delegates to the shared helper so a remote workstation gets its own token. */
function authHeaders(): Record<string, string> {
  return getAuthHeaders();
}

/** Reads a response, throwing the Core's own message on failure. */
async function readJson<T>(res: Response, what: string): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* a non-JSON body is handled below */
  }
  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error;
    throw new Error(message || `${what} failed (${res.status})`);
  }
  return body as T;
}

/**
 * The skills a filter leaves visible.
 *
 * A pure function rather than derived state in the store, so the rules can be
 * asserted directly and the view can stay a render of its props.
 */
export function filterSkills(
  skills: SkillDefinition[],
  search: string,
  scope: 'all' | 'workspace' | 'global'
): SkillDefinition[] {
  const query = search.trim().toLowerCase();
  return skills.filter(skill => {
    if (scope !== 'all' && skill.scope !== scope) return false;
    if (!query) return true;
    return (
      skill.name.toLowerCase().includes(query) ||
      skill.description.toLowerCase().includes(query) ||
      skill.path.toLowerCase().includes(query)
    );
  });
}

/** The parameter names a skill declares, for the card's preview line. */
export function parameterNames(skill: SkillDefinition): string[] {
  const properties = (skill.parametersSchema as { properties?: Record<string, unknown> } | undefined)
    ?.properties;
  if (!properties || typeof properties !== 'object') return [];
  return Object.keys(properties);
}

/** The parameters a skill's schema marks as required. */
export function requiredParameters(skill: SkillDefinition): string[] {
  const required = (skill.parametersSchema as { required?: unknown } | undefined)?.required;
  return Array.isArray(required) ? required.filter((name): name is string => typeof name === 'string') : [];
}

/** `?workspacePath=` when there is one, and nothing when there is not. */
function scopeQuery(workspacePath?: string | null): string {
  return workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
}

export const useSkillsStore = create<SkillsState>(set => ({
  skills: [],
  activeSkillId: null,
  search: '',
  scopeFilter: 'all',
  isLoading: false,
  error: null,

  loadSkills: async (workspacePath?: string | null) => {
    set({ isLoading: true, error: null });
    try {
      const body = await readJson<{ skills: SkillDefinition[] }>(
        await fetch(`${BASE}${scopeQuery(workspacePath)}`, { headers: authHeaders() }),
        'Loading skills'
      );
      set({ skills: body.skills || [], isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  loadSkill: async (name: string, workspacePath?: string | null) => {
    try {
      const body = await readJson<{ skill: SkillDefinition }>(
        await fetch(`${BASE}/${encodeURIComponent(name)}${scopeQuery(workspacePath)}`, {
          headers: authHeaders()
        }),
        `Loading the ${name} skill`
      );
      // The list is the same collection: adopt the fuller copy rather than
      // holding two versions of one skill that could drift apart.
      set(state => ({
        skills: state.skills.map(skill => (skill.id === body.skill.id ? body.skill : skill))
      }));
      return body.skill;
    } catch (err) {
      set({ error: (err as Error).message });
      return null;
    }
  },

  setActiveSkill: (id: string | null) => set({ activeSkillId: id }),
  setSearch: (search: string) => set({ search }),
  setScopeFilter: (scopeFilter: 'all' | 'workspace' | 'global') => set({ scopeFilter })
}));
