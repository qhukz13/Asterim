# Release Gate

Asterim is not release-ready until every box is ticked by someone who ran the step, on the date given. "It compiles" ticks nothing. Re-run the whole gate for every release candidate.

## A. Core loop (blocking)

- [ ] Fresh machine (or fresh user account): `npm install -g asterim@<rc>` succeeds on Windows 11, macOS, Ubuntu 24.04 with Node 22.
- [ ] `asterim` prints the URL and PIN; the dashboard loads on `http://localhost:3000` and on `http://<lan-ip>:3000` from a phone.
- [x] Pairing succeeds with the PIN (every e2e run). Measured 2026-09-09 against the packaged build: four wrong PINs are refused with 401, the fifth attempt is refused with 429 and `Retry-After: 896`, and the correct PIN is refused too while the lock holds. `GET /api/v1/projects` without a token returns 401 on loopback and on the LAN address.
- [ ] First-run wizard shows Claude Code as "Detected" when installed and "Not found" with the install command when not.
- [x] Verified by tools/e2e/gate-checks.mjs. The Core already refused the folder correctly; the dialog was throwing the message away and showing nothing, so the click looked like it had done nothing. The message now appears under the button, names the path and says what to do (docs/screenshots/gate/01-bad-path.png). A real folder opens the thread on every core-loop run.
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
- [x] Antigravity reads *preview* in the dashboard, the first-run wizard, the site's adapter table, the footer, the FAQ, the pricing list and the README; it read "best effort" in four of those on 2026-09-09 and now does not. The unbuilt Pro items are each prefixed PLANNED, and the price range that card used to name is gone — `docs/product/positioning.md` says no pricing commitments until the interviews exist, and the card was contradicting it.
- [ ] No simulated product UI anywhere. A diagram is labelled a diagram; a recording is labelled a recording.
- [x] The hero eyebrow reads "Works with the Claude Code you already run", above the headline. No price appears on the home page, and the pricing page now names none either.
- [ ] Docs → Install, First run, Security model, Adapters, Troubleshooting exist and were followed verbatim by someone other than the author.
- [x] Footer carries Docs, Source, Discussions, Privacy and "MIT licence".
- [ ] `README.md` says the same thing as the landing page.

## E. Operations (blocking)

- [ ] `crash.log` and `server.log` land in the data directory; the Settings screen's diagnostic bundle copies without paths outside the data dir.
- [x] `asterim db:snapshot` verified against the packaged build on 2026-09-09: it wrote a 588 KB snapshot at mode 0600 beside the database and reported its retention. The data directory is the backup.
- [x] Local usage summary works and transmits nothing (P0-11). Verified by `UsageSummary.test.ts`, which replaces `net.Socket.prototype.connect`, `net.connect`, `dns.lookup`, `http.request`, `https.request` and `fetch` with functions that throw, then computes and formats the summary again. A packet capture was not run; refusing the primitives fails louder and in CI.
- [x] GitHub Discussions is linked from the footer, and `.github/ISSUE_TEMPLATE/broken_session.yml` asks for what actually helps: where it stopped, the diagnostics bundle, and optionally `asterim stats` — with a checkbox confirming the reporter read what they are pasting.

## F. Responsive and accessibility (strongly recommended)

- [x] Dashboard usable at 1280×720 without overlapping controls. Measured 2026-09-09: the view tabs end 16 px before the action buttons, the page does not scroll horizontally, and the thread header wraps its agent controls onto a second row rather than truncating the thread name. The tab strip **does** overflow at this width and scrolls; it fades at its right edge instead of colliding with the buttons beside it (`docs/screenshots/e2e/06-narrow-1280x720.png`).
- [x] Verified by tools/e2e/gate-checks.mjs at 390x844 with touch emulation, with the request sent from a desktop window and answered on the phone. The card sits 14 px from each edge, the page does not scroll sideways, Deny and Approve are both 44 px tall and on screen, the card takes focus when it opens, and Escape denies -- after which the file is not on disk. It was edge to edge with 35 px buttons before this run. The rest of the workspace is not usable at that width; the site now says so rather than implying a phone can drive everything.
- [ ] Empty, loading and error states present for thread list, Changes and Memory.

## G. Known accepted risks (write them down)

- Plain HTTP on the LAN behind a PIN.
- Agent inherits the developer's environment.
- Antigravity adapter depends on Google's TUI.

Signed off by: ______ Date: ______ Version: ______
