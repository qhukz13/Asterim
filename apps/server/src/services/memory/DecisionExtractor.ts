import type { CreateCandidateInput, CreateCodeRefRequest } from '@asterim/shared';
import { dbService } from '../DatabaseService';
import { resolveInsideProject, isSafeCommitHash } from '../git/GitDriftDetector';

/** One line of an agent session, as read back from the events table. */
export interface TranscriptLine {
  text: string;
  timestamp: number;
  threadId?: string;
}

/** A decision the extractor believes it found in a transcript. */
export interface ExtractedCandidate {
  title: string;
  summary: string;
  rationale: string;
  constraints: string[];
  relatedFiles: string[];
  codeRefs: CreateCodeRefRequest[];
  confidence: number;
  threadId?: string;
}

/**
 * Phrases that mark a sentence as stating a decision, with how much they suggest
 * one actually was.
 *
 * Deliberately conservative and deliberately dumb. This is pattern matching over
 * text, not comprehension, and DEC-028 § 4 requires extraction to run locally
 * without sending transcripts anywhere — which rules out asking a model. The
 * output is a *queue for a human*, so the failure that matters is a queue nobody
 * trusts: a marker that fires on ordinary chatter costs more than one that misses.
 */
const DECISION_MARKERS: { pattern: RegExp; weight: number }[] = [
  { pattern: /\bdecision\s*:/i, weight: 0.9 },
  { pattern: /\bwe (?:will|should|must) (?:use|adopt|switch to|standardi[sz]e on)\b/i, weight: 0.8 },
  { pattern: /\b(?:adopting|adopted|standardi[sz]ing on)\b/i, weight: 0.75 },
  { pattern: /\bgoing (?:to|with)\s+\w+\s+(?:because|since|so that)\b/i, weight: 0.7 },
  { pattern: /\b(?:from now on|going forward|henceforth)\b/i, weight: 0.7 },
  { pattern: /\bnever\s+(?:commit|log|store|expose)\b/i, weight: 0.65 }
];

/** Reasons a sentence gives, used to fill the rationale. */
const RATIONALE_MARKERS = /\b(?:because|since|so that|in order to|as it|rather than|instead of)\b/i;

