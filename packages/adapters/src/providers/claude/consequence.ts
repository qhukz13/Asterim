/**
 * Claude Code permission consequence builder.
 *
 * Translates Claude Code's native tool vocabulary (Bash, Write, Edit, Read, etc.)
 * into Asterim's provider-neutral ApprovalConsequence shape.
 */

import fs from 'fs';
import path from 'path';
import type {
  ApprovalConsequence,
  ApprovalEditPreview,
  ApprovalKind,
  ApprovalPreview
} from '@asterim/shared';

export const PREVIEW_MAX_LINES = 40;
export const PREVIEW_MAX_BYTES = 8000;
export const RAW_MAX_BYTES = 4000;

export function makePreview(
  raw: string,
  maxLines = PREVIEW_MAX_LINES,
  maxBytes = PREVIEW_MAX_BYTES
): ApprovalPreview {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  const bytes = Buffer.byteLength(text, 'utf8');
  const allLines = text.split('\n');

  const shown = allLines.slice(0, maxLines);
  let omittedLines = allLines.length - shown.length;

  let out = shown.join('\n');
  if (Buffer.byteLength(out, 'utf8') > maxBytes) {
    out = Buffer.from(out, 'utf8').subarray(0, maxBytes).toString('utf8');
    const recount = out.split('\n');
    omittedLines = allLines.length - recount.length;
  }

  return {
    text: out,
    lines: out.split('\n').length,
    omittedLines: omittedLines > 0 ? omittedLines : 0,
    bytes
  };
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function pathExists(target: string | undefined): boolean | undefined {
  if (!target) return undefined;
  try {
    return fs.existsSync(target);
  } catch {
    return undefined;
  }
}

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

const DELETING_COMMAND = /(^|[\s;|&])(rm|rmdir|del|unlink|shred|truncate)\b|\bgit\s+(clean|reset\s+--hard)\b|\bDROP\s+(TABLE|DATABASE)\b/i;

export interface ClaudeConsequenceInput {
  toolName: string;
  input: Record<string, unknown>;
  intent?: string;
  escalationReason?: string;
  projectPath?: string;
}

export function buildClaudeConsequence(request: ClaudeConsequenceInput): ApprovalConsequence {
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

export function summariseConsequence(consequence: ApprovalConsequence): string {
  const target = consequence.path ?? consequence.url;
  if (consequence.command) {
    return `${consequence.tool}: ${consequence.command}`;
  }
  return target ? `${consequence.tool}: ${target}` : consequence.tool;
}
