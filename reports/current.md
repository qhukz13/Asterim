# Execution Report: P5.6-04 — Stripe Checkout, Customer Portal & Cryptographic Webhook Security

**Task ID:** P5.6-04  
**Phase:** Phase 5.6 — SaaS Foundation & Commercial Beta Release  
**Status:** IMPLEMENTED & VERIFIED  
**Date:** 2026-08-15  
**Author:** Claude Code  

---

## 1. Summary

`BillingService` creates Stripe Checkout and Customer Portal sessions and reports a subscription
overview; three authenticated `/api/v1/billing` routes expose it. The Stripe webhook is now
cryptographically verified — HMAC-SHA256 over the **raw** request bytes, compared in constant time,
with a five-minute freshness window that stops a captured delivery from being replayed — and drives
the full subscription lifecycle into SQLite: `created`/`updated` set the plan and sync
`feature_entitlements`, `deleted` returns the account to Community, `invoice.payment_failed` flags
billing without taking anything away.

Two things had to be fixed for any of it to work in production. The webhook endpoint was behind
`authMiddleware`, which would have 401'd every Stripe delivery when `NODE_ENV=production`; it is now
exempt, because it authenticates itself. And Fastify's JSON parser destroys the bytes Stripe signed,
so the webhook plugin captures the raw body before parsing — asserted by a test that replays a valid
signature against a body edited in flight and expects a 400.

