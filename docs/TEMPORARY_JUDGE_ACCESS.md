# Complete 60-minute Operations access

**Current release, 15 October 2026:** the owner reports 015–019, Edge Functions, AWS MCP and Netlify deployed. This source preparation did not inspect or modify hosted services. See [SOURCE_RELEASE_SETUP.md](SOURCE_RELEASE_SETUP.md) for reproduction; do not replay production migrations. No deleted reports/evidence are restored and no separate Judge Mode is introduced.

## Behavior and authorization

Judges use existing Supabase signup/sign-in and retain Citizen access. A verified registered Auth email is required to request one temporary session. The account may create only one request; rejected/expired accounts cannot self-service resubmit or renew in this initial version. Duplicate requests/decisions fail. New requests are capped at 25 per rolling 24 hours to limit notification abuse; organizers review requests manually.

Only the privately bootstrapped administrator UUID **and** existing permanent Operations approval authorize Approve, Reject, Revoke, request/audit listing and safe email retry. Notification destination `nigraanos.admin@gmail.com` grants no authority. No browser or service-role direct table grants are available on the new protected tables; worker service-role privileges are limited to outbox claim/finish RPC execution.

Approval uses the database clock to set a 48-hour activation deadline without granting Operations. The judge's first authenticated activation atomically sets `started_at` and `expires_at = started_at + interval '60 minutes'`. Row locks make activation idempotent and race-safe. Refresh/login and email retry never reset either deadline. Unstarted/expired/revoked grants fail current database authorization without cron. Pending/Approved/Active/Rejected/Expired/Revoked states are derived from server data.

`nigraan_is_permanent_operations()` preserves the old permanent check. Separate `nigraan_has_operations_access()` checks permanent membership OR an active temporary grant. Existing `is_approved_operations()` delegates to it, preserving all existing restrictive RLS and normal workflow validations. Therefore existing incident/evidence reads, write RPCs, AI admission/snapshots, city-context and Agent/MCP checks now understand expiry. Administrator functions exclusively use the permanent-only/admin check. Additional workflow/public-update write guards and the workflow audit recheck protect expiry during a waiting write; actor attribution is retained.

Existing assignment/public-update FKs require an Operations identity. Approval inserts a **pending**, unapproved `operations_profiles` row only if absent. It never alters an existing permanent application/approval. This identity is not a grant: after expiry it provides no Operations rights. It may appear pending in the legacy permanent-application UI; the separate judge status is authoritative. Retaining the identity preserves assignments and audit references after the hour ends. Judges cannot change its verification status through the browser.

Do not use the legacy `approve_operations_for_testing.sql` for judges: it grants permanent approval. Temporary requests/approval reject accounts already permanently approved, including a promotion between request and approval. A later deliberate owner-level permanent promotion is a separate membership decision and must never be used as a workaround to extend a judge window.

The existing Operations dashboard, exact-location map, incident details, workflow actions, AI and read-only Alexa+ simulation are available while active. Workflow/public-update changes remain afterward. **This intentionally exposes the normal Operations dataset and permitted evidence; it is not sanitized access.** Review live report suitability before admitting external judges.

### Evidence, in-flight work and delegated access

Temporary judges cannot mint other-citizen Storage signed URLs. Their previews use `judge-evidence`: JWT identity and caller-RLS evidence selection, validated exact path, bounded service-role download of that one object, and access rechecks before and after download. No reusable signed URL is returned. Permanent/own-Citizen Storage behavior remains unchanged. Temporary evidence previews require recognized JPEG/PNG/WebP/WebM/OGG/MP4 metadata and size ≤10 MiB; incompatible legacy evidence is unavailable through this proxy.

The browser uses a server timestamp plus monotonic elapsed time, conservatively including network delay. It revalidates every 15 seconds, on tab resume, connectivity return and authorization errors. At deadline it closes Operations, clears component state/media object URLs, aborts evidence work and disconnects MCP/investigations; Citizen remains available. Early revocation may take up to the next poll to change idle UI, but backend authorization fails immediately. Already delivered information/media cannot be erased from a judge's device.

MCP OAuth codes/tokens are capped at both the upstream JWT and judge deadline; the existing ten-minute token maximum is retained. Incident reference deadlines are capped by that token. Every request/tool still rechecks database authorization, including before returning tool results. Reconnects cannot renew the 60-minute window. AI and city-context retain their existing before/after authorization checks and provider quotas. No AWS infrastructure privileges are granted to judges.

## Email delivery — setup required, not yet tested live

There was no application notification provider in the inspected code. Supabase Auth confirmation/password emails remain separate and unchanged.

Use **Gmail API** through the administrator's Gmail account. No custom domain or Gmail password is required. The existing templates, outbox, audit and webhook remain; the transport uses server-side OAuth refresh followed by `users/me/messages/send`. Setup: [GMAIL_NOTIFICATION_SETUP.md](GMAIL_NOTIFICATION_SETUP.md).

After explicit rollout approval, apply migration **016 after 015**, and configure Edge Function secrets `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `JUDGE_EMAIL_FROM` (exactly `nigraanos.admin@gmail.com`) and `JUDGE_WEBHOOK_SECRET` (private random value of at least 32 characters). Keep `JUDGE_ALLOWED_ORIGINS` for the evidence endpoint. Supabase supplies the function's existing project environment; never put email credentials into Vite variables.

Deploy reviewed `judge-notifications` and `judge-evidence` only after approval; these handlers authenticate internally and use `--no-verify-jwt` only for these functions. The legacy config remains unchanged. Configure an INSERT/UPDATE Database Webhook on `public.nigraan_judge_email_outbox`, POST to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/judge-notifications`, with `Content-Type: application/json` and private `x-judge-webhook-secret`. Only pending updates are processed. Replace `YOUR_PROJECT_REF` with the explicitly confirmed target project reference before using this example URL.

