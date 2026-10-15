> **15 October 2026 source-release update:** The owner reports migrations 015–019, administrator bootstrap, Gmail notifications, Edge Functions, AWS MCP and Netlify live. Do not replay the original rollout below. This is historical original-project documentation, not a fresh bootstrap. See [SOURCE_RELEASE_SETUP.md](SOURCE_RELEASE_SETUP.md). Require separate approval for any hosted change.

# Judge access production activation

**14 October update:** production 015–018 and administrator setup are already complete. The new judge-start requirement is prepared locally in **019**. Follow [JUDGE_ACTIVATION_ROLLOUT.md](JUDGE_ACTIVATION_ROLLOUT.md) for the current staged rollout and its pre/postchecks; do not replay the historical database steps below. Approval now waits for judge activation within 48 hours; the one-hour timer starts at activation.

Prepared 12 October 2026. Review only: no hosted inspection, SQL execution, secrets transfer, deployment or push performed. Target **pmzbdrxedlthdqdpgigs**, website **https://nigraanos.netlify.app/**, existing AWS stack **nigraan-mcp-staging**, region **ap-south-1**. Never target M4E `fnsshpaprqlshmmyavfh`.

## First action and activation gate

The existing private capture has been reviewed offline. All release policies, the nine legacy Citizen policies, Around Me behavior, and the two timestamp triggers are compatible. Do not repeat those exports. New migrations 017 and 018 address inherited service-role execution and the timestamp helper's unpinned search path. No historical migrations or Citizen data are changed.

**First production action is read-only:** confirm Dashboard reference **pmzbdrxedlthdqdpgigs**, begin the quiet maintenance window and run the complete **docs/JUDGE_PRODUCTION_FINAL_PREFLIGHT.sql** in SQL Editor. Expected result: **PASS_REQUIRES_015_016_017_018**, zero blocked checks. That status accepts only the reviewed snapshot plus the mandatory hardening plan; it does not claim hardening is already installed. Stop on BLOCKED or SQL errors. Preserve current private database/schema backups and deployed frontend/MCP artifacts/settings before authorizing writes. Completed cleanup backups do not cover the current whole database.

Privately confirm the administrator's verified Auth identity, matching profile and existing permanent Operations approval before bootstrap. SQL catalog checks do not establish that specific account or the Dashboard project reference. No UUID needs to be shared. The normal Operations data/evidence must be suitable for judge access; this is not sanitized access.

Local final compatibility tests: 13 isolated PGlite checks passed, including fingerprint-bound preflight, caller search-path shadowing protection, timestamp behavior, ACL/config/trigger drift rejection, ordered migrations and catalog postcheck. Hosted lock-wait, Storage, email, MCP and full 60-minute acceptance remain post-deployment gates. No production SQL or deployment has been performed.

## Deployment sequence — separately approve before execution

1. After the fresh preflight passes and **separate explicit production-write authorization**, remain in the confirmed original SQL Editor. Execute these complete repository files in this exact order, each once:

   - `supabase/migrations/015_temporary_judge_access.sql`
   - `supabase/migrations/016_gmail_notification_retry_safety.sql`
   - `supabase/migrations/017_judge_rpc_service_role_hardening.sql`
   - `supabase/migrations/018_pin_reviewed_timestamp_search_path.sql`

   Every file is a transaction. 017 revokes inherited execution only on new judge helpers and restores only worker claim/finish; global defaults and legacy permanent helper privileges are unchanged. 018 uses exact body/owner/privilege/dependency guards before and after `ALTER FUNCTION ... SET search_path=pg_catalog`; it does not replace the body, signature, owner, SECURITY DEFINER mode, grants or triggers. Do not change guards to accommodate a failure.

   Stop immediately at any error, timeout, partial rollout, unexpected output or concurrent schema change. A failed later transaction does not undo earlier committed files. Keep requests, webhook and new frontend inactive; inspect state before resuming, never replay 015 blindly. Do not apply 014 or use broad `db push`. SQL Editor application does not automatically record CLI migration history; reconcile separately after review.

   Then run **docs/JUDGE_PRODUCTION_POSTDEPLOY_CHECK.sql** (read-only). Require **PASS**, zero blocked checks before continuing. It verifies helper bodies/security, the 018 configuration and preserved grants/triggers, RLS on new tables, restricted anonymous/service-role access and expiry triggers. This postcheck replaces the pre-deployment query after migrations: the pre-deployment query intentionally rejects new-object collisions. Privately compare pre/post permanent approvals and unrelated records against the current backup; migrations contain no incident cleanup or Auth modification. SQL catalog checks alone cannot attest all existing data contents.

