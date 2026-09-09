# Billing (frozen)

## WHAT

Stripe Checkout and Customer Portal sessions created over raw HTTPS (no SDK), a signed-webhook listener that updates `accounts.current_plan_id`, and a plan/entitlement model (`free`, `pro`, `team`, `enterprise`). None of it is reachable from the product at launch: there is no paid feature and the account portal is removed from navigation.

## WHERE

`apps/server/src/services/BillingService.ts`, `PlanService.ts`, `EntitlementService.ts`, `routes/billing.ts`, `routes/webhooks.ts`, `services/__tests__/BillingService.test.ts`.

## HOW (when enabled)

`STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`, `STRIPE_WEBHOOK_SECRET` set → `POST /api/v1/billing/checkout {planId}` creates a session with `client_reference_id = accountId`; `POST /api/v1/webhooks/stripe` verifies `stripe-signature` (HMAC-SHA256, 300 s tolerance) and updates the plan on `customer.subscription.*` and `invoice.payment_failed`.

## CONTRACT

- Unsigned webhooks are refused (503) unless `ASTERIM_ALLOW_UNSIGNED_STRIPE_WEBHOOKS=true` (local testing only). Fixed 2026-09-08.
- Plan changes never affect the local core loop; the Community edition is never gated.

## Known defects to fix before any launch of billing

- Entitlements are minted into the JWT and the refresh endpoint hard-codes them (debt D22).
- Prices differ between code ($19/$49) and the old site ($20); neither validated.
- No customer record is created on registration, so the first checkout must create one.

## DO NOT

- Do not turn billing on before a paid feature works end to end and FD-H is decided.
