/**
 * What an agent is asking permission to do, in a form a person can judge.
 *
 * The approval card is the reason Asterim exists: a card that says
 * `Write: file.txt` asks someone to authorise something they cannot see. This
 * type carries enough for an informed decision — what kind of action it is,
 * what it targets, whether it changes something that already exists, and the
 * content or the edit itself — and deliberately not more than that.
 *
 * The shape is provider-neutral. Mapping one agent's tool vocabulary onto it is
 * the Core's job (`apps/server/src/services/approvals/consequence.ts`); today
 * that mapping knows Claude Code's tools, and a second provider adds a branch
 * rather than a new shape (ADR-004).
 */

/** The families of action a person judges differently. */
export type ApprovalKind =
  | 'shell' // runs a command on this machine
  | 'create' // writes a file that does not exist yet
  | 'overwrite' // replaces the contents of a file that does
  | 'edit' // changes part of an existing file
  | 'delete' // removes something
  | 'fetch' // reaches a network resource
  | 'read' // reads without changing anything
  | 'other'; // an unrecognised tool: judged as unproven

/** Text shown in a preview pane, with what was cut off. */
export interface ApprovalPreview {
  text: string;
  /** Lines shown. */
  lines: number;
  /** Lines omitted after truncation; 0 when the whole thing is shown. */
  omittedLines: number;
  /** Size of the untruncated content in bytes. */
  bytes: number;
}

/** A replacement, for tools that change part of a file. */
export interface ApprovalEditPreview {
  before: ApprovalPreview;
  after: ApprovalPreview;
  /** How many occurrences will be replaced, when the tool says so. */
  occurrences?: number;
}

export interface ApprovalConsequence {
  /** The provider's own tool name, e.g. `Bash`, `Write`, `Edit`. */
  tool: string;
  kind: ApprovalKind;
  /** One line in plain words: "Overwrite an existing file". */
  headline: string;
  /** True when approving changes something outside the conversation. */
  mutates: boolean;
  /** Absolute path, when the action targets one file. */
  path?: string;
  /** Whether that path already exists. Decides create versus overwrite. */
  pathExists?: boolean;
  /** The command, verbatim, for shell actions. */
  command?: string;
  /** The agent's own one-line description of why it wants this. */
  intent?: string;
  /** Why the provider's own rules did not decide it themselves. */
  escalationReason?: string;
  /** URL for a network action. */
  url?: string;
  /** The content that will be written. */
  content?: ApprovalPreview;
  /** The replacement that will be made. */
  edit?: ApprovalEditPreview;
  /** Anything unrecognised, as pretty-printed JSON. */
  raw?: ApprovalPreview;
}