Email failure never resets approval or expiry. Explicit rejected sends and pre-send credential failures allow administrator retry (five attempts / 23 hours retained). Gmail has no send idempotency guarantee: timeout, 5xx, invalid success, uncertain completion and stale sending leases must not be retried. Migration 016 blocks these in the database even for the administrator. The UI hides unsafe retry buttons. Inspect Gmail Sent privately if completion is uncertain; a Message-ID is correlation only, not deduplication. Do not reset outbox state merely to force a resend. Stuck jobs intentionally fail closed, trading availability for duplicate prevention. No scheduled/automatic retry or resend is added. Logs contain only safe categories.

Actual delivery, correct sender account, Google OAuth setup and hosted webhook operation still require owner acceptance after deployment approval. Provider acceptance is not proof of inbox delivery. Supabase Auth emails remain separate.

## Private administrator bootstrap

After migration approval/application, use `supabase/admin/bootstrap_judge_admin.sql`. First privately verify your **Auth UID** under Authentication → Users and its existing permanent Operations approval. Populate a private copy of the placeholder, outside Git, and execute the entire copy only in the confirmed original project's SQL Editor. The script refuses a different existing administrator or an identity without verified email/permanent approval. It does not approve Operations membership or change Auth data. Success reports only the administrator count (expected 1). Never populate/commit the repository template.

The signed-in administrator review route is `https://nigraanos.netlify.app/#/judge-admin`. Email links contain no approval token; opening one grants nothing. Citizen workspace also presents the review button only for the administrator. The RPC independently verifies admin authority on every decision/list/retry.

## Local tests and acceptance

Dependencies already present were reused; no global packages or new application dependencies were installed. The SQL harness uses the previously isolated PGlite runtime with synthetic schema/identities only:

```powershell
npm test
node tests/judge-access-migration-check.mjs
node tests/judge-access-migration-check.mjs --docker
node tests/judge-access-render-check.mjs
npm --prefix server/mcp test
npm --prefix server/mcp run typecheck
npm --prefix server/mcp run validate:infra
npm run build
git diff --check
```

The SQL harness applies release migrations to its in-memory synthetic database, never hosted Supabase. The optional `--docker` run uses a new no-network native PostgreSQL container and adds actual competing-connection approval tests; it stops and retains that synthetic container. Endpoint email/provider downloads use injected mocks. MCP HTTP/SDK tests use loopback only. Frontend render tests disable .env loading and make no hosted calls. Windows sandbox realpath/loopback restrictions may require permission for local build/render/MCP test commands; these permissions are not deployment approval.

Before rollout, live schema drift and native lock-wait/Realtime behavior remain to be verified in an isolated/full Supabase acceptance environment. Do not weaken checks if migration prerequisites differ. A complete 60-minute hosted browser test and real email/webhook delivery cannot be claimed from local tests.

## Later rollout — explicit approval required before these operations

1. Confirm original project, current release compatibility and a database/config backup. Apply **only** `015_temporary_judge_access.sql` once in SQL Editor. Do not run migration 014, replay historical migrations or blindly `db push` against an unknown history. This migration is additive except reviewed authorization/Storage/audit helper replacements; existing records/permanent approvals are retained.
2. Privately bootstrap your administrator. Configure secrets and deploy the two new Edge Functions. Example commands, **do not run until authorized**:

   These commands require the Supabase CLI. If unavailable, pause deployment and arrange a separately authorized local CLI installation; do not install global tooling or change the shared development/staging workspace. If Database Webhooks asks to enable `pg_net`, that is also part of the separately approved rollout.

   ```powershell
   supabase functions deploy judge-evidence --project-ref pmzbdrxedlthdqdpgigs --no-verify-jwt
   supabase functions deploy judge-notifications --project-ref pmzbdrxedlthdqdpgigs --no-verify-jwt
   ```

3. Configure/test the outbox webhook. New grants must not be approved until the full rollout is ready. No Auth SMTP, redirect, credentials or permanent approval settings need changing.
4. Rebuild/redeploy the updated MCP Lambda code through the existing reviewed AWS process for `nigraan-mcp-staging` in ap-south-1; its existing Supabase configuration and infrastructure stay the same. Confirm new database access-context RPC is available, token/reference caps and expiry rejection through the real endpoint. No new AWS IAM privileges or secrets are required by this code change.
5. Build/redeploy the frontend after backend compatibility is established. Existing CORS allowlists remain; new evidence CORS must include the actual frontend origin. Nothing was pushed/deployed locally by this task.
6. Use two controlled accounts. Judge signs in → Request Temporary Operations Access. Confirm one admin email. Admin signs in → Review judge requests → Approve 60 minutes. Confirm judge email includes original deadline/UTC. Test dashboard, map, evidence, progression/public updates, AI and all five MCP tools using suitable team incident data. Use a separate account for rejection/revocation tests. Do not restore the old reports.
7. Keep the judge dashboard open through the real deadline. Verify countdown ends, Citizen remains available, and direct reads/write RPCs, AI, evidence endpoint and existing MCP token fail after expiry. Refresh/relogin/reconnect must not renew. Confirm permanent Operations still works and audit attribution is present. Test mobile/tab resume, duplicate approval, failed email/retry, and deliberate invalid workflow transitions. Never shorten a real grant by editing timestamps just to force an acceptance PASS.

If rollout fails, stop admitting judges and use the protected revocation RPC for active grants. Do not remove tables/rows or alter deadlines ad hoc. A rollback of these authorization helpers requires a separately reviewed plan; replacing the helper with permanent-only denies active judges but leaves existing records intact. The newly inserted pending identity anchors may have assignment/audit references and must not be deleted blindly.
