# Architecture audit — 25 October 2026
Sources reviewed: March PRD (all 2,967 lines), HLD v1, editorial HTML, PledgeBuy HTML, both Colab’n’Buy PDFs.

| Conflict | Implementation decision |
|---|---|
| PRD production after pledge/payment expiry | Explicit admin paid-MOQ gate, no automatic manufacture |
| Early category target rejects colors | Evaluate at deadline or explicit curator close; record snapshot |
| PledgeBuy holds money | Free nonbinding pledge; separate order/payment obligation |
| Store sold stock vs dispatch decrement | Reserve/allocate on purchase, physical decrement only at pickup |
| Failed pledge 110% credit | No credit for a free pledge; paid refunds remain separate |
| Prototype synthetic counters/localStorage | All counts from persisted pledge rows |
| One campus vs multi-campus browsing | Public browsing across campuses; operations strictly scoped |

## Runtime
Next.js App Router + Tailwind; Fastify API; Drizzle SQL adapter; PostgreSQL; Redis/BullMQ worker; npm workspace monorepo. Docker Compose is the canonical PostgreSQL/Redis environment. This constrained host cannot install native PostgreSQL or Docker: optional local PGlite runs the PostgreSQL WASM engine with filesystem persistence, explicitly development-only. It is not evidence of PostgreSQL multi-connection concurrency safety; CI uses PostgreSQL 17.

## Credential boundaries
No accessible GitHub repositories were returned, and the connector has no repository-creation operation. Local commits and an export will preserve work until a private remote is provided. Razorpay test keys, Google client ID, SMS/email provider, S3 bucket and Redis runtime must be configured. A visibly labeled local payment simulator is isolated from Razorpay mode and forbidden in production. No live payment or public deployment.
