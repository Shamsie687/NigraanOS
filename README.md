---
title: NigraanOS
emoji: 🌖
colorFrom: purple
colorTo: yellow
sdk: static
pinned: false
license: mit
---

## Existing-schema upgrade

The application now uses the existing `profiles`, `incidents`, and `evidence`
tables. The prototype `reports` table is unused; migration 011 removes its browser
access while preserving its table, sequence and data.

### Established production baseline

`supabase/historical-bootstrap/001_initial_mvp.sql` is retained unchanged for
provenance only. It was designed for a fresh Supabase project and does not
describe the current production baseline. Never execute it against production.
It is outside the active migration directory so the CLI cannot queue it.

Production already had a profiles/incidents/evidence schema. Migrations 002–010
are its verified upgrade chain. Their migration history is reconstructed from
live final-state verification because the application migration ledger was
absent; this does not prove the exact historical execution sequence. Official
CLI history repair records only 002–010 without rerunning their SQL. Version 001
is not recorded as applied. Do not rerun 002–010 against this production project.
The active migrations require the established base schema and are not a complete
bootstrap for an empty database. After reconciliation, only genuinely new
migrations should appear pending; inspect a linked push dry-run before applying.

002 is the baseline upgrade for the older schema. **If 002, 003 and 004 are already
applied, run only `supabase/migrations/005_multi_workspace_access.sql` next.**
Do not rerun deployed migrations. For a project that has not received these
upgrades, apply 002, 003, 004, then 005 in order as project owner. The historical initial
migration is not compatible with this older schema and must not be rerun.

The baseline 002 migration:
- adds `profiles.account_type` (existing profiles default to citizen);
- creates Operations profiles with pending/approved/rejected verification;
- adds incident priority, area, assignment and draft/submitted publication state;
- adds evidence transcript/transcription-status fields for future integration;
- creates/configures the **private** `incident-evidence` Storage bucket, with
  MIME restrictions and a 10 MB bucket limit (photos additionally limited to 5 MB);
- enables RLS, adds restrictive guards alongside existing policies, resets browser
  table/column write grants, and exposes narrow draft/finalize/cleanup RPCs.

No manual Storage bucket creation is needed. No existing tables, columns or legacy
rows are removed. Existing incident rows remain visible under ownership/approval
policies and retain their original statuses/content; new rows must use the new flow.
The script is a transactional, one-time migration, not an idempotent repeat-run script.
Unknown older check constraints/triggers may reject a new value: the migration or
submission fails instead of removing those safeguards. If that happens, share the
constraint/trigger error (not credentials) for a targeted compatible adjustment.

## Auth and account access

Local Supabase URL and browser-safe key remain in root `.env`, untouched.
Restart Vite after env changes. Never put server/service-role secrets in VITE variables.
Signup sends both `display_name` and `full_name` metadata for older signup-trigger
compatibility. A deferred database trigger runs after ordinary existing signup
triggers, preserves existing profile fields and creates the normal Citizen profile.
Any Operations row created by an older trigger for a new identity is forced pending.
Existing signup triggers are not removed. Existing users retain their data and
Citizen access regardless of legacy account type. The app queries `display_name`;
it does not assume a `full_name` column.

Sign in with your existing account and apply for Operations from Citizen. New
applications never self-approve. A trusted owner verifies a pending organization
application using the guarded script in `supabase/admin/approve_operations_for_testing.sql`.
The underlying owner-only update for a verified Auth UUID is:

```sql
update public.operations_profiles
set verification_status='approved'
where user_id='REPLACE-WITH-VERIFIED-USER-UUID'::uuid
  and verification_status='pending'
returning user_id, organization_name, verification_status;
```

Use **Refresh access** afterward and choose Citizen or Operations without another
login. Approval is checked from database rows, not editable user metadata.
Operations Dashboard and Citizen Reports read real submitted incidents; city
metrics/map/analytics/AI remain demonstration features.

## Submission and evidence security

1. The form requires a GPS attachment from browser geolocation, category, title,
   description, human-readable area and a photo. GPS must be refreshed after five
   minutes. Coordinates, accuracy and ownership are also checked by the RPC.