Stripe is reached through a small injectable gateway rather than the vendor SDK, so no dependency was
added and no test opens a socket. A new **102-assertion** suite is wired into `pnpm run test`, now
**24 suites / 1,802 assertions**. All four CI gates pass.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/server/src/services/BillingService.ts` | Created | Checkout, portal, subscription overview, customer lookup, payment-failure flag; `HttpStripeGateway`; `BillingError` |
| `apps/server/src/routes/billing.ts` | Created | `POST /checkout`, `POST /portal`, `GET /subscription` with error→status mapping |
| `apps/server/src/routes/webhooks.ts` | Modified | `verifyStripeSignature()`, `resolvePlanId()`, raw-body capture, signature enforcement, `invoice.payment_failed` |
| `apps/server/src/middleware/authMiddleware.ts` | Modified | Exempt `/api/v1/webhooks/` — it carries its own proof |
| `apps/server/src/index.ts` | Modified | Register `billingRoutes` |
| `apps/server/src/services/__tests__/BillingService.test.ts` | Created | 102 assertions across signature, checkout, portal, overview, webhook lifecycle, REST surface, free tier |
| `apps/server/package.json` | Modified | Suite wired into `test` |

## 3. Implementation Details

### 3.1 Webhook signature verification

```
expected = HMAC-SHA256(`${t}.${rawBody}`, STRIPE_WEBHOOK_SECRET)   // hex
header   = t=<unix seconds>,v1=<hex>[,v1=<hex>…]
```

`verifyStripeSignature(rawBody, header, secret, toleranceSeconds = 300)` returns
`{ valid, reason? }` rather than a boolean, so the route can log *why* without telling the caller.

- **Freshness first.** A signature never expires on its own; without the window a captured delivery
  could be replayed later to re-apply an old subscription state. Checked before any HMAC work.
- **Constant time.** `crypto.timingSafeEqual`, with a length comparison in front of it — it throws on
  unequal lengths, which would turn a one-character signature into a crash instead of a rejection.
  Asserted.
- **Rotation.** Stripe sends several `v1` values while an endpoint secret is being rotated; any match
  counts. Asserted.
- Direction: only *old* timestamps are refused, matching Stripe's own library. A future timestamp is
  clock skew, and forging one still requires the secret because the timestamp is inside the signature.

**The raw body.** Fastify parses JSON into an object; `JSON.stringify` of that object is not the
bytes Stripe signed (key order, whitespace, number formatting). The webhook plugin therefore
registers its own `application/json` parser with `parseAs: 'string'`, stashes the exact string on
`request.rawBody`, and then parses. Content-type parsers are encapsulated per plugin, so no other
route is affected — verified against the running server, where a JSON body on
`/api/v1/billing/checkout` still parses normally.

**Reachability.** `authMiddleware`'s `preHandler` guards everything under `/api/v1/` and had no
webhook exemption, so with `NODE_ENV=production` every Stripe delivery would have been rejected with
401 before the handler ran. `/api/v1/webhooks/` is now exempt with a comment explaining that its
credential is the signature.

### 3.2 Event handling

| Event | Effect |
| :--- | :--- |
| `customer.subscription.created` / `.updated` | `planService.updateAccountPlan(accountId, planId, customerId)` — sets the plan, records the Stripe customer, upserts every entitlement of the tier |
| `customer.subscription.deleted` | `updateAccountPlan(accountId, 'free')` — paid entitlements withdrawn, Community entitlements retained |
| `invoice.payment_failed` | `billing_status = 'payment_failed'`, `subscription_status = 'past_due'`; **plan and entitlements untouched** |
| anything else | acknowledged with `{ received: true }`, no change |

**Account resolution** tries `metadata.accountId`, then `client_reference_id`, then a lookup by
`stripe_customer_id`. That last step is what makes `invoice.payment_failed` work at all — invoices do
not carry our subscription metadata. All three paths are asserted.

**Plan resolution** (`resolvePlanId`) accepts a known plan and otherwise falls back to `pro` with a
warning. The metadata is written by our own checkout, so anything else is our bug or an old session;
`pro` is the cheapest paid tier, so guessing low is the only safe direction to guess.

A failed payment deliberately does not revoke access: a declined card must not take a developer's
workstation away mid-task. Stripe retries, and the next `customer.subscription.*` event settles it.
Asserted (`teams` stays enabled through `payment_failed`).

### 3.3 `BillingService`

`createCheckoutSession` validates the plan against `PURCHASABLE_PLANS` (`pro`, `team` — `free` is
granted and `enterprise` is sold by hand), loads the account, resolves the Stripe price id from
`STRIPE_PRICE_PRO`/`STRIPE_PRICE_TEAM`, and reuses an existing `stripe_customer_id` when there is
one. The account id is sent in `client_reference_id` **and** `subscription_data[metadata]`, which is
how the webhook later finds its way home. `createPortalSession` requires a customer;
`getSubscriptionOverview` returns plan, price, subscription and billing status, customer id,
`billingConfigured`, the purchasable plans and the live entitlement rows.

Failures are a typed `BillingError` with one of five codes, mapped in the route layer:

| Code | HTTP | When |
| :--- | :---: | :--- |
| `INVALID_PLAN` | 400 | plan is not purchasable, or a required URL is missing |
| `ACCOUNT_NOT_FOUND` | 404 | no such account |
| `NO_CUSTOMER_RECORD` | 409 | portal requested before any checkout |
| `STRIPE_NOT_CONFIGURED` | 503 | no `STRIPE_SECRET_KEY` or no price for the plan |
| `STRIPE_REQUEST_FAILED` | 502 | Stripe rejected the call |

`STRIPE_NOT_CONFIGURED` answers 503 rather than 500 because it is a deployment state, not a bug, and
its message says so explicitly — including that the Community edition is unaffected.

**No SDK.** `StripeGateway` is a two-method interface; `HttpStripeGateway` implements it with
form-encoded `fetch` calls to `api.stripe.com`. The task specifies hand-rolled HMAC verification
rather than `stripe.webhooks.constructEvent`, the surface we need is two POSTs, and an injectable
gateway is what lets the tests assert *what would have been sent* without a network call (§6).

The account for every route comes from `request.user.acc`, never from the request body — a caller
must not be able to start a checkout against someone else's account.

## 4. Verification

### 4.1 Gates

```
pnpm run typecheck  → 11 successful, 11 total (0 errors)
pnpm run lint       → 7 successful, 7 total   (0 errors)
pnpm run test       → 9 successful, 9 total   (24 suites, 1,802 assertions), exit 0
pnpm run build      → 7 successful, 7 total
```

### 4.2 The new suite — 102/102

`pnpm --filter asterim exec tsx src/services/__tests__/BillingService.test.ts`

| Group | Covers |
| :--- | :--- |
| `verifyStripeSignature` (14) | genuine signature; `Buffer` body; forged signature; another secret; body altered after signing; truncated signature (no throw); empty header; no `t`; no `v1`; non-numeric `t`; replayed delivery refused with a reason; delivery inside the window; multiple `v1` during rotation |
| `resolvePlanId` (4) | known plan, missing, unknown, `free` |
| `createCheckoutSession` (16) | unconfigured → `STRIPE_NOT_CONFIGURED` mentioning the Community edition; `free`/`enterprise`/`platinum` → `INVALID_PLAN`; unknown account; session id and URL returned; correct price per plan; account and plan carried in metadata; first-time buyer has no customer; returning buyer reuses theirs; missing price id names the env var to set |
| `createPortalSession` (7) | no customer → `NO_CUSTOMER_RECORD`; portal URL for a paying account; correct customer and return URL; unconfigured rejects |
| `getSubscriptionOverview` (11) | free account shape; `billingConfigured: false`; purchasable plans listed; after upgrade the plan, price, customer and ≥9 entitlements including the paid ones; unknown account rejects |
| Webhook signature enforcement (7) | unsigned → 400 and no change; forged → 400 and no change; **valid signature against a body edited in flight → 400 and no upgrade** |
| Subscription lifecycle (22) | `created` → pro, customer recorded, `premium_extensions` on with no cap, `teams` still off; `updated` → team, `teams` on; `payment_failed` → found by customer alone, `billing_status`/`subscription_status` set, plan and entitlements retained; `deleted` → free, paid entitlements off, `remote_relay` still on, billing back to `ok`; `client_reference_id`-only account resolves; unhandled event acknowledged; non-JSON body → 400 |
| Development mode (2) | with no `STRIPE_WEBHOOK_SECRET`, an unsigned delivery is processed |
| The REST surface (11) | 401 unauthenticated; overview 200 with plan and entitlements; missing plan 400; unknown plan 400 + `INVALID_PLAN`; unconfigured 503 + `STRIPE_NOT_CONFIGURED`; portal without a customer 409 + `NO_CUSTOMER_RECORD` |
| Community edition (4) | `remote_relay`, `mcp_marketplace` and `cloud_sync` remain accessible on the free plan with no card; paid features are simply off |

The webhook cases run against the real Fastify route and a real SQLite database in a temp directory,
so `accounts` and `feature_entitlements` are asserted as rows, not as return values.

### 4.3 Against the running server

The live dev server picked the changes up and was exercised directly (nothing that mutates the real
database was sent):

```
GET  /api/v1/billing/subscription
  → {"accountId":"acc_dev","planId":"free","planName":"Community Edition","priceMonthly":0,
     "subscriptionStatus":"active","billingStatus":"ok","stripeCustomerId":null,
     "billingConfigured":false,"purchasablePlans":["pro","team"],"entitlements":[]}
