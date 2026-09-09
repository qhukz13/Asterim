/**
 * Turns one tool call into something a person can judge.
 *
 * The rule this file exists to enforce: **a person must be able to see what
 * approving will do before they approve it.** A card that says `Write: a.txt`
 * and nothing else is a button, not a decision.
 *
 * The mapping below knows Claude Code's tool vocabulary because that is the
 * provider the MVP ships (ADR-004). The *output* shape is provider-neutral, so
 * a second provider adds a branch here rather than a new concept. Nothing in
 * this file may throw: it runs on the path that is holding an agent mid-turn.
 */

import fs from 'fs';
import path from 'path';
import type {
  ApprovalConsequence,
  ApprovalEditPreview,
  ApprovalKind,
  ApprovalPreview
} from '@asterim/shared';

/** Lines of file content shown on the card before it is cut. */
export const PREVIEW_MAX_LINES = 40;
/** Hard cap on preview bytes, so one enormous line cannot blow up the event. */
export const PREVIEW_MAX_BYTES = 8000;
/** Cap on the whole serialised argument blob for an unrecognised tool. */
export const RAW_MAX_BYTES = 4000;

/** Cuts text to something that fits on a card, and says what was cut. */
export function makePreview(
  raw: string,
  maxLines = PREVIEW_MAX_LINES,
  maxBytes = PREVIEW_MAX_BYTES
): ApprovalPreview {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  const bytes = Buffer.byteLength(text, 'utf8');
  const allLines = text.split('\n');

  let shown = allLines.slice(0, maxLines);
  let omittedLines = allLines.length - shown.length;

  let out = shown.join('\n');
  if (Buffer.byteLength(out, 'utf8') > maxBytes) {
    // A single very long line, or many wide ones. Cut by bytes and recount, so
    // the reported line count still matches what is actually displayed.
    out = Buffer.from(out, 'utf8').subarray(0, maxBytes).toString('utf8');
    shown = out.split('\n');
    omittedLines = allLines.length - shown.length;
  }

  return {
    text: out,
    lines: shown.length,
    omittedLines: omittedLines > 0 ? omittedLines : 0,
    bytes
  };
}

/** Reads a string field without trusting the tool to have supplied one. */
function str(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Whether a path exists on disk right now. Never throws. */
export function pathExists(target: string | undefined): boolean | undefined {
  if (!target) return undefined;
  try {
    return fs.existsSync(target);
  } catch {
    return undefined;
  }
}

/** A path shown to a person: absolute is honest, but the project-relative part is readable. */
export function displayPath(target: string | undefined, projectPath?: string): string | undefined {
  if (!target) return undefined;
  if (!projectPath) return target;
  try {
    const relative = path.relative(projectPath, target);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/');
    }
  } catch {
    /* fall through to the absolute path */
  }
  return target;
}

/** Commands whose shape says "this removes something". */
const DELETING_COMMAND = /(^|[\s;|&])(rm|rmdir|del|unlink|shred|truncate)\b|\bgit\s+(clean|reset\s+--hard)\b|\bDROP\s+(TABLE|DATABASE)\b/i;

export interface ConsequenceInput {
  toolName: string;
  input: Record<string, unknown>;
  /** The agent's own description of the call, when it gave one. */
  intent?: string;
  /** Why the agent's own rules did not decide this themselves. */
  escalationReason?: string;
  /** The project directory, used only to shorten displayed paths. */
  projectPath?: string;
}

/**
 * Builds the consequence for one tool call.
 *
 * Unknown tools are deliberately not guessed at: they are reported as `other`
 * with their arguments shown verbatim, because an unrecognised verb from a
 * third-party MCP server is not evidence of safety.
 */
export function buildConsequence(request: ConsequenceInput): ApprovalConsequence {
  const { toolName, intent, escalationReason, projectPath } = request;
  const input = request.input && typeof request.input === 'object' ? request.input : {};

  const base = {
    tool: toolName,
    intent,
    escalationReason
  };

  switch (toolName) {
    case 'Bash':
    case 'PowerShell':
    case 'Shell': {
      const command = str(input, 'command') ?? '';
      const deletes = DELETING_COMMAND.test(command);
      return {
        ...base,
        kind: (deletes ? 'delete' : 'shell') as ApprovalKind,
        headline: deletes
          ? 'Run a command that removes files or data'
          : `Run a ${toolName === 'PowerShell' ? 'PowerShell' : 'shell'} command on this machine`,
        mutates: true,
        command: command || '(empty command)'
      };
    }

    case 'Write': {
      const target = str(input, 'file_path');
      const exists = pathExists(target);
      return {
        ...base,
        kind: exists ? 'overwrite' : 'create',
        headline: exists
          ? 'Replace the entire contents of an existing file'
          : 'Create a new file',
        mutates: true,
        path: displayPath(target, projectPath),
        pathExists: exists,
        content: makePreview(str(input, 'content') ?? '')
      };
    }

    case 'Edit':
    case 'MultiEdit': {
      const target = str(input, 'file_path');
      const before = str(input, 'old_string') ?? '';
      const after = str(input, 'new_string') ?? '';
      const replaceAll = input.replace_all === true;
      const edit: ApprovalEditPreview = {
        before: makePreview(before),
        after: makePreview(after),
        occurrences: replaceAll ? undefined : 1
      };
      return {
        ...base,
        kind: 'edit',
        headline: replaceAll
          ? 'Replace every occurrence of some text in a file'
          : 'Replace part of an existing file',
        mutates: true,
        path: displayPath(target, projectPath),
        pathExists: pathExists(target),
        edit
      };
    }

    case 'NotebookEdit': {
      const target = str(input, 'notebook_path');
      return {
        ...base,
        kind: 'edit',
        headline: 'Change a cell in a notebook',
        mutates: true,
        path: displayPath(target, projectPath),
        pathExists: pathExists(target),
        content: makePreview(str(input, 'new_source') ?? '')
      };
    }

    case 'Read':
    case 'Glob':
    case 'Grep': {
      const target = str(input, 'file_path') ?? str(input, 'path');
      return {
        ...base,
        kind: 'read',
        headline: 'Read from this machine without changing anything',
        mutates: false,
        path: displayPath(target, projectPath),
        raw: makePreview(safeJson(input), 12, RAW_MAX_BYTES)
      };
    }

    case 'WebFetch':
    case 'WebSearch': {
      const url = str(input, 'url') ?? str(input, 'query');
      return {
        ...base,
        kind: 'fetch',
        headline:
          toolName === 'WebFetch'
            ? 'Fetch a page from the internet'
            : 'Search the web',
        mutates: false,
        url
      };
    }

    default: {
      // Unrecognised: an MCP tool, a plugin, something new in the CLI. Show the
      // arguments and say plainly that we cannot vouch for what it does.
      return {
        ...base,
        kind: 'other',
        headline: `Use the tool "${toolName}", which Asterim does not recognise`,
        mutates: true,
        raw: makePreview(safeJson(input), 20, RAW_MAX_BYTES)
      };
    }
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '(the arguments could not be displayed)';
  }
}

/**
 * The one-line summary stored in the `approvals` table and shown wherever
 * there is no room for the card. Derived from the consequence so the record and
 * the card can never disagree.
 */
export function summarise(consequence: ApprovalConsequence): string {
  const target = consequence.path ?? consequence.url;
  if (consequence.command) {
    return `${consequence.tool}: ${consequence.command}`;
  }
  return target ? `${consequence.tool}: ${target}` : consequence.tool;
}
