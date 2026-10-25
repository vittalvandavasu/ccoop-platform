# Slice 01 independent audit — 25 October 2026

Scope: Prompt 1 only. Original Git history restored from the supplied bundle (base `38f9122`). Architecture and editorial design retained. No AGENTS.md was present in the extracted repository.

## Corrected during this audit

- Domain/API test files previously ran in parallel against one native PostgreSQL database while the domain suite truncated it. Disable file parallelism and reset the API fixture explicitly. Concurrent requests within individual domain tests still run concurrently.
- Unknown/expired session cookies returned 404. Return 401 consistently without exposing session lookup results.
- A 64-character multibyte webhook signature passed the character-length check but caused timingSafeEqual to throw because byte lengths differed. Validate hexadecimal shape and compare decoded digests. Added regression coverage.
- Development identity switching retained a student's pickup QR/pass and form state. Clear private view state after successful account changes and logout. Browser regression checks switching to student2 hides the pass and orders.
- Browser suite now owns a fresh filesystem PGlite test database and starts both services, refusing to reuse existing servers. It exercises two-unit pledge, curator lock, unpaid-production rejection, simulated deposit, paid production, receipt, balance, pass, host pickup, replay rejection, persistence after reload, dialog keyboard controls, and 390px layout.

## Remaining findings / acceptance gaps

- Native PostgreSQL multi-session behavior remains a release gate. PGlite serializes one connection and cannot establish native race safety. Docker, PostgreSQL and Redis executables were not available on this host.
- Payment reconciliation after provider timeouts/crashes is missing. Deadline-expired captures while a campaign remains PAYMENT_OPEN lack a dedicated exception workflow. Provider sandbox behavior has not been verified.
- Campaigns below MOQ cannot be closed into a failed state; no scheduled closing worker, failed-color self-service, cancellation or unpaid-expiry workflow exists.
- OTP delivery, Google sign-in UI, S3 uploads and durable external notifications are incomplete. The worker only counts pending outbox rows.
- Store reservations and partial pickup are absent. Damaged counts are recorded on receipts, but there is no quarantine disposition/reconciliation workflow.
- Migration startup only reapplies the initial IF NOT EXISTS schema; a versioned migration ledger is needed before schema evolution.
- Operations fetch errors are swallowed and presented as empty data; broader loading/error recovery still needs work.
- No remote is configured; no push or hosted CI execution can be claimed.

No real payments or public deployment are authorized or performed. Later prompts remain deferred for review.
