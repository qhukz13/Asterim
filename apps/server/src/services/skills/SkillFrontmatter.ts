/**
 * The YAML frontmatter a `SKILL.md` opens with, read without a YAML engine.
 *
 * A skill file is user-authored content that Asterim reads on behalf of an
 * agent, so the parser is the security boundary: full YAML carries tags and
 * anchors that a permissive loader will turn into constructor calls, and the
 * task forbids any of that. This is a deliberate subset — mappings, sequences,
 * scalars, block scalars and flow collections — implemented as a line scanner
 * that can only ever produce plain data.
 *
 * It never throws. A truncated fence, a tab-indented block or a half-written
 * schema yields whatever could be read plus an empty rest, because a corrupt
 * skill in one directory must not stop the other skills being discovered.
 */

/** Every shape this parser can produce. Plain data, by construction. */
export type YamlValue = string | number | boolean | null | YamlValue[] | YamlMapping;

export interface YamlMapping {
  [key: string]: YamlValue;
}

/** A `SKILL.md` split into its two halves. */
export interface ParsedFrontmatter {
  /** The parsed frontmatter mapping; empty when the file has no fence. */
  data: YamlMapping;
  /** Everything after the closing fence — the instruction body. */
  body: string;
  /** False when no opening/closing `---` fence was found. */
  hasFrontmatter: boolean;
}

/** How many lines of frontmatter are worth scanning before giving up. */
const MAX_FRONTMATTER_LINES = 2000;

/**
 * How deep nesting may go before the rest is discarded.
 *
 * The parser recurses once per indentation level, so a file indented a few
 * thousand columns would overflow the stack. Nothing legible needs 32 levels,
 * and a skill that claims to is a file worth ignoring, not crashing on.
 */
export const MAX_YAML_DEPTH = 32;

interface Line {
  indent: number;
  text: string;
}

/** A tab is two columns here; YAML forbids tabs for indentation anyway. */
function toLines(source: string): Line[] {
  return source.split('\n').map(raw => {
    const withoutTabs = raw.replace(/\t/g, '  ');
    const indent = withoutTabs.length - withoutTabs.trimStart().length;
    return { indent, text: withoutTabs.trim() };
  });
}

/** Blank lines and whole-line comments carry no structure. */
function isSkippable(line: Line): boolean {
  return line.text === '' || line.text.startsWith('#');
}

/** Index of the next line that means something, or -1. */
function nextSignificant(lines: Line[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (!isSkippable(lines[i])) return i;
  }
  return -1;
}

/**
 * Strips a trailing `# comment` that is not inside quotes.
 *
 * Quote-aware because a description may legitimately contain a `#`, and cutting
 * at the first one would silently truncate it.
 */
export function stripComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === '\\' && quote === '"') i++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i);
    }
  }
  return text;
}

function unquote(text: string): string | null {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return null;
}

/** Splits a flow collection's body on top-level commas. */
function splitFlow(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quote) {
      current += char;
      if (char === '\\' && quote === '"') {
        current += body[++i] ?? '';
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === '[' || char === '{') {
      depth++;
      current += char;
    } else if (char === ']' || char === '}') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim() !== '') parts.push(current);
  return parts;
}

/**
 * A flow collection — `[a, b]` or `{type: object}`.
 *
 * JSON first, because a schema pasted from a JSON file is the common case and
 * `JSON.parse` gets every escape right. The hand-rolled split is the fallback
 * for YAML flow, whose keys and strings are usually unquoted.
 */
function parseFlow(text: string): YamlValue {
  try {
    return JSON.parse(text) as YamlValue;
  } catch {
    /* not JSON; fall through to the YAML flow reading below */
  }

  const inner = text.slice(1, -1).trim();
  if (text.startsWith('[')) {
    if (inner === '') return [];
    return splitFlow(inner).map(part => parseScalar(part));
  }

  const mapping: YamlMapping = {};
  if (inner === '') return mapping;
  for (const part of splitFlow(inner)) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const key = unquote(part.slice(0, colon).trim()) ?? part.slice(0, colon).trim();
    if (key) mapping[key] = parseScalar(part.slice(colon + 1));
  }
  return mapping;
}

/** One scalar, typed the way YAML types it. */
export function parseScalar(raw: string): YamlValue {
  const text = stripComment(raw).trim();
  if (text === '') return '';

  const unquoted = unquote(text);
  if (unquoted !== null) return unquoted;

  if (
    (text.startsWith('[') && text.endsWith(']')) ||
    (text.startsWith('{') && text.endsWith('}'))
  ) {
    return parseFlow(text);
  }

  if (text === 'true' || text === 'True' || text === 'yes') return true;
  if (text === 'false' || text === 'False' || text === 'no') return false;
  if (text === 'null' || text === 'Null' || text === '~') return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(text)) return Number(text);

  return text;
}

