# Acceptance evidence — independent verification, 25 October 2026

Prompt 1 only; later implementation prompts are deferred for review.

| Gate | Executed result |
|---|---|
| Lockfile dependency installation | `npm ci --cache .npm-cache --fetch-retries=0` passed; npm reported 0 vulnerabilities |
| TypeScript strict check | `npm run typecheck` passed |
| Domain/API tests | `npm test`: 18 passed (original 16 plus 2 API regressions), PGlite memory databases |
| Production build | `npm run build` passed, Next.js 16.4.3 |
| Migration and fictional seed | `npm run db:seed` passed twice on filesystem PGlite, testing repeatability |
| Browser journey | See browser result below; fresh isolated PGlite database per run |
| Native PostgreSQL / Redis | Not run: Docker, PostgreSQL and Redis executables absent |
| Actual Razorpay sandbox | Not run; tests use signed local fixtures and browser payments use simulator |
| Provider OTP / Google / S3 / devices | Not verified |
| Push / hosted CI | No remote configured; not run |

The restricted Windows sandbox initially blocked npm downloads and tsx user-info access. Retrying the dependency install and database/browser processes with approved access resolved those environment failures. The initial browser run failed on a test selector for Student 02; this was corrected before rerunning.

See AUDIT.md for corrected defects and remaining gaps. No real funds moved and no public deployment occurred. This is not a complete MVP or production readiness claim.

Production simulator guard: executed import with NODE_ENV=production and PAYMENT_MODE=simulator; startup rejected as expected before opening any database/service. Keyboard evidence is limited to opening the product dialog with Enter, keeping Tab focus inside it, and Escape restoring focus. Real mobile devices, screen readers, Firefox and WebKit were not tested.

## Browser result
PASS: npm run test:e2e — 1 complete Chromium journey passed in 1.2 minutes (test body 56.8 seconds). The final run honors the API Retry-After response after rapid identity switches and verifies successful recovery. Stock finishes at healthy=0, allocated=0, available=0 after pickup; replay is rejected. Nine full-page desktop/390px screenshots are in artifacts/. No horizontal page overflow was detected at the captured checkpoints. Desktop discovery, mobile pickup/receipt, and final collected screens were visually inspected.

Development runtime remains separate at .data/postgres. Browser databases are under .data/browser-test-* and unit/API tests use memory databases. Stop the development servers before rerunning browser tests.
