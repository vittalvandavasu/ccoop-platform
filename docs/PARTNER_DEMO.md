# Protected partner demo — existing coopweb Netlify site

Target remains https://coopweb.netlify.app/ . No new hosting project or paid resource was created. This branch contains the cumulative PR #1–3 implementation plus protected demo preparation. It is a fictional demonstration, not approval for a live payment pilot. Existing financial/stock holds and release-gate status are unchanged.

## Observed hosting state

The public frontend returned HTTP 200; `/v1/health` returned HTTP 500. The old Next rewrite points at 127.0.0.1:4000, which is not evidence of a hosted API. No Netlify CLI linkage/config, Netlify credential environment, backend deployment manifest or local native-service configuration was present. GitHub had a `netlify/coopweb/deploy-preview` success for PR #1, but that does not establish the site's production branch. Browser tools failed to initialize. No Netlify settings or backend services were changed. Production branch remains UNVERIFIED; do not guess main or merge solely to trigger a deploy.

The user subsequently asked to focus on GitHub functionality and will inspect the Netlify preview in the app. Hosted verification is therefore still outstanding, not reported as passed.

## Prepared implementation

- `netlify.toml`: repo-root dependency/build base, `npm run build`, publish `apps/web/.next`, Node 22. In the **existing** Netlify site, package directory must be `apps/web`; inspect the actual connected branch and deploy context there. Next's supported adapter serves SSR/routes; no static export is used.
- Production `/v1/*` uses a Node route handler and runtime `API_ORIGIN`; localhost rewrites exist only for local development. The proxy accepts only a configured HTTPS upstream in hosted mode, rejects loops/credential-bearing origins and redirects, forwards an allowlist of headers, preserves session cookies and disables response caching. Missing config returns a sanitized 503, never a fictional API response.
- Both Next's request proxy and Fastify require HTTPS Basic access credentials in partner-demo mode, including API, role switching and health. This is a shared partner-access barrier; an admitted partner may select fictional demo roles. Existing per-role/campus authorization still applies. It is not per-person production identity or a replacement for production access controls. Rotate credentials when access changes; browser Basic credentials may remain cached until the browser session is closed.
- `PARTNER_DEMO=true` is the only narrow production simulator exception, requiring `DEMO_DATASET=fictional`, explicit simulator selection, HTTPS `APP_ORIGIN`, strong access configuration and zero provider credentials. Fastify/database startup also requires a separately named PostgreSQL database `ccoop_demo` or `ccoop_demo_*`. Normal production simulator rejection remains. Tests verify both guards.
- Production cookies are Secure, HttpOnly, SameSite=Strict and host-only through the same-origin API route. Mutation origins are checked at frontend and API. Authorization/cookie headers are redacted from API logs.
- Persistent banner: “Partner demo · Fictional data · Simulated payments”. The frontend exposes the Netlify build commit in `X-CCOOP-Commit`; protected API health reports `RELEASE_COMMIT`. Compare both with actual deployment metadata; self-reported values alone are not proof of deployment.
- Worker uses separate `ccoop-partner-demo-outbox` queue name by default and requires explicit Redis configuration in demo mode. Campaign deadlines still recover through PostgreSQL; provider polling stays disabled in simulator mode. No production data is seeded automatically.

## Required runtime configuration (values are not secrets unless noted)

Configure these on **both** the existing Netlify runtime/functions and existing Fastify service; build-context variables alone may not populate runtime functions. Netlify build also needs PARTNER_DEMO/DEMO_DATASET/PAYMENT_PROVIDER (nonsecret defaults in TOML). Never put credentials in NEXT_PUBLIC variables, Git, screenshots or comments.

| Variable | Value / source |
|---|---|
| PARTNER_DEMO | true |
| DEMO_DATASET | fictional |
| PAYMENT_PROVIDER | simulator |
| APP_ORIGIN | https://coopweb.netlify.app for the existing production demo URL; use the exact preview URL in an isolated preview's API configuration |
| DEMO_ACCESS_USER | Named shared demo access account, no colon |
| DEMO_ACCESS_PASSWORD | Protected random secret, at least 32 characters; same on frontend and API; distribute through an approved secure channel |
| API_ORIGIN | Netlify runtime only: actual existing Fastify HTTPS origin, without path/trailing slash; not the Netlify frontend or localhost |
| DATABASE_URL | API/worker only: isolated existing PostgreSQL database named ccoop_demo or ccoop_demo_*; never a real-data database |
| REDIS_URL | Worker only: isolated existing Redis configuration; do not share live queues/data |
| NODE_ENV | production on hosted API/worker and Next runtime |
| API_HOST / PORT | API service's approved binding; usually 0.0.0.0 and its supplied PORT behind TLS |
| RELEASE_COMMIT | API/worker deployed Git SHA; Netlify frontend uses COMMIT_REF at build |

Remove CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET from every demo environment/context. Startup rejects any of them. DEV_AUTH is not needed for protected demo role selection. No external identity login is required merely to demonstrate fictional roles; the access barrier is mandatory.

Run the API as `node --import tsx apps/api/src/server.ts` and worker as `node --import tsx apps/api/src/worker.ts` in existing long-lived Node services with installed project dependencies. Neither is started by `next build` or by the Netlify frontend deployment. Ensure tsx remains installed in that service. PostgreSQL/Redis and a worker cannot be assumed to exist because the frontend builds.

After verifying the connection belongs to a disposable isolated fictional database, apply versioned migrations through the normal startup and explicitly run `npm run db:seed` once with the protected demo runtime configuration. Seed inserts fictional records without clearing history. Do not truncate existing hosted data or run test suites against the demo database. No provisioning or budget is authorized by this setup guide.

## Verification and integration checklist

1. Confirm the actual existing Netlify site ID, Git remote, connected branch, package directory and runtime variables in the app. Preserve newer commits. Integrate dependency PRs in order only after checks pass and the target branch is known; no force push.
2. Confirm actual API service deployment SHA, native PostgreSQL connection and worker/Redis status. New paid resources require separate budget approval.
3. Unauthenticated frontend and direct API must return 401; missing configuration must fail closed. Authenticate, inspect banner/commit header and `/v1/health` (simulator + native DB + matching API SHA).
4. Sign in as student, create a pledge, reload and confirm DB persistence. Use protected curator to close/resolve, student to pay via simulation, admin to approve, host to receive and perform one-time pickup. Repeat settlement/scan to verify deduplication. Confirm campus denial, retained holds and investigation behavior.
5. Verify no gateway network requests and no configured provider secrets. Check desktop and 390px layouts; inspect secure cookie attributes, role switching and unauthorized API calls after session creation.
6. Record deployment ID/SHA, URLs, health/service evidence and journey outcomes without secrets. Do not call deployment complete on a push, build or mock test alone.

Automated evidence is recorded in the demo PR: protected-production configuration, frontend/API access denial, proxy routing/cookies/origin checks, simulated HTTP settlement with both gateway transports intercepted, plus existing fixture/native/browser journeys. These tests do not prove the existing Netlify runtime/backend has been configured. All real Cashfree/payment-release gates remain unchanged and open.

References: [Netlify monorepos](https://docs.netlify.com/build/configure-builds/monorepos/), [Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/). No external service state is inferred from these documents.
