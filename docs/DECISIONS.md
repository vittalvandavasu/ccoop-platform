# Architecture decisions — Cashfree milestone, 26 October 2026

The original commercial decisions remain: free pledges; explicit eligibility lock; separate paid-demand production gate; purchase allocates stock and physical pickup decrements it; all operations are campus-scoped. Next.js, Fastify, Drizzle, PostgreSQL and Redis/BullMQ remain the architecture.

Cashfree is the preferred provider for new obligations. A provider-neutral obligation/ledger model owns financial state; Cashfree REST and legacy Razorpay adapters operate at the boundary. We pin the documented 2025-01-01 Cashfree contract and use fixed sandbox endpoints. Direct REST lets us retain decimal numeric source strings before integer conversion without additional SDK dependencies. The official SDK and current official API/checkout/webhook documentation were reviewed (links in README).

Versioned transactional migrations adopt existing 001 installations. Existing mappings and ledger values are retained. Provider-scoped transaction/order uniqueness replaces global gateway uniqueness. Known simulated records and Razorpay-linked records keep their identities; unidentifiable legacy obligations are marked legacy_unknown for manual review.

Only authenticated server observations can settle money. Webhook signature verification uses the PG client secret and raw timestamp+body. Cashfree supports delayed retries and resends; timestamp syntax is validated but no arbitrary age cutoff is enforced. Durable provider transaction deduplication prevents replay. The authenticated Get Order response verifies customer ownership even when webhook customer details are omitted.

Cashfree creation uses an obligation UUID idempotency key and deterministic order ID persisted before network I/O. Recovery fetches that ID. Provider timeouts leave recoverable intent, and uncertain expired attempts cannot silently start a replacement. Order/database locks are not held across network requests.

Financial records distinguish received amount from applied amount. Distinct successful transactions are never silently dropped. Overpayment, expired completion, initial settlement after campaign approval and existing payment holds create evidence plus an operations hold. No automatic refund, stock reversal or production insertion occurs. A timely provider success delivered after expiry remains admissible only if the campaign is still eligible; the provider timestamp does not reopen an approved campaign.

Lock order for admission, settlement and production is campaign -> order -> obligation. Native tests use separate PostgreSQL pools, hold a conflicting lock and observe both blocked sessions before releasing it. PGlite is reserved for isolated fixture/browser convenience and is not race evidence.

BullMQ polls persisted obligations to recover missing webhooks, rotates attempts through bounded batches and records sanitized reconciliation failures. Its outbox behavior remains counting only; external delivery is not implemented. All provider customer details are fictional, and no sandbox credentials are passed to CI.
