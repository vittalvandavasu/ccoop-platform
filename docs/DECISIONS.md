# Architecture decisions — Cashfree milestone, 26 October 2026

Release assurance continuation: [POLICY_REGISTER.md](POLICY_REGISTER.md) records refund, held-credit and stock-disposition questions, alternatives, consequences, recommended safeguards and approving roles. Every entry is PROPOSED / NOT APPROVED. No policy approval is inferred from implementation or CI. [RELEASE_ASSURANCE.md](RELEASE_ASSURANCE.md) and [OPERATIONS_READINESS.md](OPERATIONS_READINESS.md) record the cumulative audit and external gates.

## Investigation-first scope (27 October)

The user authorized investigation, assignment, notes and verified reconciliation while retaining all financial/stock holds. Operational cases reference existing obligations or receipt/SKU lines and cannot replace the ledgers. REVIEWED_HELD means only that an operator reviewed evidence. Incorrect/excess physical observations never enter stock. Financial release, refunds, replacements, inventory corrections, packing and partial handover require separate business rules. Read queues use repeatable-read snapshots; payment review verifies an evidence fingerprint under the existing campaign/order/obligation lock order. Reconciliation jobs have persisted leases and reuse provider-idempotent verification outside locks. Details: INVESTIGATIONS.md.

## Prompt 2 campaign decisions

The normative campaign policy is [CAMPAIGNS.md](CAMPAIGNS.md). Category MOQ counts eligible-color units at final resolution, colors aggregate across sizes, and reaching a threshold never closes pledging. When failed colors exist, all conversion waits for explicit decisions or expiry. This supersedes the earlier immediate-payment interpretation. Published commercial details are immutable; draft revisions and audited deadline extensions use request keys and optimistic revisions under campaign locks.

BullMQ uses a recurring deadline scan rather than relying solely on individual delayed jobs. Persisted state/deadlines are authoritative, so losing Redis jobs or worker downtime cannot lose transitions. Payment expiry closes invitations without canceling paid orders or deleting uncertain gateway attempts. Timely settlement is still admissible in PAYMENT_CLOSED, while production remains a separate paid-demand gate. Campus admins now require explicit campus role membership; the earlier global admin shortcut is removed.

The original commercial decisions remain: free pledges; explicit eligibility lock; separate paid-demand production gate; purchase allocates stock and physical pickup decrements it; all operations are campus-scoped. Next.js, Fastify, Drizzle, PostgreSQL and Redis/BullMQ remain the architecture.

Cashfree is the preferred provider for new obligations. A provider-neutral obligation/ledger model owns financial state; Cashfree REST and legacy Razorpay adapters operate at the boundary. We pin the documented 2025-01-01 Cashfree contract and use fixed sandbox endpoints. Direct REST lets us retain decimal numeric source strings before integer conversion without additional SDK dependencies. The official SDK and current official API/checkout/webhook documentation were reviewed (links in README).

Versioned transactional migrations adopt existing 001 installations. Existing mappings and ledger values are retained. Provider-scoped transaction/order uniqueness replaces global gateway uniqueness. Known simulated records and Razorpay-linked records keep their identities; unidentifiable legacy obligations are marked legacy_unknown for manual review.

Only authenticated server observations can settle money. Webhook signature verification uses the PG client secret and raw timestamp+body. Cashfree supports delayed retries and resends; timestamp syntax is validated but no arbitrary age cutoff is enforced. Durable provider transaction deduplication prevents replay. The authenticated Get Order response verifies customer ownership even when webhook customer details are omitted.

Cashfree creation uses an obligation UUID idempotency key and deterministic order ID persisted before network I/O. Recovery fetches that ID. Provider timeouts leave recoverable intent, and uncertain expired attempts cannot silently start a replacement. Order/database locks are not held across network requests.

Financial records distinguish received amount from applied amount. Distinct successful transactions are never silently dropped. Overpayment, expired completion, initial settlement after campaign approval and existing payment holds create evidence plus an operations hold. No automatic refund, stock reversal or production insertion occurs. A timely provider success delivered after expiry remains admissible only if the campaign is still eligible; the provider timestamp does not reopen an approved campaign.

Lock order for admission, settlement and production is campaign -> order -> obligation. Native tests use separate PostgreSQL pools, hold a conflicting lock and observe both blocked sessions before releasing it. PGlite is reserved for isolated fixture/browser convenience and is not race evidence.

BullMQ polls persisted obligations to recover missing webhooks, rotates attempts through bounded batches and records sanitized reconciliation failures. Its outbox behavior remains counting only; external delivery is not implemented. All provider customer details are fictional, and no sandbox credentials are passed to CI.
