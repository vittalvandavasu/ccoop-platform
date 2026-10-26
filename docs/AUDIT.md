# Audit — Cashfree / native verification, 26 October 2026

Baseline 3959078 retained; current branch implements the requested Cashfree and hosted infrastructure milestone only. Original session, malformed Razorpay signature, identity-state and test isolation fixes remain.

## Changes reviewed

- Added migrations 002/003 and a version ledger with PostgreSQL advisory locking. A migration fixture starts from the original schema and verifies that legacy funds/provider identities survive repeat startup.
- Cashfree obligations remain separate from provider attempts, immutable successful receipts, application credits, and exceptions. Monetary parsing uses numeric JSON source strings and BigInt decimal conversion; no floating-point multiplication/rounding is used.
- Deterministic creation intent/idempotency survives a remote-create timeout or local crash. Expired attempts reconcile before replacement; uncertain remote state fails closed.
- Signature fixtures cover missing/malformed/tampered values and legitimate delayed retries. Successful events cannot be downgraded, replayed across obligations, or credited twice. Overpayment retains both receipts and blocks fulfillment pending review.
- Student history/status controls use authenticated APIs. Checkout callback/redirect has no authority to credit funds. Admin exceptions are campus-filtered and no refund is silently issued.
- Cashfree sandbox endpoint and frontend mode are fixed. Production gateway configuration is rejected; production simulator is forbidden. No real customer fields are sent.
- Payment admission/settlement now follow the same campaign-first lock order as production. Native CI observes overlapping transactions using pg_stat_activity, rather than relying on Promise.all alone.
- The worker is exported for real Redis/BullMQ verification; it reports pending outbox records without marking them delivered. Reconciliation failures remain visible and are rotated so one unavailable order cannot starve all later batches.
- Account changes now invalidate in-flight activity responses as well as clearing rendered QR/form state. Browser regression delays an old response across an identity switch.

## Remaining limitations

Actual Cashfree credentials, allowed checkout domain and provider-reachable callback endpoint are absent. Fixture and simulator successes are not sandbox transaction evidence. Offers, surcharges and partial captures are not supported; mismatched amounts/currency are rejected for investigation. Provider configuration/secret rotation still requires an operational rehearsal. Webhooks that cannot validate the authenticated order return an error so Cashfree can retry; background reconciliation also retries.

Payment holds require manual operations/refund review; this milestone does not implement provider refund execution or a hold-resolution workflow. Ambiguous legacy obligations must be reconciled manually. Legacy Razorpay remote timeout recovery is unchanged.

Campaign failure/cancellation/expiry management, Campus Store reservations, quarantine disposition, partial pickup, real OTP/external notifications, Google sign-in UI, S3 and device/PWA testing remain backlog items. No public deployment or production readiness claim is made.

See STATUS.md for executed evidence and the final hosted run. The PR is for review only and must not be merged automatically.