/** Sentences that impose a boundary rather than state the choice. */
const CONSTRAINT_MARKERS = /\b(?:must not|never|always|do not|don't|require[sd]?|only if)\b/i;

/**
 * A repository-relative-looking path with a recognisable extension.
 *
 * Leading `./` and `../` segments are captured deliberately. An earlier version
 * began with `\b`, which cannot match before a dot — so `../../secrets/keys.json`
 * matched only from `secrets`, silently *normalising a traversal into a
 * plausible in-project path* and inventing an anchor the transcript never named.
 * Capturing the prefix means the containment check sees the real path and drops it.
 */
const PATH_PATTERN = /(?:^|[\s('"`\[])((?:\.{1,2}\/)*(?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z][\w]{0,9})/g;

/** `path#symbol`, the anchor form the memory tools use. */
const ANCHOR_PATTERN = /(?:^|[\s('"`\[])((?:\.{1,2}\/)*(?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z][\w]{0,9})#([A-Za-z_$][\w$]*)/g;

/** A 7–40 character hex string that looks like a commit. */
const COMMIT_PATTERN = /\b([0-9a-f]{7,40})\b/g;

/** Splits text into sentences without losing the terminator. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/** The strongest decision marker in a sentence, or 0 when none matches. */
export function decisionSignal(sentence: string): number {
  let best = 0;
  for (const marker of DECISION_MARKERS) {
    if (marker.pattern.test(sentence) && marker.weight > best) best = marker.weight;
  }
  return best;
}

/**
 * Extracts code anchors from text, keeping only those that resolve inside the
 * project.
 *
 * The paths come from model output, so this is the point where SEC-01's lesson
 * applies: a proposed anchor of `../../etc/passwd` must be dropped when the
 * candidate is *created*, not left for whatever reads it later. `resolveInsideProject`
 * and `isSafeCommitHash` are reused rather than reimplemented (P5.4-02).
 */
export function extractAnchors(
  projectPath: string,
  text: string
): { relatedFiles: string[]; codeRefs: CreateCodeRefRequest[]; rejected: string[] } {
  const relatedFiles: string[] = [];
  const codeRefs: CreateCodeRefRequest[] = [];
  const rejected: string[] = [];
  const seenPaths = new Set<string>();

  const accept = (filePath: string): boolean => {
    if (resolveInsideProject(projectPath, filePath) === null) {
      if (!rejected.includes(filePath)) rejected.push(filePath);
      return false;
    }
    return true;
  };

  for (const match of text.matchAll(ANCHOR_PATTERN)) {
    const [, filePath, symbolName] = match;
    if (!accept(filePath)) continue;
    codeRefs.push({ filePath, symbolName });
    seenPaths.add(filePath);
    if (!relatedFiles.includes(filePath)) relatedFiles.push(filePath);
  }

  for (const match of text.matchAll(PATH_PATTERN)) {
    const filePath = match[1];
    if (seenPaths.has(filePath) || relatedFiles.includes(filePath)) continue;
    if (!accept(filePath)) continue;
    relatedFiles.push(filePath);
    codeRefs.push({ filePath });
  }

  // A commit hash only becomes an anchor when it accompanies a file; on its own
  // it is just a number in a sentence.
  const commit = [...text.matchAll(COMMIT_PATTERN)].map(m => m[1]).find(isSafeCommitHash);
  if (commit && codeRefs.length > 0) {
    codeRefs[0] = { ...codeRefs[0], commitHash: commit };
  }

  return { relatedFiles, codeRefs, rejected };
}

/** Trims a sentence into something usable as a headline. */
export function toTitle(sentence: string, max = 80): string {
  const cleaned = sentence
    .replace(/^\s*(?:decision\s*:|note\s*:)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned.replace(/[.!?]+$/, '');
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Finds candidate decisions in a transcript.
 *
 * Pure: no database, no clock, no filesystem beyond the path containment check.
 * Everything stateful lives in `extractForProject` below, which makes the
 * detection itself straightforward to test against fixed text.
 */
export function extractCandidates(projectPath: string, lines: TranscriptLine[]): ExtractedCandidate[] {
  const candidates: ExtractedCandidate[] = [];
  const seenTitles = new Set<string>();

  for (const line of lines) {
    const sentences = splitSentences(line.text);
    // Sentences already absorbed as a constraint of an earlier candidate. A
    // prohibition like "Never log the derived key" matches a decision marker in
    // its own right, so without this it would queue twice — once attached to the
    // decision it qualifies and once as a decision of its own.
    const consumed = new Set<number>();

    sentences.forEach((sentence, index) => {
      if (consumed.has(index)) return;
      const signal = decisionSignal(sentence);
      if (signal === 0) return;

      const title = toTitle(sentence);
      if (title.length < 8) return;

      // The same decision restated across a session should not queue twice.
      const key = title.toLowerCase();
      if (seenTitles.has(key)) return;
      seenTitles.add(key);

      // Rationale is taken from the sentence itself when it explains, otherwise
      // from the sentence that follows — which is where "because…" usually lands.
      const next = sentences[index + 1] ?? '';
      const rationale = RATIONALE_MARKERS.test(sentence)
        ? sentence
        : RATIONALE_MARKERS.test(next)
          ? next
          : '';

      const constraints: string[] = [];
      for (let offset = 1; offset < 4 && index + offset < sentences.length; offset++) {
        const following = sentences[index + offset];
        if (!CONSTRAINT_MARKERS.test(following)) continue;
        constraints.push(toTitle(following, 120));
        consumed.add(index + offset);
      }

      // Anchors are read from the whole line, not just the sentence: a decision
      // and the file it concerns are frequently a clause apart.
      const { relatedFiles, codeRefs } = extractAnchors(projectPath, line.text);

      // Evidence raises confidence, but never to certainty — a human confirming
      // it is what makes a candidate authoritative (DEC-027).
      let confidence = signal;
      if (rationale) confidence += 0.05;
      if (relatedFiles.length > 0) confidence += 0.05;
      confidence = Math.min(0.95, Number(confidence.toFixed(2)));

      candidates.push({
        title,
        summary: toTitle(sentence, 200),
        rationale: rationale ? toTitle(rationale, 200) : 'No rationale was stated in the session.',
        constraints,
        relatedFiles,
        codeRefs,
        confidence,
        threadId: line.threadId
      });
    });
  }

  return candidates;
}

export interface ExtractionRequest {
  projectId: string;
  threadId?: string;
  sessionId?: string;
  /** How many recent transcript events to consider. */
  limit?: number;
}

export class DecisionExtractor {
  /**
   * Reads a project's recent transcript from the events table.
   *
   * `chat.message` and `agent.log` are the two types carrying prose an agent
   * actually said. Terminal output is deliberately excluded: it is command
   * output, not statements, and mining it produces noise.
   */
  public readTranscript(request: ExtractionRequest): TranscriptLine[] {
    const db = dbService.getDb();
    const limit = Math.min(Math.max(request.limit ?? 200, 1), 2000);

    const rows = request.threadId
      ? (db
          .prepare(
            `SELECT payload_json, timestamp, thread_id FROM events
              WHERE project_id = ? AND thread_id = ? AND type IN ('chat.message', 'agent.log')
              ORDER BY timestamp DESC LIMIT ?`
          )
          .all(request.projectId, request.threadId, limit) as unknown as {
          payload_json: string;
          timestamp: number;
          thread_id: string | null;
        }[])
      : (db
          .prepare(
            `SELECT payload_json, timestamp, thread_id FROM events
              WHERE project_id = ? AND type IN ('chat.message', 'agent.log')
              ORDER BY timestamp DESC LIMIT ?`
          )
          .all(request.projectId, limit) as unknown as {
          payload_json: string;
          timestamp: number;
          thread_id: string | null;
        }[]);

    const lines: TranscriptLine[] = [];
    for (const row of rows.reverse()) {
      let text: string;
      try {
        const payload = JSON.parse(row.payload_json);
        // Events are stored as the full envelope, so the payload may be nested.
        const inner = payload?.payload ?? payload;
        text = typeof inner?.content === 'string' ? inner.content : typeof inner?.message === 'string' ? inner.message : '';
      } catch {
        continue;
      }
      if (text.trim()) {
        lines.push({ text, timestamp: row.timestamp, threadId: row.thread_id ?? undefined });
      }
    }
    return lines;
  }

  /**
   * Extracts and stages candidates for a project.
   *
   * Returns what was staged. Nothing reaches `project_decisions` — that requires
   * a human approving the candidate (DEC-027), and this method has no path to it.
   */
  public extractForProject(request: ExtractionRequest): CreateCandidateInput[] {
    const db = dbService.getDb();
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(request.projectId) as
      | { path: string }
      | undefined;
    if (!project) return [];

    const lines = this.readTranscript(request);
    const extracted = extractCandidates(project.path ?? '', lines);

    return extracted.map(candidate => ({
      projectId: request.projectId,
      sessionId: request.sessionId,
      threadId: candidate.threadId ?? request.threadId,
      title: candidate.title,
      summary: candidate.summary,
      rationale: candidate.rationale,
      constraints: candidate.constraints,
      relatedFiles: candidate.relatedFiles,
      codeRefs: candidate.codeRefs,
      confidence: candidate.confidence
    }));
  }
}

export const decisionExtractor = new DecisionExtractor();
