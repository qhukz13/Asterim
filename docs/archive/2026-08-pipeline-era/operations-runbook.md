# Asterim Operations Runbook

Deployment, configuration and secret handling for the two long-running Asterim
processes: the **Core Server** (`apps/server`, package `asterim`) and the
**Cloud Relay** (`apps/relay`, package `@asterim/relay`).

Every variable below was read out of the source, not out of an older document.
Anything not listed here is not read by the code. In particular `.env.example`
at the repository root is stale and documents `AGENTDECK_*` names that nothing
reads — treat this file as the source of truth for configuration.

---

## 1. Core Server

The Core is the only privileged process: it owns the SQLite database, the
EventBus, agent lifecycle, git and mDNS. It is the process a developer runs on
their workstation, and the one packaged by `Dockerfile.server`.

### 1.1 Configuration

| Variable                 | Default                 | Effect                                                                                                                                                                                                                                                               |
| :----------------------- | :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                   | `3000`                  | HTTP + Socket.IO listen port.                                                                                                                                                                                                                                        |
| `HOST`                   | `::`                    | Listen address. `::` accepts IPv6 and IPv4 on every interface, which is what LAN pairing needs. Set `127.0.0.1` to restrict the Core to the machine, or when a reverse proxy is in front of it.                                                                      |
| `ASTERIM_DATA_DIR`       | `~/.asterim`            | Where `asterim.db` (+ WAL sidecars), `crash.log` and the loopback descriptor `server.json` live. The directory is forced to `0700` and the database to `0600` on every start (DEC-028).                                                                              |
| `ASTERIM_SOVEREIGN_MODE` | unset                   | `true` is the air-gap switch: no `RelayClient` connection, no Web Push dispatch, local CLI execution only (DEC-028 §3). Local-subnet mDNS discovery remains active.                                                                                                  |
| `ASTERIM_RELAY_URL`      | `http://localhost:4000` | Which Cloud Relay to open a tunnel on. Ignored in Sovereign Mode.                                                                                                                                                                                                    |
| `ASTERIM_RELAY_SECRET`   | unset                   | HMAC key used to sign tunnel registrations. Falls back to `RELAY_SECRET` if unset. Must equal the relay's `RELAY_SECRET`. Without it the Core sends an unsigned registration, which a hardened relay refuses.                                                        |
| `STRIPE_SECRET_KEY`      | unset                   | Enables Stripe Checkout and the Customer Portal. Unset means `POST /api/v1/billing/checkout` answers `503 STRIPE_NOT_CONFIGURED`; **the Community edition is unaffected.**                                                                                           |
| `STRIPE_WEBHOOK_SECRET`  | unset                   | Endpoint signing secret. When set, `POST /api/v1/webhooks/stripe` rejects any delivery whose signature or timestamp does not verify. **Unset means the endpoint accepts unsigned payloads** — acceptable locally, never in a deployment reachable from the internet. |
| `STRIPE_PRICE_PRO`       | unset                   | Stripe price id for the Pro plan. Required to check out Pro.                                                                                                                                                                                                         |
| `STRIPE_PRICE_TEAM`      | unset                   | Stripe price id for the Team plan. Required to check out Team.                                                                                                                                                                                                       |
| `NODE_ENV`               | unset                   | `production` disables the development fallback user in `authMiddleware`; every `/api/v1/` request must then carry a real token. Set by both Dockerfiles.                                                                                                             |
| `MOCK_AGENT`             | unset                   | `true` replaces the Antigravity adapter with a mock. Development and CI only.                                                                                                                                                                                        |

Read from the environment but supplied by the operating system, not configured
by an operator: `HOME` / `USERPROFILE` (git credential helpers and `~/.ssh`),
`SHELL` / `COMSPEC` (terminal sessions), `LOCALAPPDATA` (Windows paths).

VAPID keys for Web Push are **not** environment variables — they are generated
on first run and stored in the `settings` table.

### 1.2 Ports and endpoints

| Path                           | Purpose                                                                                                        |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------- |
| `GET /health`                  | Liveness. Unauthenticated. Used by the container healthcheck.                                                  |
| `GET /api/v1/system`           | System status. Authenticated.                                                                                  |
| `POST /api/v1/auth/pair`       | Device pairing with the 6-digit PIN. Rate limited: 5 consecutive failures lock the address out for 15 minutes. |
| `POST /api/v1/webhooks/stripe` | Stripe deliveries. Exempt from `authMiddleware`; authenticated by HMAC signature instead.                      |
| `/api/v1/billing/*`            | Checkout, portal, subscription overview. Authenticated.                                                        |

---

## 2. Cloud Relay

A blind forwarder. Everything crossing it is E2E encrypted between the
workstation and the mobile client, so the relay never holds project data and
keeps no persistent state — routing tables are in memory by design.

### 2.1 Configuration

