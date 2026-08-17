Task-ID: P9-03
Status: COMPLETE

# Execution Report: P9-03 — Workspace Secrets Management UI & Workstation Security Status Dashboard

**Task ID:** P9-03
**Phase:** Phase 9 — Enterprise Hardening, Desktop Shell & Production Release
**Status:** VERIFIED
**Date:** 2026-08-17
**Author:** Claude Code

---

## 1. Summary

The vault and the environment-secret API built in P9-01 / P9-02 now have the operator-facing surface they
were built for. Environment Settings → **Secrets & Credentials** no longer renders three hardcoded password
fields; it lists what the Core actually holds — key name, mask, presence, date — and lets an operator add,
rotate and delete credentials, with a **Workstation Security** card underneath rendering
`GET /api/v1/security/vault-status`.

The design follows from what the API can and cannot do. `GET` never decrypts, so the panel has no reveal
control and no copy button: there is nothing to reveal. A credential travels one direction only, and the
one place a plaintext exists in the browser is the value field the operator typed it into — which is
**uncontrolled**, so the credential never enters React state and never appears in the rendered tree. It is
read once on submit, the field is cleared *before* the request is awaited, and the store holds no copy at
any point.

One thing the task did not name turned out to be required by `CLAUDE.md` and is included: the mask, the key
rules and the masked/status shapes now live once in `@asterim/shared` (`types/security.ts`), imported by
both the Core and the dashboard. Restating them in `apps/web` is the explicit anti-pattern the repo forbids,
and it would have let the client's idea of a valid key drift from the Core's. The server files keep their
existing export names by re-exporting, so no call site in the Core changed.

**Two contract discrepancies in the task brief were resolved in favour of the running code** (§ 7).

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `packages/shared/src/types/security.ts` | Created | The credential contract in one place: `SECRET_MASK`, `SECRET_KEY_PATTERN`, `PROTECTED_SECRET_KEYS`, `isProtectedSecretKey`, `isValidSecretKeyFormat`, `EnvironmentSecretSummary`, `EnvironmentSecretStatus`, `EnvironmentSecretErrorCode`, `VaultStatus`, `VaultStatusResponse`, `EnvironmentSecretsResponse` |
| `apps/web/src/stores/useSecretStore.ts` | Created | Secrets per environment + vault status: `fetchSecrets`, `setSecret`, `deleteSecret`, `fetchVaultStatus`, plus the pure helpers `validateSecretKey`, `isMaskPlaceholder`, `describeSecretError`, `secretsFor` |
| `apps/web/src/components/environment/EnvironmentSecretsPanel.tsx` | Created | The list, the add/rotate form and the delete confirmation; props-only `EnvironmentSecretsPanelView` plus the connected container |
| `apps/web/src/components/security/SecurityStatusCard.tsx` | Created | The vault health card; pure `vaultHealthOf`, props-only `SecurityStatusCardView`, connected `SecurityStatusCard` |
| `apps/web/src/components/environment/__tests__/EnvironmentSecretsUI.test.ts` | Created | 203-assertion suite: key rules, error mapping, health verdicts, the store against a recording `fetch`, static render, and the literal bodies a running Core returned |
| `apps/web/src/components/environment/EnvironmentSettingsView.tsx` | Modified | The mock secrets section (three hardcoded fields, `#131b2e` hex) replaced by the real panel, keyed on the environment id |
| `apps/server/src/services/security/EnvironmentSecretService.ts` | Modified | Imports the mask / key rules / shapes from `@asterim/shared` and re-exports them under the same names; local duplicates removed |
| `apps/server/src/services/security/SecretVaultService.ts` | Modified | `VaultStatus` imported from `@asterim/shared` and re-exported |
| `packages/shared/src/index.ts` | Modified | Exports `./types/security` |
| `apps/web/package.json` | Modified | New suite wired into `"test"` (now 9 web suites) |

## 3. Implementation Details

**Zero plaintext, structurally rather than by discipline.** The store has no state field that could hold a
value: `secretsByEnvironment` holds only the masked summaries the Core returns, and the credential passed to
`setSecret` is an argument that lives for one request. The panel's value field is uncontrolled — a
controlled password input would have put the plaintext in React state and, through it, into the rendered
tree as a `value` attribute, which is exactly what the first run of this suite caught (§ 7.1). React tracks
only whether the field is non-empty; the plaintext exists solely in the DOM node the operator typed it into.
On submit the value is read from a ref, the field is cleared, and only then is the POST awaited — so nothing
that renders during the request, or after a failure, holds it.

