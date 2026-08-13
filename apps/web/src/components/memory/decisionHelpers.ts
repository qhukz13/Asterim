import type { ProjectDecision } from '@asterim/shared';

/**
 * Pure helpers shared by the Explorer and the Timeline.
 *
 * They live apart from both because each view needs helpers first written in the
 * other: the Timeline reads `anchorLabels`/`provenanceLabel`, and the Explorer now
 * reads `buildLineage` to resolve supersession titles. Importing across the two
 * components made them mutually dependent, which worked only by accident of module
 * evaluation order. Nothing here renders, so nothing here can create a cycle.
 */

/** Splits a decision's anchors into displayable `path#symbol` labels, deduplicated. */
export function anchorLabels(decision: ProjectDecision): string[] {
  const labels = (decision.codeRefs ?? [])
    .map(ref => {
      if (ref.filePath && ref.symbolName) return `${ref.filePath}#${ref.symbolName}`;
      return ref.filePath || ref.symbolName || '';
    })
    .filter(Boolean);

  // relatedFiles are derived from file-only code refs, so they are usually already
  // covered above. Include any that are not, without duplicating a path.
  for (const file of decision.relatedFiles ?? []) {
    if (!labels.some(l => l === file || l.startsWith(`${file}#`))) labels.push(file);
  }
  return labels;
}

/**
 * How a decision entered memory, rendered so a reviewer can weigh it at a glance.
 *
 * DEC-024 exists precisely so an agent's unprompted assertion is distinguishable
 * from something a human approved. That distinction is worth nothing if the UI
 * renders both identically, so human-confirmed decisions carry the accent and
 * agent statements stay neutral — the accent means "a person stood behind this".
 */
export function provenanceLabel(decision: ProjectDecision): { text: string; isHuman: boolean } {
  const percent = Math.round((decision.confidence ?? 0) * 100);
  switch (decision.provenance) {
    case 'HUMAN_CONFIRMED':
      return { text: `Human · ${percent}%`, isHuman: true };
    case 'REPOSITORY_EVIDENCE':
      return { text: `Repository · ${percent}%`, isHuman: false };
    case 'INFERRED':
      return { text: `Inferred · ${percent}%`, isHuman: false };
    default:
      return { text: `Agent · ${percent}%`, isHuman: false };
  }
}

/** One end of a supersession link, resolved to a title where the counterpart is loaded. */
export interface LineageLink {
  id: string;
  title: string;
  /** False when only the id is known, because the other decision is not in view. */
  resolved: boolean;
}

export interface Lineage {
  /** The decision that replaced this one. */
  replacedBy?: LineageLink;
  /** The decision this one replaced. */
  replaces?: LineageLink;
}

/**
 * Resolves each decision's supersession links.
 *
 * `supersededBy` carries two opposite meanings depending on `status`: on a
 * SUPERSEDED decision it names the replacement, and on the ACTIVE replacement it
 * names what was replaced. That is recorded as drift in
 * `blueprint/audit/IMPLEMENTATION_DRIFT.md` § 4; until it is split into two fields,
 * a consumer has to read `status` to know which way the link points, and this is
 * the one place in the UI that does so.
 */
export function buildLineage(decisions: ProjectDecision[]): Map<string, Lineage> {
  const byId = new Map(decisions.map(d => [d.id, d]));
  const link = (id: string): LineageLink => {
    const target = byId.get(id);
    return target ? { id, title: target.title, resolved: true } : { id, title: id, resolved: false };
  };

  const lineage = new Map<string, Lineage>();
  for (const decision of decisions) {
    if (!decision.supersededBy) continue;
    lineage.set(
      decision.id,
      decision.status === 'SUPERSEDED'
        ? { replacedBy: link(decision.supersededBy) }
        : { replaces: link(decision.supersededBy) }
    );
  }
  return lineage;
}
