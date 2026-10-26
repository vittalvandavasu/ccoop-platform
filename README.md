# CCOOP.IN — Cashfree sandbox and native verification

Private campus collective commerce implementation. Next.js/React/TypeScript/Tailwind frontend, Fastify API, Drizzle/PostgreSQL persistence and Redis/BullMQ worker. Editorial design retained. This is not a complete MVP or a live-payment release.

## Setup

Node 22+ is required (lossless JSON numeric source support). Install exactly from the lockfile with `npm ci`. Copy `.env.example` to the ignored `.env` **locally**, then supply runtime values there. Never place secrets in chat, source, screenshots, `NEXT_PUBLIC_*` variables or workflow logs.

With Docker: `docker compose up -d`, `npm run db:seed`, then `npm run dev`. Run `npm run worker` in a separate terminal. API: 127.0.0.1:4000; frontend: http://localhost:3000. Migrations run automatically under a PostgreSQL advisory lock and version ledger. Seeding is repeatable and preserves commercial records.

Without Docker, set `DATABASE_URL=` and `PAYMENT_PROVIDER=simulator`, `DEV_AUTH=true` in `.env`. The API uses persisted `.data/postgres` PGlite. Do not run two processes over that directory. The worker requires native PostgreSQL and Redis. PGlite is never native concurrency evidence.

## Secure Cashfree sandbox configuration

| Variable | Required value / purpose |
|---|---|
| PAYMENT_PROVIDER | `cashfree` (preferred/default); `simulator` only for isolated development |
| CASHFREE_ENV | `sandbox`; all other values are rejected |
| CASHFREE_CLIENT_ID | Your sandbox PG App ID, server-only |
| CASHFREE_CLIENT_SECRET | Your sandbox PG secret, server-only; also verifies webhook HMAC |
| APP_ORIGIN | Exact frontend origin, e.g. `http://localhost:3000`; mutation origin checks use it |
| DATABASE_URL | Native PostgreSQL application database for rehearsal |
| REDIS_URL | Redis connection used by BullMQ |
| DEV_AUTH | `true` only outside production to use fictional seeded identities |

Retrieve sandbox PG keys from Cashfree Merchant Dashboard > Developers > API Keys and enter them in the local ignored `.env` using your editor. There is **no separate Cashfree webhook secret**. CI has no gateway credentials and runs fixtures only. If a future private rehearsal needs hosted secrets, put them in its protected runtime secret store; this workflow must not receive them.

The adapter fixes its endpoint to `https://sandbox.cashfree.com/pg` and pins API version `2025-01-01`, a documented supported version. It uses direct REST to preserve exact numeric JSON lexemes and integer-paise accounting, rather than introducing another SDK dependency. The checkout script is `https://sdk.cashfree.com/js/v3/cashfree.js`, always initialized with `mode: 'sandbox'`. Browser callbacks only trigger backend verification.

Whitelist the rehearsal frontend domain in Cashfree. Configure the sandbox webhook endpoint `/v1/payments/cashfree/webhook`, webhook version `2025-01-01`, for Success Payment, Failed Payment and User Dropped Payment. Localhost cannot receive Cashfree callbacks directly: a provider-reachable, separately authorized endpoint is needed for actual webhook delivery. No public application/tunnel is deployed by this milestone. Backend status verification can still recover missing webhooks via authenticated API calls.

Only synthetic customer references (`test_<obligation UUID>`) and the documented sample phone `9999999999` are sent by the adapter. Names, student emails and real phone numbers are never sent. Use only Cashfree's sandbox test instruments; offers/surcharges/partial captures are not supported by this exact-amount integration.

## Rehearse the commercial journey

1. Student pledges 2 Northfield hoodie units, free and nonbinding.
2. Curator closes the campaign and records eligible color demand.
3. Student confirms the purchase and pays a 50% deposit (or full amount).
4. Admin separately approves sufficient verified paid demand.
5. Host receives and reconciles healthy/damaged quantities.
6. Student pays the remaining balance, then obtains a short-lived pickup pass.
7. Host verifies physical handover. Replays do not decrement stock again.

