/**
 * A deliberately small YAML reader, for pipeline definitions only (P9-01).
 *
 * Asterim has no YAML dependency and this is not the place to acquire one. A
 * pipeline definition is a file an agent can write into a repository the Core
 * then reads, so the reader is part of the trust boundary, and the general
 * parsers are general in exactly the directions that matter here: anchors and
 * aliases make a forty-line file expand to gigabytes, tags name constructors,
 * and multi-document streams hide a second definition behind the first.
 *
 * So the subset is the contract rather than an omission:
 *
 *   - Block mappings, block sequences, and one document.
 *   - Plain, single-quoted and double-quoted scalars; `null`/`~`, booleans and
 *     numbers by the core schema's spelling.
 *   - Literal (`|`) and folded (`>`) block scalars, with `-` and `+` chomping.
 *   - Flow sequences and flow mappings of scalars — `dependsOn: [a, b]`.
 *
 * Everything else is refused with the line it was refused on: anchors (`&`),
 * aliases (`*`), tags (`!`), directives (`%`), a second document, tab
 * indentation, complex keys. Refusing is safe; guessing is not.
 *
 * Every bound is checked while reading rather than after: length, line count,
 * nesting depth and collection size. A reader that only notices a
 * ten-million-entry list once it has built one has already spent the memory.
 */

/** Anything this reader can produce. */
export type YamlValue = string | number | boolean | null | YamlValue[] | YamlMapping;

export interface YamlMapping {
  [key: string]: YamlValue;
}

/** The largest document accepted, in characters. */
export const MAX_YAML_CHARS = 262144;

/** The most lines one document may have. */
export const MAX_YAML_LINES = 5000;

/** How deeply collections may nest before the document is refused. */
export const MAX_YAML_DEPTH = 24;

/** The most entries one mapping or sequence may hold. */
export const MAX_YAML_COLLECTION_ENTRIES = 500;

/** A document this reader will not read, and the line that stopped it. */
export class YamlParseError extends Error {
  constructor(
    message: string,
    /** 1-based, or 0 when the problem is the document as a whole. */
    public readonly line = 0
  ) {
    super(line > 0 ? `${message} (line ${line})` : message);
    this.name = 'YamlParseError';
  }
}

/**
 * Keys that would change an object rather than fill it in.
 *
 * A mapping is built as an ordinary `{}`, so writing `__proto__` into one
 * replaces its prototype instead of adding a member — a definition file an
 * agent can write must not be able to reach that far.
 */
const REFUSED_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** Matches a plain integer or float in the core schema's spelling. */
const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** The sigils this reader refuses to interpret rather than guess at. */
const REFUSED_SIGILS: Record<string, string> = {
  '&': 'anchors',
  '*': 'aliases',
  '!': 'tags',
  '%': 'directives',
  '?': 'complex mapping keys'
};

/**
 * Reads one YAML document.
 *
 * Throws `YamlParseError` for anything outside the subset, which is the whole
 * point: a definition this cannot read is one the pipeline engine refuses to
 * run rather than one it half-understands.
 */
export function parseSafeYaml(source: string): YamlValue {
  return new SafeYamlReader(source).read();
}

class SafeYamlReader {
  /** The document, split into lines with carriage returns removed. */
  private readonly lines: string[];
  /** The line being read, 0-based. */
  private index = 0;
  /** Whether the `---` that opens a document has already been consumed. */
  private sawDocumentStart = false;
  /** Whether any content has been read, which is what makes a `---` a second document. */
  private sawContent = false;

  constructor(source: string) {
    if (typeof source !== 'string') {
      throw new YamlParseError('A pipeline definition must be text.');
    }
    if (source.length > MAX_YAML_CHARS) {
      throw new YamlParseError(
        `A pipeline definition may be at most ${MAX_YAML_CHARS} characters; this one is ${source.length}.`
      );
    }

    this.lines = source.split('\n').map(line => line.replace(/\r$/, ''));
    if (this.lines.length > MAX_YAML_LINES) {
      throw new YamlParseError(
        `A pipeline definition may be at most ${MAX_YAML_LINES} lines; this one is ${this.lines.length}.`
      );
    }
  }

  public read(): YamlValue {
    this.skipIgnorable();
    if (this.index >= this.lines.length) return null;

    const value = this.parseNode(this.indentOf(this.index), 0);

    this.skipIgnorable();
    if (this.index < this.lines.length) {
      throw new YamlParseError(
        'Unexpected content after the end of the document.',
        this.index + 1
      );
    }
    return value;
  }

