/**
 * The whole of Asterim's command-line argument parsing (P7-03).
 *
 * Deliberately not a dependency. `commander`/`yargs` would each pull a tree of
 * packages into a binary whose entire CLI surface is six subcommands and five
 * options, and every one of those packages is code that ships next to the
 * operator's database. The grammar below is the one the DEC-030 tooling
 * actually uses and nothing more.
 */

/** A parsed command line: the subcommand, its options, and anything left over. */
export interface ParsedArgs {
  /** The subcommand, e.g. `db:status`. Empty when the line was only options. */
  command: string;
  /** `--name value`, `--name=value` and bare `--name` (as `true`). */
  flags: Record<string, string | boolean>;
  /** Tokens that were neither the command nor part of an option. */
  positionals: string[];
}

/**
 * Options that never take a value.
 *
 * Without this list `data:restore --force --file backup.db` would read `--file`
 * as the value of `--force`, because the "does the next token look like a
 * value" heuristic cannot tell an option name from a value that starts with a
 * dash. Naming the three that exist is cheaper than making the heuristic clever.
 */
const BOOLEAN_FLAGS = new Set(['dry-run', 'force', 'help', 'h']);

/**
 * `true` when a token can be the value of the option before it.
 *
 * A leading dash usually means "this is the next option", but not always: `-2`
 * is what someone types after `--keep`, and reading it as an option would make
 * `--keep -2` silently fall back to the default retention instead of being
 * rejected as the nonsense it is. So a negative number counts as a value, and
 * is left to the command to validate.
 */
function looksLikeValue(token: string): boolean {
  return !token.startsWith('-') || /^-\d/.test(token);
}

/** Splits `process.argv.slice(2)` into a command, its options and its leftovers. */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let command = '';

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];

    if (token === '--help' || token === '-h') {
      flags.help = true;
      continue;
    }

    if (token.startsWith('--')) {
      const body = token.slice(2);
      const equals = body.indexOf('=');
      if (equals !== -1) {
        flags[body.slice(0, equals)] = body.slice(equals + 1);
        continue;
      }
      const next = argv[index + 1];
      if (BOOLEAN_FLAGS.has(body) || next === undefined || !looksLikeValue(next)) {
        flags[body] = true;
      } else {
        flags[body] = next;
        index++;
      }
      continue;
    }

    if (!command) {
      command = token;
      continue;
    }
    positionals.push(token);
  }

  return { command, flags, positionals };
}

/**
 * The value of a `--name` option, or `undefined` when it was absent.
 *
 * Two things read as absent rather than as a value. A bare `--name` returns
 * `undefined` rather than `"true"`, because an option declared to take a path
 * was not given one and a file called `true` is not what anyone meant. So does
 * an empty `--name=`, which is what a shell produces from an unset variable —
 * `--out=$BACKUP_DIR` with nothing in `BACKUP_DIR`. Every command here treats a
 * missing option as either its documented default or an error, and both are
 * better than `--keep=` being read as zero and pruning every snapshot.
 */
export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (typeof value !== 'string') return undefined;
  return value.trim().length > 0 ? value : undefined;
}

/** `true` only for a bare `--name`, `--name=true` or `--name true`. */
export function booleanFlag(args: ParsedArgs, name: string): boolean {
  const value = args.flags[name];
  return value === true || value === 'true';
}
