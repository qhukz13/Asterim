/**
 * The `asterim` entrypoint: one binary, two jobs (P7-03).
 *
 * With a subcommand on the command line this process is a tool — it operates on
 * the channel's database, prints to the terminal, and exits. With nothing on the
 * command line it is the Core, and `./server` boots exactly as it always has.
 *
 * The order here is the whole design. `src/server.ts` constructs Fastify, opens
 * the database, starts the socket manager and redirects stdout into
 * `server.log`, all at import time; ES module imports are hoisted, so a check
 * *after* importing it would run long after all of that had happened. So the
 * boot path is reached through a lazy `require` that a CLI invocation never
 * executes, which is what makes "`asterim db:status` does not start a server"
 * a structural property rather than something to remember.
 *
 * `require`, not `await import`: this file is bundled to CommonJS by tsup, and a
 * plain synchronous require keeps the server's startup as the first thing that
 * happens on the boot path rather than something deferred to a microtask.
 */

import { isCliInvocation, runCli } from './cli';

const argv = process.argv.slice(2);

if (isCliInvocation(argv)) {
  process.exit(runCli(argv));
} else {
  require('./server');
}