**Validation runs twice, deliberately.** `validateSecretKey` checks the POSIX pattern and the protected-name
list before the request, purely so the operator gets an answer without a round trip; the Core checks the
same shared constants on arrival and its verdict is the one that counts. The wording names the actual rule —
"a key must start with a letter or underscore", "`PATH` decides what the agent process *is*" — because
"invalid" does not tell an operator what to change. `describeSecretError` branches on the Core's error
*code*, never on message text.

**Rotation is not a second mode.** The Core upserts, so typing an existing key replaces its value and keeps
its `created_at`; the store replaces the row in place rather than appending, so the list does not reorder
under the operator. Re-submitting the mask is caught client-side before it can be sent (the Core refuses it
too — belt and braces, because a form that round-trips what it displayed is how P9-02's `ai_api_key` nearly
got overwritten).

**Deletion asks first.** The value is gone, not archived, so the row's Remove button arms an in-place
confirmation rather than acting on the first click. A 404 leaves the row alone rather than optimistically
removing it.

**Health is the Core's verdict, not the card's.** `vaultHealthOf` orders the failures by what an operator can
do about them: key-underivable (red) outranks unreadable envelopes, which outrank plaintext-on-disk, which
outranks a bare unhealthy flag. Unreadable is ranked above plaintext because plaintext is fixed by the next
Core start and unreadable is not — it means a database from another machine, which is invisible everywhere
else in the product until an agent session fails to authenticate.

**Store scoping.** Secrets are keyed by environment id, not held for one "active" environment: the settings
view can be open on one environment while the workspace switcher moves to another, and a single list would
briefly show one environment's key names under another's name. `secretsFor` returns one shared frozen-empty
reference so a zustand selector on an environment with no secrets does not re-render without end.

## 4. Verification

Everything below was run in this session. There is still no test runner in the repo; "test" means the
standalone assertion scripts, and the CI gates are typecheck / lint / test / build.

| Gate | Command | Result |
| :--- | :--- | :--- |
| New suite | `pnpm --filter @asterim/web exec tsx src/components/environment/__tests__/EnvironmentSecretsUI.test.ts` | **203/203 assertions passed** |
| Web suites | `pnpm --filter @asterim/web run test` | **9/9 suites pass** (151, 37, 134, 113, 104, 85, 134, 686, 203) |
| Server suites (regression on the shared-types move) | `pnpm --filter asterim run test` | **23/23 suites pass**, 0 failures — including `SecretVaultService` **133/133** and `EnvironmentSecretService` **181/181** |
| Adapters / Relay / MCP memory | `pnpm --filter … run test` | **29/29**, **71/71 + 28/28 + 23/23**, **24/24** |
| Typecheck | `tsc --noEmit` in `@asterim/web`, `asterim`, `@asterim/shared`, `@asterim/adapters`, `@asterim/marketing`, `@asterim/relay`, `@asterim/mcp-memory-server` | clean, **0 errors** |
| Lint | `eslint` in all seven workspaces | **0 errors** (warnings: web 304 — was 302, +2 `react-refresh/only-export-components` on the two new component files, the same warning every existing view file with an exported helper carries; server 298, adapters 28, marketing 18, shared 3, mcp 12, relay 0 — all unchanged) |
| Build | `@asterim/shared`, `@asterim/adapters`, `@asterim/web`, `asterim`, `@asterim/marketing`, `@asterim/relay`, `@asterim/mcp-memory-server` | all succeed (`asterim` → `dist/index.js` 956.40 KB after the web build) |

The root `pnpm run build` (turbo) form was blocked by this session's command sandbox, so each workspace was
built individually — same tasks, same tools, one process per package instead of turbo's fan-out. There is no
root `typecheck` or `test` script in `package.json`; those gates are per-workspace by construction.

**Live contract capture.** The sandbox blocked booting a listening server this session, so the Core's real
routes were driven in-process instead, through Fastify's own `inject()` against a seeded database with the
production `SecretVaultService` (100,000 PBKDF2 rounds, real salt file in a temp data dir) — the same
mechanism the server suites use, minus the socket:

