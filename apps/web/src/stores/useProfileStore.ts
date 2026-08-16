import { create } from 'zustand';
import { getAuthHeaders } from '../utils/auth';
import type { AgentProfile, CreateProfileInput, UpdateProfileInput } from '@asterim/shared';

/**
 * Agent profiles, as the dashboard sees them (P6-07).
 *
 * Unlike the skills store this one writes: a profile is a record in Asterim's
 * own database, not a file the developer owns, so creating and editing belong
 * here. Built-in profiles are the exception and the store never attempts to
 * write one — the Core would refuse anyway, but a picker that offers Save on
 * something immutable is a worse experience than one that offers Clone.
 *
 * Which profile is active is held per thread rather than globally. A user
 * reviewing a diff in one thread and implementing in another wants two
 * different personas at the same time, and a single "active profile" would make
 * switching threads silently reconfigure the one they left.
 */

interface ProfileState {
  profiles: AgentProfile[];
  /** Thread id → profile id. Absent means the thread runs unprofiled. */
  activeByThread: Record<string, string | null>;
  /** The profile whose detail pane is open in the manager, if any. */
  inspectedProfileId: string | null;
  /** Free-text filter over name, role and description. */
  search: string;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  loadProfiles: (workspaceId?: string | null) => Promise<void>;
  createProfile: (input: CreateProfileInput) => Promise<AgentProfile | null>;
  cloneProfile: (id: string, overrides?: Partial<CreateProfileInput>) => Promise<AgentProfile | null>;
  updateProfile: (id: string, input: UpdateProfileInput) => Promise<AgentProfile | null>;
  deleteProfile: (id: string) => Promise<boolean>;
  setActiveProfile: (threadId: string, profileId: string | null) => void;
  setInspectedProfile: (id: string | null) => void;
  setSearch: (search: string) => void;
}

const BASE = '/api/v1/profiles';

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
 * The profiles a filter leaves visible.
 *
 * Pure rather than derived state, so the rules can be asserted directly and the
 * views can stay renders of their props.
 */
export function filterProfiles(profiles: AgentProfile[], search: string): AgentProfile[] {
  const query = search.trim().toLowerCase();
  if (!query) return profiles;
  return profiles.filter(
    profile =>
      profile.name.toLowerCase().includes(query) ||
      profile.role.toLowerCase().includes(query) ||
      profile.description.toLowerCase().includes(query)
  );
}

/**
 * How a capability list reads in the UI.
 *
 * The three cases are the ones the contract distinguishes, and the wording has
 * to keep them apart: a profile with `[]` reaches nothing, and calling that
 * "All" — which is what an `||` fallback would produce — would be a lie about
 * what the agent can do.
 */
export function capabilitySummary(list: string[] | undefined, noun: string): string {
  if (list === undefined) return `All ${noun}`;
  if (list.some(entry => entry === '*')) return `All ${noun}`;
  if (list.length === 0) return `No ${noun}`;
  return list.join(', ');
}

/** The profile a thread is set to run under, or null. */
export function activeProfileFor(
  profiles: AgentProfile[],
  activeByThread: Record<string, string | null>,
  threadId: string | null | undefined
): AgentProfile | null {
  if (!threadId) return null;
  const id = activeByThread[threadId];
  if (!id) return null;
  return profiles.find(profile => profile.id === id) || null;
}

/** `?workspaceId=` when there is one, and nothing when there is not. */
function scopeQuery(workspaceId?: string | null): string {
  return workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  activeByThread: {},
  inspectedProfileId: null,
  search: '',
  isLoading: false,
  isSaving: false,
  error: null,

  loadProfiles: async (workspaceId?: string | null) => {
    set({ isLoading: true, error: null });
    try {
      const body = await readJson<{ profiles: AgentProfile[] }>(
        await fetch(`${BASE}${scopeQuery(workspaceId)}`, { headers: getAuthHeaders() }),
        'Loading agent profiles'
      );
      set({ profiles: body.profiles || [], isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  createProfile: async (input: CreateProfileInput) => {
    set({ isSaving: true, error: null });
    try {
      const body = await readJson<{ profile: AgentProfile }>(
        await fetch(BASE, {
          method: 'POST',
          headers: getAuthHeaders({ json: true }),
          body: JSON.stringify(input)
        }),
        'Creating the profile'
      );
      set(state => ({ profiles: [...state.profiles, body.profile], isSaving: false }));
      return body.profile;
    } catch (err) {
      set({ error: (err as Error).message, isSaving: false });
      return null;
    }
  },

  cloneProfile: async (id: string, overrides: Partial<CreateProfileInput> = {}) => {
    set({ isSaving: true, error: null });
    try {
      // The Core fills in every field the override leaves out, so the client
      // never has to echo back a system prompt it only ever displayed.
      const body = await readJson<{ profile: AgentProfile }>(
        await fetch(BASE, {
          method: 'POST',
          headers: getAuthHeaders({ json: true }),
          body: JSON.stringify({ ...overrides, cloneOf: id })
        }),
        'Cloning the profile'
      );
      set(state => ({ profiles: [...state.profiles, body.profile], isSaving: false }));
      return body.profile;
    } catch (err) {
      set({ error: (err as Error).message, isSaving: false });
      return null;
    }
  },

  updateProfile: async (id: string, input: UpdateProfileInput) => {
    set({ isSaving: true, error: null });
    try {
      const body = await readJson<{ profile: AgentProfile }>(
        await fetch(`${BASE}/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: getAuthHeaders({ json: true }),
          body: JSON.stringify(input)
        }),
        'Saving the profile'
      );
      set(state => ({
        profiles: state.profiles.map(profile => (profile.id === id ? body.profile : profile)),
        isSaving: false
      }));
      return body.profile;
    } catch (err) {
      set({ error: (err as Error).message, isSaving: false });
      return null;
    }
  },

  deleteProfile: async (id: string) => {
    set({ isSaving: true, error: null });
    try {
      await readJson<{ deleted: boolean }>(
        await fetch(`${BASE}/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        }),
        'Deleting the profile'
      );
      // Threads pointing at it are released here too. The Core clears its own
      // column; leaving the id in this map would keep sending a dead profile
      // with the next start command.
      const released: Record<string, string | null> = {};
      for (const [threadId, profileId] of Object.entries(get().activeByThread)) {
        released[threadId] = profileId === id ? null : profileId;
      }
      set(state => ({
        profiles: state.profiles.filter(profile => profile.id !== id),
        activeByThread: released,
        inspectedProfileId: state.inspectedProfileId === id ? null : state.inspectedProfileId,
        isSaving: false
      }));
      return true;
    } catch (err) {
      set({ error: (err as Error).message, isSaving: false });
      return false;
    }
  },

  setActiveProfile: (threadId: string, profileId: string | null) =>
    set(state => ({ activeByThread: { ...state.activeByThread, [threadId]: profileId } })),
  setInspectedProfile: (id: string | null) => set({ inspectedProfileId: id }),
  setSearch: (search: string) => set({ search })
}));

/**
 * The profile id a start command should carry for a thread.
 *
 * Read imperatively by the socket layer, which is not a component and has no
 * business subscribing. Undefined rather than null when nothing is selected, so
 * the payload simply omits the field and the Core falls back to whatever the
 * thread was last started under.
 */
export function activeProfileIdForThread(threadId: string | null | undefined): string | undefined {
  if (!threadId) return undefined;
  return useProfileStore.getState().activeByThread[threadId] || undefined;
}
