# CCOOP.IN — implementation slice 01

A private, production-oriented foundation, **not a release-ready complete MVP**.

## Implemented
- Next.js / React / TypeScript editorial storefront, two fictional campuses, three products each, variant selection, accessible native pledge dialog and persisted activity.
- Fastify, Drizzle and PostgreSQL-compatible schema/migration. Explicit development-only PGlite fallback; no browser localStorage for commercial records.
- Server-side free pledges with request replay protection and aggregate per-student limit; deterministic curator lock and color threshold snapshot; eligible pledge conversion to price-snapshotted order.
- Separate deposit/full/balance obligations; local simulator; Razorpay **test-only** Order API adapter and raw-body signed capture webhook. Fixtures verify signatures, replay, mapping and amounts; actual provider sandbox remains untested without keys.
- Admin paid-demand gate; SKU production manifest; host healthy/damaged receipt reconciliation; stock exception handling, allocation, and immutable application-level movement history.
- Full payment + physical allocation required for short-lived rotating opaque QR passes; hashed tokens, one-use host handover and atomic stock decrement.
- In-app notification outbox, audit trail, tenant authorization, origin checking, secure production cookie flags, development OTP challenge/verify with expiry/attempt limits, Google ID-token verification endpoint.
- Redis/BullMQ worker skeleton reports pending notifications; it does **not** deliver email/SMS or mark deliveries successful.
- PWA manifest, icon and offline navigation shell. No financial/identity responses cached.
- Docker Compose PostgreSQL 17/Redis 7; GitHub Actions definition; 18 independently verified domain/API tests; full four-role Playwright rehearsal (see docs/STATUS.md).

## Run with PostgreSQL (canonical environment)
Node 22+ and Docker Compose are required.

```bash
npm ci
cp .env.example .env
docker compose up -d
npm run db:seed
npm run dev
```

Open http://localhost:3000. API binds 127.0.0.1:4000; Next proxies `/v1`. This origin is enforced for mutations. Set `APP_ORIGIN` when changing the origin. `.env` is loaded by API/seed/worker scripts. The frontend receives no secrets.

For development without a PostgreSQL server:

```bash
DEV_AUTH=true DATABASE_URL= PAYMENT_MODE=simulator npm run dev
```

This uses filesystem-persisted PGlite in `.data/postgres`. Never use this fallback for production or to claim multi-connection concurrency validation. Do not run two API processes over the same PGlite directory. The worker requires an external PostgreSQL server and Redis.

## Rehearse the vertical slice
1. Sign in as **student**, view Northfield hoodie, pledge **2 units** (pilot MOQ = 2).
2. Switch the development identity to **curator**, open Operations, explicitly close pledges and evaluate MOQ.
3. Switch to student, My activity → Confirm purchase → Pay 50%. In simulator mode no gateway is contacted and no money moves.
4. Switch to **admin**, Operations → Approve paid production. Unpaid pledged demand alone fails this gate.
5. Switch to **host**, Operations → count every SKU → Confirm receipt. Enter actual healthy/damaged quantities; shortages can withhold allocation.
6. Student → My activity → pay balance → Get pickup pass. A QR and copyable opaque token appear for 10 minutes.
7. Host → Operations → paste pass → Verify & confirm physical handover. A second handover fails; on-hand and allocated counts reduce together.

Curator and host are assigned only to Northfield; Westbridge browsing works, operational access is denied. Admin can operate all campuses. Test identity buttons are enabled only with `DEV_AUTH=true` outside production. No passwords are bundled.

## Razorpay test configuration
Set `PAYMENT_MODE=razorpay`, `RAZORPAY_KEY_ID=rzp_test_...`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in the runtime environment. Live keys are rejected. Configure provider `payment.captured` webhooks at `/v1/payments/webhook` on an HTTPS staging host. Gateway checkout callbacks never settle an order; the signed server webhook does. Do not paste keys into chat or commit `.env`.

Pending gateway creation interrupted by a crash can leave an orphan provider order: retry/reconciliation hardening remains a release blocker. Expired obligations with actual captured funds are recorded; late initial captures after production approval become payment exceptions, never silently join production.

## Verify
```bash
npm run typecheck
npm test
npm run build
# Dedicated disposable PostgreSQL database only, name must include test:
DATABASE_URL=postgres://ccoop:ccoop@localhost:5432/ccoop_test npm test
# Install Chromium once; browser tests start their own API/frontend and isolated database:
npx playwright install chromium
npm run test:e2e
```
Tests truncate their isolated test database. Never point them at business data. CI uses `ccoop_test`. Browser tests create a fresh `.data/browser-test-*` database on each run and refuse to reuse servers on ports 3000/4000. Stop development servers before running. Screenshots are saved to `artifacts/`. Domain/API test files run serially to prevent truncation races on native PostgreSQL.

## Independent verification
See [docs/STATUS.md](docs/STATUS.md) for executed checks and [docs/AUDIT.md](docs/AUDIT.md) for findings. Original 16 tests plus 2 API regressions pass; strict type checking and the production build pass. Native PostgreSQL/Redis and real provider integrations remain unverified.

## Remaining scope / release blockers
Campus Store reservations/expiry/checkout and operating windows; actual product/drop authoring; failed-color self-service switching and cancellations; partial item pickup; camera scanner; phone OTP and real email/SMS delivery; Google sign-in UI; S3 uploads; refunds and adjustment approval; role administration; shipping state detail; external notifications; PWA install/device testing; approved photos/content and operational rehearsal. See `docs/BACKLOG.md`.

The supplied Git bundle history was restored locally on `codex/verify-slice-01`. No remote is configured, so no remote push or hosted CI run has occurred. No public deployment or real payment has been attempted.
