> **15 October 2026 source-release update:** 000 → 002–013 remains the original bootstrap runner scope. The fresh baseline now includes an invoker-only pinned timestamp helper, not a clone of the old SECURITY DEFINER function. Fresh judge setup then uses 015 → 016 → 017 → 019. Skip 018 on fresh projects: it targets the exact original legacy helper/ACL/triggers and correctly rejects this fresh baseline. Historical 001 and M4E 014 remain excluded. Fresh sequence validation uses synthetic managed-service stubs, not hosted Supabase parity. See [SOURCE_RELEASE_SETUP.md](SOURCE_RELEASE_SETUP.md). Require separate approval for any hosted change.

# Independent hackathon Supabase setup — preparation only

Approved application release: `9b242aa1fb4d073acce007bcd654a603af810eda`.
No project has been created, contacted, migrated or deployed by this preparation.
Production `pmzbdrxedlthdqdpgigs` and M4E `fnsshpaprqlshmmyavfh` are permanently rejected by the supplied runner.

## Why a new baseline is required

Historical `supabase/historical-bootstrap/001_initial_mvp.sql` creates enum-based `reports` and `profiles.full_name`; 002 assumes text-based `incidents`, `evidence` and `profiles.display_name`. Do NOT apply 001.
The candidate `supabase/hackathon/000_release_baseline.sql` supplies only those established objects plus an empty identity-based `reports` compatibility table/sequence needed by 011. It is derived from release schema dependencies and existing synthetic schema contracts, not copied production data or a claimed production schema clone.
Managed Supabase Auth/Storage must already exist. 002 creates the deferred Auth signup trigger; 005 replaces its function with final Citizen-only signup behavior. No extra trigger is invented. There is no seed data. 014 and M4E's evidence-upload/privacy-cleanup are deliberately excluded.

## Exact order — one file at a time

| Order | File |
| --- | --- |
| 000 | supabase/hackathon/000_release_baseline.sql |
| 002 | supabase/migrations/002_accounts_evidence_upgrade.sql |
| 003 | supabase/migrations/003_fix_incident_categories.sql |
| 004 | supabase/migrations/004_fix_evidence_constraints.sql |
| 005 | supabase/migrations/005_multi_workspace_access.sql |
| 006 | supabase/migrations/006_voice_transcription.sql |
| 007 | supabase/migrations/007_transcription_quota_tuning.sql |
| 008 | supabase/migrations/008_citizen_report_edits_updates.sql |
| 009 | supabase/migrations/009_nigraan_ai.sql |
| 010 | supabase/migrations/010_city_environment_context.sql |
| 011 | supabase/migrations/011_security_harden_legacy_access.sql |
| 012 | supabase/migrations/012_citizen_accountability.sql |
| 013 | supabase/migrations/013_citizen_around_me.sql |

Baseline stays outside the normal migrations directory to prevent accidental existing-project application. Do not use `supabase db push`, link, reset, migration repair, dashboard SQL paste, or arbitrary deploy commands to bypass the guard. This procedure uses owner SQL files and DOES NOT create Supabase CLI migration-history entries; do not subsequently mix it with CLI migration application without a separately reviewed history strategy.

## Beginner checklist and future execution gates

