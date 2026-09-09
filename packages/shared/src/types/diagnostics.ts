/**
 * Why something failed, and what the person can do about it.
 *
 * "Something went wrong" is not an acceptable answer in a tool a stranger
 * installs and runs without support. Every failure the Core can recognise gets
 * a code, a plain-language explanation, and at least one thing to try.
 */

export type DiagnosisCode =
  | 'CLI_NOT_FOUND' // the agent's binary is not installed or not on PATH
  | 'CLI_NOT_LOGGED_IN' // installed, but has no credentials
  | 'CLI_VERSION_UNSUPPORTED' // too old for the protocol Asterim speaks
  | 'CLI_SPAWN_DENIED' // found, but the OS refused to run it
  | 'CLI_EXITED' // started and then died
  | 'PROTOCOL_FAILURE' // started, but never spoke the protocol
  | 'WORKSPACE_MISSING' // the project folder is gone
  | 'POLICY_BLOCKED' // a fleet policy refused it
  | 'UNKNOWN';

export interface Diagnosis {
  code: DiagnosisCode;
  /** One line, in plain words. */
  title: string;
  /** What actually happened, including the underlying message. */
  detail: string;
  /** Ordered things to try. First is most likely to work. */
  remedies: string[];
  /** Section of the docs that covers it, when there is one. */
  docsAnchor?: string;
}

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** What was found. Never a secret, never a path outside the data directory. */
  detail?: string;
  /** What to do when this is not `ok`. */
  remedy?: string;
}

export interface DiagnosticsReport {
  generatedAt: string;
  asterim: {
    version: string;
    channel: string;
    port: number;
    /** Redacted: the home directory is replaced. */
    dataDir: string;
    uptimeSeconds: number;
    schemaVersion?: number;
  };
  runtime: {
    node: string;
    platform: string;
    arch: string;
    osRelease: string;
  };
  /** One row per agent Asterim knows how to drive. */
  agents: DiagnosticCheck[];
  /** Environment and configuration rows. */
  environment: DiagnosticCheck[];
  /** Recent log lines, redacted. Newest last. */
  logTail: string[];
}