/** Reads a `|` or `>` block, returning its text and the line after it. */
function parseBlockScalar(
  lines: Line[],
  start: number,
  parentIndent: number,
  indicator: string
): { value: string; next: number } {
  const folded = indicator.startsWith('>');
  const keep = indicator.includes('+');
  const strip = indicator.includes('-');

  const collected: string[] = [];
  let i = start;
  let blockIndent = -1;

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.text === '') {
      collected.push('');
      continue;
    }
    if (line.indent <= parentIndent) break;
    if (blockIndent === -1) blockIndent = line.indent;
    collected.push(' '.repeat(Math.max(0, line.indent - blockIndent)) + line.text);
  }

  // Trailing blanks belong to whatever follows, not to the block.
  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();

  let value: string;
  if (folded) {
    const paragraphs: string[] = [];
    let buffer: string[] = [];
    for (const line of collected) {
      if (line === '') {
        paragraphs.push(buffer.join(' '));
        buffer = [];
      } else {
        buffer.push(line);
      }
    }
    paragraphs.push(buffer.join(' '));
    value = paragraphs.join('\n');
  } else {
    value = collected.join('\n');
  }

  if (keep) value += '\n';
  else if (!strip && value !== '') value += '\n';

  return { value, next: i };
}

/** A `key: value` line, split into its two halves. */
interface KeyLine {
  key: string;
  /** The value on the same line; empty when the line is just `key:`. */
  inline: string;
}

/**
 * Reads `key:`, `"key":` or `'key':` and whatever follows it.
 *
 * Scanned rather than matched with one regex on purpose. The natural expression
 * of "a key is everything up to the colon" is `([^:#]+?)\s*:`, whose lazy
 * repetition and trailing `\s*` both match a space — an ambiguity that turns
 * into quadratic backtracking on a long line with no colon in it, which is
 * exactly the line a hostile `SKILL.md` would contain. Scanning is linear and
 * says the same thing more plainly.
 *
 * Returns null for anything that is not a key line, including `key:value` with
 * no space, which YAML reads as a plain scalar rather than a mapping.
 */
function parseKeyLine(text: string): KeyLine | null {
  let key: string;
  let after: number;

  const quote = text[0] === '"' || text[0] === "'" ? text[0] : null;
  if (quote) {
    const closing = findClosingQuote(text, quote);
    if (closing === -1) return null;
    key = unquote(text.slice(0, closing + 1)) ?? text.slice(1, closing);
    after = closing + 1;
    while (after < text.length && (text[after] === ' ' || text[after] === '\t')) after++;
    if (text[after] !== ':') return null;
  } else {
    const colon = text.indexOf(':');
    if (colon === -1) return null;
    const raw = text.slice(0, colon);
    // A `#` before the colon means the line was a comment, not a key.
    if (raw.includes('#')) return null;
    key = raw.trim();
    after = colon;
  }

  if (!key) return null;

  const rest = text.slice(after + 1);
  // `key:value` is a scalar in YAML; only `key: value` or a bare `key:` is a
  // mapping entry.
  if (rest !== '' && !/^\s/.test(rest)) return null;

  return { key, inline: rest.trim() };
}

/** Index of the quote that closes the one at position 0, or -1. */
function findClosingQuote(text: string, quote: string): number {
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '\\' && quote === '"') {
      i++;
      continue;
    }
    if (text[i] !== quote) continue;
    // In single quotes, `''` is an escaped quote rather than the end.
    if (quote === "'" && text[i + 1] === "'") {
      i++;
      continue;
    }
    return i;
  }
  return -1;
}

