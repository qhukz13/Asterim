# ADR-003: Device pairing is the only authentication at launch

**Status.** Accepted 2026-09-08.

**Context.** Two mechanisms existed: PIN pairing (used by the dashboard and the socket) and accounts with JWTs (used by nothing that worked: the portal never sent the token, sockets ignored JWTs, and the OAuth exchange accepted any code). The auth middleware also granted a full user to any unauthenticated request whenever `NODE_ENV` was not `production`, which is how the Core normally runs.

**Decision.** Pairing tokens authenticate everything. The middleware requires a token on every `/api/v1/` route on every interface; the development bypass needs an explicit flag and a loopback source. The OAuth exchange is removed. Account routes remain but are not linked from any UI, and the marketing portal is removed. Reviving accounts requires the list in `docs/architecture/authentication.md` § Modifying.

**Consequences.** No sign-up friction; no server-side user data; a LAN-safe default. The cost: no revocation of pairing tokens before expiry (P1-04), and no path to a hosted product until accounts are rebuilt properly.
