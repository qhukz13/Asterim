import fs from 'fs';
import path from 'path';
import type { CodeRefDrift, DecisionCodeRef, DecisionDriftInfo, DriftType, ProjectDecision } from '@asterim/shared';
import { GitProvider } from './GitProvider';

/**
 * A snapshot of the repository, taken once and reused across every anchor.
 *
 * Gathering this per decision — or worse, per code ref — would mean one `git`
 * subprocess per row. A project with fifty anchored decisions would spawn
 * hundreds of processes to answer one question.
 */
export interface RepoSnapshot {
  /** Repository-relative paths with uncommitted changes, as `git status --porcelain` reports them. */
  changedPaths: Set<string>;
  /** Current HEAD commit, or null outside a repository. */
  head: string | null;
  /** True when `projectPath` is inside a git working tree. */
  isRepository: boolean;
}

/** Severity order, worst last. Used to summarise a decision's anchors. */
const DRIFT_SEVERITY: DriftType[] = ['FILE_MODIFIED', 'SYMBOL_NOT_FOUND', 'FILE_DELETED'];

/** A commit-ish safe to interpolate into a git command. */
export function isSafeCommitHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F]{7,40}$/.test(value);
}

/**
 * Resolves a repository-relative path, or null if it escapes the project.
 *
 * Anchors are written by agents, so `../../etc/passwd` is a path this code must
 * expect to be handed. Containment is checked with `path.relative` rather than a
 * prefix test, for the same reason as the MCP project resolver: a prefix match
 * would accept a sibling directory whose name merely starts the same way.
 */
