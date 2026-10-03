# Nigraan AI MVP — local implementation and deployment handoff

Implemented locally only. Migration 009 has not been applied remotely; the new
function has not been deployed or live-tested. Do not claim real AI is working
until a deployed Groq request succeeds and its sources are checked.

## File inventory

Created: `supabase/migrations/009_nigraan_ai.sql`; the four files
`supabase/functions/nigraan-ai/{index.ts,handler.js,context.js,responseValidation.js}`;
`src/services/nigraanAi.js`; `src/hooks/useNigraanAi.js`;
`src/components/NigraanAiPanel.jsx`; `tests/nigraan-ai.test.js`;
`tests/nigraan-ai-migration-check.mjs`; `tests/nigraan-ai-render-check.mjs`;
`tests/ai-browser-server.mjs`; `tests/ai-browser/{fixture.jsx,client.js,feed.js}`;
this document; and the mobile verification screenshot.

Changed: `src/pages/OperationsPage.jsx`, `src/components/Sidebar.jsx`,
`src/index.css`, `supabase/config.toml`, `package.json` (AI test script only).
Removed: the unused demo `src/components/AiCopilot.jsx`.
Production build and existing rendering checks regenerated their local artifacts.
Migrations 002–008 and both transcribe-recording source files remained unchanged.

## Deployment order

1. After already deployed 008, run **only** `supabase/migrations/009_nigraan_ai.sql`
   once in this linked project's Supabase SQL Editor. Do not rerun 001–008.
2. Add server-side secrets shown below. Existing `GROQ_API_KEY` is reused;
   do not change the working transcription secrets/function.
3. Deploy `nigraan-ai` from the project root.
4. Reload the local app, sign in with approved Operations access, open Nigraan AI
   and run the live acceptance checks. No `.env` additions are required.

PowerShell, from `C:\Users\User\Downloads\huggingface`:

```powershell
supabase secrets set NIGRAAN_AI_MODEL="openai/gpt-oss-20b" NIGRAAN_AI_ALLOWED_ORIGINS="http://127.0.0.1:5173,http://localhost:5173"
supabase functions deploy nigraan-ai --no-verify-jwt
```

The function verifies JWTs using Auth `getUser()` internally; disabling the gateway's
legacy JWT check does not disable authentication. Never add a Groq or service-role
secret to Vite. For hosted demos, add the exact HTTPS app origin to the **AI** origin
allowlist; do not modify transcription settings as part of this setup.

The configured model is restricted to GPT-OSS 20B for this quota budget. The current
production model and strict schema support were verified against official Groq docs:
https://console.groq.com/docs/models
https://console.groq.com/docs/structured-outputs
https://console.groq.com/docs/rate-limits

## Authorization and snapshot

- Browser sends question, supported scope/category/activity window and optional
  incident ID; unexpected fields, including client incident data, are rejected.
- Edge verifies Auth identity and `is_approved_operations()`.
- Its sole DB client uses `SUPABASE_ANON_KEY` plus the caller Authorization JWT.
  **There is no service-role client or privileged incident reader in this function.**
- `nigraan_ai_snapshot(text,text,integer,uuid)` is SECURITY INVOKER. Explicit SELECT
  projections run with current RLS and one statement/MVCC snapshot.
- Draft incidents and unpublished Citizen changes are excluded. Current approved
  Operations access is all submitted incidents, not organization-specific scope.
- Snapshot supports briefing, unresolved, recent, longest and selected-incident
  scopes; eight canonical category filters; activity windows 24/168/720 hours.
- The activity window applies to published Citizen activity, not incident age.
  Recent scope selects incidents with published activity in that window.
- Counts/categories/status distributions cover **all matching records**, including
  more than a PostgREST page. Detail selection is at most eight incidents and eight
  activity records, reduced further if needed for the provider budget. Coverage
  states omitted incident/activity detail counts.
