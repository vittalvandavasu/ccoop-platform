# Release evidence package — updated 28 October 2026

Authoritative gate IDs/statuses, approval authorities and closure criteria now live in [RELEASE_GATES.md](RELEASE_GATES.md). This document is a supporting evidence index; its historical tables do not independently close gates.

## Current decision: NO-GO for a controlled payment pilot

The software has passing synthetic checks; external payment, security, recovery and operational gates remain open. A documented procedure is not an executed rehearsal. No production deployment, merge, financial release, refund or stock adjustment occurred. This update changes documentation only; no additional evidence collection or financial behavior is enabled.

### Current integration baseline

Remote fetch/API checks on 28 October confirmed a clean `codex/operations-investigations` checkout at `89eaa58c0091d210797ea744b5c6dbef6de93616`. PR #1 remains open at `4faf62e9765f7a0c47da53b845d45c04109ac7cb` into main; PR #2 remains open at `d93bf62889bddc433ac1181a6f1f27134bbe8015` into #1; draft PR #3 remains open at `89eaa58` into #2. Both dependency heads are ancestors of #3. No merge was performed. This documentation commit extends #3; its exact SHA and fresh validation run are recorded in the PR evidence entry after push.

Verified baseline CI: [PR run 40534021207](https://github.com/vittalvandavasu/ccoop-platform/actions/runs/40534021207) and [push run 40534011343](https://github.com/vittalvandavasu/ccoop-platform/actions/runs/40534011343) both completed SUCCESS on `89eaa58`. Results: 64 fixtures, 19 native PostgreSQL/Redis checks, four Chromium journeys, migrate/seed twice, types and production build. These are historical for any later documentation commit, not a substitute for its own CI. Final validation must bind the new run's `head_sha` to `git rev-parse HEAD`; see [PR #3](https://github.com/vittalvandavasu/ccoop-platform/pull/3) for that immutable SHA/run pair and actual outcomes.

Safest integration sequence: human review/merge #1; retarget #2 to updated main and rerun all checks; human review/merge #2; retarget #3 to updated main and rerun all checks; only then consider a separately authorized release. Do not cherry-pick migrations without ancestors. Branch protection/required-check enforcement remains unverified. Migrations are ordered 001–005; none changed here. The existing legacy-upgrade fixture preserves payment IDs/provider bindings, paid totals and receipt counts; production-sized/restored legacy data has not been rehearsed.

### Evidence index and launch blockers

| Gate / evidence | Actual status | Required owner and next action |
|---|---|---|
| Cumulative code/integration review — [RELEASE_ASSURANCE.md](RELEASE_ASSURANCE.md) | Reviewed; financial/stock invariants and normalized evidence retained. Stale reconciliation display metadata and sustained-backlog behavior remain risks. | Engineering: qualify those cases before relying on automatic alert closure; review final merged candidate. |
| Real provider rehearsal — [CASHFREE_REHEARSAL.md](CASHFREE_REHEARSAL.md) | 0 of 14 scenarios executed against Cashfree; mocked fixtures are separate evidence. | Payments integrator + merchant admin: provide protected sandbox credentials, approved domain/callback and human checkout; attach actual per-row evidence. |
| Webhook evidence retention — proposal in CASHFREE_REHEARSAL.md | Normalized observations durable; raw evidence absent; retention proposal NOT APPROVED/NOT IMPLEMENTED. | Security/privacy + finance: approve minimal fields, raw-storage necessity, access, retention/deletion and legal holds; engineering then implements/tests approved scope. |
| Financial and inventory decisions — [POLICY_REGISTER.md](POLICY_REGISTER.md) | Investigation-only scope approved; refund, release, replacement, partial fulfillment and stock correction remain proposed. | Accountable finance/product/fulfillment owners: name approvers and explicitly record chosen options, limits, evidence and acceptance. |
| Authentication/access/secrets — [OPERATIONS_READINESS.md](OPERATIONS_READINESS.md) | Code controls partially verified; deployed identity, grants, secret rotation and log redaction unverified. | Security/platform: provision named scoped operators and demonstrate production-equivalent sign-in, revocation, redaction and secret handling. |
| Backup/restore/migration recovery | No backup configuration or actual restore/interrupted-upgrade evidence inspected. | DBA/platform: approve RPO/RTO/retention, restore isolated copy, compare ledger/stock invariants and test interrupted migration/worker recovery. |
| PostgreSQL/Redis availability and jobs | Native CI passed; HA, Redis persistence, provider outage/backlog and external availability monitoring unverified. | Platform/engineering: inspect deployment configuration, execute failure/restart drills and record recovery/latency. |
| Monitoring and incident response | UI/DB states exist; alert routing not implemented/verified; contacts unassigned. | Operations: name on-call responders, connect queue/exception/callback/DB/Redis/audit alerts, demonstrate receipt and escalation. |
| Payment suspension and pilot ownership | No audited application pause; proposed ingress procedure untested. Pilot campus/cap/support scope not approved. | Incident commander + platform + pilot owner: rehearse stopping new checkout while preserving callbacks/reconciliation; review outstanding provider sessions and approve pilot limits/stop criteria. |

Owners are required roles, not assigned people. All blockers stay open until a named owner supplies evidence and acceptance. A business owner may explicitly restrict pilot scope to exclude a deferred feature, but this cannot waive unresolved payment/security/recovery controls silently. Current recommendation remains NO-GO; safe independent engineering and synthetic rehearsal may continue.

## Historical assessment — 27 October 2026

The following sections preserve the original pre-investigation assessment; current status above and RELEASE_ASSURANCE.md supersede their then-open implementation items (assignment and terminal checkout display are now implemented).

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
