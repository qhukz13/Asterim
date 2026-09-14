# Authentication

## WHAT

Two mechanisms coexist. **Device pairing** is the product's authentication: a six-digit PIN printed by the Core at start, exchanged for an HMAC-signed 30-day token that every REST call and the Socket.IO handshake carry. **Accounts** (register/login/JWT/refresh cookie) exist in the Core but are not used by the dashboard and not exposed at launch.

## WHY

A local tool on a LAN needs something a phone can type once, that survives restarts, and that never requires an internet account. Accounts were built for a hosted SaaS that does not exist.

## WHERE

| Piece | Path |
| --- | --- |
| PIN, token mint/verify, brute-force lockout | `apps/server/src/services/PairingService.ts` |
| Pair route | `apps/server/src/routes/auth.ts` (`POST /api/v1/auth/pair`) |
| Middleware (Bearer pairing token or JWT; allow-list; loopback dev bypass) | `apps/server/src/middleware/authMiddleware.ts` |
| Socket handshake | `apps/server/src/sockets/socketManager.ts` (`setupMiddleware`) |
| Dashboard side | `apps/web/src/hooks/useAuth.ts`, `src/utils/auth.ts`, `src/PinScreen.tsx` |
| Accounts (dormant) | `controllers/AuthController.ts`, `services/TokenService.ts`, `services/PasswordService.ts`, routes `sessions`, `devices`, `apikeys` |
| Tests | `services/__tests__/PairingService.test.ts`, the 401 checks in `FleetGovernance.test.ts` and `internal.test.ts` |

## HOW

1. Start: `PairingService` generates a PIN (console, `pairing_pin.txt`, QR) and a per-install HMAC secret kept in the vault.
2. `POST /api/v1/auth/pair {pin}` from any address: 5 failures → 15-minute lockout per IP with exponential back-off. Success → token `base64(payload).hmac`.
3. The dashboard stores the token under `asterim_token_<origin>` and sends `Authorization: Bearer` on REST and `auth.token` on the socket.
4. `authMiddleware` accepts a valid pairing token or a valid account JWT; otherwise 401. Public: `/auth/pair`, `/auth/login`, `/auth/register`, `/auth/refresh`, `/webhooks/stripe`, `/health`.
5. Dev only: with `ASTERIM_DEV_AUTH_BYPASS=true`, `NODE_ENV !== production`, and a loopback source address, an unauthenticated request acts as the local developer user. Tests set this at the top of each suite.

## CONTRACT

- No route under `/api/v1/` other than the list above answers without a token, on any interface.
- The dev bypass can never apply to a non-loopback address.
- `/api/v1/auth/oauth/token` no longer exists (it accepted any code; security audit S2).
- Tokens are not revocable before expiry today (P1-04).

## MODIFYING

- Adding a public route requires editing the allow-list in `authMiddleware.ts` and a line in `docs/audit/security-audit.md` explaining why.
- Reviving accounts requires: the portal sending the access token, rate limits on login/register, e-mail verification, password reset, `Secure` on the refresh cookie, and entitlements re-read from the database instead of the JWT.

## DO NOT

- Do not read `NODE_ENV` alone to decide auth behaviour.
- Do not put the PIN or a token in logs.
- Do not accept the pairing token from a query string on REST routes (only the one-time `?pin=` convenience on the pairing screen exists).
