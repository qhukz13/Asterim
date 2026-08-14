/**
 * The air-gap switch (DEC-028).
 *
 * When enabled, Asterim opens no outbound network connection of its own: no cloud
 * relay socket, no push gateway request, no remote LLM call. It does not restrict
 * what the *user* explicitly asks for — a `git fetch` is still a `git fetch` —
 * because the mandate is about what the product does on its own initiative.
 *
 * Read from the environment on every call rather than cached at import time.
 * Callers include module-scope singletons whose construction order is not
 * something this switch should depend on, and a test that sets the variable must
 * see it take effect.
 */
export function isSovereignMode(): boolean {
  return process.env.ASTERIM_SOVEREIGN_MODE === 'true' || process.argv.includes('--sovereign');
}

/**
 * Logs once per subsystem that it has been disabled, so the reason a feature is
 * silent is visible in the console rather than inferred.
 */
const announced = new Set<string>();

export function announceSovereignBlock(subsystem: string, message: string): void {
  if (announced.has(subsystem)) return;
  announced.add(subsystem);
  console.log(`[${subsystem}] Sovereign Mode active: ${message}`);
}

/** Test seam: forget which subsystems have announced. */
export function resetSovereignAnnouncements(): void {
  announced.clear();
}