| Variable                       | Default                   | Effect                                                                                                                                                                                                                                      |
| :----------------------------- | :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                         | `4000`                    | Listen port.                                                                                                                                                                                                                                |
| `RELAY_SECRET`                 | unset                     | HMAC key for `register_tunnel`. **Unset runs the relay open** — any client may claim any tunnel id — and the process logs a warning on start. `GET /health` reports `authMode: development_open` in that state and `hmac_enabled` when set. |
| `RELAY_MAX_CONNECTIONS_PER_IP` | `50`                      | Concurrent sockets allowed from one address. Over the cap the socket is refused with `RATE_LIMITED` and disconnected.                                                                                                                       |
| `RELAY_MAX_EVENTS_PER_MINUTE`  | `20`                      | `register_tunnel` + `join_tunnel` events allowed per address per minute.                                                                                                                                                                    |
| `RELAY_IDLE_TUNNEL_MS`         | `900000` (15 min)         | Silence after which a tunnel is closed. The sweep also closes tunnels whose host socket has gone.                                                                                                                                           |
| `NODE_ENV`                     | `production` in the image | No behavioural effect in the relay today.                                                                                                                                                                                                   |

### 2.2 Endpoints

| Path           | Purpose                                                                                                                                                                   |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /health`  | `status`, `service`, `version`, `uptime`, `activeTunnels`, `connectedSockets`, `authMode`.                                                                                |
| `GET /metrics` | Counters: `totalConnections`, `activeConnections`, `totalTunnelsCreated`, `activeTunnels`, `messagesForwarded`, `authRejections`, `rateLimitRejections`, `tunnelsReaped`. |

Neither response ever contains a tunnel id — a tunnel id is the credential a
mobile client uses to join. Both endpoints are unauthenticated: put them behind
an internal listener or an authenticating proxy before exposing the relay
publicly.

---

## 3. Container images

Both images are multi-stage, run as the unprivileged `node` user, and carry no
compiler, package manager or source tree in the final layer.

```bash
# From the repository root
docker build -f Dockerfile.server -t asterim-server:0.1.0 .
docker build -f Dockerfile.relay  -t asterim-relay:0.1.0  .
```

| Image            |    Size | Contents of `/app`                                                                                   |
| :--------------- | ------: | :--------------------------------------------------------------------------------------------------- |
| `asterim-server` | ~333 MB | `dist/` (bundled server + the dashboard under `dist/web`), production `node_modules`, `package.json` |
| `asterim-relay`  | ~182 MB | `dist/`, production `node_modules`, `package.json`                                                   |

`node:22-alpine` is 167 MB of that. The server's remainder is mostly `node-pty`,
which is compiled in the builder stage; the Dockerfile drops node-gyp's
intermediate objects and the macOS/Windows prebuilt addons that a Linux image
can never load.

### 3.1 Running the Core Server

```bash
docker volume create asterim-data

docker run -d --name asterim-server \
  -p 3000:3000 \
  -v asterim-data:/home/node/.asterim \
  -e ASTERIM_RELAY_URL=https://relay.example.com \
  -e ASTERIM_RELAY_SECRET="$RELAY_SECRET" \
  -e STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
  -e STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET" \
  -e STRIPE_PRICE_PRO=price_... \
  -e STRIPE_PRICE_TEAM=price_... \
  asterim-server:0.1.0

# Fully offline, no relay, no push:
docker run -d --name asterim-server \
  -p 3000:3000 -v asterim-data:/home/node/.asterim \
  -e ASTERIM_SOVEREIGN_MODE=true \
  asterim-server:0.1.0
```

Notes:

- **The volume is not optional.** Everything the user owns — projects, threads,
  decisions, entitlements — is in `asterim.db` under `/home/node/.asterim`.
  Without a mount it disappears with the container.
- The image sets `ASTERIM_DATA_DIR=/home/node/.asterim` and the Core enforces
  `0700` on it and `0600` on the database at every start.
- **`/app` must stay writable.** The Core writes `pairing_pin.txt` into its
  working directory on every start, so a read-only root filesystem breaks
  startup. The PIN is regenerated each start and is never valid across restarts.
- The pairing PIN is printed to the container log. `docker logs asterim-server`
  is how an operator reads it to pair the first device.
- Agent CLIs (`claude`, `aider`, `agy`) are **not** in the image. A containerized
  Core can drive only the adapters whose binaries are mounted or installed into
  it; `GET /health` reports which were found.

### 3.2 Running the Cloud Relay

```bash
docker run -d --name asterim-relay \
  -p 4000:4000 \
  -e RELAY_SECRET="$RELAY_SECRET" \
  -e RELAY_MAX_CONNECTIONS_PER_IP=50 \
  -e RELAY_MAX_EVENTS_PER_MINUTE=20 \
  asterim-relay:0.1.0