export function resolveInsideProject(projectPath: string, filePath: string): string | null {
  const root = path.resolve(projectPath);
  const target = path.resolve(root, filePath);
  const rel = path.relative(root, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

/**
 * True when `symbol` appears in `content` as an identifier.
 *
 * Deliberately a word-boundary search rather than an AST parse: the anchors are
 * function, class and constant names, the files may be any language in the
 * project, and DEC-027's § 5 forbids pulling in a parser. The trade-off is
 * explicit — this can be fooled by a symbol that survives only inside a comment
 * or a string, which makes it prone to *missing* drift rather than inventing it.
 * For a caution badge that is the right direction to be wrong in.
 */
export function symbolAppears(content: string, symbol: string): boolean {
  if (!symbol) return true;
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w$])${escaped}([^\\w$]|$)`).test(content);
}

export class GitDriftDetector {
  constructor(private readonly provider: GitProvider = new GitProvider()) {}

  /**
   * Reads the repository state once.
   *
   * Every git command here is a fixed string with nothing interpolated, so no
   * anchor path can reach a shell. Outside a repository this returns a snapshot
   * that reports nothing changed, so file existence and symbol checks still work
   * for projects that are not under version control.
   */
  public async snapshot(projectPath: string): Promise<RepoSnapshot> {
    const empty: RepoSnapshot = { changedPaths: new Set(), head: null, isRepository: false };
    if (!projectPath || !fs.existsSync(projectPath)) return empty;

    try {
      const porcelain = await this.provider.exec('git status --porcelain', projectPath);
      const changedPaths = new Set<string>();

      for (const line of porcelain.split('\n')) {
        if (!line.trim()) continue;
        // `XY <path>`, or `XY <old> -> <new>` for a rename. Both endpoints count:
        // the old path is gone and the new one is not what was anchored.
        //
        // Matched rather than sliced at a fixed column: `GitProvider.exec` trims
        // its output, which eats the leading space of ` M path` on the first line
        // and shifts every column by one. StatusManager gets away with
        // `substring(3)` only because its `-b` flag puts an unindented
        // `## branch` line first, absorbing the trim.
        const match = line.match(/^\s*(\S{1,2})\s+(.+)$/);
        if (!match) continue;
        for (const part of match[2].split(' -> ')) {
          const cleaned = part.trim().replace(/^"|"$/g, '');
          if (cleaned) changedPaths.add(cleaned);
        }
      }

      let head: string | null = null;
      try {
        head = await this.provider.exec('git rev-parse HEAD', projectPath);
      } catch {
        // A repository with no commits yet.
      }

      return { changedPaths, head, isRepository: true };
    } catch {
      // Not a git repository, or git is unavailable. File and symbol checks still apply.
      return { ...empty, isRepository: false };
    }
  }

  /**
   * Drift for one code reference, or null when it is intact.
   *
   * Order matters: a deleted file cannot also be checked for a symbol, and there
   * is no point reporting "modified" about something that is gone.
   */
  public async detectRefDrift(
    projectPath: string,
    ref: DecisionCodeRef,
    snapshot?: RepoSnapshot
  ): Promise<CodeRefDrift | null> {
    const repo = snapshot ?? (await this.snapshot(projectPath));

    // A symbol-only anchor has no file to check. Nothing can be said about it
    // without searching the whole project, which is not what an anchor means.
    if (!ref.filePath) return null;

    const absolute = resolveInsideProject(projectPath, ref.filePath);
    if (!absolute) {
      return {
        refId: ref.id,
        filePath: ref.filePath,
        symbolName: ref.symbolName,
        type: 'FILE_DELETED',
        detail: `${ref.filePath} is outside the project and cannot be verified`
      };
    }

    if (!fs.existsSync(absolute)) {
      return {
        refId: ref.id,
        filePath: ref.filePath,
        symbolName: ref.symbolName,
        type: 'FILE_DELETED',
        detail: `${ref.filePath} no longer exists`
      };
    }

    let content = '';
    try {
      content = fs.readFileSync(absolute, 'utf8');
    } catch {
      return {
        refId: ref.id,
        filePath: ref.filePath,
        symbolName: ref.symbolName,
        type: 'FILE_DELETED',
        detail: `${ref.filePath} could not be read`
      };
    }

    // A missing symbol is more specific than "the file changed", so it is
    // reported in preference to it.
    if (ref.symbolName && !symbolAppears(content, ref.symbolName)) {
      return {
        refId: ref.id,
        filePath: ref.filePath,
        symbolName: ref.symbolName,
        type: 'SYMBOL_NOT_FOUND',
        detail: `${ref.symbolName} is no longer in ${ref.filePath}`
      };
    }

    if (repo.changedPaths.has(ref.filePath)) {
      return {
        refId: ref.id,
        filePath: ref.filePath,
        symbolName: ref.symbolName,
        type: 'FILE_MODIFIED',
        detail: `${ref.filePath} has uncommitted changes`
      };
    }

    if (await this.changedSinceAnchor(projectPath, ref, repo)) {
      return {
        refId: ref.id,
        filePath: ref.filePath,
        symbolName: ref.symbolName,
        type: 'FILE_MODIFIED',
        detail: `${ref.filePath} changed since ${(ref.commitHash as string).slice(0, 7)}`
      };
    }

    return null;
  }

  /**
   * Whether the anchored file changed between the anchor's commit and HEAD.
   *
   * Deliberately narrower than "HEAD differs from ref.commitHash". Any commit to
   * any file moves HEAD, so comparing the two directly would report every
   * anchored decision as drifted the first time anyone commits anything — drift
   * that fires constantly is drift nobody reads. This asks the question actually
   * worth asking: did *this file* change since the decision was anchored to it.
   */
  private async changedSinceAnchor(
    projectPath: string,
    ref: DecisionCodeRef,
    repo: RepoSnapshot
  ): Promise<boolean> {
    if (!repo.isRepository || !repo.head || !ref.filePath) return false;
    if (!isSafeCommitHash(ref.commitHash)) return false;
    if (repo.head.startsWith(ref.commitHash) || ref.commitHash.startsWith(repo.head)) return false;

    try {
      // The hash is validated as hex above and the path is passed after `--`, so
      // git treats it as a path rather than a revision. Nothing here is a shell
      // metacharacter risk: the path is quoted and the hash cannot contain one.
      const changed = await this.provider.exec(
        `git diff --name-only ${ref.commitHash} HEAD -- ${JSON.stringify(ref.filePath)}`,
        projectPath
      );
      return changed.trim().length > 0;
    } catch {
      // An unknown commit (shallow clone, rewritten history) is not evidence of
      // drift — it is an absence of evidence, and flagging it would be noise.
      return false;
    }
  }

  /** Aggregates drift across every anchor of a decision. */
  public async detectDecisionDrift(
    projectPath: string,
    decision: ProjectDecision,
    snapshot?: RepoSnapshot
  ): Promise<DecisionDriftInfo> {
    const repo = snapshot ?? (await this.snapshot(projectPath));
    const refs: CodeRefDrift[] = [];

    for (const ref of decision.codeRefs ?? []) {
      const drift = await this.detectRefDrift(projectPath, ref, repo);
      if (drift) refs.push(drift);
    }

    let worst: DriftType | null = null;
    for (const drift of refs) {
      if (worst === null || DRIFT_SEVERITY.indexOf(drift.type) > DRIFT_SEVERITY.indexOf(worst)) {
        worst = drift.type;
      }
    }

    return { decisionId: decision.id, drifted: refs.length > 0, refs, worst };
  }

  /** Drift for a set of decisions, sharing one repository snapshot. */
  public async detectAll(
    projectPath: string,
    decisions: ProjectDecision[]
  ): Promise<Record<string, DecisionDriftInfo>> {
    const repo = await this.snapshot(projectPath);
    const result: Record<string, DecisionDriftInfo> = {};
    for (const decision of decisions) {
      result[decision.id] = await this.detectDecisionDrift(projectPath, decision, repo);
    }
    return result;
  }
}

export const gitDriftDetector = new GitDriftDetector();