  // --- Lines ----------------------------------------------------------------

  /** How far a line is indented. Tabs are refused rather than counted. */
  private indentOf(index: number): number {
    const line = this.lines[index] ?? '';
    let indent = 0;
    while (indent < line.length && line[indent] === ' ') indent++;
    if (line[indent] === '\t') {
      throw new YamlParseError('Indent pipeline definitions with spaces, not tabs.', index + 1);
    }
    return indent;
  }

  /** Whether a line carries nothing but whitespace or a comment. */
  private isIgnorable(index: number): boolean {
    const text = (this.lines[index] ?? '').trim();
    return text.length === 0 || text.startsWith('#');
  }

  /** One line's content: indentation removed, comments removed, right-trimmed. */
  private contentOf(index: number): string {
    this.sawContent = true;
    return stripComment(this.lines[index] ?? '')
      .slice(this.indentOf(index))
      .trimEnd();
  }

  /** Advances past blank lines, comments and the one document marker allowed. */
  private skipIgnorable(): void {
    while (this.index < this.lines.length) {
      if (this.isIgnorable(this.index)) {
        this.index++;
        continue;
      }
      const text = this.lines[this.index].trim();
      if (text === '---') {
        // A `---` before anything else opens this document; one after content
        // has been read opens a second, which is a stream this will not read.
        if (this.sawDocumentStart || this.sawContent) {
          throw new YamlParseError(
            'A pipeline definition must be a single YAML document.',
            this.index + 1
          );
        }
        this.sawDocumentStart = true;
        this.index++;
        continue;
      }
      if (text === '...') {
        // The rest of the stream is another document or nothing; either way this
        // document is over.
        this.index = this.lines.length;
        return;
      }
      return;
    }
  }

  // --- Nodes ----------------------------------------------------------------

  private guardDepth(depth: number, line: number): void {
    if (depth > MAX_YAML_DEPTH) {
      throw new YamlParseError(
        `A pipeline definition may nest at most ${MAX_YAML_DEPTH} levels deep.`,
        line
      );
    }
  }

  /** A mapping or a sequence, decided by what the first line at `indent` is. */
  private parseNode(indent: number, depth: number): YamlValue {
    this.guardDepth(depth, this.index + 1);
    this.skipIgnorable();
    if (this.index >= this.lines.length) return null;

    const text = this.contentOf(this.index);
    return text === '-' || text.startsWith('- ')
      ? this.parseSequence(indent, depth)
      : this.parseMapping(indent, depth);
  }

  private parseMapping(indent: number, depth: number): YamlMapping {
    const mapping: YamlMapping = {};

    for (;;) {
      this.skipIgnorable();
      if (this.index >= this.lines.length) break;

      const lineIndent = this.indentOf(this.index);
      if (lineIndent < indent) break;
      if (lineIndent > indent) {
        throw new YamlParseError('Unexpected indentation.', this.index + 1);
      }

      const line = this.index + 1;
      const text = this.contentOf(this.index);
      if (text === '-' || text.startsWith('- ')) {
        throw new YamlParseError(
          'A list item cannot appear where a mapping key is expected.',
          line
        );
      }

      const entry = splitKey(text, line);
      guardKey(entry.key, line);
      if (Object.prototype.hasOwnProperty.call(mapping, entry.key)) {
        throw new YamlParseError(`Duplicate key '${entry.key}'.`, line);
      }
      if (Object.keys(mapping).length >= MAX_YAML_COLLECTION_ENTRIES) {
        throw new YamlParseError(
          `A mapping may hold at most ${MAX_YAML_COLLECTION_ENTRIES} entries.`,
          line
        );
      }

      this.index++;
      mapping[entry.key] = this.parseValueAfterKey(entry.rest, indent, depth, line);
    }

    return mapping;
  }

