# Cashfree / native verification status — 26 October 2026

Baseline preserved: 39590783e929e65e21ec292858f668dc602f3756. Branch: codex/cashfree-postgres-verification. Scope excludes Campus Store, unrelated campaign management, live payments and public deployment.

## Evidence categories

| Category | Actual evidence |
|---|---|
| 1. Fixture tests | 35 passed locally: original domain/API behavior, Cashfree adapter/signatures/retries/history/expiry/ownership, legacy migration preservation. In-memory/file PGlite; no real provider calls. |
| 2. Native PostgreSQL / Redis | Hosted run 40276124361 passed on 94b17ed: 34 domain/API/provider/migration fixtures, PostgreSQL 17 migration/seed twice, and 10 native tests including deliberate multi-connection overlaps and a real Redis 7/BullMQ job. The subsequent odd-paise fixture raises the local fixture count to 35; see PR checks for the final commit run. |
| 3. Simulator browser | Both local and hosted Chromium tests passed on the Cashfree integration. 390px and desktop screenshots, keyboard dialog controls, rate-limit recovery, stock/replay assertions. Both local Chromium tests passed, including the delayed-account-response regression (1.2 minutes total). |
| 4. Actual Cashfree sandbox | NOT EXECUTED. CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET are absent; no .env file is present. Domain whitelisting and a provider-reachable webhook endpoint also remain to be configured for a full provider rehearsal. |

Type checks and production build passed locally. Hosted evidence: https://github.com/vittalvandavasu/ccoop-platform/actions/runs/40276124361
Review PR (unmerged): https://github.com/vittalvandavasu/ccoop-platform/pull/1
Latest branch checks: https://github.com/vittalvandavasu/ccoop-platform/actions?query=branch%3Acodex%2Fcashfree-postgres-verification

No external notification delivery is claimed: the real worker reports outbox counts and leaves delivered_at null. CI never loads provider credentials. No real student data or real payments were sent to a provider.

## Configuration handoff

### PR #1 payment-provider isolation review fix

Razorpay order creation now requires the selected provider to be Razorpay. Configured credentials alone cannot send simulator checkout to a gateway. Existing obligations retain their provider; conflicting checkout and simulation requests are rejected.

Five HTTP regression cases intercept the real Razorpay SDK's Axios transport and Cashfree's fetch transport using dummy credentials. They verify zero gateway calls for simulator full/deposit/balance checkout, settlement and retries; exact credits with no duplicate financial events; preservation of Cashfree/Razorpay obligations; and normal Razorpay order creation/reuse when selected. The simulator regression reproduced the unwanted mocked Razorpay order before the fix.

Local validation: all 40 fixture tests passed, strict type checking passed, production build passed, and both Chromium journeys passed. Native PostgreSQL/Redis verification runs in the existing GitHub Actions workflow; see PR #1 review evidence for the final commit's actual run and result. Actual Cashfree sandbox transactions remain unverified and are required before payment release.

Configure sandbox PG credentials directly in the ignored local `ccoop-platform/.env` (see `.env.example` and README). Use PAYMENT_PROVIDER=cashfree, CASHFREE_ENV=sandbox and the exact APP_ORIGIN. Do not paste secrets into chat. Configure Cashfree's allowed domain and sandbox webhook endpoint/version/events as described in README. Callback delivery requires separately authorized reachable hosting; this milestone does not expose the application publicly.

## Remaining risks / next step

Actual hosted checkout and provider request/response behavior need a credentialed sandbox rehearsal. Refund/exception resolution is intentionally manual and blocks affected orders. Legacy Razorpay timeout recovery, real OTP/email/SMS, Google UI, S3, store reservations and broad campaign management remain incomplete. Firefox/WebKit, actual phones, screen readers and PWA installation were not exercised.

Proceed to Prompt 2 for campaign management after reviewing this PR and its final CI result, while retaining actual Cashfree sandbox verification as a release gate. Do not treat this as payment launch readiness.