```
POST   /api/v1/environments/env_shape/secrets  → 201 {"success":true,"secret":{"key":"DEPLOY_TOKEN","maskedValue":"••••••••","isSet":true,"createdAt":1786976800132}}
POST   {key:"PATH"}                            → 400 {"error":"'PATH' controls how the agent process itself is launched and cannot be stored as a secret.","code":"PROTECTED_SECRET_KEY_ERROR"}
GET    /api/v1/environments/env_shape/secrets  → 200 {"secrets":[{…,"maskedValue":"••••••••",…}],"mask":"••••••••"}
       listing contains the stored credential: false
GET    /api/v1/security/vault-status           → 200 {"vault":{"ready":true,"algorithm":"AES-256-GCM","keyDerivation":"PBKDF2-HMAC-SHA512","iterations":100000,…,"environmentSecrets":{"total":1,"encrypted":1,"plaintext":0,"unreadable":0,"environments":1,"migrationComplete":true}},"healthy":true}
DELETE /api/v1/environments/env_shape/secrets/DEPLOY_TOKEN → 200 {"success":true}, again → 404 {"error":"Secret not found"}
```

Those exact bodies are now **in the suite** (`the literal bodies a running Core returned`), parsed by the
store and rendered by both views, so a change to the Core's shape that this dashboard would misread fails in
CI rather than in a browser.

**Rendered output** (tag-stripped `renderToStaticMarkup` of both views fed the bodies above):

```
=== PANEL ===
Credentials stored for Client Sandbox are encrypted at rest with the workstation vault and handed only to
agent sessions started in this environment. They are never returned to this dashboard, so a stored value
cannot be displayed again — only replaced.
DEPLOY_TOKEN / •••••••• / Encrypted / Added 2026-08-17 / Remove
Add or rotate a secret — Reusing an existing key rotates it in place. …
Secret key | Secret value | Show | Store secret
The value is cleared from this form the moment it is submitted and is never held by the dashboard.

=== CARD ===
Workstation Security | Refresh
Vault active & healthy — Every managed credential on this workstation is encrypted at rest and readable by
this machine only.
Cipher AES-256-GCM (PBKDF2-HMAC-SHA512, 100,000 rounds) · Key derivation salt Present · System credentials
0 encrypted (0 plaintext · 0 unreadable · 5 managed keys) · Environment secrets 1 encrypted (1 total across
1 environment · 0 unreadable) · Migration Complete · Output redaction 1 value
```

No browser screenshots: driving Puppeteer needs a live server on a port, which the sandbox blocked this
session. The views are pure functions of their props and are rendered and asserted directly instead.

## 5. Acceptance Criteria Review

- [x] **1. Masked Secrets Display** — the Secrets tab renders `EnvironmentSecretsPanel`, which fetches
  `GET /api/v1/environments/:id/secrets` on mount and re-fetches when the environment changes. Each row is
  the key in JetBrains Mono, the `••••••••` badge, an Encrypted/Not set indicator and `Added <date>`; the
  empty state says so instead of looking broken. Asserted in the suite against both a fixture and the
  literal body a running Core returned, and the URL/method/`Authorization` header are asserted on the
  recording `fetch`.
- [x] **2. Add & Rotate Secret** — one form, `POST /api/v1/environments/:id/secrets`. Client-side POSIX
  validation (`^[A-Za-z_][A-Za-z0-9_]{0,127}$`) and the protected-name list run before the request, from the
  shared constants the Core enforces — asserted for `PATH`, `LD_PRELOAD`, `LD_AUDIT`, `LD_LIBRARY_PATH`,
  `DYLD_INSERT_LIBRARIES`, `NODE_OPTIONS`, `BASH_ENV`, `ENV`, `IFS`, `SHELL`, case-insensitively, and for
  leading digits, hyphens, spaces, `$(…)` and over-length keys. A server `400` with
  `PROTECTED_SECRET_KEY_ERROR` / `INVALID_SECRET_KEY_ERROR`, or a `404` with `ENVIRONMENT_NOT_FOUND_ERROR`,
  is surfaced with the Core's own message and the code passed back to the caller. Rotation replaces the row
  in place, verified with the `createdAt` the Core returned.
- [x] **3. Delete Secret** — `DELETE /api/v1/environments/:id/secrets/:key`, behind an in-place
  confirmation (`Delete DEPLOY_TOKEN?` → `Confirm delete` / `Cancel`), with only the armed row confirming.
  The key is URL-encoded (asserted: `A KEY/WITH SLASH` → `A%20KEY%2FWITH%20SLASH`), the row leaves state on
  success and is left alone on 404.