  private parseSequence(indent: number, depth: number): YamlValue[] {
    const items: YamlValue[] = [];

    for (;;) {
      this.skipIgnorable();
      if (this.index >= this.lines.length) break;

      const lineIndent = this.indentOf(this.index);
      if (lineIndent < indent) break;
      if (lineIndent > indent) {
        throw new YamlParseError('Unexpected indentation.', this.index + 1);
      }

      const line = this.index + 1;
      const text = this.contentOf(this.index);
      // A mapping key at the sequence's own indentation ends the sequence; the
      // caller decides whether that is legal where it stands.
      if (text !== '-' && !text.startsWith('- ')) break;

      if (items.length >= MAX_YAML_COLLECTION_ENTRIES) {
        throw new YamlParseError(
          `A list may hold at most ${MAX_YAML_COLLECTION_ENTRIES} entries.`,
          line
        );
      }

      const rest = text === '-' ? '' : text.slice(2).trim();

      if (rest.length === 0) {
        this.index++;
        items.push(this.parseChildBlock(indent, depth));
        continue;
      }

      if (isBlockScalarHeader(rest)) {
        this.index++;
        items.push(this.parseBlockScalar(rest, indent, line));
        continue;
      }

      if (looksLikeMappingEntry(rest)) {
        // `- id: build` opens a mapping whose keys line up with `id`. The line is
        // rewritten as that mapping's first entry and re-read at its column, so
        // the ordinary mapping reader handles it and the following `  name:`
        // lines land in the same mapping.
        const childIndent = this.columnOfItemValue(this.index, indent);
        this.lines[this.index] = ' '.repeat(childIndent) + rest;
        this.guardDepth(depth + 1, line);
        items.push(this.parseMapping(childIndent, depth + 1));
        continue;
      }

      this.index++;
      items.push(parseScalar(rest, line));
    }

    return items;
  }

  /** Where the value of `- value` starts, in columns. */
  private columnOfItemValue(index: number, indent: number): number {
    const after = (this.lines[index] ?? '').slice(indent + 1);
    return indent + 1 + (after.length - after.trimStart().length);
  }

  /** The value of a `key:` whose text after the colon is `rest`. */
  private parseValueAfterKey(
    rest: string,
    indent: number,
    depth: number,
    line: number
  ): YamlValue {
    if (rest.length === 0) return this.parseChildBlock(indent, depth);
    if (isBlockScalarHeader(rest)) return this.parseBlockScalar(rest, indent, line);
    return parseScalar(rest, line);
  }

  /**
   * The block indented under the line just consumed, or `null`.
   *
   * `null` rather than an empty mapping: `parameters:` with nothing under it
   * says there are no parameters, and inventing `{}` there would make an empty
   * declaration indistinguishable from one that declared an empty collection.
   */
  private parseChildBlock(indent: number, depth: number): YamlValue {
    this.skipIgnorable();
    if (this.index >= this.lines.length) return null;

    // Nothing is indented under that key, so it has no block. The cursor stays
    // on the next significant line, which is the caller's to read.
    const childIndent = this.indentOf(this.index);
    if (childIndent <= indent) return null;

    return this.parseNode(childIndent, depth + 1);
  }

