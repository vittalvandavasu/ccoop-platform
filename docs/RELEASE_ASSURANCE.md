# Release assurance audit — 27 October 2026

Scope: source audit of main..d046c7a, including PRs 1–3, then the narrowly scoped verification correction on the existing PR #3 branch. This is engineering evidence, not production approval. No merge, deployment, live transaction, refund or hold release was performed.

## Integration baseline

Live GitHub API and fetch confirmed all three PRs open/unmerged: #1 `codex/cashfree-postgres-verification` at `4faf62e9765f7a0c47da53b845d45c04109ac7cb` into main; #2 `codex/campaign-management` at `d93bf62889bddc433ac1181a6f1f27134bbe8015` into #1; #3 `codex/operations-investigations` initially at `d046c7a6ca96897f824f8549fbec0fd1661a8f62` into #2. Main is `39590783e929e65e21ec292858f668dc602f3756`. Working tree was clean. Both ancestor checks returned zero. PR #3 includes both dependency heads, not copies of competing implementations. Source inspection found one financial capture path, one campaign transition implementation and one investigation queue.

The cumulative change touches 39 files. No merge conflict is implied by these ancestor relationships; conflicts against future main changes have not been tested. Human integration order: #1, retarget/retest #2 against updated main, then retarget/retest #3. Do not merge all three independently against their original bases. The final combined branch must pass checks after retargeting. The workflow runs on pushes and pull requests; it seeds twice, checks types, fixtures, native PostgreSQL/Redis, build and Chromium. Branch protection/required-check enforcement has not been verified.

## Confirmed strengths from implementation

- `domain.ts`: admission/capture/approval serialize campaign → order → obligation; replay uses provider/payment identity; paise received and applied are separate; exceptions retain funds and block pickup/new payment. Existing holds are never cleared by investigations.
- `campaigns.ts`: private drafts, immutable published terms, snapshot-based conversion and eligible-color MOQ; expiry closes invitations without deleting obligations or rejecting all timely delayed evidence. Production approval is a separate paid-demand decision.
- `server.ts`, `cashfree.ts`, `payments.ts`: origin/session/ownership checks; campus roles; raw-body HMAC; authenticated order/customer/amount checks; exact decimal parsing; explicit simulator/Razorpay selection. Browser return is not capture authority. Legacy provider bindings are preserved.
- `investigations.ts`: canonical source identity, actor/request-key uniqueness, optimistic revisions under campaign locks, evidence fingerprint for review, persisted queued requests, lease tokens, retries and audit insertion in the same result transaction. External calls occur outside investigation locks.
- `domain.ts` receiving/pickup: healthy-only stock admission, whole-order allocation, one-time token consumption, stock movements and audit. Incorrect/excess reports are metadata only.

## Defects, corrections and limits

| Finding | Effect and action |
|---|---|
| Non-throwing reconciliation marked `VERIFIED` even for empty/pending/failed histories | Corrected: `INCONCLUSIVE_NO_VERIFIED_RECEIPT` retries at 30 seconds, max three executions; exhaustion is FAILED and requires follow-up. `PAYMENT_RECEIPT_VERIFIED` requires captured evidence and separately reports received/applied paise and hold. Neither means refund/release. |
| Stale lease completion counted as completed despite losing its token | Corrected: metrics count only committed outcomes. Native overlapping-worker regression verifies the stale timeout cannot overwrite a recovered result or later review. |
| Raw webhook body is authenticated in memory but not durably retained | Existing observations preserve normalized identity/status/amount/source, not raw request bytes/signatures. Retention/access/expiry policy and protected evidence storage must be approved before claiming raw evidence retention. Do not add sensitive payloads to ordinary logs. |
| Concurrent reconciliation metadata | Corrected in the release-gate increment: migration 006 and a request token prevent old requests from overwriting newer reconciliation_error/last_checked_at. Both completion orders have deterministic fixture/native coverage. Valid older receipt evidence is retained. This fence does not define aggregate multi-attempt checkout ordering or make display state financial authority; read attempts/events and keep holds. Drain old workers before relying on the fence. |
| Broad recurring scan checks up to 50 obligations sequentially, including captured ones | Fair rotation exists, but two HTTP requests per obligation and 10-second request deadlines can delay campaign polling. Load/backlog/timeout observability and SLA need rehearsal. No claim of bounded end-to-end queue latency. |
| Legacy provider inference relies on old provider-order IDs or simulator ID prefix | Migration keeps amounts/events/references; ambiguous records are `legacy_unknown`. Review actual legacy data before migration; do not reinterpret unknown receipts automatically. |

## Migration and consistency assessment

001 initial → 002 provider identities/events/observations/exceptions → 003 reconciliation visibility → 004 campaign revisions/snapshots → 005 investigation metadata. Native migration uses one connection/transaction and advisory lock; repeated startup skips applied names. No migration files were rewritten in this correction. The legacy fixture upgrades 001, preserves Razorpay/simulator/unknown identities, paid totals and receipt quantities, then reopens successfully. Native CI checks fresh/repeated migrations; actual legacy production restoration is unverified. Migration ledger has no content checksum; runtime DB credentials perform DDL; statement/lock timeouts and split migration/runtime roles are not configured in code. Back up and rehearse on a restored copy before rollout. Do not run old binaries against a partially upgraded schema or reverse migrations by deleting ledger rows.

Money is stored in PostgreSQL int paise; decimal conversion uses BigInt and rejects precision/range errors. Order totals are frozen; held receipts increment received evidence but not applied credit. No student wallet or refund ledger exists. Stock allocation and financial state remain separate. Receipt discrepancies do not authorize paid changes. These are application invariants, not protection against a privileged database writer.

## Missing evidence and next actions

1. Payment integrator + sandbox merchant administrator: execute every row of [CASHFREE_REHEARSAL.md](CASHFREE_REHEARSAL.md); no credentials or authorized callback environment were available locally.
2. Finance/product and fulfillment owners: approve or reject each entry in [POLICY_REGISTER.md](POLICY_REGISTER.md). Role owners are proposed; named people remain unassigned.
3. Platform/security owners: satisfy [OPERATIONS_READINESS.md](OPERATIONS_READINESS.md), including restore, redaction, alerts, runtime grants and payment incident suspension.
4. Engineering: add actual restore/interrupted migration testing, multi-attempt/out-of-order metadata tests, production authentication/session security checks, sustained backlog/Redis-loss drills. Automated synthetic settlement cannot replace any of these operational checks.

Current correction tests cover empty/pending/failed responses, timeout→recovery, verified-but-held receipts and stale lease results. Executed commands, exact SHA and final hosted results are recorded in PR #3; prior 60/18/4 results only apply to d046c7a. A local all-investigation attempt exhausted Node memory; a filtered attempt skipped all tests and is not passing evidence. No actual sandbox or production verification occurred.