function parseMapping(
  lines: Line[],
  start: number,
  indent: number,
  depth: number
): { value: YamlMapping; next: number } {
  const mapping: YamlMapping = {};
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (isSkippable(line)) {
      i++;
      continue;
    }
    if (line.indent < indent) break;
    if (line.indent > indent) {
      // Indentation that belongs to nothing: skip rather than misattribute it.
      i++;
      continue;
    }

    const entry = parseKeyLine(line.text);
    if (!entry) {
      i++;
      continue;
    }

    const { key, inline } = entry;
    i++;

    if (/^[|>][+-]?$/.test(inline)) {
      const block = parseBlockScalar(lines, i, indent, inline);
      mapping[key] = block.value;
      i = block.next;
      continue;
    }

    if (inline !== '') {
      mapping[key] = parseScalar(inline);
      continue;
    }

    const child = nextSignificant(lines, i);
    if (child === -1) {
      mapping[key] = null;
      continue;
    }

    const childLine = lines[child];
    // `key:` followed by `- item` at the same column is a sequence, which YAML
    // permits and schema authors write constantly.
    if (childLine.indent === indent && /^-(\s|$)/.test(childLine.text)) {
      const sequence = parseSequence(lines, child, indent, depth + 1);
      mapping[key] = sequence.value;
      i = sequence.next;
      continue;
    }
    if (childLine.indent <= indent || depth >= MAX_YAML_DEPTH) {
      mapping[key] = null;
      continue;
    }

    const block = parseNode(lines, child, childLine.indent, depth + 1);
    mapping[key] = block.value;
    i = block.next;
  }

  return { value: mapping, next: i };
}

function parseSequence(
  lines: Line[],
  start: number,
  indent: number,
  depth: number
): { value: YamlValue[]; next: number } {
  const items: YamlValue[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (isSkippable(line)) {
      i++;
      continue;
    }
    if (line.indent !== indent || !/^-(\s|$)/.test(line.text)) break;

    const content = line.text.slice(1).trim();
    i++;

    if (content === '') {
      const child = nextSignificant(lines, i);
      if (child !== -1 && lines[child].indent > indent && depth < MAX_YAML_DEPTH) {
        const block = parseNode(lines, child, lines[child].indent, depth + 1);
        items.push(block.value);
        i = block.next;
      } else {
        items.push(null);
      }
      continue;
    }

    // `- name: value` opens a mapping whose remaining keys are indented under it.
    const asKey = parseKeyLine(content);
    if (asKey) {
      const entry: YamlMapping = {};
      entry[asKey.key] = asKey.inline === '' ? null : parseScalar(asKey.inline);

      const child = nextSignificant(lines, i);
      if (child !== -1 && lines[child].indent > indent && depth < MAX_YAML_DEPTH) {
        const rest = parseMapping(lines, child, lines[child].indent, depth + 1);
        Object.assign(entry, rest.value);
        i = rest.next;
      }
      items.push(entry);
      continue;
    }

    items.push(parseScalar(content));
  }

  return { value: items, next: i };
}

/** A mapping or a sequence, whichever the first line at this indent starts. */
function parseNode(
  lines: Line[],
  start: number,
  indent: number,
  depth: number
): { value: YamlValue; next: number } {
  const line = lines[start];
  if (line && /^-(\s|$)/.test(line.text)) return parseSequence(lines, start, indent, depth);
  return parseMapping(lines, start, indent, depth);
}

/** Parses a standalone YAML document in the supported subset. */
export function parseYaml(source: string): YamlMapping {
  try {
    const lines = toLines(source);
    const first = nextSignificant(lines, 0);
    if (first === -1) return {};
    const parsed = parseMapping(lines, first, lines[first].indent, 0);
    return parsed.value;
  } catch (err) {
    console.warn(`[Skills] Could not read frontmatter: ${(err as Error).message}`);
    return {};
  }
}

/**
 * Splits a `SKILL.md` into its frontmatter and its body.
 *
 * A file with no fence is not an error: the whole file becomes the body and the
 * skill falls back to its directory name, which is what the open Agent Skill
 * layout implies for a bare instruction file.
 */
export function parseFrontmatter(source: string): ParsedFrontmatter {
  // A byte-order mark ahead of the fence would stop it being recognised.
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  let cursor = 0;
  while (cursor < lines.length && lines[cursor].trim() === '') cursor++;

  if (lines[cursor]?.trim() !== '---') {
    return { data: {}, body: text.trim(), hasFrontmatter: false };
  }

  const limit = Math.min(lines.length, cursor + 1 + MAX_FRONTMATTER_LINES);
  for (let i = cursor + 1; i < limit; i++) {
    const line = lines[i].trim();
    if (line === '---' || line === '...') {
      return {
        data: parseYaml(lines.slice(cursor + 1, i).join('\n')),
        body: lines.slice(i + 1).join('\n').trim(),
        hasFrontmatter: true
      };
    }
  }

  // An opening fence that never closes: treat the file as pure instructions
  // rather than guessing where the author meant the frontmatter to end.
  return { data: {}, body: text.trim(), hasFrontmatter: false };
}