  /**
   * A literal (`|`) or folded (`>`) block scalar.
   *
   * Read from the raw lines rather than the comment-stripped ones: inside a
   * block scalar a `#` is a `#`, and stripping it would silently truncate a
   * task description that mentions an issue number.
   */
  private parseBlockScalar(header: string, parentIndent: number, line: number): string {
    const style = header[0];
    const chomping = header.slice(1).trim();
    if (chomping !== '' && chomping !== '-' && chomping !== '+') {
      throw new YamlParseError(
        `Only '|', '|-', '|+', '>', '>-' and '>+' block scalars are supported; got '${header}'.`,
        line
      );
    }

    const raw: string[] = [];
    while (this.index < this.lines.length) {
      const current = this.lines[this.index];
      if (current.trim().length === 0) {
        raw.push('');
        this.index++;
        continue;
      }
      if (this.indentOf(this.index) <= parentIndent) break;
      raw.push(current);
      this.index++;
    }

    // Trailing blank lines belong to whatever follows the block, not to it —
    // except as the newlines `+` keeps, which are re-added by chomping below.
    while (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
    if (raw.length === 0) return '';

    const blockIndent = raw
      .filter(entry => entry.length > 0)
      .reduce((least, entry) => Math.min(least, entry.length - entry.trimStart().length), Infinity);
    const content = raw.map(entry => (entry.length === 0 ? '' : entry.slice(blockIndent)));

    const body =
      style === '|'
        ? content.join('\n')
        : // Folded: a single newline between two non-empty lines becomes a
          // space, a blank line stays a newline. More indented lines are kept
          // literally, which is what makes a code block inside `>` survive.
          content.reduce((folded, entry, position) => {
            if (position === 0) return entry;
            const previous = content[position - 1];
            const literal = entry.startsWith(' ') || previous.startsWith(' ');
            if (entry === '' || previous === '' || literal) return `${folded}\n${entry}`;
            return `${folded} ${entry}`;
          }, '');

    if (chomping === '-') return body.replace(/\n+$/, '');
    if (chomping === '+') return `${body}\n`;
    return `${body}\n`;
  }
}

// --- Scalars -----------------------------------------------------------------

/** Whether a value's text opens a block scalar. */
function isBlockScalarHeader(text: string): boolean {
  return text.startsWith('|') || text.startsWith('>');
}

/** Whether a sequence item's text is really the first entry of a mapping. */
function looksLikeMappingEntry(text: string): boolean {
  try {
    splitKey(text, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes a trailing comment, respecting quotes.
 *
 * A `#` only opens a comment at the start of a line or after whitespace, which
 * is what keeps `task: fix #42` and a URL fragment intact.
 */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let position = 0; position < line.length; position++) {
    const character = line[position];
    if (quote) {
      if (character === '\\' && quote === '"') {
        position++;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '#' && (position === 0 || /\s/.test(line[position - 1]))) {
      return line.slice(0, position);
    }
  }
  return line;
}

/** Refuses a key that would reach the object model rather than the document. */
function guardKey(key: string, line: number): void {
  if (REFUSED_KEYS.includes(key)) {
    throw new YamlParseError(`'${key}' is not usable as a key.`, line);
  }
}

/** Splits `key: value` into its two halves, or refuses the line. */
function splitKey(text: string, line: number): { key: string; rest: string } {
  let quote: string | null = null;

  for (let position = 0; position < text.length; position++) {
    const character = text[position];
    if (quote) {
      if (character === '\\' && quote === '"') {
        position++;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    // A colon ends a key only when a space or the end of the line follows it,
    // so `url: https://example.com` keeps its scheme.
    if (character === ':' && (position === text.length - 1 || text[position + 1] === ' ')) {
      const rawKey = text.slice(0, position).trim();
      if (rawKey.length === 0) {
        throw new YamlParseError('A mapping key cannot be empty.', line);
      }
      const key = unquote(rawKey, line);
      if (typeof key !== 'string') {
        throw new YamlParseError('A mapping key must be text.', line);
      }
      return { key, rest: text.slice(position + 1).trim() };
    }
  }

  throw new YamlParseError(`Expected 'key: value'; got '${truncate(text)}'.`, line);
}

/** A quoted scalar's text, or the input unchanged when it is not quoted. */
function unquote(text: string, line: number): string {
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return unescapeDoubleQuoted(text.slice(1, -1), line);
  }
  if (text.startsWith("'") || text.startsWith('"')) {
    throw new YamlParseError('Unterminated quoted string.', line);
  }
  return text;
}

/** The escapes a double-quoted scalar may use. Anything else is refused. */
function unescapeDoubleQuoted(text: string, line: number): string {
  let out = '';
  for (let position = 0; position < text.length; position++) {
    const character = text[position];
    if (character !== '\\') {
      out += character;
      continue;
    }
    const escaped = text[++position];
    switch (escaped) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case '"':
        out += '"';
        break;
      case '\\':
        out += '\\';
        break;
      case '/':
        out += '/';
        break;
      default:
        throw new YamlParseError(`Unsupported escape '\\${escaped ?? ''}'.`, line);
    }
  }
  return out;
}

/** One scalar, or a flow collection when the text opens one. */
export function parseScalar(text: string, line: number): YamlValue {
  const trimmed = text.trim();

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseFlow(trimmed, line);
  }

  const sigil = REFUSED_SIGILS[trimmed[0] ?? ''];
  if (sigil) {
    throw new YamlParseError(`Pipeline definitions may not use ${sigil}.`, line);
  }

  if (trimmed.startsWith("'") || trimmed.startsWith('"')) return unquote(trimmed, line);

  if (trimmed === '' || trimmed === '~' || /^null$/i.test(trimmed)) return null;
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  if (NUMBER_PATTERN.test(trimmed)) return Number(trimmed);

  return trimmed;
}

/** A flow sequence or flow mapping: `[a, b]`, `{ a: 1 }`, and nestings of them. */
function parseFlow(text: string, line: number): YamlValue {
  const scanner = { text, position: 0 };
  const value = readFlowValue(scanner, line, 0);
  skipFlowSpace(scanner);
  if (scanner.position < scanner.text.length) {
    throw new YamlParseError(`Unexpected '${scanner.text[scanner.position]}' in a flow value.`, line);
  }
  return value;
}

interface FlowScanner {
  text: string;
  position: number;
}

function skipFlowSpace(scanner: FlowScanner): void {
  while (scanner.position < scanner.text.length && /\s/.test(scanner.text[scanner.position])) {
    scanner.position++;
  }
}

function readFlowValue(scanner: FlowScanner, line: number, depth: number): YamlValue {
  if (depth > MAX_YAML_DEPTH) {
    throw new YamlParseError(`A flow value may nest at most ${MAX_YAML_DEPTH} levels deep.`, line);
  }
  skipFlowSpace(scanner);

  const opener = scanner.text[scanner.position];
  if (opener === '[') return readFlowSequence(scanner, line, depth);
  if (opener === '{') return readFlowMapping(scanner, line, depth);
  return parseScalar(readFlowScalarText(scanner, line), line);
}

function readFlowSequence(scanner: FlowScanner, line: number, depth: number): YamlValue[] {
  scanner.position++; // '['
  const items: YamlValue[] = [];

  for (;;) {
    skipFlowSpace(scanner);
    if (scanner.position >= scanner.text.length) {
      throw new YamlParseError('Unterminated flow sequence.', line);
    }
    if (scanner.text[scanner.position] === ']') {
      scanner.position++;
      return items;
    }
    if (items.length >= MAX_YAML_COLLECTION_ENTRIES) {
      throw new YamlParseError(
        `A list may hold at most ${MAX_YAML_COLLECTION_ENTRIES} entries.`,
        line
      );
    }

    items.push(readFlowValue(scanner, line, depth + 1));
    skipFlowSpace(scanner);
    const separator = scanner.text[scanner.position];
    if (separator === ',') {
      scanner.position++;
      continue;
    }
    if (separator !== ']') {
      throw new YamlParseError("Expected ',' or ']' in a flow sequence.", line);
    }
  }
}

function readFlowMapping(scanner: FlowScanner, line: number, depth: number): YamlMapping {
  scanner.position++; // '{'
  const mapping: YamlMapping = {};

  for (;;) {
    skipFlowSpace(scanner);
    if (scanner.position >= scanner.text.length) {
      throw new YamlParseError('Unterminated flow mapping.', line);
    }
    if (scanner.text[scanner.position] === '}') {
      scanner.position++;
      return mapping;
    }
    if (Object.keys(mapping).length >= MAX_YAML_COLLECTION_ENTRIES) {
      throw new YamlParseError(
        `A mapping may hold at most ${MAX_YAML_COLLECTION_ENTRIES} entries.`,
        line
      );
    }

    const key = readFlowScalarText(scanner, line, true);
    skipFlowSpace(scanner);
    if (scanner.text[scanner.position] !== ':') {
      throw new YamlParseError("Expected ':' in a flow mapping.", line);
    }
    scanner.position++;

    const value = readFlowValue(scanner, line, depth + 1);
    const name = unquote(key.trim(), line);
    guardKey(name, line);
    mapping[name] = value;

    skipFlowSpace(scanner);
    const separator = scanner.text[scanner.position];
    if (separator === ',') {
      scanner.position++;
      continue;
    }
    if (separator !== '}') {
      throw new YamlParseError("Expected ',' or '}' in a flow mapping.", line);
    }
  }
}

/** The text of one scalar inside a flow collection, quotes included. */
function readFlowScalarText(scanner: FlowScanner, line: number, isKey = false): string {
  skipFlowSpace(scanner);
  const start = scanner.position;
  const opener = scanner.text[scanner.position];

  if (opener === '"' || opener === "'") {
    scanner.position++;
    while (scanner.position < scanner.text.length) {
      const character = scanner.text[scanner.position];
      if (character === '\\' && opener === '"') {
        scanner.position += 2;
        continue;
      }
      scanner.position++;
      if (character === opener) return scanner.text.slice(start, scanner.position);
    }
    throw new YamlParseError('Unterminated quoted string.', line);
  }

  const stops = isKey ? ':,{}[]' : ',{}[]';
  while (
    scanner.position < scanner.text.length &&
    !stops.includes(scanner.text[scanner.position])
  ) {
    scanner.position++;
  }
  return scanner.text.slice(start, scanner.position);
}

function truncate(text: string, limit = 60): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
