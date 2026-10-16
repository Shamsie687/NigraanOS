# Judge renewal and 12-hour sessions — deployed 17 October 2026

Status: migration 020, compatible MCP, notification worker and frontend were deployed under separate approval on 17 October 2026. The catalog postcheck and all six preservation fingerprints passed. The rollout sequence below is retained for provenance/future reviewed upgrades, not permission to replay 020. Do not replay migrations 015–019, access M4E, restore old test incidents, or change permanent memberships.

## Behavior and boundaries

- Signed-in verified accounts request access through Citizen → Operations access. The protected administrator remains the allowlisted permanent Operations account; an email address grants no authority.
- New activations start exactly 43,200 seconds at the database clock. Refresh/relogin/repeated activation cannot move the start or expiry. Previously started 3,600-second sessions keep their original start and expiry, including already expired sessions. Unstarted approvals switch to the new duration; old already-sent emails may still describe the earlier policy, so the website is authoritative.
- Approval defaults to 48 hours to activate. An administrator may select a future activation deadline up to 45 days after approval. The input uses the browser's local timezone and is converted to UTC; displayed timestamps include PKT. Choose the judging cutoff explicitly, including timezone and a buffer. This deadline limits activation, not an already-started session: the final activation may remain valid for another twelve hours.
- Only the administrator may renew an expired session or missed activation deadline. Active, unstarted-but-still-valid, pending, rejected and revoked cycles cannot be renewed. Renewal uses an expected cycle and row lock, archives the full previous grant in a protected append-only audit entry, increments the cycle once and grants an unstarted approval. A fresh judge activation is required. No self-service renewal or permanent privilege is created.
- Audit/outbox records retain prior timestamps and jobs. Notifications are deduplicated by request/cycle/event. Older-cycle pending jobs cannot be claimed or retried; records are retained. An email already in flight may arrive late, and uncertain delivery must not be retried automatically. Emails label the approval cycle and are advisory; judges can always check status on the website. Existing 23-hour/five-attempt retry limits remain.
- Existing RLS/RPC checks and the evidence proxy read the server access context. No evidence policy or permanent Operations approval is weakened. Workflow changes made while authorized can persist afterward.
- MCP remains read-only, with delegations capped at ten minutes, the upstream credential and the actual Operations deadline. References retain their own five-minute/delegation caps. A renewal cannot revive an expired bearer/reference; judges reconnect with fresh consent as necessary during the twelve hours. Twelve hours of Operations access does not mean twelve hours for one MCP connection.

## Local verification

```cmd
npm test
node tests/judge-renewal-migration-check.mjs
node tests/judge-access-render-check.mjs
npm --prefix server/mcp test
npm --prefix server/mcp run typecheck
npm --prefix server/mcp run validate:infra
npm run build
node scripts/verify-source-release.mjs
git diff --check
```

Final security verification, 16 October: Docker Desktop's Linux engine was available. `node tests/judge-renewal-migration-check.mjs --docker` passed 51 assertions against native PostgreSQL, including independent simultaneous renewal, activation and revocation calls. The native harness was corrected to return read-only CTE query results; its initial harness failures were not migration failures. The isolated synthetic container had no host mounts or exposed ports, used no network and was stopped/retained afterward. Time-controlled synthetic expiry checks do not constitute an elapsed twelve-hour hosted test. No genuine email delivery, hosted renewal, Realtime or provider availability is established by these tests.

## Reviewed rollout order — completed; future hosted changes need separate approval

