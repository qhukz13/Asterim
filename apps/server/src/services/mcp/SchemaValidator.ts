/**
 * Argument validation against a tool's published `inputSchema`.
 *
 * MCP tools describe their inputs with JSON Schema. This checks arguments
 * against that description *before* they cross the pipe, so an agent that
 * forgets a required field is told which field, rather than receiving whatever
 * a third-party server chooses to say about it — often nothing useful, and
 * sometimes nothing at all.
 *
 * It is a deliberate subset: types, `required`, `properties`, `enum`, `items`,
 * and nested objects. Anything it does not understand (`$ref`, `oneOf`,
 * `patternProperties`, …) is *ignored rather than rejected*. A validator that
 * fails closed on schema features it has not implemented would block working
 * tools, which is a worse failure than passing an argument through to a server
 * that would have caught it anyway.
 *
 * It never throws. A malformed or self-referential schema yields `valid: true`
 * with the reason logged, because a broken schema is the server author's bug
 * and must not become an Asterim crash (P6-04 §6).
 */

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/** JSON Schema types this validator understands. */
type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  [key: string]: unknown;
}

/** How deep nesting may go before the schema is assumed to be cyclic. */
export const MAX_SCHEMA_DEPTH = 12;

function typeOf(value: unknown): JsonSchemaType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  return 'object';
}

/** True when `value` satisfies one declared type. */
function matchesType(value: unknown, expected: JsonSchemaType): boolean {
  const actual = typeOf(value);
  // Every integer is a number; the reverse is not true.
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'object') return actual === 'object';
  return actual === expected;
}

function describe(value: unknown): string {
  const actual = typeOf(value);
  return value === undefined ? 'undefined' : actual;
}

/**
 * Validates one value against one schema, collecting every problem rather than
 * stopping at the first: an agent fixing its arguments should learn about all
 * of them in one round trip.
 */
function validateValue(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: string[],
  depth: number,
  seen: Set<JsonSchema>
): void {
  if (depth > MAX_SCHEMA_DEPTH || seen.has(schema)) {
    // A cycle, or a schema deeper than anything a tool call reasonably needs.
    // Stop descending rather than recursing forever.
    return;
  }

  const nested = new Set(seen);
  nested.add(schema);

  if (schema.type) {
    const allowed = (Array.isArray(schema.type) ? schema.type : [schema.type]).filter(
      candidate => typeof candidate === 'string'
    );
    if (allowed.length > 0 && !allowed.some(candidate => matchesType(value, candidate))) {
      errors.push(`${path}: expected ${allowed.join(' or ')}, received ${describe(value)}`);
      // The value is the wrong shape; descending into it would only produce
      // noise about members it was never going to have.
      return;
    }
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const permitted = schema.enum.some(candidate => candidate === value);
    if (!permitted) {
      errors.push(
        `${path}: must be one of ${schema.enum.map(entry => JSON.stringify(entry)).join(', ')}`
      );
    }
  }

  if (typeOf(value) === 'object' && schema.properties) {
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(schema.properties)) {
      if (!child || typeof child !== 'object') continue;
      if (record[key] === undefined) continue;
      validateValue(record[key], child as JsonSchema, `${path}.${key}`, errors, depth + 1, nested);
    }
  }

  if (typeOf(value) === 'object' && Array.isArray(schema.required)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required) {
      if (typeof key !== 'string') continue;
      if (record[key] === undefined) {
        errors.push(`${path}.${key}: required`);
      }
    }
  }

  if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    value.forEach((entry, index) => {
      validateValue(
        entry,
        schema.items as JsonSchema,
        `${path}[${index}]`,
        errors,
        depth + 1,
        nested
      );
    });
  }
}

/**
 * Checks tool arguments against a tool's input schema.
 *
 * A tool with no schema — or one whose schema is not an object — accepts
 * anything: the server published no contract, so there is none to enforce.
 */
export function validateToolArguments(
  args: Record<string, unknown> | undefined,
  schema: Record<string, unknown> | undefined,
  toolName = 'arguments'
): ValidationResult {
  try {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return { valid: true };
    }

    const errors: string[] = [];
    validateValue(args ?? {}, schema as JsonSchema, toolName, errors, 0, new Set());

    return errors.length === 0 ? { valid: true } : { valid: false, errors };
  } catch (err) {
    // A schema this validator cannot survive is the server author's problem,
    // not a reason to fail the call or take the process down.
    console.warn(
      `[MCP] Could not validate arguments for '${toolName}': ${(err as Error).message}. Passing them through.`
    );
    return { valid: true };
  }
}