2. Take Photo uses `capture="environment"`; compatible mobile browsers open the
   camera. Desktop behavior may show a file picker. Upload Photo accepts JPG/PNG/WebP.
   Browser validation checks MIME, size, file signature and image decoding.
3. Optional MediaRecorder voice supports recording, timer, stop, playback and
   deletion/re-recording. It stops at two minutes; recordings are limited to 10 MB.
   Microphone tracks and local preview URLs are released on stop/unmount.
4. A draft incident is created through an authenticated RPC. Files upload without
   upsert to `<user UUID>/<incident UUID>/<random filename>` in the private bucket.
5. The final RPC checks ownership and actual Storage object metadata, inserts
   evidence rows and marks the incident submitted in one database transaction.
   It refuses missing/photo-free evidence. Internal status defaults to `reported`,
   priority to `normal`, and assignment remains empty. Citizens cannot choose them.
6. My Reports and approved Operations query `incidents` with publication state
   `submitted`. Private evidence is viewable through two-minute signed URLs.

Citizens read only their own incidents/evidence and upload/delete only within their
own drafts. Approved Operations can read submitted city incidents/evidence; pending
accounts cannot read other citizens' records. No browser user can directly insert,
update or delete incident/evidence rows, or approve Operations accounts. New RPCs
use the authenticated identity, security-definer execution and fixed empty search paths.
Restrictive guards prevent old permissive policies from widening access. Other
Storage buckets and the old `reports` table keep their existing configuration/policies.

