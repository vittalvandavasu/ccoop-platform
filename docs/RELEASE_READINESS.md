# Release readiness assessment — 27 October 2026

## Verified repository state

Default branch main is at 3959078. Clean starting checkout: codex/campaign-management at d93bf62889bddc433ac1181a6f1f27134bbe8015. PR #1 is open, mergeable, head 4faf62e and base main. PR #2 is open, mergeable, head d93bf62 and base codex/cashfree-postgres-verification. No newer remote work was found on fetch. GitHub reports the repository PUBLIC; earlier README/private-artifact descriptions were inaccurate. Visibility was not changed.

Both PR #2's PR run 40372922785 and previously pending push run 40372901157 completed successfully. No workflow correction is justified by the earlier Chromium installation delay. Historical evidence: 51 fixtures, 15 native PostgreSQL/Redis checks, three browser journeys, types, build and repeated migration/seed. This is not fresh verification of subsequent changes.

Integration order: human review/merge PR #1 into main, retarget PR #2 to updated main, inspect the combined diff and rerun CI, then human review/merge PR #2. The investigation increment branches from PR #2 and must follow it. Never cherry-pick later migrations without their dependencies. No automatic merges or deployment.

## Implementation and evidence map

- apps/api/src/domain.ts: campaign-first financial admission/capture locks, paise credits, immutable provider events, payment holds, paid-demand approval, receipt/allocation and whole-order pickup. Native tests observe actual overlapping PostgreSQL locks.
- payments.ts and cashfree.ts: sandbox adapter, raw signature checks, attempts/observations, authenticated reconciliation and exact numeric parsing. Mocked transport/signature/retry/late/overpayment tests exist; actual provider behavior remains unverified.
- campaigns.ts: private drafts, eligibility resolution, immutable published terms, snapshots and overdue transitions; API/fixture/native/browser coverage exists.
- server.ts: session/origin controls and campus-scoped authorization; operations exposes exceptions but had no investigation workflow.
- worker.ts: BullMQ recurring recovery, rotating provider reconciliation, five retries with exponential backoff, retained job history. Outbox records are inbox persistence, not external delivery.
- packages/db/migrations/001–004 and index.ts: additive versioned migrations under an advisory transaction lock. Legacy values/providers survive the existing migration fixture. Restore from a real backup and interrupted production upgrade have not been rehearsed.
- apps/web/app: editorial role interfaces and Chromium desktop/390px evidence. Real devices, Firefox/WebKit, screen readers and production identity delivery remain unverified.

## Baseline risks and smallest increment

A delayed pending observation can preserve a terminal payment_attempts.status but overwrite obligations.checkout_state with the incoming stale status. Add a regression, derive the display state from the persisted attempt, preserve observations, and prove no financial credit changes.

No packing ledger, partial handover, discrepancy assignment, refund execution or audited hold release exists. Receipts accept healthy/damaged amounts up to expected; excess/incorrect physical items cannot safely be admitted into available inventory under current rules. Amount/reference mismatches are rejected rather than credited; they must not be presented as confirmed received funds.

Preserve integer paise, authenticated evidence, immutable events/snapshots/provider identities, campaign -> order -> obligation locks, free-pledge rules, eligible-color MOQ, separate paid production approval, expiry survival and simulator isolation. Avoid external network I/O while financial locks are held. Investigation metadata must not become a second payment or stock ledger.

## Explicit release gates and acceptance criteria

| Gate | Acceptance criterion | Current status |
|---|---|---|
| Combined baseline | Current candidate passes fixtures, native PostgreSQL/Redis, migration repeatability, typecheck, build and browser journeys | Historical baseline green; rerun each increment |
| Cashfree rehearsal | Every row in CASHFREE_REHEARSAL.md has actual dated evidence and an operator result | BLOCKED: no local credentials, allowed-domain verification or reachable callback environment |
| Operational holds | Authorized, audited investigations; separate approved rules before money/stock release | Investigation-first scope approved; release/refund/stock-adjustment rules intentionally deferred |
| Recovery | Backup/restore and interrupted-worker/provider rehearsal with ledger comparison | Automated recovery fixtures exist; operational restore rehearsal outstanding |
| Identity/security | Production sign-in delivery, session/security review and access provisioning verified | Incomplete; DEV_AUTH must remain off in production |
| Fulfillment | Physical counts, evidence, discrepancies and authorized handover reconcile without financial mutation | Whole-order flow exists; packing/partial handover/corrections need a later approved increment |
| Pilot operations | Named operators, escalation rules, monitoring and campus rehearsal | Not yet verified |

User-approved scope: investigation, assignment, notes and verified reconciliation first. Financial holds remain; excess/incorrect stock stays outside available inventory. No refund, credit release, replacement order or stock adjustment is authorized. A reviewed case is not a financially or physically resolved case. Further business decisions are required before those actions can be implemented.
