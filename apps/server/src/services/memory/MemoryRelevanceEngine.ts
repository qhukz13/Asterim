import type {
  BriefingOptions,
  DecisionProvenance,
  DecisionDriftInfo,
  ProjectDecision,
  RelevanceBreakdown
} from '@asterim/shared';

/**
 * Baseline weight by how a decision entered memory (DEC-024).
 *
 * A person confirming something outranks an agent asserting it. This is the only
 * component that applies to every decision, so it is what orders the list when
 * nothing else distinguishes two entries.
 */
export const PROVENANCE_WEIGHT: Record<DecisionProvenance, number> = {
  HUMAN_CONFIRMED: 1.0,
  REPOSITORY_EVIDENCE: 0.85,
  AGENT_STATEMENT: 0.7,
  INFERRED: 0.5
};

/** Boost for a decision anchored to a file the agent is actually touching. */
export const PATH_OVERLAP_BOOST = 0.5;

/** Range of the lexical component, from a single shared term to a strong overlap. */
export const LEXICAL_MIN = 0.1;
export const LEXICAL_MAX = 0.4;

/** Deduction when a decision's anchors have moved out from under it (DEC-027). */
export const DRIFT_PENALTY = 0.15;

/** Decisions returned when the caller does not say. */
export const DEFAULT_BRIEFING_LIMIT = 15;

/**
 * Words carrying no signal about *which* decision is relevant.
 *
 * Deliberately short. A long stoplist starts discarding domain terms, and the
 * scoring only has to separate decisions from each other — not to understand the
 * sentence.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'to', 'of', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that', 'these', 'those', 'as', 'at',
  'by', 'from', 'we', 'i', 'you', 'should', 'will', 'can', 'do', 'does', 'not', 'no', 'yes',
  'how', 'what', 'why', 'when', 'where', 'add', 'use', 'using', 'make', 'need'
]);

/**
 * Splits text into comparable terms.
 *
 * `camelCase` and `snake_case` are broken apart, because "hashPassword" in a task
 * description should match "hash password" in a decision summary. Terms shorter
 * than three characters are dropped: they match everything and mean nothing.
 */
export function tokenize(text: string): Set<string> {
  const terms = (text || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
  return new Set(terms);
}

/** Normalises a path for comparison: forward slashes, no leading or trailing one. */
export function normalizePath(filePath: string): string {
  return (filePath || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
}

/**
 * True when two paths refer to the same file, or one contains the other.
 *
 * Segment-aware: `src/auth` must not match `src/authentication`, the same
 * substring trap the project resolver and the drift detector both avoid.
 */
export function pathsOverlap(a: string, b: string): boolean {
  const left = normalizePath(a);
  const right = normalizePath(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

/** Every path a decision is anchored to, deduplicated. */
export function decisionPaths(decision: ProjectDecision): string[] {
  const paths = new Set<string>();
  for (const file of decision.relatedFiles ?? []) {
    if (file) paths.add(normalizePath(file));
  }
  for (const ref of decision.codeRefs ?? []) {
    if (ref.filePath) paths.add(normalizePath(ref.filePath));
  }
  return [...paths];
}

/**
 * Lexical component, scaled by how much of the query the decision covers.
 *
 * Measured against the *query's* terms rather than the decision's: a long
 * decision should not score lower for containing more words than was asked
 * about. Returns 0 when there is no query, so an unscoped briefing is ordered
 * purely by provenance and drift.
 */
export function lexicalScore(decision: ProjectDecision, queryTerms: Set<string>): number {
  if (queryTerms.size === 0) return 0;

  const haystack = tokenize(
    [decision.title, decision.summary, decision.rationale, ...(decision.constraints ?? [])].join(' ')
  );

  let hits = 0;
  for (const term of queryTerms) {
    if (haystack.has(term)) hits++;
  }
  if (hits === 0) return 0;

  const ratio = hits / queryTerms.size;
  return Number((LEXICAL_MIN + (LEXICAL_MAX - LEXICAL_MIN) * ratio).toFixed(4));
}

/** Drift types that mean the anchor is gone rather than merely edited. */
function isSevereDrift(drift: DecisionDriftInfo | undefined): boolean {
  if (!drift?.drifted) return false;
  return drift.refs.some(ref => ref.type === 'FILE_DELETED' || ref.type === 'SYMBOL_NOT_FOUND');
}

/** The full score for one decision, with each component kept separate. */
export function scoreDecision(
  decision: ProjectDecision,
  options: BriefingOptions
): { score: number; breakdown: RelevanceBreakdown } {
  const provenance = PROVENANCE_WEIGHT[decision.provenance] ?? PROVENANCE_WEIGHT.INFERRED;

  const touched = (options.touchPaths ?? []).filter(Boolean);
  const anchors = decisionPaths(decision);
  const pathOverlap =
    touched.length > 0 && anchors.some(anchor => touched.some(path => pathsOverlap(anchor, path)))
      ? PATH_OVERLAP_BOOST
      : 0;

  const lexical = lexicalScore(decision, tokenize(options.taskDescription ?? ''));

  // A missing file or symbol makes a decision less likely to be about the code in
  // front of you — but only mildly. DEC-027 is explicit that drift annotates and
  // never demotes, so this must not be large enough to bury a human-confirmed
  // decision beneath an agent's guess.
  const driftPenalty = isSevereDrift(options.drift?.[decision.id]) ? DRIFT_PENALTY : 0;

  const score = Number((provenance + pathOverlap + lexical - driftPenalty).toFixed(4));
  return { score, breakdown: { provenance, pathOverlap, lexical, driftPenalty } };
}

export class MemoryRelevanceEngine {
  /**
   * Orders decisions by relevance, highest first.
   *
   * Fully deterministic: the same inputs always produce the same order, with ties
   * broken by `createdAt` then `id` — the same total order the SQL queries use, so
   * ranking never introduces the instability the briefing's byte-identical
   * guarantee depends on.
   *
   * Runs entirely in-process. No embeddings, no vector store, no network (DEC-028).
   */
  public rankDecisions(decisions: ProjectDecision[], options: BriefingOptions = {}): ProjectDecision[] {
    const scored = decisions.map(decision => {
      const { score } = scoreDecision(decision, options);
      return { decision: { ...decision, relevanceScore: score }, score };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.decision.createdAt !== a.decision.createdAt) return b.decision.createdAt - a.decision.createdAt;
      return a.decision.id < b.decision.id ? 1 : a.decision.id > b.decision.id ? -1 : 0;
    });

    const limit = options.limit;
    const ordered = scored.map(s => s.decision);
    return typeof limit === 'number' && limit >= 0 ? ordered.slice(0, limit) : ordered;
  }

  /**
   * Applies ranking to a briefing's decisions.
   *
   * Rules and intent are passed through untouched and uncapped. They are
   * governance invariants: a rule the agent is not told about is a rule that
   * cannot be followed, and dropping one to save tokens would make the briefing
   * cheaper and wrong. Only `activeDecisions` is ranked and bounded.
   */
  public applyToBriefing<T extends { activeDecisions: ProjectDecision[] }>(
    briefing: T,
    options: BriefingOptions = {}
  ): T {
    const limit = options.limit ?? DEFAULT_BRIEFING_LIMIT;
    return {
      ...briefing,
      activeDecisions: this.rankDecisions(briefing.activeDecisions, { ...options, limit })
    };
  }
}

export const memoryRelevanceEngine = new MemoryRelevanceEngine();
