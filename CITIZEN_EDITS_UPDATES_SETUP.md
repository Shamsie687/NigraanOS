# Citizen report edits and updates

This implementation is local. Migration 008 has not been applied remotely and the updated transcription function has not been deployed. Existing migrations 002–007 must not be modified or rerun. Existing incidents, evidence, private Storage, transcription receipts and their provenance remain intact.

## Deploy in this order

1. In your existing Supabase SQL Editor run **`supabase/migrations/008_citizen_report_edits_updates.sql` once**.
2. Redeploy the existing transcription function from `C:\Users\User\Downloads\huggingface`:

```powershell
$transcriptionProjectRef = Read-Host 'Supabase Project Reference ID'
npx supabase functions deploy transcribe-recording --project-ref $transcriptionProjectRef
```

Use `npx supabase login` first only if your existing CLI login expired. No environment variables, provider keys, allowed origins or bucket settings change. Do not expose Groq or service-role keys in Vite. The deployed function must recognize new change-draft paths before a new update/edit audio transcript can be submitted; original reporting/transcription paths remain supported.

3. Refresh the frontend after the current source is served. If Vite is not running, start `npm run dev` in this project. No remote SQL was run by the agent.

## Rules and UX

- My Reports cards show **Edit Report** for `reported`, **Add Update** for `acknowledged`, `assigned`, or `in_progress`, and **View Details** for `resolved`. Opening a card shows the report details/activity and the appropriate action. The detail fetches the latest authorized incident rather than trusting the card snapshot.
- Only the submitting Citizen may edit the original, and only while `reported`. Allowed fields are title, description, the eight canonical categories, area, and latitude/longitude/accuracy. Existing GPS stays by default; a one-time current-location capture can replace it. Manual coordinate entry is not added. A new GPS capture expires after five minutes in the UI.
- Status, priority, assignment, organization, AI and internal metadata cannot be edited through these RPCs. Unknown fields are rejected server-side. There are no direct browser table-write grants.
- Evidence is **additive**. Existing photos/audio/transcripts cannot be replaced or removed. Citizens can add one new photo and/or one new recording to an edit or update. An original report's required photo remains; new edit/update attachments are optional. Existing audio/transcripts are not retrospectively rewritten. A replacement explanation or newly corrected recording can be added as new evidence instead.
- An update needs clarification text (1–5,000 characters); it may also contain a new photo and/or recording. It cannot change any original fields. Updates are append-only after publication. No Citizen delete/rewrite controls or RPCs exist for published activity.
- `resolved` locks original editing and new updates. Existing history and evidence remain visible; no reopening is implemented.
- Both workspaces show chronological **Citizen report activity**: original report and original evidence, edit events with before/after values, and update text/evidence. Original editable values are reconstructed from the first edit snapshot; protected metadata/internal Operations notes are not included. Activity records identify the editor, incident and publication time. Operations status transitions are not falsely represented as Citizen updates.
- No-op edits with no new evidence are rejected. Adding evidence alone is recorded as an edit event. An update changes only the incident freshness timestamp, not original report fields.
- My Reports refreshes after saving and displays success. Operations' existing incident UPDATE subscription/polling refreshes the same map and selected detail. Edited category/GPS therefore update real markers. The activity area also has manual Refresh activity; no second map system or separate realtime publication is required.

## Database and race safety

008 adds a private-draft/published activity table (`nigraan_citizen_changes`), a nullable `evidence.citizen_change_id` link, indexes, three authenticated RPCs (begin/finalize/abandon draft), and a private field-validation helper. Existing rows receive only a null evidence link; no existing values are rewritten or deleted.

Draft activity is readable only by its author. Published activity is readable by users who can already read the parent incident, including approved Operations. New evidence uses the existing evidence RLS based on its incident. Direct activity insert/update/delete is denied. Existing evidence guards and private Storage policies remain in force.

Finalization locks the parent incident before the change row and rechecks owner, submitted state, current workflow status, and (for edits) the captured `updated_at` version. This uses the same incident lock as Operations status updates. If acknowledgement wins, Save is rejected; no audit event, evidence or original mutation is committed. Another saved Citizen edit also invalidates a stale edit form. The UI refreshes the current status and offers Add Update when appropriate. Cancel/reopen to refresh a stale edit's fields/version. Reattach any unsaved additional evidence if switching from a rejected edit to an update.

Private original evidence keeps its existing three-part path. New activity evidence uses **`<owner>/<incident>/<change-draft>/<file>`**, a distinct four-part namespace. This prevents crafted draft UUID collisions from unlocking finalized original or update files. The Storage helper recognizes both formats, allows upload/delete only for self-owned drafts, and disallows published evidence mutations. Approved Operations cannot read unpublished change drafts/files.