- [x] **4. Security Vault Status Surface** — `SecurityStatusCard` renders `GET /api/v1/security/vault-status`
  live: health badge, cipher, key derivation and rounds, salt presence, system-credential tallies with the
  managed-key count, the environment-secret tallies P9-02 folded in, migration state and the redaction
  count. Rendered against the real body above. Amber and red states are asserted separately for unreadable
  envelopes (system *and* environment), plaintext on disk, an underivable key and a bare unhealthy flag.
- [x] **5. Data Sovereignty & Zero Plaintext Leakage** — the value field is uncontrolled, so no credential
  reaches React state or the rendered tree; asserted with a regex that the field carries no `value` attribute
  in any state, including revealed, where a controlled field would have emitted it. The store is serialised
  and asserted free of the credential after a successful store, after a rotation, and after every failure
  path (client-side refusal, 400 ×2, 404). Nothing touches `localStorage` but `getAuthHeaders`, reading the
  token. On submit the field is cleared before the request is awaited.
- [x] **6. Automated Web Test Suite** — `EnvironmentSecretsUI.test.ts`, **203/203**, in three layers: pure
  helpers, the store against a recording `fetch` (URLs, methods, headers, bodies, encoding, state
  transitions), and `react-dom/server` render assertions — plus the captured-real-body layer.
- [x] **7. Monorepo CI Gates** — typecheck clean in all seven workspaces, lint 0 errors, every test suite
  passes (9 web, 23 server, plus adapters/relay/mcp), every build succeeds. Per-workspace invocation as
  noted in § 4.

