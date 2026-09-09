# Release Gate

Asterim is not release-ready until every box is ticked by someone who ran the step, on the date given. "It compiles" ticks nothing. Re-run the whole gate for every release candidate.

## A. Core loop (blocking)

- [ ] Fresh machine (or fresh user account): `npm install -g asterim@<rc>` succeeds on Windows 11, macOS, Ubuntu 24.04 with Node 22.
- [ ] `asterim` prints the URL and PIN; the dashboard loads on `http://localhost:3000` and on `http://<lan-ip>:3000` from a phone.
- [x] Pairing succeeds with the PIN (every e2e run). Measured 2026-09-09 against the packaged build: four wrong PINs are refused with 401, the fifth attempt is refused with 429 and `Retry-After: 896`, and the correct PIN is refused too while the lock holds. `GET /api/v1/projects` without a token returns 401 on loopback and on the LAN address.
- [ ] First-run wizard shows Claude Code as "Detected" when installed and "Not found" with the install command when not.
- [ ] Add project with a non-existent folder shows an inline error; with a real folder the thread opens.
- [x] Verified by `tools/e2e/core-loop.mjs` on every run, both ways (2026-09-09). The card names the action ("Create a new file"), the path, and the two lines it would write. Deny: the file is not on disk, and the agent replies that the write was denied, says what it would have created, and asks how to proceed (`docs/screenshots/e2e/07-after-deny.png`). Approve: the file appears with the content shown on the card (`docs/screenshots/e2e/02-approval-card.png`).
- [ ] Send a task that requires a shell command. Same card. The Terminal tab is untouched.
- [ ] Transcript shows the agent's text, tool calls and results; status pill goes working → idle with cost.
- [ ] Changes tab shows the diff; commit from Changes creates the commit with the user as author; the agent has not committed.
- [ ] Stop the Core (`Ctrl+C`), restart, reopen the thread: the conversation resumes (`--resume`) and history is intact.
- [ ] Clear chat → next message starts a fresh Claude Code session.
- [ ] Antigravity adapter: labelled best-effort; with `MOCK_AGENT=true` the packaged binary shows the mock approval card.

## B. Security (blocking)

- [ ] `docs/audit/security-audit.md` has no open CRITICAL or HIGH item that affects the launch build.
- [x] `HOST=127.0.0.1` restricts the Core to the machine. Measured 2026-09-09: the socket listens on 127.0.0.1:PORT only, loopback answers 200, and the LAN address does not connect.
- [x] The packaged bundle contains no `--dangerously-skip-permissions` and no `bypassPermissions`. `ASTERIM_DEV_AUTH_BYPASS` appears once, as the name of a variable that must be set to `true` **and** be on loopback **and** not be production before it does anything; no default sets it.
- [~] `pnpm audit --prod` shows no critical advisories. It showed 25 high on 2026-09-09; overrides for `socket.io-parser`, `fast-uri` and `brace-expansion` cleared 20 of them. The five that remain are all Fastify 4: the framework itself, `@fastify/static`, and `find-my-way`. Every fix is in a major (Fastify 5.7.3, @fastify/static 10.1.2), which is not a release-candidate change. The one that matters, a route-guard bypass via path traversal in @fastify/static, is mitigated by an onRequest guard that refuses any raw path containing a traversal segment in any encoding (verified against literal, percent-encoded, double-encoded and backslash forms). The upgrade is the top P1.

## C. Build and tests (blocking)

- [~] `pnpm run typecheck`, `pnpm run lint` (0 errors) and `pnpm run build` are green. `pnpm run test` runs all 34 server suites; 33 pass and `AgentMcpIntegration.test.ts` ends at 156/160 on the ConPTY console-attachment defect (P1-06, `docs/development/testing.md`). Measured on Windows 10 on 2026-09-09. Not yet run on Linux in CI for a tag.
- [x] `tools/e2e/core-loop.mjs` passes 10/10 against the packaged binary installed from a tarball into a clean prefix, with a clean data directory and a real Claude Code (2026-09-09).

## D. Product surface (blocking)

- [ ] Landing page makes no claim that is not on this checklist. Install command is the real one. Screenshots are real captures, legible at the size shown, and regenerated from the current build.
- [ ] Every capability shown in the product or on the site that is not shipping carries a status word: BETA, PREVIEW or PLANNED. Antigravity reads PREVIEW everywhere it appears.
- [ ] No simulated product UI anywhere. A diagram is labelled a diagram; a recording is labelled a recording.
- [ ] The home page states the relationship to Claude Code above the fold, and commits to no price.
- [ ] Docs → Install, First run, Security model, Adapters, Troubleshooting exist and were followed verbatim by someone other than the author.
- [ ] Footer links: source, licence (MIT), privacy note.
- [ ] `README.md` says the same thing as the landing page.

## E. Operations (blocking)

- [ ] `crash.log` and `server.log` land in the data directory; the Settings screen's diagnostic bundle copies without paths outside the data dir.
- [ ] Backup story documented: the data directory is the backup; `asterim db:snapshot` works and is in Docs.
- [x] Local usage summary works and transmits nothing (P0-11). Verified by `UsageSummary.test.ts`, which replaces `net.Socket.prototype.connect`, `net.connect`, `dns.lookup`, `http.request`, `https.request` and `fetch` with functions that throw, then computes and formats the summary again. A packet capture was not run; refusing the primitives fails louder and in CI.
- [ ] Support channel exists (GitHub Discussions) with a "report a broken session" template.

## F. Responsive and accessibility (strongly recommended)

- [x] Dashboard usable at 1280×720 without overlapping controls. Measured 2026-09-09: the view tabs end 16 px before the action buttons, the page does not scroll horizontally, and the thread header wraps its agent controls onto a second row rather than truncating the thread name. The tab strip **does** overflow at this width and scrolls; it fades at its right edge instead of colliding with the buttons beside it (`docs/screenshots/e2e/06-narrow-1280x720.png`).
- [ ] Approval card usable on a 390 px wide phone; Approve/Deny reachable by keyboard.
- [ ] Empty, loading and error states present for thread list, Changes and Memory.

## G. Known accepted risks (write them down)

- Plain HTTP on the LAN behind a PIN.
- Agent inherits the developer's environment.
- Antigravity adapter depends on Google's TUI.

Signed off by: ______ Date: ______ Version: ______
