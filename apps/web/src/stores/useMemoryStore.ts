import { create } from 'zustand';
import type {
  ArchitecturalRule,
  AsterimEvent,
  CandidateDecision,
  DecisionDriftInfo,
  CreateDecisionRequest,
  CreateIntentRequest,
  CreateRuleRequest,
  DecisionStatus,
  MemoryDecisionCreatedPayload,
  MemoryDecisionSupersededPayload,
  MemoryDecisionUpdatedPayload,
  MemoryIntentUpdatedPayload,
  MemoryRuleCreatedPayload,
  ProjectBriefing,
  ProjectDecision,
  ProjectIntent,
  SupersedeDecisionRequest
} from '@asterim/shared';

/**
 * Project Memory state for the Decision Explorer.
 *
 * Domain-scoped under ProjectStore (blueprint/STORE_ARCHITECTURE.md § 2): it holds
 * the memory of exactly one project at a time, and `projectId` records which. Every
 * fetch adopts the project it was asked for; every socket event is discarded unless
 * it belongs to that project, so a late event from a project the user has navigated
 * away from cannot write into the new project's state.
 */
interface MemoryState {
  /** The project this state describes, or null before the first fetch. */
  projectId: string | null;
  briefing: ProjectBriefing | null;
  decisions: ProjectDecision[];
  rules: ArchitecturalRule[];
  activeIntent: ProjectIntent | null;
  /** Drift keyed by decision id. Computed server-side; empty until fetched. */
  drift: Record<string, DecisionDriftInfo>;
  /** Staged candidates awaiting review (DEC-027). */
  candidates: CandidateDecision[];
  loading: boolean;
  error: string | null;

  fetchBriefing: (projectId: string) => Promise<void>;
  fetchDecisions: (projectId: string, filter?: { status?: DecisionStatus }) => Promise<void>;
  fetchRules: (projectId: string) => Promise<void>;
  fetchIntent: (projectId: string) => Promise<void>;
  fetchDrift: (projectId: string) => Promise<void>;
  fetchCandidates: (projectId: string) => Promise<void>;
  approveCandidate: (projectId: string, candidateId: string) => Promise<ProjectDecision>;
  rejectCandidate: (projectId: string, candidateId: string) => Promise<void>;

  createDecision: (projectId: string, data: CreateDecisionRequest) => Promise<ProjectDecision>;
  supersedeDecision: (
    projectId: string,
    decisionId: string,
    data: SupersedeDecisionRequest
  ) => Promise<ProjectDecision>;
  updateDecisionStatus: (
    projectId: string,
    decisionId: string,
    status: DecisionStatus
  ) => Promise<ProjectDecision>;
  archiveDecision: (projectId: string, decisionId: string) => Promise<ProjectDecision>;
  createRule: (projectId: string, data: CreateRuleRequest) => Promise<ArchitecturalRule>;
  createIntent: (projectId: string, data: CreateIntentRequest) => Promise<ProjectIntent>;

  /** Applies a `memory.*` socket event to local state. Ignores other projects. */
  handleMemoryEvent: (event: AsterimEvent<any>) => void;

  /** Drops all memory state. Call when the active project changes. */
  reset: () => void;
}

const MEMORY_EVENT_TYPES = [
  'memory.decision_created',
  'memory.decision_superseded',
  'memory.decision_updated',
  'memory.rule_created',
  'memory.intent_updated'
] as const;

/** True when a socket event is one this store knows how to apply. */
export function isMemoryEvent(event: { type?: string } | null | undefined): boolean {
  return !!event?.type && (MEMORY_EVENT_TYPES as readonly string[]).includes(event.type);
}