The finalizer derives kind/MIME/size from actual Storage metadata, validates source, duplicates and limits, and atomically commits optional evidence, original field changes, history and publication. The original photo is never removed. New activity supports one image (JPG/PNG/WebP, 5 MB) and one audio (WebM/Ogg/MP4, 10 MB).

On failure, newly uploaded draft paths are cleaned up before abandoning the draft. A lost commit response is reconciled: published activity/files are preserved, and unknown outcomes are reported without unsafe deletion. Only new self-owned unpublished drafts can be abandoned; published activity cannot be removed. A network failure may still require owner/admin cleanup, as in the existing reporting flow.

## Voice/transcription reuse

The new composer reuses the existing recorder, playback URL lifecycle, transcription hook/editor, Groq function, quotas and receipt/binding system. Voice is optional and transcription errors still allow audio-only submission. Editing/correcting machine text preserves the original machine text separately.

The only Edge change adds authorization of four-part change-draft audio paths: caller RLS must reveal a self-owned, unpublished change for that parent incident. The function still downloads private bytes as the caller, compares SHA-256 with the trusted receipt, and never exposes a public audio URL. Finalization consumes an owned, unexpired, unused receipt bound to that exact path. Machine and Citizen-reviewed labels, provider/language/time metadata, original audio and quota rules are unchanged. No new provider/API key or transcription system is introduced.

## Exact live test steps after deployment

1. Submit a normal Citizen report with GPS/photo (optionally voice/transcript). Confirm the current original submission flow still succeeds.
2. In My Reports open a `reported` report → Edit Report. Change title/description/category/area; optionally capture new GPS. Save. Confirm success and refreshed values in My Reports, Operations details and Live Map (use Fit filtered incidents if needed).
3. Inspect Citizen report activity in both workspaces: original text, “Citizen edited this report,” timestamp and before/after values should appear. Confirm original evidence is still available. Add another photo or newly transcribed recording and confirm it is shown with that edit, separately from original evidence.
4. Race test: open the edit form, then acknowledge the report in an Operations session before clicking Save. Save must be rejected, original values must not change, and Citizen details should offer Add Update. An already acknowledged report must have no Edit Report action.
5. Add Update to an acknowledged/assigned/in-progress report, first text-only, then text plus photo and voice/transcript. Verify private playback, correction/original machine text, chronological entries and unchanged original fields. Previous updates must have no rewrite/delete action.
6. Sign in as another Citizen: they must not read or edit the report, add an update, or access its evidence. Approved Operations must see published updates/evidence; pending or revoked Operations must retain existing restricted access. An organization account can edit/update only reports it personally submitted as Citizen.
7. Resolve through the existing Operations workflow. Verify Citizen View Details/read-only, retained history/evidence, no new update, and no reopening. If resolution occurs after an update draft opens, Save must also be rejected.
8. Confirm regular English/Urdu transcription and quota behavior, private original evidence, map markers/filters and Citizen status refresh still work. A failed upload/binding/status-race should clean only unfinished draft files; a lost committed response must preserve published evidence.

## Local checks and limits

`npm test` covers action/payload rules, real service paths, optional transcript binding, status-failure cleanup and lost-response preservation. `node tests/transcription-migration-check.mjs` applies 002–008 only to isolated PostgreSQL fixtures and checks preserved data/policies/private bucket, ownership/allowlists, history, stale/status races, append-only updates, published/draft visibility, private evidence/transcript provenance, draft namespace collisions, resolved locks and original reporting/Operations workflow. Render checks cover edit/update/resolved UI; production build includes the existing map and WASM override.

Actual 008 remote behavior cannot be verified until you apply it. The user has already verified deployed Groq transcription; the extended change-draft binding path has been tested locally, not against the deployed function. No production backend behavior is mocked. Static layout previews and automated test fixtures use explicitly synthetic inputs only.

Not implemented: evidence replacement/deletion, rewriting existing transcripts, update editing/deletion, incident reopening, internal Operations notes, AI, or new external APIs. Existing demo city alerts/analytics remain labeled demo.

## Files

Created: `supabase/migrations/008_citizen_report_edits_updates.sql`, `src/utils/citizenChanges.js`, `src/services/{citizenChanges,citizenChangeSubmission}.js`, `src/components/{CitizenActivity,CitizenChangeForm,CitizenReportDetail}.jsx`, `tests/citizen-changes.test.js`, and this guide.

Changed: `src/pages/CitizenPage.jsx`, `src/components/{ReportFeed,IncidentDetail,EvidenceViewer}.jsx`, `src/index.css`, `supabase/functions/transcribe-recording/handler.js`, `tests/{transcription.test.js,transcription-migration-check.mjs,render-check.mjs}`, and README. No application dependencies added; `.env`, migrations 002–007, provider and Rollup override untouched.
