import { parseArgs } from './args';
import type { CliIo } from './context';
import { CliError, consoleIo } from './context';
import { commandDbMigrate, commandDbSnapshot, commandDbStatus } from './db';
import { commandDataBackup, commandDataClone, commandDataRestore } from './data';

/**
 * The `asterim` command line (P7-03).
 *
 * The binary has two jobs now: it is the Core, and it is the tool that operates
 * on the Core's database. Keeping them in one binary rather than shipping a
 * second one matters because the migrations are compiled into this build — a
 * separate CLI would have to be version-locked to the server it manages, and
 * the whole point of DEC-030's checksums is that the code and the database
 * agree about history.
 *
 * The split is made in `src/index.ts` before anything server-shaped is loaded,
 * so a CLI invocation never constructs Fastify, never opens a socket, and never
 * reaches `initLogger()` — which redirects stdout into `server.log` and would
 * otherwise send this module's entire output to a file instead of the terminal.
 */

/** Every subcommand, with the one-line summary `--help` prints. */
export const CLI_COMMANDS: Record<string, { usage: string; summary: string }> = {
  'db:status': {
    usage: 'db:status [--channel <stable|dev>]',
    summary: 'Show schema version, migration history and snapshots.'
  },
  'db:migrate': {
    usage: 'db:migrate [--dry-run] [--channel <stable|dev>]',
    summary: 'Apply pending migrations, snapshotting the database first.'
  },
  'db:snapshot': {
    usage: 'db:snapshot [--keep <count>] [--channel <stable|dev>]',
    summary: 'Take a snapshot now and prune older ones (default keep: 10).'
  },
  'data:clone': {
    usage: 'data:clone --from <channel> --to <channel> [--force]',
    summary: "Copy one channel's database onto another channel."
  },
  'data:backup': {
    usage: 'data:backup [--out <path>] [--channel <stable|dev>]',
    summary: 'Write a standalone copy of the database.'
  },
  'data:restore': {
    usage: 'data:restore --file <path> [--force] [--channel <stable|dev>]',
    summary: 'Replace the database with a backup, keeping a safety copy.'
  }
};

const HELP_COMMANDS = new Set(['help', '--help', '-h']);

/**
 * `true` when this argv is asking for a command rather than for a server.
 *
 * Namespaced prefixes rather than an exact match against `CLI_COMMANDS`, so a
 * misspelled `db:staus` is answered with "unknown command" instead of silently
 * booting the Core and listening on a port — which is the failure mode that
 * would actually cost someone an afternoon.
 */
export function isCliInvocation(argv: string[]): boolean {
  const first = argv.find(token => token.length > 0);
  if (first === undefined) return false;
  if (HELP_COMMANDS.has(first)) return true;
  return first.startsWith('db:') || first.startsWith('data:');
}

/** The `--help` screen. */
export function printHelp(io: CliIo): void {
  io.out('Asterim — local-first AI agent workstation');
  io.out('');
  io.out('Usage');
  io.out('  asterim                          Start the Core (HTTP + WebSocket).');
  io.out('  asterim <command> [options]      Run a database or data command and exit.');
  io.out('');
  io.out('Commands');
  for (const { usage, summary } of Object.values(CLI_COMMANDS)) {
    io.out(`  ${usage}`);
    io.out(`      ${summary}`);
  }
  io.out('');
  io.out('Common options');
  io.out('  --channel <stable|dev>           Which channel to act on. Defaults to');
  io.out('                                   ASTERIM_CHANNEL, then NODE_ENV, then stable.');
  io.out('  --help, -h                       Show this help.');
  io.out('');
  io.out('Notes');
  io.out('  Every file these commands write is owner-only (0600) inside the channel data');
  io.out('  directory, except where --out names somewhere else. Anything that replaces a');
  io.out('  database copies it to asterim.db.bak.<timestamp> first.');
}

/**
 * Runs one command and returns the process exit code.
 *
 * Synchronous throughout: nothing here waits on the network, and returning a
 * code rather than calling `process.exit` is what lets the test suite exercise
 * every command in-process.
 */
export function runCli(argv: string[], io: CliIo = consoleIo): number {
  const args = parseArgs(argv);

  if (args.flags.help === true || HELP_COMMANDS.has(args.command) || args.command === '') {
    printHelp(io);
    return 0;
  }

  try {
    switch (args.command) {
      case 'db:status':
        return commandDbStatus(args, io);
      case 'db:migrate':
        return commandDbMigrate(args, io);
      case 'db:snapshot':
        return commandDbSnapshot(args, io);
      case 'data:clone':
        return commandDataClone(args, io);
      case 'data:backup':
        return commandDataBackup(args, io);
      case 'data:restore':
        return commandDataRestore(args, io);
      default:
        io.err(`Unknown command: ${args.command}`);
        io.err('');
        // On the failure path the help is diagnostic output, so it goes to
        // stderr with the error — a shell pipeline reading this command's stdout
        // should get nothing rather than a help screen it will try to parse.
        printHelp({ out: io.err, err: io.err });
        return 1;
    }
  } catch (err) {
    if (err instanceof CliError) {
      io.err(`Error: ${err.message}`);
      return 1;
    }
    // Anything else is a bug or a broken database, and the operator needs the
    // stack to tell one from the other.
    io.err(`Error: ${(err as Error).message}`);
    if ((err as Error).stack) io.err((err as Error).stack as string);
    return 1;
  }
}

export { CliError, consoleIo } from './context';
export type { CliIo } from './context';
export { pruneSnapshots, listSnapshots } from './snapshots';