function memoryUrl(projectId: string, suffix: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/memory${suffix}`;
}

/** Mirrors the auth header convention in useWorkspaceStore. */
function authHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem('asterim_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

/**
 * Reads a response, throwing on failure with the server's own message.
 *
 * The memory routes answer errors as `{ error: string }`, which is far more useful
 * to show than a bare status code — a rejected decision says which field was wrong.
 */
async function readJson<T>(res: Response, what: string): Promise<T> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* a non-JSON body is handled below */
  }
  if (!res.ok) {
    throw new Error(body?.error || `${what} failed (HTTP ${res.status})`);
  }
  if (body === null) {
    throw new Error(`${what} returned a response that was not JSON`);
  }
  return body as T;
}

/**
 * Inserts or replaces a decision by id, newest first.
 *
 * Upsert rather than prepend because the same decision arrives twice on the happy
 * path: once as the POST response, once as the socket event the write produced.
 * Ordering matches the server's `created_at DESC, id DESC`.
 */
function upsertDecision(list: ProjectDecision[], decision: ProjectDecision): ProjectDecision[] {
  const next = list.filter(d => d.id !== decision.id);
  next.push(decision);
  next.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return next;
}

function upsertRule(list: ArchitecturalRule[], rule: ArchitecturalRule): ArchitecturalRule[] {
  const next = list.filter(r => r.id !== rule.id);
  next.push(rule);
  next.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return next;
}

/** Keeps `briefing.activeDecisions` consistent with a decision that changed. */
function applyDecisionToBriefing(
  briefing: ProjectBriefing | null,
  decision: ProjectDecision
): ProjectBriefing | null {
  if (!briefing) return briefing;
  const withoutIt = briefing.activeDecisions.filter(d => d.id !== decision.id);
  return {
    ...briefing,
    activeDecisions:
      decision.status === 'ACTIVE' ? upsertDecision(withoutIt, decision) : withoutIt
  };
}

/** The store's data fields at rest, i.e. everything except the actions. */
type MemoryData = Omit<
  MemoryState,
  | 'fetchBriefing'
  | 'fetchDecisions'
  | 'fetchRules'
  | 'fetchIntent'
  | 'fetchDrift'
  | 'fetchCandidates'
  | 'approveCandidate'
  | 'rejectCandidate'
  | 'createDecision'
  | 'supersedeDecision'
  | 'updateDecisionStatus'
  | 'archiveDecision'
  | 'createRule'
  | 'createIntent'
  | 'handleMemoryEvent'
  | 'reset'
>;

const empty = (): MemoryData => ({
  projectId: null,
  briefing: null,
  decisions: [],
  rules: [],
  activeIntent: null,
  drift: {},
  candidates: [],
  loading: false,
  error: null
});

export const useMemoryStore = create<MemoryState>((set, get) => ({
  ...empty(),

  reset: () => set(empty()),

  // --- Reads ---

  fetchBriefing: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(memoryUrl(projectId, '/briefing'), { headers: authHeaders() });
      const { briefing } = await readJson<{ briefing: ProjectBriefing }>(res, 'Loading the briefing');
      set({
        projectId,
        briefing,
        // The briefing already carries the project's rules and current intent, so
        // adopt them rather than making the caller issue two more requests.
        rules: briefing.architecturalRules,
        activeIntent: briefing.currentIntent,
        loading: false
      });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  fetchDecisions: async (projectId, filter) => {
    set({ loading: true, error: null });
    try {
      const query = filter?.status ? `?status=${encodeURIComponent(filter.status)}` : '';
      const res = await fetch(memoryUrl(projectId, `/decisions${query}`), { headers: authHeaders() });
      const { decisions } = await readJson<{ decisions: ProjectDecision[] }>(res, 'Loading decisions');
      set({ projectId, decisions, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  fetchRules: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(memoryUrl(projectId, '/rules'), { headers: authHeaders() });
      const { rules } = await readJson<{ rules: ArchitecturalRule[] }>(res, 'Loading rules');
      set({ projectId, rules, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  fetchIntent: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(memoryUrl(projectId, '/intents/active'), { headers: authHeaders() });
      const { intent } = await readJson<{ intent: ProjectIntent | null }>(res, 'Loading the intent');
      set({ projectId, activeIntent: intent, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  /**
   * Loads drift for the project's active decisions.
   *
   * Kept out of `fetchBriefing` because it shells out to git: a view should be
   * able to render memory immediately and let the caution badges arrive after.
   * A failure is swallowed into `error` and leaves the previous drift in place —
   * a stale badge is better than a view that fails to load because git is slow.
   */
  fetchDrift: async (projectId) => {
    try {
      const res = await fetch(memoryUrl(projectId, '/drift'), { headers: authHeaders() });
      const { drift } = await readJson<{ drift: Record<string, DecisionDriftInfo> }>(res, 'Loading drift');
      set({ projectId, drift });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  /** Loads the review queue. Only PENDING candidates are actionable. */
  fetchCandidates: async (projectId) => {
    try {
      const res = await fetch(memoryUrl(projectId, '/candidates?status=PENDING'), { headers: authHeaders() });
      const { candidates } = await readJson<{ candidates: CandidateDecision[] }>(res, 'Loading candidates');
      set({ projectId, candidates });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  /**
   * Promotes a candidate into project memory.
   *
   * The created decision is upserted locally rather than waiting for the socket
   * echo, so the queue and the list move together on the click. The candidate is
   * dropped from `candidates` because the queue holds only what still needs a
   * decision from the reviewer.
   */
  approveCandidate: async (projectId, candidateId) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(
        memoryUrl(projectId, `/candidates/${encodeURIComponent(candidateId)}/approve`),
        { method: 'POST', headers: authHeaders(true), body: JSON.stringify({}) }
      );
      const { decision } = await readJson<{ decision: ProjectDecision }>(res, 'Approving the candidate');
      set(state => ({
        loading: false,
        candidates: state.candidates.filter(c => c.id !== candidateId),
        decisions: upsertDecision(state.decisions, decision),
        briefing: applyDecisionToBriefing(state.briefing, decision)
      }));
      return decision;
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  /** Discards a candidate. Writes nothing to project memory. */
  rejectCandidate: async (projectId, candidateId) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(
        memoryUrl(projectId, `/candidates/${encodeURIComponent(candidateId)}/reject`),
        { method: 'POST', headers: authHeaders(true), body: JSON.stringify({}) }
      );
      await readJson<{ candidate: CandidateDecision }>(res, 'Discarding the candidate');
      set(state => ({ loading: false, candidates: state.candidates.filter(c => c.id !== candidateId) }));
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  // --- Writes ---
  //
  // These reject on failure rather than swallowing, because a caller submitting a
  // form needs to know whether it was accepted. `error` is still set so a passive
  // view can show it, but the promise is the caller's signal.

  createDecision: async (projectId, data) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(memoryUrl(projectId, '/decisions'), {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(data)
      });
      const { decision } = await readJson<{ decision: ProjectDecision }>(res, 'Recording the decision');
      set(state => ({
        loading: false,
        decisions: upsertDecision(state.decisions, decision),
        briefing: applyDecisionToBriefing(state.briefing, decision)
      }));
      return decision;
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  supersedeDecision: async (projectId, decisionId, data) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(
        memoryUrl(projectId, `/decisions/${encodeURIComponent(decisionId)}/supersede`),
        { method: 'POST', headers: authHeaders(true), body: JSON.stringify(data) }
      );
      const { decision } = await readJson<{ decision: ProjectDecision }>(res, 'Superseding the decision');
      set(state => {
        // The response describes the replacement. Mark the replaced decision here
        // rather than waiting for a refetch, so the explorer never shows two
        // ACTIVE decisions where one has just retired the other.
        const superseded = state.decisions.map(d =>
          d.id === decisionId
            ? { ...d, status: 'SUPERSEDED' as DecisionStatus, supersededBy: decision.id }
            : d
        );
        const oldDecision = superseded.find(d => d.id === decisionId);
        let briefing = state.briefing;
        if (oldDecision) briefing = applyDecisionToBriefing(briefing, oldDecision);
        briefing = applyDecisionToBriefing(briefing, decision);
        return { loading: false, decisions: upsertDecision(superseded, decision), briefing };
      });
      return decision;
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  updateDecisionStatus: async (projectId, decisionId, status) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(
        memoryUrl(projectId, `/decisions/${encodeURIComponent(decisionId)}/status`),
        { method: 'PATCH', headers: authHeaders(true), body: JSON.stringify({ status }) }
      );
      const { decision } = await readJson<{ decision: ProjectDecision }>(res, 'Updating the decision');
      set(state => ({
        loading: false,
        decisions: upsertDecision(state.decisions, decision),
        briefing: applyDecisionToBriefing(state.briefing, decision)
      }));
      return decision;
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  archiveDecision: (projectId, decisionId) =>
    get().updateDecisionStatus(projectId, decisionId, 'ARCHIVED'),

  createRule: async (projectId, data) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(memoryUrl(projectId, '/rules'), {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(data)
      });
      const { rule } = await readJson<{ rule: ArchitecturalRule }>(res, 'Adding the rule');
      set(state => ({
        loading: false,
        rules: upsertRule(state.rules, rule),
        briefing: state.briefing
          ? { ...state.briefing, architecturalRules: upsertRule(state.briefing.architecturalRules, rule) }
          : state.briefing
      }));
      return rule;
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  createIntent: async (projectId, data) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(memoryUrl(projectId, '/intents'), {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(data)
      });
      const { intent } = await readJson<{ intent: ProjectIntent }>(res, 'Setting the intent');
      set(state => ({
        loading: false,
        activeIntent: intent,
        briefing: state.briefing ? { ...state.briefing, currentIntent: intent } : state.briefing
      }));
      return intent;
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  // --- Live updates ---

  handleMemoryEvent: (event) => {
    if (!isMemoryEvent(event)) return;

    const payload = event.payload as { projectId?: string } | undefined;
    const current = get().projectId;

    // Never apply another project's memory. Socket rooms are keyed by project, so
    // this should not happen — but the cost of being wrong is showing one project's
    // decisions as another's, which is exactly the confusion memory exists to prevent.
    if (!payload?.projectId || (current !== null && payload.projectId !== current)) return;

    switch (event.type) {
      case 'memory.decision_created': {
        const { decision } = event.payload as MemoryDecisionCreatedPayload;
        if (!decision) return;
        set(state => ({
          decisions: upsertDecision(state.decisions, decision),
          briefing: applyDecisionToBriefing(state.briefing, decision)
        }));
        return;
      }

      case 'memory.decision_updated': {
        const { decision } = event.payload as MemoryDecisionUpdatedPayload;
        if (!decision) return;
        // applyDecisionToBriefing drops it from activeDecisions when the new
        // status is anything but ACTIVE, and reinstates it when a decision is
        // moved back — both directions matter, since STALE is reversible.
        set(state => ({
          decisions: upsertDecision(state.decisions, decision),
          briefing: applyDecisionToBriefing(state.briefing, decision)
        }));
        return;
      }

      case 'memory.decision_superseded': {
        const { decisionId, supersededBy, decision } = event.payload as MemoryDecisionSupersededPayload;
        set(state => {
          const marked = state.decisions.map(d =>
            d.id === decisionId
              ? { ...d, status: 'SUPERSEDED' as DecisionStatus, supersededBy: supersededBy ?? d.supersededBy }
              : d
          );
          let briefing = state.briefing;
          const oldDecision = marked.find(d => d.id === decisionId);
          if (oldDecision) briefing = applyDecisionToBriefing(briefing, oldDecision);
          // `decision` is optional on this payload: it is present only when the
          // replacement was created as part of the same operation.
          if (decision) briefing = applyDecisionToBriefing(briefing, decision);
          return {
            decisions: decision ? upsertDecision(marked, decision) : marked,
            briefing
          };
        });
        return;
      }

      case 'memory.rule_created': {
        const { rule } = event.payload as MemoryRuleCreatedPayload;
        if (!rule) return;
        set(state => ({
          rules: upsertRule(state.rules, rule),
          briefing: state.briefing
            ? { ...state.briefing, architecturalRules: upsertRule(state.briefing.architecturalRules, rule) }
            : state.briefing
        }));
        return;
      }

      case 'memory.intent_updated': {
        const { intent } = event.payload as MemoryIntentUpdatedPayload;
        set(state => ({
          activeIntent: intent,
          briefing: state.briefing ? { ...state.briefing, currentIntent: intent } : state.briefing
        }));
        return;
      }
    }
  }
}));
