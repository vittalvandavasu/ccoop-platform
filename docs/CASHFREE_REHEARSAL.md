# Cashfree sandbox rehearsal — NOT EXECUTED

This is a reproducible acceptance checklist, not provider evidence. No local .env, CASHFREE_CLIENT_ID or CASHFREE_CLIENT_SECRET was found on 27 October 2026. Native DATABASE_URL/REDIS_URL were also unset. Never paste credentials or raw authenticated requests into chat, source, screenshots or logs.

## Prerequisites

Use an isolated synthetic-data database and sandbox merchant account. Supply server-only credentials through an ignored .env or protected runtime store, PAYMENT_PROVIDER=cashfree, CASHFREE_ENV=sandbox, the exact APP_ORIGIN, native PostgreSQL and Redis. Verify allowed-domain registration and a separately authorized provider-reachable webhook environment. This checklist does not authorize hosting, a tunnel or public deployment. Use the configured provider's documented test instruments; no live money or real student information. Confirm production simulator guards, migrations, backups and named operators before starting.

Run npm ci, npm run db:seed twice, npm run typecheck, npm test, npm run test:native, npm run build and npm run test:e2e against disposable test data first. Start the API/web application and npm run worker in the authorized rehearsal environment. Use curator/student/admin/host roles with explicit campus membership. Do not truncate the rehearsal database with the test commands.

## Record each scenario

Record timestamp, commit, synthetic campaign/order/obligation IDs, provider order/payment IDs, expected paise, received/applied paise, sanitized state/audit IDs, operator and pass/fail. Never retain secrets, auth headers, signatures, checkout session tokens or customer PII in evidence. Provider IDs belong in restricted evidence storage, not public screenshots.

| Scenario | Automated evidence | Actual sandbox acceptance |
|---|---|---|
| Closure and eligibility | Campaign fixture/native/browser cases | Close a campaign, resolve failed colors, confirm only eligible pledges convert |
| Obligation/create/retry | Cashfree create/idempotency fixtures | One immutable obligation and provider order across retry; exact amount/customer binding |
| Checkout/server verification | Adapter and simulated browser fixtures only | Complete sandbox checkout; browser return alone must not credit; authenticated verification credits once |
| Valid/duplicate/delayed webhooks | Raw HMAC and event dedupe fixtures | Observe genuine callback; replay only via approved provider mechanism; one applied credit |
| Pending/failed/dropped and retry | Attempt/history fixtures | Exercise provider-supported outcomes; retain each attempt; no false credit |
| Multiple successful attempts | Overpayment fixtures | If provider sandbox cannot produce this, record NOT EXERCISED; never manufacture a provider result and call it real |
| Late verification/expiry | Native expiry race and delayed-success fixtures | Interrupt callback delivery/worker, restore them; distinguish timely completion from late completion and retain holds |
| Worker interruption | BullMQ recovery and mocked reconciliation fixtures | Stop/restart worker, recover persisted due transitions and provider status without losing attempts |
| Invalid amount/reference evidence | Rejection fixtures | Use only provider-supported sandbox scenarios; otherwise retain automated-only classification |
| Deposit/balance/handover | Full adapter fixture journey | Verify paid gate, physical receipt, balance verification and one-time pickup; no automatic hold release |

After each scenario compare orders.paid with SUM(payment_events.credited_amount); inspect immutable receipts, attempts/observations, exceptions and audit. Confirm original provider identity, no double credit, no negative stock, and pending obligations survive expiry. Failure means keep the release gate closed; preserve sanitized evidence and investigate. Do not clear flags or edit counters to make the rehearsal pass.

Business-policy gates remain separate: no automatic refunds, no manual mark-as-paid, no applying held money, and no making quarantined/excess/incorrect items available. Investigation notes may record evidence and ownership while the hold remains.