2. Execute a **private copy** of `supabase/admin/bootstrap_judge_admin.sql` with the privately verified Auth UUID substituted. Never edit the repository template. It requires owner SQL Editor access, verified email, existing permanent approval and no different allowlisted administrator. Expected administrator count: **1**. It does not change Auth, profiles or permanent approval.
3. Configure server secrets using `GMAIL_NOTIFICATION_SETUP.md` under the same Windows account that saved DPAPI credentials. Disable clipboard history/sync, copy each decrypted value directly into Edge Function Secrets, clear clipboard and close PowerShell. Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `JUDGE_EMAIL_FROM` exactly `nigraanos.admin@gmail.com`, and private random `JUDGE_WEBHOOK_SECRET` (at least 32 characters). Also set `JUDGE_ALLOWED_ORIGINS=https://nigraanos.netlify.app` for evidence. Do not overwrite Supabase Auth email settings or unrelated secrets. Supabase supplies runtime project credentials; no browser service-role credential is added.
4. Deploy the two new functions in this order from the release root, using an already authorized Supabase CLI session:

   ```powershell
   supabase functions deploy judge-evidence --project-ref pmzbdrxedlthdqdpgigs --no-verify-jwt
   supabase functions deploy judge-notifications --project-ref pmzbdrxedlthdqdpgigs --no-verify-jwt
   ```

   These specific handlers validate caller JWT/RLS or the webhook secret internally. Do not disable JWT verification on legacy functions. No AI/city-context redeployment is needed if the live inspection confirms their deployed authorization matches the release. If CLI access or webhook extension activation is missing, stop for explicit setup approval.