- Longest-waiting means unresolved age since `reported_at`, never `updated_at` or
  time-in-status. Unresolved scope sorts stored priority first, then older reports.
- Final success and fallback recheck approval and current visibility of supporting
  incidents. Citation clicks independently recheck approval and query through RLS.
- No server/browser persistent conversation storage or cross-user result cache.
  Workspace unmount/logout aborts local requests and discards results. Cancelling
  the browser does not guarantee cancellation of an already running provider call.

## Exact provider data and privacy

Provider input is an explicit projection: redacted Operations question, scope,
server counts/category/status distributions, request-local aliases, canonical
category/status/priority, numeric age since reported, Citizen activity kind and
allowlisted changed field **names**. UUID mappings stay server-side.

Excluded from Groq: Citizen title, description, area/address, update bodies,
before/after free-text values, reporter/uploader IDs, profile fields, exact GPS,
evidence rows, Storage paths, signed URLs, raw photos/audio, all transcripts,
transcription job data, demo metrics and any database/provider credential other
than the Groq authorization header sent to Groq itself.

Stored incident titles are returned to the authorized browser for supporting
incident buttons; they do not enter the model payload. React escapes them.
The question sanitizer strips recognizable contact numbers, emails, URLs,
UUIDs and coordinate pairs. Arbitrary PII typed into an Operations question,
such as a person's name, cannot reliably be recognized. The UI explicitly asks
users not to enter Citizen names/addresses/contact details. No request body,
incident text or provider response is logged by the function.

This first version summarizes **activity metadata**, not the substance of Citizen
updates or transcripts. This deliberate privacy boundary is visible in the UI.
Transcript provenance and incident-specific transcript interpretation are deferred;
there is no claim of image/audio/textual Citizen-content analysis.

## Quotas and lease behavior

009 creates two new private RLS-enabled tables:

- `nigraan_ai_requests`: UUID, user ID, creation time, lease expiry; indexed by
  user/time and global time. No authenticated direct table grants/policies.
- `nigraan_ai_budget_lock`: singleton row used only for atomic admission.

`nigraan_ai_admit()` is a narrow SECURITY DEFINER quota writer with empty
search_path and no caller-supplied identity, limits or timestamps. It checks
approval before/after obtaining a global row lock. It cannot read/return incident
data and exposes only a request UUID or structured quota error.

Limits, all rolling:

| Scope | Limit |
|---|---|
| Account short window | 10 attempts / 10 minutes |
| Account daily window | 50 attempts / 24 hours |
| Shared application/model short window | 1 attempt / 60 seconds |
| Shared application/model daily window | 40 attempts / 24 hours |
| Account concurrency | One 60-second active lease |

The shared caps can be reached before account caps. A fixed lease intentionally
continues until 60 seconds after admission even if the request completes early.
This is also a cooldown: there is no user-callable release RPC to bypass it.
Crashed requests naturally recover after expiry. No existing quota/job rows change.
Admitted failures count; rejected admissions do not create rows. Auth, DB or
configuration failures before admission do not consume quota. No automatic retries.

Provider JSON request <=3,500 UTF-8 bytes; max completion 1,000 tokens includes
reasoning. Budget leaves headroom under published 8K TPM/200K TPD free limits.
Actual Groq organization limits/other clients may differ; provider 429 remains
distinct from our quota. Old quota rows are retained; a privileged retention job
can be added later without changing counts in the active windows.

## Structured answer, injection and fallback

Groq chat completions use `openai/gpt-oss-20b`, low reasoning effort and strict
JSON Schema: `fact_refs`, `interpretation[{text,refs}]`,
`suggestions[{text,refs}]`, and `limitations`.

Server validates exact object keys, field types, lengths and every fact/alias
reference. Fabricated aliases reject the whole AI answer. Aliases map to real
authorized incidents; model-generated IDs/URLs are never used. Numeric factual
prose, common unsupported action/state assertions and incomplete output are rejected.
Factual cards, statuses, category distributions and age labels are rendered solely
from database-calculated values. Model-selected fact refs never replace those values.

