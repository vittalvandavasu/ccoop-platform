# Investigation-first operational review

Approved scope: investigation, assignment, notes and authenticated reconciliation. A reviewed case retains its financial and stock holds. This is the foundation of the next milestone, not completion of refund/credit-release, stock-correction, packing or partial-handover workflows.

## Authoritative sources

Payment candidates derive from payment_exceptions, expired unverified obligations, reconciliation failures and legacy-unknown mappings. The queue shows expected paise, immutable received/applied events, attempts, provider references, student/order/campaign IDs and last verification. Unsupported or mismatched evidence is rejected by existing verification; absent observations are not represented as received money. Opening a case references an existing obligation, not a second ledger.

Fulfillment candidates derive missing (expected minus healthy minus damaged) and damaged quantities from saved receipt lines. Manifest expected quantities come from production/arrival/stock-exception/collected orders; received quantities come from receipt lines; handover counts come from collected order states maintained by the atomic pickup flow. Outstanding means not handed over, not necessarily missing. Packing remains unrecorded (null), never guessed. Incorrect/excess reports are immutable operator observations tied to a receipt/SKU, not inventory receipts; their quantity does not enter stock availability. Additional context is appended as notes.

## Authorization and actions

Payment investigations require an admin role in the relevant campus. Fulfillment investigations require host/admin in that campus. Assignments validate the assignee against the same scope. Curators and students cannot investigate, even if they know source IDs.

OPEN -> INVESTIGATING via assignment; REVIEWED_HELD records completed review without resolving the underlying money/stock discrepancy; REOPEN returns to OPEN. Notes can be appended in any state. Every action requires a reason, accepts a non-secret supporting reference and records actor/time, before/after revision and outcome. Request keys bind actor/payload and return the saved result. Stale revisions fail. Payment review also checks a fingerprint of the displayed evidence under campaign/order/obligation locks; queue reads use a repeatable-read snapshot.

No case action edits payment_events, obligations.amount/provider, orders.paid/payment_hold/commercial_snapshot, stock, receipts or handover records. There is no mark-as-paid, refund, hold-clear, replacement or stock-release action. Reviewed status describes the review only; later evidence remains visible in the source records and may require reopening.

## Verified reconciliation and recovery

RECONCILE persists a QUEUED action rather than calling a provider in the request transaction. It requires a mapped Cashfree obligation. The existing native BullMQ worker claims actions with FOR UPDATE SKIP LOCKED and a two-minute lease, rechecks operator authorization, then calls existing authenticated reconciliation outside locks. Same-obligation queued work is rejected while another action is active. Settlement remains provider-evidenced and idempotent under the original financial rules; holds are never cleared.

Errors are sanitized. Three executions are allowed, with 30-second retry availability; an interrupted PROCESSING lease is recoverable. Lease tokens prevent stale completions from overwriting a reclaimed job. A crash after provider verification but before job completion safely replays reconciliation; provider event deduplication prevents double credit. Each completed attempt records an audit outcome. FAILED actions remain visible and a new reasoned request can be queued. Missing credentials or simulator mode leave requests queued and make no gateway calls. Native workers with Cashfree sandbox credentials are required for execution.

## Deferred policy decisions

Before any money release/refund, define eligible exception categories, authorized evidence, operator separation/approval limits, provider refund confirmation and append-only accounting treatment. Before stock adjustments/replacements/partial handover, define custody, physical evidence, disposition authority, per-unit allocation/packing rules and financial implications. These decisions were explicitly deferred by the user. No production readiness claim follows from passing CI.