POST /api/v1/billing/checkout {"planId":"pro",…}   → 503   (no Stripe keys on this machine)
POST /api/v1/webhooks/stripe  {}                    → 400   {"error":"Invalid webhook payload"}
POST /api/v1/webhooks/stripe  "not json"            → 400
```

The 503 and the parsed-JSON 400 together confirm the scoped content-type parser did not leak: the
billing route still receives a normally parsed body.

## 5. Acceptance Criteria Review

- [x] **1. `verifyStripeSignature()` validates genuine signatures and rejects forged or replayed ones
      in constant time** — `crypto.timingSafeEqual` behind a length check; 14 assertions including
      forgery, another secret, tampering, truncation, and a 10-minute-old replay.
- [x] **2. The webhook updates `accounts` and `feature_entitlements` across the lifecycle** — 22
      assertions on real rows for `created`, `updated`, `deleted` and `payment_failed`.
- [x] **3. `/checkout` and `/portal` return valid URLs or descriptive configuration errors** — URLs
      via the recording gateway; 503 `STRIPE_NOT_CONFIGURED` (message names the missing variable and
      states the Community edition is unaffected), 409 `NO_CUSTOMER_RECORD`, 400 `INVALID_PLAN`.
      Confirmed live (§4.3).
- [x] **4. `GET /billing/subscription` returns accurate plan and entitlement state** — asserted on a
      free account and after an upgrade; confirmed live.
- [x] **5. `BillingService.test.ts` passes** — 102/102.
- [x] **6. CI gates pass with 0 errors, 24 test suites** — typecheck 11/11, lint 7/7 (0 errors),
      test **24 suites / 1,802 assertions**, build 7/7.

Definition of Done:

- [x] `BillingService.ts` implemented
- [x] `/api/v1/billing` routes registered and functional
- [x] Stripe webhook signature verification active
- [x] `BillingService.test.ts` passing
- [x] `pnpm run test` passes across all packages
- [x] Monorepo CI gates pass: typecheck, lint, test, build

## 6. Git Diff Review

Four modified files (one of them a `package.json` script) and three new files, all inside
`apps/server`. Reviewed against §6:

- **The Community edition is not gated.** Nothing was added that requires payment to use Asterim: no
  entitlement check was inserted into any existing path, and `PlanService`'s free-tier definition is
  untouched. Four assertions confirm `remote_relay`, `mcp_marketplace` and `cloud_sync` still resolve
  on the free plan with no card and no Stripe configuration. A failed payment explicitly does not
  revoke entitlements.
- **No test makes a network call.** Stripe is behind `StripeGateway`; the suite injects a recording
  implementation. `HttpStripeGateway` — the only code that would call out — is never constructed in
  the tests.
- **No card data and no secret is stored or logged.** The only Stripe identifiers written to SQLite
  are `stripe_customer_id` (an opaque `cus_…` handle, already in the schema). `STRIPE_SECRET_KEY`
  lives in an in-memory field, is sent only in an `Authorization` header, and appears in no log line;
  the webhook secret is only ever an HMAC key. Error text from Stripe is surfaced, which carries no
  credential.

Behaviour deliberately changed:

1. `/api/v1/webhooks/` is exempt from `authMiddleware` (§3.1). Without it the feature cannot work in
   production. The endpoint is not unauthenticated — it authenticates cryptographically instead.
2. The webhook plugin installs its own `application/json` parser to retain the raw body. Scoped to
   that plugin; verified not to affect other routes (§4.3).
3. `invoice.payment_failed` is newly handled.

**One deviation from the task text, deliberate.** §5.3 says to set `billing_status = 'past_due'`.
`past_due` is not a member of `BillingStatus` in `@asterim/shared` (`'ok' | 'payment_failed' |
'grace_period'`), and `SubscriptionOverview.billingStatus` is typed with that union — writing it
would put a value in the database that the domain type says cannot exist. Per AGENTS.md §7 the shared
types are the source of truth for domain models, so the row records `billing_status =
'payment_failed'` **and** `subscription_status = 'past_due'` — the latter *is* a declared
`SubscriptionStatus`. The account therefore reads as past due in the column whose vocabulary has that
word, with no type violation. Both columns are asserted. If the orchestrator wants the literal value,
the fix is a one-word change plus widening `BillingStatus` in `@asterim/shared`.

`webhooks.ts` was Prettier-clean at `HEAD` and was reformatted after editing; the three new files are
Prettier-clean. `index.ts` and `authMiddleware.ts` were already non-compliant, so they were left
alone rather than reflowed. `apps/server` reports **0 lint errors and 241 warnings** — one fewer than
the 242 baseline, since the new code adds none and replaced a pre-existing `any` in `webhooks.ts`.

## 7. Problems Discovered

1. **The webhook endpoint was unreachable in production.** `authMiddleware` guards all of
   `/api/v1/` and exempted only the public auth routes and `/api/v1/internal/`. With
   `NODE_ENV=production`, every Stripe delivery would have been 401'd before the handler ran — the
   subscription lifecycle would silently never have worked. Found by reading the middleware rather
   than by a failing test, because in development the middleware injects a default user and hides it.
2. **Signature verification is meaningless without the raw body.** `JSON.stringify(request.body)` is
   not what Stripe signed. The test that replays a valid signature against a body edited in flight
   fails loudly if the raw-body capture is ever removed.
3. **`crypto.timingSafeEqual` throws on unequal lengths** — the same trap as the relay work in
   P5.6-03. A truncated `v1` would have crashed the handler; the length check in front of it is what
   makes it a rejection.
4. **`invoice.payment_failed` carries no account metadata.** Invoices are not subscriptions; only the
   `customer` field connects them to us. Hence the `stripe_customer_id` lookup, asserted with an
   event that has no metadata at all.
5. **`accounts.owner_user_id` is a foreign key**, so a test cannot seed an account without first
   seeding its owner. The first run failed with `FOREIGN KEY constraint failed`; the fixture now
   inserts the user.

## 8. Architectural Concerns

1. **Webhook deliveries are not idempotent.** Stripe retries on any non-2xx and can deliver the same
   event twice; nothing records `event.id`, so a replayed *valid* event re-applies its state. The
   operations are idempotent in effect today (setting the same plan twice is harmless), but an
   out-of-order `deleted` → `created` pair would land wrong. A `processed_webhook_events` table keyed
   on `event.id`, or checking the subscription's `current_period_end`, is the durable fix.
2. **The webhook trusts metadata for the plan.** `metadata.planId` decides the tier, and it is set by
   our checkout — but a `price` → plan mapping read from the subscription's line items would be
   authoritative rather than advisory. Worth doing when the price ids are actually configured.
3. **`HttpStripeGateway` has no retry, timeout, or idempotency key.** A network blip during checkout
   creation surfaces as a 502 to the user, and a retried POST could create a second Checkout Session.
   Stripe's `Idempotency-Key` header is the standard answer; I did not add it because nothing yet
   retries.
4. **No Stripe configuration is documented anywhere.** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_PRO` and `STRIPE_PRICE_TEAM` are read by the code and mentioned in no document —
   the same gap as `RELAY_SECRET` in P5.6-03. `.env.example` is already known to be stale.
5. **The marketing site's pricing page has no path into checkout.** `apps/marketing` sells the tiers
   but its CTAs do not call `/api/v1/billing/checkout`, so the commercial loop is implemented but not
   yet reachable by a user.

## 9. Recommended Next Step

**`P5.6-05` — connect the commercial loop and document its configuration.** Two halves, both small:

1. **Wire the UI.** Point the Pro/Team CTAs on `apps/marketing`'s pricing page at
   `POST /api/v1/billing/checkout` and redirect to `checkoutUrl`; add a "Manage billing" action in
   the account portal calling `POST /api/v1/billing/portal`; render `GET /billing/subscription` on
   the account overview, including the `past_due` state, which currently has no way of reaching a
   user. `AccountLayout` already has a Billing tab with nothing behind it.
2. **Document and de-risk the configuration** (§8.4): a single operations document covering
   `STRIPE_*` and `RELAY_SECRET` — what each is, where to get it, how to rotate it — plus webhook
   event idempotency (§8.1), which is the one correctness gap I would not ship a public beta without.
