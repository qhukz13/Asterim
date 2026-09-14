/**
 * Whether the account system is reachable at all.
 *
 * WHAT: one predicate, read by the auth routes and by `authMiddleware`.
 *
 * WHY: Asterim's authentication is a device pairing PIN (ADR-003). The account
 * system — register, login, refresh, JWTs, entitlements — belongs to the frozen
 * cloud subsystems and is not part of the MVP, but it shipped in the same
 * binary with its endpoints on the public allow-list. On 2026-09-09 that was
 * verified live against the packaged build: anyone on the LAN could POST to
 * `/api/v1/auth/register` with any address and password, receive a JWT,
 * read the operator's projects, and register an MCP server with an arbitrary
 * command — which is remote code execution, past the PIN, with no interaction
 * from the operator at all. The same shape as S1 in the security audit,
 * through a different door.
 *
 * CONTRACT: off unless `ASTERIM_ENABLE_ACCOUNTS=true`. When off, the account
 * endpoints answer 404 and account JWTs are not accepted anywhere; pairing
 * tokens are unaffected, so the dashboard is untouched. Sovereign mode forces
 * it off regardless, because an account system that talks to nothing is still
 * a login form on the LAN.
 *
 * DO NOT: default this to on, or add a second way to switch it on. If accounts
 * ever ship, they need rate limiting, address verification and a password
 * reset first (`docs/audit/security-audit.md`, S5) — not a flag flip.
 */
import { isSovereignMode } from './SovereignMode';

export function accountsEnabled(): boolean {
  if (isSovereignMode()) return false;
  return process.env.ASTERIM_ENABLE_ACCOUNTS === 'true';
}

/** The reply for a request to an account endpoint that is not enabled. */
export const ACCOUNTS_DISABLED_BODY = {
  error:
    'Accounts are not enabled on this workstation. Asterim pairs a browser with the six-digit PIN printed at startup.'
};
