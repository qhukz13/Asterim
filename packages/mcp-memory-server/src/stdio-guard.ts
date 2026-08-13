/**
 * Stdio protocol guard.
 *
 * MCP stdio transport reserves `process.stdout` exclusively for JSON-RPC message
 * frames. A single stray byte on stdout corrupts the frame the client is parsing
 * and the connection is dropped.
 *
 * This is not hypothetical in Asterim: `DatabaseService` writes
 * `[Database] Using database at: …` to `console.log` from inside its singleton
 * constructor — that is, as a side effect of *importing* the module, before any
 * server code runs (see docs/p5.1-01-audit-report.md § 4).
 *
 * Rebinding the whole console — rather than patching `console.log` alone —
 * covers `info`, `debug`, `dir`, `table` and `group`, which Node also routes to
 * stdout, so no present or future log line in any imported module can reach the
 * protocol stream.
 *
 * ORDER MATTERS. This module must be the FIRST import in the entrypoint. Imports
 * hoist, but they execute in source order, so a guard listed first runs first.
 * Installing it after the service imports is measurably too late.
 */
globalThis.console = new console.Console(process.stderr, process.stderr);

export {};