1. **Local review first.** Run `node scripts/hackathon-bootstrap.mjs verify` and `node --test tests/hackathon-bootstrap.test.js`. These read files only; they do not run SQL. Review the baseline and integrity manifest. SHA256 detects accidental drift, not malicious edits to both source and manifest.
2. **Authorize a new dedicated project separately.** Choose a funded evaluation-period plan and region. Create it only after approval. Record its actual 20-letter ref privately; never use either forbidden ref. No ref is prefilled here. The local planner accepts `node scripts/hackathon-bootstrap.mjs plan --project-ref NEW_REF --confirm-project-ref NEW_REF` only when both actual values match; NEW_REF is a placeholder and is intentionally rejected.
3. **Inspect fresh hosted prerequisites under separate authorization.** Owner role must be postgres; managed auth.users/storage.objects/storage.buckets and standard roles must exist. Public tables/views/sequences, users, buckets and application migration history must be empty. Check browser roles cannot inherit owner/BYPASSRLS privileges, public schema ownership, extension availability (including gen_random_uuid), automatic-RLS event triggers, exposed public Data API schema, and unexpected existing functions/triggers/policies. Do not disable automatic RLS or broaden ACLs. Any mismatch stops setup. A default extension table in public will deliberately fail the baseline and needs review rather than deletion.
4. **Apply exactly the ordered files**, only after hosted review. Install/verify owner tooling separately if absent; this preparation installs nothing. Direct database IPv6 connectivity, psql and a trusted Supabase certificate chain are prerequisites. Pooler connections are intentionally unsupported. Supply a database-owner URL privately as process environment `HACKATHON_DATABASE_URL`; never put it in a command argument, committed file, report or copied .env. The runner validates exact `db.NEW_REF.supabase.co:5432`, owner postgres and database postgres, overrides PG targeting, uses TLS verify-full and never prints the URL/password or child diagnostics.

   Future command template (NOT executed):

   ```powershell
   node scripts/hackathon-bootstrap.mjs apply-one --project-ref NEW_REF --confirm-project-ref NEW_REF --migration 000 --ack-new-empty-project --execute --approve-reviewed-operation
   ```

   Repeat with 002 through 013 in the table order, inspecting results privately between each file. The acknowledgment refers to the originally reviewed fresh project; after 000 application tables exist. The runner allows one listed file, not arbitrary SQL, but does not remotely inspect history/order or independently prove project novelty. Keep a private execution log and stop on missing/out-of-order/duplicate files. SQL transactions protect each file, NOT the entire chain. Baseline refuses existing public objects/users/buckets, and many later files are intentionally not rerunnable. The runner suppresses child output to avoid credential leakage; a failure requires private diagnosis and renewed review, never automatic retries.

5. **Validate grants and signup before populating anything.** Check RLS on every application table; no anon report reads, no browser approval or arbitrary writes. Verify narrow authenticated grants, definer ownership/search_path and deferred signup trigger. Global/postgres public default privileges are revoked in 000; existing managed Auth/Storage ACLs are not rewritten. Service-role access is opt-in through release grants, including 006 transcription job CRUD and environmental worker RPCs. This choice must be validated against hosted function execution.
6. **Deploy only required release functions after independent approval.** Verify integrity again. Use one function per confirmed operation:

   ```powershell
   node scripts/hackathon-bootstrap.mjs deploy-function --project-ref NEW_REF --confirm-project-ref NEW_REF --function city-context --execute --approve-reviewed-operation
   ```

   Allowed names are city-context, nigraan-ai, transcribe-recording; no privacy functions. An existing Supabase CLI and project-authorized account/access token are prerequisites. Every deployment uses explicit project-ref, shell:false, no linked target, and no-verify-jwt matching release config. Handler Auth getUser and approval checks remain enabled. CLI-managed token/cache behavior is outside this wrapper; verify account privately. Deployments overwrite a function of the same name and are separately approved operations. On Windows an actual executable must be on PATH; .cmd-only tooling may need separately reviewed invocation. Do not add shell:true as a shortcut.
7. **Configure independent public frontend/MCP values and functions' private secrets**, then create only synthetic test identities/data under separate authorization. Do not copy production/M4E values. Finish browser/hosted acceptance before claiming demo readiness.

## Release-compatible Storage, Auth and function settings