1. Complete native independent-connection renewal/activation/revocation testing and a second SQL review. Confirm original-project schema drift with read-only `docs/JUDGE_RENEWAL_PREFLIGHT.sql`: require PASS / 0 / []. Privately preserve the existing judge request/audit/outbox records and function definitions before any approved migration. Stop on drift; do not weaken guards.
2. Establish a quiet maintenance window covering all Operations users. Permanent memberships and authorization rules are preserved, but 020 takes exclusive table locks: authorization reads can briefly block, including permanent users' context requests. The ten-second lock timeout bounds lock acquisition waits, not total transaction duration; do not promise uninterrupted service. Deploy the compatible AWS MCP adapter first (accepts legacy 3,600 and explicit 43,200-second contracts, rejects all other durations), and the compatible `judge-notifications` worker next (old jobs still use their snapshotted legacy duration). No IAM, endpoint, OAuth, secrets, webhook, Gmail authorization or infrastructure settings changes are needed for this code change. `judge-evidence` and city-context require no source change.
3. Apply ONLY additive `supabase/migrations/020_judge_renewal_twelve_hour_sessions.sql` after deployed 019. Its transaction validates reviewed predecessor function bodies, takes bounded table locks, preserves started grants, installs cycle history/outbox and the administrator RPC, and commits atomically. Never rerun historical migrations. Stop on any SQL error; transaction failure must roll back rather than be retried piecemeal.
4. Run read-only `docs/JUDGE_RENEWAL_POSTCHECK.sql`: require PASS / 0 / []. Verify preserved prior grant timestamps, permanent memberships, administrator allowlist and unrelated records against the private pre-rollout snapshot. The structural postcheck alone cannot prove preservation without that comparison. Historical 019-only postchecks intentionally no longer describe this contract.
5. Release the compatible frontend via a focused reviewed PR/Netlify flow. Old open frontend/MCP clients do not understand the new duration and may fail closed; require reloading/reconnecting before admitting judges. Do not roll back to an incompatible one-hour client after issuing twelve-hour sessions.
6. Under explicit acceptance approval, test a designated non-admin account: bounded approval without access; activation; normal Operations/MCP reads; administrator early revocation; expired-cycle renewal using a local time-controlled test first; unchanged old bearer rejection; no duplicate activation/email; missing email with website status. Do not use SQL timestamp edits on real accounts to simulate expiry. Monitor the first real twelve-hour boundary.
7. Separately verify Gmail readiness through November 9–20. External Testing refresh tokens last seven days; an October renewal does not cover November. Publishing/verification decisions and any secret renewal require separate approval. Until durable authorization is established, monitor the admin dashboard directly and maintain organizer contact/coverage. Email failure never extends authorization, and manual renewal still needs an available administrator.

## Failure handling and rollback

Before 020, compatible MCP/worker changes can be rolled back normally while the old contract is still active. A failed 020 transaction must leave schema and records unchanged; inspect privately and stop. After 020 succeeds, never drop cycle/history columns, erase outbox jobs, replay 019 or recalculate an existing deadline to force a downgrade. Pause new approvals/renewals operationally, retain current expiries, use compatible prior artifacts where possible and prepare a separately reviewed forward repair. Revocation remains an explicit administrator action, not an automatic rollback step. No rollback commands are authorized here.

Twelve hours expands the exposure window for full Operations capability; keep real personal evidence out of judge demonstrations. Read data already downloaded cannot be recalled. This implementation does not guarantee unattended judge access or email delivery.

## Local validation and exact change inventory

Previously, 304 application tests, 75 MCP tests, MCP typecheck, render checks and production build passed. Final native verification passed 51 SQL checks, including preflight/postcheck, legacy preservation, bounded deadlines, expiry RLS/RPC denial, independent concurrent renewal/activation/revocation, prior-grant history, stale notifications, failure isolation and failed-migration rollback. The 75 MCP tests and typecheck were rerun successfully. Immediate hosted acceptance: PASS. Administrator UI verified cycle preservation and exact twelve-hour activation timestamps; the user confirmed one approval email, refresh/fresh-login persistence, one authorized remote city-status read and Citizen access. Genuine twelve-hour expiry is PENDING, not simulated. November Gmail reliability and organizer coverage remain separate gates. Migration 020 is deliberately apply-once, not replay-idempotent: a second execution fails closed and rolls back. Do not bypass its predecessor guards after a successful application.

The historical 67-file source-release proposal is not expanded: its covered-file canonical hashes are refreshed for this local review. The five new renewal artifacts below are separately listed for a future focused review; the inventory for this synchronization is recorded separately in docs/judge-renewal-release-manifest.json.

- `docs/HACKATHON_JUDGE_GUIDE.md`
- `docs/JUDGE_RENEWAL_POSTCHECK.sql`
- `docs/JUDGE_RENEWAL_PREFLIGHT.sql`
- `docs/JUDGE_RENEWAL_ROLLOUT.md`
- `docs/source-release-manifest.json`
- `server/mcp/src/supabaseAdapter.ts`
- `server/mcp/tests/adapter.test.ts`
- `server/mcp/tests/judgeExpiredRegression.test.ts`
- `server/mcp/tests/judgeExpiry.test.ts`
- `src/components/JudgeAccess.jsx`
- `src/components/JudgeCountdown.jsx`
- `src/pages/JudgeAdminPage.jsx`
- `src/services/judgeAccess.js`
- `supabase/functions/judge-notifications/handler.js`
- `supabase/migrations/020_judge_renewal_twelve_hour_sessions.sql`
- `tests/judge-access-render-check.mjs`
- `tests/judge-access.test.js`
- `tests/judge-backends.test.js`
- `tests/judge-renewal-migration-check.mjs`
- `tests/judge-native-postgres.mjs` (native CTE result handling corrected during final verification)
