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
  if (process.env.ASTERIM_SOVEREIGN_MODE === 'true' || process.argv.includes('--sovereign')) {
    return true;
  }
  return policyHook ? safePolicyHook() : false;
}

/**
 * A second way to switch the air gap on: an enterprise fleet policy that
 * mandates it (P10-01).
 *
 * Inverted rather than imported, for the same reason the EventBus does not
 * import the vault: this module is pulled in by `AiService`, `PushService` and
 * `RelayClient`, and a direct dependency on the policy engine would drag the
 * database open behind every one of them, in tests that have no database.
 * Registered once at startup; unregistered by passing `null`.
 */
let policyHook: (() => boolean) | null = null;

export function registerSovereignPolicyHook(fn: (() => boolean) | null): void {
  policyHook = fn;
}

/**
 * A hook that throws must not be able to decide the air gap is off — nor to
 * take down the subsystem that asked. It is treated as no answer, which is what
 * the switch meant before a policy existed.
 */
function safePolicyHook(): boolean {
  try {
    return policyHook?.() === true;
  } catch (err) {
    console.warn(`[SovereignMode] Fleet policy could not be consulted: ${(err as Error).message}`);
    return false;
  }
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