- 002 creates private `incident-evidence`, maximum 10 MiB, MIME allowlist image/jpeg, image/png, image/webp, audio/webm, audio/ogg, audio/mp4. Preserve RLS and `nigraan_storage_*` policies/helpers. Original evidence paths are owner/incident/file; 008 adds owner/incident/change-draft/file. Draft-only owner uploads/cleanup and authorized submitted reads remain; updates/overwrites are denied. Do not apply 014's direct-upload denial or make the bucket public.
- Auth: enable the supported email/password flow. Site URL for first acceptance: http://127.0.0.1:5173/. Allow that exact signup/confirmation return URL; if using localhost instead, configure http://localhost:5173/ and use its matching MCP variant. Configure the selected /agent-callback URL for documented browser flow; MCP callback validation is separate from Supabase Auth redirects. Avoid wildcard redirect allowlists. Decide confirmation/mail delivery explicitly; use controlled test addresses or independently confirmed synthetic users.
- Synthetic Citizen: signup creates own profile through the deferred trigger, default account_type citizen; no metadata-selected privileges. Separate Operations user signs up normally, applies through nigraan_apply_operations with organization name (1–200), a supported type (government/ngo/civic_organization/utility/volunteer_group/other), explanation up to 1000. Application starts pending. Owner-only approval of its pending row is a later privileged data change; use the release admin procedure only after separately reviewing target/account. Browser cannot self-approve. Login alone is insufficient: is_approved_operations must return true.
- city-context: built-in NEW-project SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY; CITY_CONTEXT_ALLOWED_ORIGINS initially `http://127.0.0.1:5173,http://localhost:5173`. Release handler validates Auth and Operations approval; worker service key is server-only and constrained to environmental RPCs. Normal weather/air-quality providers are external services: their later requests require authorization, not a local-only claim.
- Optional nigraan-ai: independently supplied GROQ_API_KEY and NIGRAAN_AI_ALLOWED_ORIGINS for selected origins; optional transcribe-recording: GROQ_API_KEY and TRANSCRIPTION_ALLOWED_ORIGINS. Keep all three verify_jwt=false as in release config because handlers perform Auth verification. Never expose service/Groq credentials through VITE variables.
- Around Me needs a separately reviewed release-building schedule/worker if demonstrated; migration 013 alone does not establish populated releases. Realtime incidents publication is a separate optional reviewed configuration; polling exists. No cron/realtime changes are prepared or run here.

## Minimum Alexa+ MCP demonstration

The reviewed full database chain 000 + 002–013 is recommended for unchanged release frontend compatibility. Raw MCP reads need approved identity, incidents, published-change metadata and environmental function support, but skipping intermediate migrations is not a supported bootstrap. For all five tools and a populated investigation, deploy city-context, create approved Operations plus synthetic submitted incidents/published activity. AI and transcription functions/Groq are optional unless those extra features are demonstrated; required Citizen photo evidence uses real private Storage without either function. Record all synthetic records as test scenarios, never actual city conditions.

Use existing local MemoryStore MCP for initial browser acceptance; no AWS credentials or calls are needed by server/mcp/src/local.ts. It still accesses the NEW hosted Supabase. Set VITE_SUPABASE_URL/ANON_KEY to the new project's public config; MCP accepts these or SUPABASE_URL/ANON_KEY (those take precedence). VITE_NIGRAAN_MCP_URL=http://127.0.0.1:8787. Startup after separate service authorization: `npm --prefix server/mcp run dev:simulator` and `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`. These scripts can load a local .env; review it privately and never copy another workspace's .env.
Client is nigraanos-alexa-simulator; consent http://127.0.0.1:5173/; exact callback http://127.0.0.1:5173/agent-callback; resource http://127.0.0.1:8787/mcp. localhost uses dev:simulator:localhost and matching frontend/callback; MCP still binds 127.0.0.1:8787. Keep any shared redirect override consistent. Judge-facing HTTPS frontend/AWS MCP require a later dedicated stack and reviewed origin allowlist change; existing defaults reference the existing Netlify origin and must not silently be reused.

## Validation, privileges, rollback and remaining gates

Local tests prove sequence/target guards, no production/M4E targets, strict owner-host binding, source integrity and unchanged release files. They DO NOT execute any migration, establish SQL correctness, hosted Auth/Storage/RLS, TLS/CLI availability, Edge imports, or account privileges. Missing optional PGlite helper remains unresolved; no SQL was run even locally in this step. Before applying, separately authorize an isolated SQL chain/security test and read-only fresh-project hosted inspection. No schema-parity or production-readiness claim follows from static tests.
Privileged tasks: project provisioning/billing; owner SQL, trigger/default-ACL changes and Storage policies; function deployment; secret configuration; test account creation/confirmation; Operations approval; any future scheduler/publication changes. Schema/functions/settings and data writes are external changes needing separate authorization. Do not put owner or service credentials in the frontend.
Rollback: stop after any failure. Each SQL file is transactional; already committed earlier files remain. No automatic down migrations, reset, cleanup, history repair or deletion are provided. Keep a private execution log and snapshot of reviewed artifacts; investigate before resuming. Recreating an unused disposable project requires separate approval. Once test users/media exist, preserve them until an explicitly approved teardown. Function rollback is a separately approved deployment of a verified previous artifact, not silent fallback. Recovery here never touches production or M4E.

The next safe action is an independently authorized SQL validation of this candidate baseline/chain. A new empty project may then be provisioned after owner review; applying the bootstrap remains gated on fresh-project inspection and SQL verification.
