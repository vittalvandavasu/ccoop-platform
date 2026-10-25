# Prioritized acceptance backlog
- P0 Foundation: workspace, locked dependencies, migrations, two-campus seed, cookie sessions, tenant RBAC, CI. Verify fresh install and migration repeatability.
- P0 Transaction slice: persist free pledge; deadline/explicit lock creates eligibility; separate paid MOQ gate; deposit and balance; SKU receipt/allocation; single-use pickup. Verify replay and tenant failures.
- P0 Payment provider: Razorpay test Order API and signed captured webhooks, exact amount/currency/provider mapping. Verify on provider sandbox after keys supplied.
- P0 Hardening: execute race tests on multi-connection PostgreSQL, backup/restore rehearsal, session/OTP penetration review.
- P1 Operational breadth: failed-color switching, cancellation, partial line pickup, refunds, approved stock adjustments, role administration, CSV preview/import, store windows and reservation expiry.
- P1 Identity/integrations: real OTP delivery, Google OAuth, S3 catalog upload, durable BullMQ outbox notifications and retry/dead-letter observability.
- P1 PWA: manifest and offline shell; public catalog cache, opt-in notifications, real Android/iOS installation checks.
- P1 Release: physical campus rehearsal, approved catalog photography, legal/tax policy, staging provider E2E and production approval.

Completion is recorded in README; a listed issue is not a claim of implementation.

## Next verification priority (25 October audit)
Run the serialized domain/API suite and additional payment/approval races against a dedicated native PostgreSQL database, and start Redis/BullMQ on a Docker-capable host. See AUDIT.md for unresolved findings. Prompt 2 remains the next implementation scope after review.