curl -s http://localhost:4000/health   # expect "authMode":"hmac_enabled"
```

No volume: the relay persists nothing, and must not. If `/health` reports
`development_open`, `RELAY_SECRET` did not reach the process — fix that before
the port is reachable from anywhere but localhost.

### 3.3 Healthchecks

Both images declare a `HEALTHCHECK` that fetches `/health` with Node's built-in
`fetch` (no `curl` in the image). Orchestrators that ignore the image-level
directive — Kubernetes, and `podman build` in OCI format — should configure the
same probe themselves:

```
GET /health   interval 30s   timeout 5s   start-period 20s (server) / 10s (relay)
```

### 3.4 Behind a reverse proxy

The relay's rate limits are keyed on the socket's source address. Behind a load
balancer every connection appears to come from the balancer, which collapses all
clients into one bucket. Terminate TLS in front of the relay, but either
preserve the client address (PROXY protocol / direct pass-through) or raise
`RELAY_MAX_CONNECTIONS_PER_IP` and `RELAY_MAX_EVENTS_PER_MINUTE` accordingly and
rely on the balancer for per-client limiting.

The limits are also per process: two relay instances mean two independent
budgets.

---

## 4. Secret generation

```bash
# Relay HMAC key — 32 random bytes, hex
openssl rand -hex 32
# or, without openssl:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The same value goes to the relay as `RELAY_SECRET` and to every Core as
`ASTERIM_RELAY_SECRET`. It is a symmetric key: anyone holding it can open a
tunnel on that relay. Store it wherever the deployment keeps its secrets — never
in the repository, never in an image layer, never in a `docker run` line that
lands in shell history (use `--env-file` or the platform's secret store).

Stripe values come from the Stripe dashboard: the secret key under _Developers →
API keys_, the endpoint signing secret under _Developers → Webhooks → your
endpoint_, and the price ids under _Products_.

---

## 5. Rotation playbooks

### 5.1 `RELAY_SECRET`

The relay verifies against exactly one secret, so a single instance cannot
accept both the old and the new value at once. Zero downtime therefore means
running two relays for the length of the rollover:

1. Generate the new secret (§4).
2. Start a **second** relay with the new value, on a new address
   (`relay-next.example.com`), and confirm `GET /health` reports
   `authMode: hmac_enabled`.
3. Roll the workstations: set `ASTERIM_RELAY_SECRET` to the new value and
   `ASTERIM_RELAY_URL` to the new relay, then restart each Core. A Core
   registers its tunnel on connect, so a restart is the whole migration.
4. Watch `GET /metrics` on the old relay. When `activeTunnels` reaches zero and
   stays there, retire it.
5. Move the DNS name to the new instance at leisure.

Accepting a short interruption instead: set the new secret on the relay and on
every Core, then restart the relay. Existing tunnels close (clients see
`tunnel_closed`) and re-register within seconds. Nothing is lost — tunnels are
ephemeral and every payload is end-to-end encrypted between the endpoints, not
the relay.

> **Gap.** Multi-secret verification (accept `RELAY_SECRET` and
> `RELAY_SECRET_PREVIOUS` during a window) would make this a single-instance,
> zero-downtime operation. It is not implemented today.

### 5.2 `STRIPE_WEBHOOK_SECRET`

This one _is_ zero-downtime, because Stripe signs with both secrets during a
roll and Asterim accepts any matching `v1` in the signature header:

1. Stripe dashboard → _Developers → Webhooks_ → your endpoint → **Roll secret**,
   choosing an expiry for the old one (24 hours is comfortable).
2. Deploy the Core with the new `STRIPE_WEBHOOK_SECRET`. Deliveries signed with
   either secret verify until the old one expires.
3. Confirm in the Stripe dashboard that recent deliveries are `200`, then let
   the old secret expire.

If a delivery is rejected, the Core logs
`[Billing Webhook] Rejected unverified payload: <reason>` — `signature does not
match` means the wrong secret is deployed, `timestamp is …s old` means the
container's clock has drifted more than five minutes.

### 5.3 `STRIPE_SECRET_KEY`

1. Create a new secret (or restricted) key in the Stripe dashboard.
2. Deploy the Core with it; checkout and portal calls use it immediately.
3. Confirm a checkout session can be created, then revoke the old key.

Nothing in Asterim stores the key: it lives in the process environment and is
sent only as an `Authorization` header to `api.stripe.com`.

### 5.4 The device pairing PIN

Not rotatable and not meant to be: a fresh 6-digit PIN is generated on every
Core start, printed to the log, and written to `pairing_pin.txt` in the working
directory. To invalidate it, restart the Core. Already-paired devices hold a
30-day HMAC token and are unaffected.

---

## 6. Release pipeline

`.github/workflows/release.yml` runs on a `v*` tag and refuses to package
anything that does not pass the same four gates as CI — typecheck, lint, test,
build — before building both images and opening a draft GitHub Release. The
draft is deliberate: a human decides when a release is public.

```bash
git tag v0.1.0
git push origin v0.1.0
```

Images are built in CI to prove the Dockerfiles still build; publishing them to
a registry is intentionally not wired up, because no registry has been chosen.
