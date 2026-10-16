# Fresh-clone setup — source release updated 17 October 2026

This checklist reproduces the checked-in implementation, not a database backup. The owner reports the original deployment is working; this preparation made no hosted changes. Nigraan Agent is a deterministic Alexa+ web simulation with real MCP reads, not an official Alexa+ integration or an unrestricted AI planner.

## 1. Public, local-only checks

Use Windows CMD, Node 22.23+ (Node 24 for AWS Lambda), npm and Git. Clone the reviewed submission commit after it is published; do not assume today's main contains the proposed files yet.

```cmd
git clone --config core.autocrlf=false https://github.com/Shamsie687/NigraanOS.git
cd NigraanOS
npm ci
npm --prefix server/mcp ci
node scripts/verify-source-release.mjs
node scripts/hackathon-bootstrap.mjs verify
npm test
node tests/judge-access-render-check.mjs
node tests/source-release-migration-check.mjs
node tests/judge-access-migration-check.mjs
node tests/judge-activation-migration-check.mjs
node tests/judge-renewal-migration-check.mjs
node scripts/verify-source-release.mjs --self-test
npm --prefix server/mcp test
npm --prefix server/mcp run typecheck
npm --prefix server/mcp run validate:infra
npm run build
git diff --check
```

These use synthetic fixtures and do not need Supabase/AWS/Gmail credentials. PGlite is pinned in the root lockfile; no cleanup backup folder or ignored review runtime is required. Rollup's existing WASM override is preserved. The native SQL option requires a running Docker Linux engine and its pinned PostgreSQL image; the default tests do not establish native concurrency. No dedicated frontend typecheck is configured; frontend checks use tests, rendering and Vite.

The clone command deliberately preserves Git's LF bytes on Windows. The existing licensing test parses LF-delimited upstream notices before checking their exact hashes; a default CRLF-converting checkout can fail its marker assertion despite unchanged license text. Use the documented clean LF clone; do not edit license notices or relax their hash checks. Source integrity itself accepts both LF and CRLF.

## 2. Private runtime configuration

Only browser-safe `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and public `VITE_NIGRAAN_MCP_URL` belong in ignored local configuration or Netlify Production build variables. MCP URL is an origin, with no trailing slash or `/mcp`. Do not put service-role keys, provider credentials or OAuth tokens in Vite variables. A build with missing/wrong values may compile but is not a working deployment.

The hosted submission uses the existing Netlify site and AWS origin documented in the judge guide/deployment runbook. Local reproduction requires separately authorized access to a compatible Supabase project: no incident data or test identity is bundled. Operations requires verified permanent membership or an activated temporary grant. An unapproved fresh account cannot demonstrate Operations merely by starting Vite.

For local simulation, create ignored `.env` privately with the compatible project's public URL/key and `VITE_NIGRAAN_MCP_URL=http://127.0.0.1:8787`. In separate CMD windows run `npm run dev` and `npm --prefix server/mcp run dev:simulator`; use `http://127.0.0.1:5173` consistently. That server has real Supabase reads, not seeded incident mocks. Its callback is `/agent-callback`; do not use the separate local test-client registration accidentally. Supabase Auth must allow the exact chosen frontend origin. Browser media/geolocation and email confirmation may require manual permissions. Static fixtures are tests, not hosted-data evidence.

## 3. Database setup — privileged, new disposable project only

**Do not run this against the original or M4E projects. Do not replay deployed migrations.** Project creation, SQL, users and deployments require separate owner approval. Existing projects need a read-only compatibility review instead of this bootstrap.

For a genuinely empty Supabase project with managed Auth/Storage and standard roles:

1. Verify its new reference privately and inspect emptiness. Use `scripts/hackathon-bootstrap.mjs verify` and its documented exact-reference guards for the 000–013 foundation. Never use historical 001, bulk `db push`, reset, or automatic migration replay.
2. Apply `supabase/hackathon/000_release_baseline.sql`, then migration files **002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013** one at a time, stopping on any failure.
3. Apply **015 → 016 → 017 → 019 → 020** one at a time for fresh judge access. **Do not apply 014 or 018.** 014 belongs to separate privacy work. 018 hardens the exact original project's legacy timestamp helper and deliberately rejects a different schema. The fresh 000 baseline instead defines an invoker-only, pinned timestamp helper and matching update triggers; this is new fresh-project compatibility preparation, not deployed original SQL. Synthetic validation covers this fresh sequence. Managed Supabase Auth/Storage behavior still needs separate hosted acceptance.
4. Migration 002 configures the private `incident-evidence` bucket and policies. Preserve RLS, caller-scoped RPCs and column grants. Never make evidence public. No real accounts, incidents or media are restored or seeded by the bootstrap.
5. Establish a verified organizer Auth identity privately. Use the existing guarded `supabase/admin/approve_operations_for_testing.sql` only for the verified organizer's permanent application, then the UUID-placeholder `bootstrap_judge_admin.sql` and `verify_judge_admin.sql`. Do not infer authorization from the notification inbox. Never populate repository templates with private UUIDs.

The bootstrap uses SQL Editor/owner SQL files, not automatic CLI migration-ledger recording. Do not mix this with CLI application/history repair without a separate plan. Each transaction rolls back its own failure; earlier successful files remain. No automatic down migrations, deletion or recovery claims are provided.

## 4. Edge Functions and email — privileged private setup

