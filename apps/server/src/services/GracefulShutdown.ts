import { FastifyInstance } from 'fastify';
import { dbService } from './DatabaseService';
import { serverRegistry } from './ServerRegistry';
import { mcpProcessSupervisor } from './mcp/McpProcessSupervisor';

/**
 * The Core's single shutdown owner.
 *
 * Before this, three subsystems each had an opinion about process exit and the
 * first one to call `process.exit()` won — which meant asynchronous cleanup
 * registered by anything else silently never ran. Everything that has to happen
 * when Asterim stops happens here, in one order:
 *
 *   1. stop accepting requests (`fastify.close()`, which fires `onClose` hooks)
 *   2. stop the supervised MCP children
 *   3. remove the loopback descriptor, so no other process dials a dead port
 *   4. close SQLite, so the WAL is checkpointed rather than abandoned
 *
 * A second signal, or a step that hangs, must not leave the process wedged, so
 * the whole sequence is bounded and a repeat signal exits immediately.
 */

/** How long the ordered sequence may take before the process exits anyway. */
export const SHUTDOWN_TIMEOUT_MS = 10000;

let shuttingDown = false;
let installed = false;

export async function runShutdownSequence(fastify: FastifyInstance, reason: string): Promise<void> {
  console.log(`[Shutdown] ${reason}: closing Asterim`);

  const step = async (label: string, action: () => Promise<void> | void): Promise<void> => {
    try {
      await action();
    } catch (err) {
      // One failed step must not strand the others; a half-closed Core is
      // worse than a noisy log line.
      console.error(`[Shutdown] ${label} failed: ${(err as Error).message}`);
    }
  };

  await step('closing HTTP server', () => fastify.close());
  await step('stopping MCP servers', () => mcpProcessSupervisor.shutdownAll());
  await step('removing loopback descriptor', () => serverRegistry.clear());
  await step('closing database', () => dbService.close());

  console.log('[Shutdown] Complete');
}

/**
 * Traps the signals a process actually receives — `SIGINT` from a terminal,
 * `SIGTERM` from an orchestrator — and runs the sequence once.
 *
 * A synchronous `exit` handler remains as a backstop for the paths no handler
 * can await: an uncaught exception, or a `process.exit()` from elsewhere.
 */
export function setupGracefulShutdown(fastify: FastifyInstance): void {
  if (installed) return;
  installed = true;

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (shuttingDown) {
        console.warn(`[Shutdown] Second ${signal}; exiting now`);
        process.exit(1);
      }
      shuttingDown = true;

      const forceExit = setTimeout(() => {
        console.error(`[Shutdown] Timed out after ${SHUTDOWN_TIMEOUT_MS}ms; exiting anyway`);
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceExit.unref?.();

      void runShutdownSequence(fastify, signal)
        .catch(err => console.error('[Shutdown] Failed:', err))
        .finally(() => {
          clearTimeout(forceExit);
          process.exit(0);
        });
    });
  }

  // Whatever else happens, the descriptor must not outlive the process: a stale
  // one costs every MCP write a connection attempt to a port nothing answers.
  process.on('exit', () => {
    try {
      serverRegistry.clear();
    } catch {
      // Nothing useful can be done from an exit handler.
    }
  });
}

/** Test seam: forget that the sequence was installed or has begun. */
export function resetShutdownStateForTests(): void {
  installed = false;
  shuttingDown = false;
}
