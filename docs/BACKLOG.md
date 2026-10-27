# Prioritized acceptance backlog
- Investigation foundation (27 October): campus-scoped assignment, notes, review-with-holds, evidence inspection, durable authenticated reconciliation and receipt discrepancy reporting implemented. This does not complete financial or stock resolution. Next decisions: refund/held-credit release evidence and approvals; custody/disposition rules; packing and partial-handover accounting.
- Completed in Prompt 2: campus-authorized draft editor, immediate/scheduled publication, immutable published commercial terms, deterministic MOQ closure/failure, audited deadline extensions, student edits/cancellation, reviewed failed-color switches, resolution/payment expiry, inbox persistence and BullMQ downtime recovery. See CAMPAIGNS.md for the chosen commercial rules and the stacked PR for executed evidence.
- P0 Foundation: workspace, locked dependencies, migrations, two-campus seed, cookie sessions, tenant RBAC, CI. Verify fresh install and migration repeatability.
- P0 Transaction slice: persist free pledge; deadline/explicit lock creates eligibility; separate paid MOQ gate; deposit and balance; SKU receipt/allocation; single-use pickup. Verify replay and tenant failures.
- P0 Payment provider: Cashfree sandbox adapter, verified webhooks, reconciliation and exception holds implemented. Execute actual credentialed sandbox checkout/webhook rehearsal; fixture/CI results are not provider evidence. Preserve legacy Razorpay records.
- P0 Hardening: execute race tests on multi-connection PostgreSQL, backup/restore rehearsal, session/OTP penetration review.
- P1 Operational breadth: partial line pickup, audited payment-hold/refund resolution, approved stock adjustments, role administration, CSV preview/import, campaign cloning, store windows and reservation expiry.
- P1 Identity/integrations: real OTP delivery, Google OAuth, S3 catalog upload, durable BullMQ outbox notifications and retry/dead-letter observability.
- P1 PWA: manifest and offline shell; public catalog cache, opt-in notifications, real Android/iOS installation checks.
- P1 Release: physical campus rehearsal, approved catalog photography, legal/tax policy, staging provider E2E and production approval.

Completion is recorded in README; a listed issue is not a claim of implementation.

## Next verification priority (25 October audit)
Hosted PostgreSQL 17 / Redis 7 verification is required for each milestone (see STATUS.md and PR checks). Next recommended implementation: audited payment-exception/refund resolution and fulfillment discrepancy handling, with separate approval before any actual refund execution. In parallel, configure Cashfree sandbox keys privately and rehearse real sandbox checkout, verification and delayed webhooks before payment release. Prompt 2 campaign management does not depend on those credentials.