Existing functions are `city-context`, `nigraan-ai`, `transcribe-recording`, plus `judge-evidence` and `judge-notifications`. Their source and per-function internal authentication configuration are included. Deploy only to the separately confirmed target with explicit `--project-ref`; do not use a generic command against an implicitly linked project. No deployment is performed by local setup/tests.

Configure `JUDGE_ALLOWED_ORIGINS` to exact approved frontend origins; never use a wildcard. `judge-evidence` validates Auth identity, current access and caller RLS before privileged exact-path download. `judge-notifications` requires `JUDGE_WEBHOOK_SECRET` before claim/send. Runtime Supabase server credentials stay server-side. Optional existing AI/transcription provider secrets are needed only for those features; inspect their documented handler settings rather than guessing values. City context uses external modeled-weather/AQ services; it is not an offline fixture at runtime.

The existing optional provider settings are `GROQ_API_KEY`, `NIGRAAN_AI_MODEL`, `NIGRAAN_AI_ALLOWED_ORIGINS`, `TRANSCRIPTION_ALLOWED_ORIGINS` and `CITY_CONTEXT_ALLOWED_ORIGINS`. Keep provider credentials private and set exact allowed frontend origins for each deployed feature. Supabase supplies the runtime project URL/public/service credentials to its functions; never copy those into a repository or browser. AWS deployment parameters are enumerated in `infra/mcp/template.json`; let the reviewed template supply Lambda environment mappings instead of manually editing them.

Email instructions: [GMAIL_NOTIFICATION_SETUP.md](GMAIL_NOTIFICATION_SETUP.md). The current transport deliberately allows only the organizer mailbox `nigraanos.admin@gmail.com`; an unrelated reviewer cannot substitute a different sender without a separately reviewed code/configuration change. Tests mock Gmail; no Gmail credentials are required for tests. Only the owner privately authorizes `gmail.send` using `scripts/authorize-gmail.mjs`. Store `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `JUDGE_EMAIL_FROM`, `JUDGE_WEBHOOK_SECRET` in Edge secrets, never Git. The Windows DPAPI file remains outside the repository. Google External Testing tokens expire after seven days; October authorization does not cover November judging.

Initialize Database Webhooks through Supabase's integration enable action, not merely pg_net or an empty schema. Only after separate delivery-test approval configure INSERT/UPDATE on `public.nigraan_judge_email_outbox` with the worker URL, JSON content type and private header. Enabling a webhook does not backfill old pending rows. A controlled retry can generate one event; uncertain delivery must not be retried blindly. No worker, webhook or email is activated by this checklist.

## 5. AWS and frontend release — explicit approvals required

AWS uses API Gateway HTTP API, Lambda (Node 24/ARM64), DynamoDB, KMS and CloudWatch. `infra/mcp/template.json` and the locked server package contain the actual runtime entry point. For the existing stack follow [AWS_JUDGE_ACTIVATION_DEPLOYMENT_CMD.md](AWS_JUDGE_ACTIVATION_DEPLOYMENT_CMD.md): read-only identity/config inspection, private rollback artifacts, local SAM build, approved package/change set, reviewed execution. For a new stack supply independently reviewed parameters; `use-existing-parameters.json` is for UPDATE only, never fresh CREATE. No AWS secrets belong in the frontend. Do not deploy local.ts/MemoryStore.

Current simulator origins are the existing Netlify origin and exact local development origins. A different hosted domain requires reviewing the frontend/server consent/CORS allowlists, client and callback registration; environment variables alone do not add arbitrary trusted origins. Keep Netlify build command `npm run build`, publish directory `dist`, and `public/_redirects` copied to `dist/_redirects`. Retain the last published deploy and previous AWS artifact. A GitHub merge can automatically deploy Netlify and is a separate approval gate.

## 6. Judge acceptance and release limitations

Use [HACKATHON_JUDGE_GUIDE.md](HACKATHON_JUDGE_GUIDE.md). Approval defaults to a 48-hour activation window, with an administrator-selectable future deadline within 45 days. One successful activation starts twelve server-clock hours. Only the protected administrator may renew an expired cycle; active sessions cannot be extended and revoked/rejected cycles cannot be renewed. Existing started one-hour grants retain their original deadlines. Email failure does not reset either deadline. Repeated activation cannot extend it. Current Operations views are broad operational access, not sanitized Judge Mode. Evidence/incident data must be team-authorized and safe for evaluation.

Independent reviewers need an agreed access arrangement through November 9–20. A twelve-hour account is not continuous access throughout judging: returning reviewers require administrator renewal after expiry. Maintain organizer coverage and confirm the access arrangement meets organizer requirements. No official Alexa+ connection, hosted checksum, full server security certification or evaluation-period uptime is claimed. Record a truthful demo, including valid empty candidate/activity results. Do not reintroduce the deleted test reports.

Integrity manifests hash canonical Git LF text bytes (CRLF becomes LF; every other byte is preserved). Both LF exports and Windows CRLF checkouts must pass the same exact hash inventory. The source manifest excludes only its own circular self-hash; inspect its staged diff and allowlist separately.

Current deployed production already includes 015–020. Never replay them. The fresh-project sequence deliberately omits original-project-only 018; 020 remains apply-once and must stop on predecessor drift. Optional native concurrency checks: `node tests/judge-renewal-migration-check.mjs --docker` (isolated Docker Linux PostgreSQL only). No application import or verification requires ignored recovery files.