5. Configure Database Webhooks on `public.nigraan_judge_email_outbox`: INSERT and UPDATE, POST to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/judge-notifications`, JSON content type and the private `x-judge-webhook-secret` header. Both migrations and the worker must exist first. Do not expose the header or use service-role credentials as the webhook secret. Pending jobs only are processed. An approved Database Webhooks/pg_net prerequisite may be necessary; do not enable it silently. Replace `YOUR_PROJECT_REF` with the explicitly confirmed target project reference before using this example URL.
6. Update **existing** AWS MCP Lambda from `server/mcp`; the older MCP guide's first-deployment banner is historical. First privately inspect the existing deployed stack/template/parameters, endpoint, callback, account and retained DynamoDB/KMS resources. Keep current parameters, IAM, origin and resource identities; Gmail secrets belong only in Supabase, not AWS. Local preparation commands:

   ```powershell
   npm --prefix server/mcp run build
   npm --prefix server/mcp run validate:infra
   sam build --template-file infra/mcp/template.json
   ```

   The actual reviewed update uses this built template and stack, retaining current parameter values. Do **not** blindly use guided defaults or create a new packaging bucket. Prepare an UPDATE change set through the existing approved SAM/CloudFormation process using its current artifact bucket and parameters. This repository has no saved SAM configuration identifying that bucket; the exact upload/change-set command must be finalized from the private live stack configuration. Review all changes: stop for table/key/API replacement, IAM expansion, endpoint changes or unrelated configuration changes. Approve that exact change set separately, then execute it and wait for **stack-update-complete**, not stack-create-complete. Never delete the stack to roll back. The new MCP artifact caps tokens/references at the judge deadline and rechecks database authorization; old deployed code has not been established to satisfy this requirement.
7. Deploy frontend **last** to the existing Netlify site. Retain existing public Vite Supabase URL/anon key and MCP URL/client ID; verify they target the original project and unchanged AWS origin without exposing values. Build with the site's actual approved public build environment:

   ```powershell
   npm run build
   ```

   Use the existing site's approved deployment method. For a manual Netlify deployment, upload this release's built **dist** folder to that site's Deploys page; do not create another site or upload repository/private files. Confirm the resulting live URL remains unchanged and `/agent-callback` rewrite from `public/_redirects` is present. A manual dist upload does not inject Netlify environment variables after compilation. If using Git builds instead, commit/push requires separate approval; no push is necessary for the manual artifact route.

## Acceptance before judge admission

Use controlled accounts and suitable current team data; do not restore deleted reports. Verify permanent Operations/Citizen behavior, unchanged permanent approvals and unrelated incident records against the pre-rollout snapshot. Confirm a non-admin cannot review/approve/retry and judges cannot change allowlists or permanent membership.

Submit a request; privately verify actual Gmail sender and receipt of the admin notification. Approve once, confirm the applicant receives the original UTC expiration and dashboard countdown. Verify map/evidence/workflow/AI/city context and all five MCP tools. Rejection and early revocation require separate controlled accounts because each account receives only one request/window. Audit actors and workflow changes must persist. Check notification failures cannot alter grant timestamps and uncertain sends cannot be retried.

Keep Operations open through the full 60 minutes. Verify direct RLS/RPC/Edge requests, AI and existing MCP delegation/reference fail after expiry, evidence is no longer served, browser returns to Citizen, refresh/relogin cannot renew, and permanent Operations remains available. Complete mobile/tab-resume checks. Do not admit external judges before these results pass. This is normal Operations data and write access, not sanitized access; organizer must approve the suitability of current reports/evidence. Already delivered data cannot be recalled.

## Failure and rollback

Stop the rollout and judge admission at any error. Disable the new notification webhook if delivery is faulty; do not blindly retry unknown delivery. Email outages do not revoke or extend grants. Use the protected administrator revoke action for active grants while the compatible frontend/backend is available; verify each revocation. Wait for expiry if revocation is unavailable rather than improvising broad SQL.

Restore the previous Netlify artifact and reviewed MCP artifact only after active temporary grants have been revoked/expired and access checks verified. AWS rollback must retain its existing table/key/API and settings. Keep new DB tables/audits/pending identity anchors intact. There is no tested automatic down migration: replacing authorization/Storage/audit helpers requires a reviewed database rollback using captured pre-change definitions. Do not drop migrations/tables, delete identities or restore an entire database over current data ad hoc.

## Gmail Testing availability decision

Authorization expires seven days after actual consent. Renewing on **21–22 October** covers approximately **28–29 October**, not an unknown later evaluation period. Update the hosted refresh-token secret after every renewal and verify controlled delivery; saving a local token alone changes nothing hosted. Schedule owner renewals through evaluation or complete the appropriate Google publishing/verification-exception process and authorize afresh. Publishing is not verification; delivery/token revocation still requires monitoring. If no later renewal plan exists, ongoing automatic notification availability is blocked. Gmail's consumer daily limits share the account's normal use, and uncertain jobs intentionally remain blocked to prevent duplicates.

## Timestamp hardening recovery and final postchecks

If 018 fails its guards, its transaction rolls back; do not recreate `handle_updated_at`, change its owner/grants, drop its triggers or loosen RLS. The helper may remain unpinned while earlier judge migrations are committed: keep activation paused. Keep the approved pre-change definition and ACL privately. A separately reviewed emergency configuration rollback can restore its old search-path setting, but that reopens the reviewed risk and requires judge admission to remain paused; no automatic down migration is supplied.

After catalog PASS and administrator bootstrap, verify real Citizen profile/report edits still update timestamps, permanent Operations reads/workflow/evidence still work, no permanent approvals changed, admin-only decisions enforce identity, and direct judge writes/read RPCs deny expiry. Recheck catalog postcheck after any rollback or manual adjustment. The existing full hosted 60-minute, email, evidence and MCP acceptance section remains mandatory before external judges are admitted.