The simulator is visibly labeled and unavailable in production. It never calls Cashfree. A deposit alone never permits pickup. Student payment history lists obligations, attempts, received/applied money and exceptions; Check payment status asks the backend to verify Cashfree directly. Expired/abandoned sessions are distinguished from verified failure or success. Closing checkout does not mark an order paid.

## Payment safety and exception policy

- Every obligation has an immutable provider identity and amount snapshot. Reusing a pending obligation with a different provider fails. Existing Razorpay order mappings/events remain Razorpay; known simulated events remain simulator. Ambiguous legacy obligations are tagged `legacy_unknown` and require review rather than guessed reassignment.
- Cashfree order IDs and idempotency keys are persisted before network calls. Retries fetch the same order and reuse the same key; a timeout never generates a replacement ID. Before replacing expired attempts, reconcile remote status; provider uncertainty fails closed.
- Signatures authenticate `timestamp + original raw body` using HMAC-SHA256 and base64. No arbitrary freshness cutoff rejects delayed retries/resends. Financial deduplication uses provider plus transaction ID, not timestamps or browser claims.
- Successful provider transactions are retained individually. A second success for an obligation is an OVERPAYMENT exception, with no second application of funds. Failure/pending events never overwrite a successful attempt.
- Success completed after obligation expiry is held for review. A timely success delivered late can be applied while the campaign remains eligible. Initial funds discovered after production approval are held and never join the batch. Existing holds block further checkout/production/pickup.
- Payment exception amounts are received money, **not** refundable credit or an automatic refund. Admin Operations exposes the reason, order, provider and amount. Refund execution and audited resolution are still manual/out of scope; do not clear holds by editing counters.
- The worker polls Cashfree obligations in bounded, rotating batches to reconcile delayed/missing webhooks and persists a sanitized retry error. It also reports pending outbox rows. It does **not** deliver external notifications or mark them delivered.

Legacy Razorpay test-only adapter and `/v1/payments/webhook` remain available when test keys are configured. `PAYMENT_MODE` is a legacy fallback when `PAYMENT_PROVIDER` is absent. Razorpay provider-timeout reconciliation remains a legacy limitation.

## Verification commands

```text
npm run typecheck
npm test
npm run build
npm run test:native
npx playwright install chromium
npm run test:e2e
```

`npm test` runs domain/API/Cashfree fixtures and an old-schema migration fixture. Without DATABASE_URL, domain/API tests use in-memory PGlite. The migration fixture always uses a separate `.data/migration-test-*` database. Native tests require a disposable PostgreSQL database with `test` in its name plus REDIS_URL; they refuse PGlite. **Tests truncate their database**; never use business data. Test files run serially; race tests use two independent pools and observe deliberate overlapping row-lock waits.

GitHub Actions provisions PostgreSQL 17 and Redis 7, seeds twice, runs fixtures/races/worker, checks types/build, and runs Chromium with a **separate** PGlite browser database. Browser tests own ports 3000/4000 and refuse existing servers; stop development services first. Screenshots are in `artifacts/` and uploaded as the private workflow's `browser-evidence` artifact. Fixtures and simulator runs are not actual Cashfree sandbox evidence.

See [STATUS](docs/STATUS.md), [AUDIT](docs/AUDIT.md), [DECISIONS](docs/DECISIONS.md) and [BACKLOG](docs/BACKLOG.md). No live payments, repository visibility change, merge or public deployment is part of this milestone.

## Official integration references

- [Create order / idempotency](https://www.cashfree.com/docs/api-reference/payments/latest/orders/create-order)
- [Hosted checkout](https://www.cashfree.com/docs/payments/online/web/redirect)
- [Payment attempts API](https://www.cashfree.com/docs/api-reference/payments/latest/payments/get-payments-for-an-order)
- [Webhook signature](https://www.cashfree.com/docs/payments/online/webhooks/signature-verification)
- [Payment webhook payloads](https://www.cashfree.com/docs/api-reference/payments/latest/payments/webhooks)
- [Retries/resends](https://www.cashfree.com/docs/payments/online/webhooks/overview)
- [Official Node SDK reviewed](https://github.com/cashfree/cashfree-pg-sdk-nodejs)