Signed preview URLs are temporary bearer links: anyone holding one may view its
file until expiry, even after account approval is revoked. Do not share them.
This follows [Supabase private-bucket access](https://supabase.com/docs/guides/storage/buckets/fundamentals).
GPS coordinates are browser-provided; the database cannot prove they were not spoofed.
Storage MIME/size checks are not a server-side image decoder or malware scanner.
Production abuse/rate/quota controls and trusted media inspection are future work.

## Failure and recovery limitations

Storage uploads and PostgreSQL commits are not one atomic transaction. Failed uploads
are removed via Storage, then only the new self-owned draft is abandoned. Existing
and finalized incidents are never cleaned up by these RPCs. A lost finalize response
is checked against incident state before cleanup, so a successfully committed
submission is treated as success. If state cannot be confirmed, the app does not
delete evidence; it shows the incident reference and asks you to refresh before retrying.

Closing the browser/offline failures can leave a private draft or uploaded objects.
Drafts stay out of both feeds. A future authenticated draft-recovery/expiry job is
needed for interrupted sessions and long-term orphan cleanup. Cleanup is best-effort;
no distributed transaction or universal crash/concurrency guarantee is claimed.
Legacy evidence may use different paths/media labels/buckets; such previews show
unavailable rather than exposing a public fallback or modifying legacy files.

## Voice transcription

Recording, local playback, private audio upload and optional transcription/review
are implemented. Real transcription requires migration 006, the authenticated
Supabase Edge Function and a server-only Groq key. Failures preserve audio and
allow audio-only reporting; no transcript is fabricated. See
[VOICE_TRANSCRIPTION_SETUP.md](VOICE_TRANSCRIPTION_SETUP.md) for exact setup and tests.

## Exact manual test flow

1. Run the new additive migration above, then start/restart `npm run dev -- --host 127.0.0.1`.
   Ensure Supabase Auth redirects allow your app origin.
2. Register a Citizen with full name/email/password; confirm email if enabled and sign in.
   Open **Report an incident**.
3. Choose category, fill title/description/area, select **Use my current location**,
   allow location permission and verify attached coordinates/accuracy.
4. Select **Take Photo** on mobile, or **Upload Photo**. Confirm image preview and
   Photo attached. Test missing/invalid photo: submission must remain disabled.
5. Optionally start recording, grant microphone permission, stop, play it back,
   delete/re-record if needed. Transcribe and review if configured, or keep audio
   without transcript. See the voice setup guide for Urdu/English/failure tests.
6. Submit. Confirm success, then refresh My Reports and reload the browser.
7. In Supabase Table Editor, verify one `incidents` row with your `reporter_id`,
   coordinates/accuracy, status `reported`, priority `normal`, publication state
   `submitted`; verify `evidence` row(s) with matching `incident_id`, uploader,
   storage paths, MIME/source/size. There should be at least one image row; voice is
   another row with source `recording`. Verify files in the private bucket.
8. A second citizen must not see the first citizen's incidents/evidence. Pending
   Operations must show verification pending. An approved account should see the
   incident in Citizen Reports after Refresh and be able to view its private evidence.
9. Test a failed/offline upload: no submitted incident should appear. If cleanup
   cannot finish, note the draft reference and inspect it as project owner.

Geolocation and microphone require a secure context (HTTPS or localhost) and user
permissions. A phone visiting a plain HTTP LAN IP may be unable to use either;
test mobile using an HTTPS deployment/tunnel. Camera capture/recording format
support varies by browser. Location attachment may fail indoors or without device
location services; failure is shown without fabricating coordinates.

## Automated verification

### Real interactive city map

Operations Dashboard/Live Map now share a Leaflet + React Leaflet OpenStreetMap
map backed by all authenticated submitted incidents. Category/workflow filters,
priority markers, private incident detail access, real priority lists and one-shot
location controls are implemented. Realtime INSERT/UPDATE invalidation has a
truthful connection indicator plus 30-second visible-tab/manual refresh fallback.
No schema migration or API key is required; existing migrations remain untouched.

See **[MAP_TESTING.md](MAP_TESTING.md)** for changed files, exact test steps,
optional Supabase publication setup, local test results and remote verification
limits. Schematic demo markers are no longer used in the Operations map views.

### One account and real Operations workflow (005)

Every normal account can use Citizen. Operations is additional approved workspace
access on the same Auth identity/email; legacy `account_type` no longer gates access.
Apply from Citizen, obtain trusted owner approval, refresh access and switch
workspaces without signing in again. Pending/rejected requests retain Citizen
reporting. Dashboard/Citizen Reports read real incidents and private evidence;
approved Operations can advance the server-validated sequential status workflow.

See **[MULTI_WORKSPACE_TESTING.md](MULTI_WORKSPACE_TESTING.md)** for the exact
migration, existing-account application steps, guarded project-owner approval SQL,
end-to-end test, mock feature inventory and local verification commands. Do not
rerun deployed migrations or change account_type to test access.

### Deployed evidence repair (004)

After already deployed 002 and 003, run **only**
`supabase/migrations/004_fix_evidence_constraints.sql` in the existing project's
SQL Editor. Do not edit/rerun those earlier migrations. 002's finalizer inserted
the normalized Storage MIME string into `evidence.media_type`; the form sends
only a Storage path and source to that RPC. Exact legacy CHECK definitions are
not in this repository. 004 reads them from the installed database and prints
their definitions and rejected canonical combinations in SQL Editor notices.

New evidence uses `media_type='image'` or `'audio'` and a separate `mime_type` text
column. MIME and size are derived by the RPC from Storage metadata, not browser
labels. Images allow JPEG/PNG/WebP, source `camera` or `upload`, up to 5 MB;
recorded audio allows WebM/Ogg/MP4, source `recording`, up to 10 MB. Both require
at least 1 byte, and the maximum sizes are inclusive.
At least one photo remains mandatory; voice remains optional.

004 inspects every evidence CHECK using canonical kind/MIME/source/size and
transcription combinations. Conflicting checks confined to those fields are
reconciled with the canonical rules; compatible checks stay. An incompatible
unrelated/custom check stops the transaction with its exact definition for
review instead of being removed. RLS, permissions on evidence tables, Storage
policies, and the private bucket are preserved. The RPC retains authenticated
citizen ownership checks and transactional evidence/publication behavior.

No existing rows or files are rewritten or deleted. Existing media/source values
stay as they were, and the new MIME column is NULL for existing rows; canonical
checks use `NOT VALID`. Legacy rows may need explicit normalization before later
updates. The preview recognizes both canonical kinds and legacy MIME-valued rows.
SQL Editor results list remaining constraints and counts of legacy exceptions.

Storage uploads precede finalization and are not part of its database transaction.
A database failure rolls back evidence rows and publication, leaving a draft.
The app removes every attempted upload path before calling the draft-abandon RPC
when its own draft is confirmed. A lost finalization response that committed is
treated as success. Unknown outcomes or cleanup failures preserve files, show the
reference and original failure where available, and require later inspection.
Closing the browser/offline failures can still leave private drafts/files; 004
does not delete previously orphaned files or guess which uploads are abandoned.

`node tests/evidence-migration-check.mjs` uses the optional isolated PGlite runtime
installed by the command below. It applies 002/003/004 to a synthetic local
schema, reproduces the old write mismatch, and tests canonical photo/audio,
MIME/source/size, legacy preservation, unchanged RLS/private bucket, atomic
database failure, cleanup permissions, ownership, retries, and custom-rule safety.

### Deployed database category repair (003)

If 002 has already been applied, run **only**
`supabase/migrations/003_fix_incident_categories.sql` in the existing project's SQL
Editor. The old `incidents_category_check` was not replaced by 002: its values can
conflict with the canonical categories already accepted by the form, validation,
and submission RPC. 001 describes a different historical `reports` schema and
must not be rerun; 002 remains unchanged.

003 reads the installed CHECK definitions and tests all canonical category,
workflow, priority and submission-state values. It removes conflicting single-column checks,
preserves compatible/unrelated checks, and adds exact canonical checks. A custom
multi-column check involving these fields aborts the transaction with its exact
definition for review instead of being silently removed. SQL Editor notices show
the old definitions and rejected values; the final results list remaining CHECKs
and counts of legacy rows outside the canonical domains.

No rows are remapped, deleted or recreated. New checks use `NOT VALID` to preserve
legacy rows; future inserts and updates enforce the canonical values. An existing
row outside a canonical domain requires explicit normalization before it can be
updated. Status uses `reported`, `acknowledged`, `assigned`, `in_progress`,
`resolved`; priority uses `low`, `normal`, `medium`, `high`, `critical`, matching
002. Initial values remain server-owned `reported` / `normal`.

For an isolated PostgreSQL regression run (no remote database access), install
the optional test runtime outside application dependencies with
`npm install --prefix review/sql-check --no-save --package-lock=false @electric-sql/pglite`,
then run `node tests/migration-check.mjs`. This checks legacy constraints/rows,
all 200 canonical combinations, invalid values, unrelated checks, repeatability,
and atomic rejection of unexpected custom rules.

`npm test` covers GPS payload validation, image type/size/signature checks,
upload order, optional voice evidence, upload cleanup, lost finalize responses and
unconfirmed outcomes with an injected mock client. `node tests/render-check.mjs`
checks entry/form rendering and missing-evidence gating. `npm run build` builds
production output. No dependencies were added for this upgrade; the Rollup WASM
override is preserved. Never print env values during testing.

`supabase/tests/rls_smoke.sql` is an optional rollback-only staging/database test
after the additive migration. It uses synthetic Storage metadata (not real files)
to check missing-photo rejection, atomic evidence rollback, cross-user restrictions,
self-approval prevention and approved/revoked access. Local tests do not establish
that the remote migration or real Storage upload works: run the manual flow above.
This upgrade has not applied SQL to your remote project or signed up test users.

The existing Vite/esbuild development-tool audit findings remain; a separate
compatible toolchain update is recommended without removing the WASM workaround.
# Real voice transcription foundation

Optional recordings can now call an authenticated Supabase Edge Function using Groq Whisper, review/edit actual returned text, or keep audio without a transcript. Configuration and deployment are required; no external transcription API has been tested and no transcripts are fabricated. Run only the new 006 migration. See [VOICE_TRANSCRIPTION_SETUP.md](VOICE_TRANSCRIPTION_SETUP.md) for secrets, exact deployment commands, provenance/security and live tests. Never add the Groq key to Vite/browser environment variables.

For the current quota upgrade, apply additive **007** after deployed 006 and redeploy the function. It enables 10 attempts per rolling ten minutes, 100 per day, one active request per account, and distinct quota/provider errors. Follow [TRANSCRIPTION_QUOTA_TUNING.md](TRANSCRIPTION_QUOTA_TUNING.md); do not rerun old migrations.

Citizen corrections/append-only updates now require additive **008** and a transcription function redeployment for new change-draft audio binding. See [CITIZEN_EDITS_UPDATES_SETUP.md](CITIZEN_EDITS_UPDATES_SETUP.md). Original edits are limited to owned `reported` incidents; processing incidents accept updates, and resolved incidents are read-only. Existing evidence is retained; new evidence is additive and private.