Definition of Done: store extended (a dedicated `useSecretStore` rather than overloading `useWorkspaceStore`,
per `blueprint/STORE_ARCHITECTURE.md`'s separation) ✔; secrets panel connected to the real API ✔; add/rotate
and delete with validation and feedback ✔; security card wired to `/api/v1/security/vault-status` ✔; suite
created and wired into `"test"` ✔; CI gates clean ✔.

## 6. Git Diff Review

Reviewed `git diff` and `git status` in full. 5 files added, 5 modified. Against the forbidden list:

- **No plaintext retained in React state or localStorage after submission** — the value field is
  uncontrolled and there is no store field that could hold a value; asserted, not merely intended.
- **No external UI library dependency** — no change to any `dependencies` block. The two new components use
  only React, the existing `Icons.tsx` and the `tokens.css` custom properties (`--color-surface-*`,
  `--color-border-*`, `--color-text-*`, `--color-state-completed/paused/error`, `--font-family-mono`). No
  hex literal was introduced; the mock section removed from `EnvironmentSettingsView` took three of them
  (`#131b2e`, `#090d16`, `#34d399`) with it.
- **No backend validation weakened, no RBAC bypassed** — the only server change is where three type
  declarations and two constants are *declared*; the values are byte-identical (`SECRET_KEY_PATTERN`,
  the eleven protected names) and every server behaviour assertion still passes, including the 400/401/403/404
  RBAC matrix in `EnvironmentSecretService.test.ts`. No route, guard or handler was touched.
- **No existing web suite or build broken** — all 8 pre-existing web suites pass unchanged, all 23 server
  suites pass, every workspace builds.
- Nothing added to `docs/`.

Two pre-existing conditions were left alone rather than folded into this change: `tests/report.md` was
already modified when this session started (the previous test-gate report), and the four unused
`Icons` imports in `EnvironmentSettingsView.tsx` were already unused before this task (confirmed against
`HEAD`) — they are not secrets-related and removing them would be an unrelated edit.

**One leftover:** `apps/web/src/__p903_preview.ts`, a throwaway that produced the rendered-output block in
§ 4, is still on disk — this session's sandbox refused every form of `rm`, `mv` and `git clean` on it. It is
untracked and **not** in the commit, imports nothing outside the app, and is deleted by
`rm apps/web/src/__p903_preview.ts`.

## 7. Problems Discovered

1. **A controlled password input renders its value.** The first run of the suite failed on
   "a masked-entry draft is not in the markup": `renderToStaticMarkup` emits `value="…"` for a controlled
   `<input type="password">`. In a browser React sets it as a DOM property rather than an attribute, so it
   would not have shown in view-source — but it is still in the element, and any code that serialises the
   form (an error reporter, a session replay, a DOM-snapshot extension) would have captured a live
   credential. Fixed by making the field uncontrolled, which also removes the credential from React state
   entirely. This is the one finding in this task that a build, a typecheck and a manual click-through would
   all have missed.
2. **The task brief's API shapes did not match the routes.** Two differences, resolved in favour of the
   running code (`apps/server/src/routes/`), which is what the acceptance criteria are tested against:
   - `GET …/secrets` returns `{ secrets, mask }`, **not** `{ success: true, secrets }`. A store that
     branched on `body.success` would have treated every successful listing as a failure.
   - `GET /api/v1/security/vault-status` returns `{ vault: { …, environmentSecrets }, healthy }` — the
     metrics are nested under `vault`, not flattened as `{ cipher, kdf, saltExists, rounds, settings, … }`,
     and the field names are `algorithm` / `keyDerivation` / `iterations` / `saltPresent`. The brief's shape
     has no `vault` wrapper at all; reading it as written would have produced a card of `undefined`s. Both
     are now pinned by the captured-real-body assertions.
3. **The contract was declared in the Core only.** `EnvironmentSecretSummary`, `VaultStatus`, `SECRET_MASK`
   and the key rules lived in `apps/server`, which `apps/web` cannot import — so building this panel meant
   either restating them (the anti-pattern `CLAUDE.md` names explicitly) or moving them. Moved to
   `@asterim/shared`, with the server re-exporting under the existing names so no Core call site changed.
   The risk was regression in P9-01/P9-02; 314 assertions across those two suites confirm there was none.
4. **`@asterim/shared` resolves through `dist` for the server.** Its `package.json` has
   `types: dist/index.d.ts`, so adding a file to `src/` is invisible to `apps/server` until
   `pnpm --filter @asterim/shared run build` runs. Turbo encodes this, but a bare `tsc --noEmit` in the
   server workspace fails confusingly until shared is built once.
5. **A zustand selector returning a fresh `[]` re-renders forever.** `secretsFor` had to return one shared
   empty array rather than `secretsByEnvironment[id] || []`; under zustand v5's `useSyncExternalStore` the
   literal would be a new reference on every store read. Caught while writing, asserted so it stays fixed.
6. **The personal-environment fallback id.** `EnvironmentSettingsView` falls back to a synthetic
   `{ id: 'personal' }` when no workspace is active, and the panel will ask the Core for that id's secrets
   and surface a "not found". That is pre-existing behaviour shared with the members, audit and projects
   tabs on the same view, and was left as-is rather than special-cased here.

## 8. Architectural Concerns

1. **`DeveloperSettings.tsx` is dead code.** The task offered it as a home for the security card; it is
   imported by nothing (`AISettings` is the only settings component `App.tsx` renders). The card went into
   the Secrets tab of Environment Settings instead, which is reachable. Worth either deleting
   `DeveloperSettings.tsx` or wiring it up — it currently carries the entire multi-device workstation UI
   that no user can reach.
2. **Vault status is a workstation fact shown inside an environment.** The card answers a machine-level
   question but currently only appears under one environment's Secrets tab. If a global Security section
   ever exists, that is where it belongs; the component is already connected-and-props-only so moving it is
   an import.
3. **No `updated_at` on `environment_secrets`** (carried from P9-02 § 8.5): the panel can say when a
   credential was introduced but not when it was last rotated, which is the field an audit actually wants.
   The UI has the column ready for it.
4. **Nothing tells a running agent session that a secret changed.** Resolution happens at session start, so
   a rotation takes effect on the next session — the form says so, but an operator who rotates a credential
   mid-session gets no signal that the running agent still holds the old one. A `workspace:<id>` EventBus
   notice would close that.
5. **The RBAC fallback for member-less environments** (P9-02 § 8.1) is now user-visible: on a single-user
   workstation any authenticated caller can add and delete an environment's secrets through this panel. Still
   the right default for local-first, still a policy decision worth confirming.
6. **`MIN_REDACTABLE_LENGTH = 8`** means a credential of eight characters or fewer is encrypted at rest but
   not stripped from agent output. The card's "Output redaction — N values" tally will silently undercount
   in that case; it reports what the redactor holds, which is correct but could mislead.

## 9. Recommended Next Step

**P9-04 — Desktop shell / production release gate**, per the phase title. The enterprise-hardening vertical
is now closed end to end: credentials encrypted at rest (P9-01), an API and agent-injection path that never
returns them (P9-02), and an operator surface for both (P9-03). If a smaller step is preferred first, the
highest-value one is § 8.1 — decide whether `DeveloperSettings.tsx` is deleted or wired in, since it is the
only remaining unreachable settings surface and P9-04's desktop shell will have to answer for it either way.