System instruction declares every question/text untrusted DATA; no tools or write
actions are offered. Citizen prompt-injection text never reaches Groq because all
Citizen free text is excluded. User-question directives stay in the data message.
These controls reduce risk; they do not prove all model prose true. Interpretation
is labeled and must be checked against supporting incidents by humans.

Errors distinguish auth/access, origin/input, database/setup, configuration,
account/shared quota, active lease/cooldown, Groq 429, provider unavailability,
timeout, context budget and malformed output. Provider call timeout is 30 seconds;
total operation abort signal is 45 seconds, with a separate bounded final access
check on fallback. HTTP errors preserve factual cards when authorization still
holds. No canned fallback interpretation is generated.

## UI and verification

Operations has Nigraan AI navigation, Dashboard entry, six suggested chips,
question/scope/category/activity-window controls, Generate/Regenerate, facts,
interpretation, proposed next steps, supporting incidents, snapshot and coverage.
The old demo AI component is removed. Unrelated Analytics/Emergency features stay
labeled demo. Existing human workflow buttons inside IncidentDetail remain human
actions; AI cannot invoke them.

Run local checks:

```powershell
npm test
npm run test:ai
node tests/transcription-migration-check.mjs
node tests/workspace-migration-check.mjs
node tests/render-check.mjs
node tests/transcription-render-check.mjs
npm run build
```

`npm run test:ai` uses isolated PostgreSQL/PGlite and SSR, never remote Supabase.
Provider stubs appear only in automated tests. Optional isolated browser fixture:
`node tests/ai-browser-server.mjs` at `http://127.0.0.1:5182/`. Its aliases/auth/provider
responses are defined only in this server, not production Vite configuration.

Browser checks performed: Dashboard entry, chip/filter selection, factual/AI
separation, citation opening existing detail, failure facts retained, pending
request abort on unmount/Citizen switch/sign-out, mobile 390x844 layout without
page overflow. Screenshot: `review/nigraan-ai-mobile-check.png` (test fixture).

## Real deployed acceptance — required before claiming success

1. In approved Operations, compare current real submitted incident totals with
   the feed. Generate Current briefing. Confirm a successful deployed function
   response contains a non-null, validated `answer` (factual fallback alone is NOT
   successful Groq generation). Check every interpretation against citations.
2. Open a cited incident; verify title, status, stored priority and report-age
   facts against detail. This performs a fresh authorized read.
3. Test category chips, unresolved scope, recent activity and longest waiting.
   Confirm counts are scoped correctly; missing/bounded details are disclosed.
4. Publish a real Citizen update in another account, wait for the 60-second AI
   cooldown, regenerate and check new timestamp/update count. No automatic model
   call should occur from map/realtime refreshes.
5. Submit a second request within the cooldown: clear busy/shared-budget response,
   factual cards preserved, no additional provider request. Allow 60 seconds and
   retry. Across two accounts the shared one/minute cap also applies.
6. Citizen-only/pending/rejected accounts must not use the function. Revoke a test
   Operations approval and verify subsequent requests/citation reads are denied.
7. Ask to ignore instructions and declare everything resolved. Do not accept any
   changed factual status or invented action. The model may refuse/explain; if it
   violates validation the factual fallback must remain.
8. Confirm browser requests/bundle contain no Groq/service-role secret. Do not
   print secrets in logs or chat. Test Urdu/English questions before quality claims.
9. Recheck Citizen submission/edit/update, private evidence, transcription, map
   and human Operations workflow. The AI rollout does not redeploy transcription.

Not implemented: autonomous actions, dispatch, verification, emergency declaration,
organization-specific access, vectors/embeddings, generated SQL/tools, clustering,
raw media analysis, transcript interpretation, substantive update-text summaries,
or continuously regenerated AI. Existing data and migrations 002–008 remain intact.
