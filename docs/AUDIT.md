# Audit — Cashfree / native verification, 26 October 2026

## Prompt 2 campaign-management review

- Migration 004 adds scheduling, revisions, original pledge-request payloads, immutable order snapshots and persisted mutation responses. It preserves existing money, provider mappings, obligations and orders. Legacy order snapshots are explicitly identified.
- Curator drafts are absent from public catalog routes. Server-side authorization scopes curator/admin actions to their campus. Published/scheduled commercial edits are rejected; only draft catalog revisions and audited active-phase deadline extensions are allowed.
- Campaign-first locking serializes edits/cancellation, close, switches/expiry, conversion, payment expiry and verification. Creation request payloads survive later pledge edits, so replay does not create another pledge. Close, publication, extensions and pledge decisions have durable replay protection.
- Resolution is explicit and price-reviewed. Category MOQ counts eligible-color units; size variants have no independent MOQ. Failed campaigns and expired/canceled free pledges create no refund or credit entitlement. Paid-demand production approval remains separate.
- Expiry never deletes orders or gateway attempts. Timely late verification is permitted while PAYMENT_CLOSED; existing late-payment holds and production exclusion remain. Simulator isolation tests and provider fixtures remain in the default suite.
- Worker recovery handles all overdue phases and writes audit/outbox records transactionally. The real Redis worker test verifies scheduled publication and replay; native race tests deliberately overlap connections. Inbox persistence is implemented, external delivery is not.
- Browser journeys cover draft edit/publication/scheduling, pledge edits, explicit color review/conversion, keyboard operation, campus denial, and 390px layouts alongside the original commerce/privacy journeys. Screenshots are retained in the CI browser-evidence artifact. Consult STATUS and the stacked PR for executed results.

Remaining campaign-adjacent gaps: media upload, catalog import, campaign cloning, bulk tools and external delivery. Actual Cashfree sandbox transactions remain unverified and block payment release, not campaign development. Campus Store, public deployment and live payments are excluded.

Historical PR #1 audit follows. Baseline 3959078 and its Cashfree/hosted infrastructure work are retained. Original session, malformed Razorpay signature, identity-state and test isolation fixes remain.

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

Campaign failure/cancellation/expiry management is implemented in Prompt 2 above. Campus Store reservations, quarantine disposition, partial pickup, real OTP/external notifications, Google sign-in UI, S3 and device/PWA testing remain backlog items. No public deployment or production readiness claim is made.

See STATUS.md for executed evidence and the final hosted run. The PR is for review only and must not be merged automatically.

Final review also corrected whole-rupee UI rounding: paise are now displayed exactly when nonzero. A regression verifies an odd-paise deposit rounds upward and leaves the exact remaining balance.
