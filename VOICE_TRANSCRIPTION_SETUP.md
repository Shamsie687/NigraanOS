# Voice transcription setup and testing

Local implementation is ready for configuration. It has not been deployed and no real Groq request has been made. Do not rerun 001–005. No provider key belongs in `.env`, `VITE_*`, React, or Git.

## Provider

Groq speech recognition using `whisper-large-v3` through its transcription endpoint, not translation or a chat/LLM endpoint. This multilingual model is a practical MVP choice for Urdu and English. Automatic detection is offered for mixed speech; mixed-language accuracy and Urdu script quality require testing with actual recordings. Choose Urdu explicitly if automatic detection misidentifies it. Roman Urdu is not offered as a separate spoken language. No transcript is fabricated when configuration or speech recognition fails.

Groq currently documents a usable free plan: Whisper has base limits of 20 requests/minute, 2,000/day, 7,200 audio seconds/hour and 28,800/day. Organization limits may differ; check your Groq Console Limits page. No paid upgrade is required by this implementation. After additive migration 007, the app limits each authenticated account to ten attempts per ten minutes and one hundred per rolling day, with one active request per account. Failed attempts count. See [TRANSCRIPTION_QUOTA_TUNING.md](TRANSCRIPTION_QUOTA_TUNING.md) for upgrading an existing deployed 006 setup.

Official sources: [speech-to-text](https://console.groq.com/docs/speech-to-text), [free-plan limits](https://console.groq.com/docs/rate-limits), [Supabase secrets](https://supabase.com/docs/guides/functions/secrets), [function deployment](https://supabase.com/docs/guides/functions/deploy).

## Exact configuration order

1. Create a Groq account at [Groq Console](https://console.groq.com/) and create an API key in API Keys. Keep it private.
2. In the existing Supabase project's SQL Editor, run **only** `supabase/migrations/006_voice_transcription.sql`, once. This adds nullable evidence metadata, a private receipt table and rate-limit RPC, and wraps the deployed 005 finalizer. Existing evidence/incidents are not rewritten. Existing RLS and Storage policies are unchanged; `incident-evidence` remains private. No bucket/realtime changes are needed.
3. In Supabase Dashboard → Edge Functions → Secrets, add:
   - `GROQ_API_KEY`: your actual Groq API key, entered privately into the dashboard.
   - `TRANSCRIPTION_ALLOWED_ORIGINS`: a comma-separated list of exact browser origins. For local Vite development use `http://127.0.0.1:5173,http://localhost:5173`. Add the actual deployed HTTPS origin later. Include port numbers; omit paths, trailing slashes and wildcards. Add your LAN origin if testing on a phone; microphone/GPS require a secure context.
4. Run `supabase/migrations/007_transcription_quota_tuning.sql` once after 006, before deploying the current function. Deploy using the commands below. Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` inside Edge Functions; do not copy service-role keys into frontend configuration. The service-role client is used only after server-side Auth verification and profile checking, for private transcription receipts. Private audio reads use the caller's JWT and existing Storage RLS.
5. Restart the frontend with `npm run dev`. Existing frontend Supabase URL/browser-safe key stay unchanged.

## Exact deployment commands (PowerShell)

From `C:\Users\User\Downloads\huggingface`:

```powershell
npx supabase login
$transcriptionProjectRef = Read-Host 'Supabase Project Reference ID'
npx supabase link --project-ref $transcriptionProjectRef
npx supabase functions deploy transcribe-recording --project-ref $transcriptionProjectRef
```

The Project Reference ID is the identifier in your project dashboard, not an API key. CLI login may require your own account authorization. Enter any CLI authentication or database-password prompts privately; do not paste credentials in chat. These commands deploy the function only; they do not push/rerun migrations. Use SQL Editor for 006 as above. No Groq SDK, frontend dependency, or transcription provider package installation is needed; the function uses native `fetch`. A functioning Supabase CLI/network and account access are required. CLI/Deno are not currently installed in the inspected workspace.

`supabase/config.toml` sets `verify_jwt=false` **only for this function** because authentication is handled by `supabase.auth.getUser()` in the handler. This verifies the caller with Supabase Auth before provider/administrative work and works with asymmetric signing keys; it is not an anonymous transcription endpoint. Do not remove this explicit authentication. CORS is an additional browser restriction, not an authentication mechanism.

## Architecture and provenance

- Citizen microphone capture and playback remain local. Maximum recording time stays two minutes; maximum size stays 10 MB. Voice is optional and GPS/photo remain required.
- Tapping **Transcribe recording** explicitly sends raw recording bytes over HTTPS to the authenticated Edge Function and then Groq. The UI discloses this external processing. Groq processes the audio under its own service terms/data policy; NigraanOS does not make the Storage bucket public or send a signed audio URL to Groq. Transcription before submission creates no Storage orphan file.
- Handler verifies the user session/profile, exact origin, bounded multipart bytes, supported MIME and container signature (WebM/Ogg/MP4), language choice, and persistent per-user quotas. Groq must parse the recording and return a non-empty transcript plus usable duration no longer than 125 seconds (small recorder stop tolerance). Container checks are not a complete audio decoder. Provider errors/empty/malformed results return no substitute text. Requests time out after 45 seconds.
- Automatic choice omits the provider language parameter. Urdu sends `ur`; English sends `en`. Detected language is stored only when returned. Text remains Unicode, uses `dir="auto"`, and is never transliterated or translated by app code.
- Trusted receipts store the provider's original text, audio SHA-256, selected/detected language, provider/model and time. Receipts expire after 24 hours. The private receipt table has RLS enabled and no anonymous/authenticated grants. Original audio is retained in the existing private bucket after submission. Unused receipt rows contain text/hash metadata only, not audio; expiry prevents use but does not automatically purge them. Retention cleanup can be configured separately by the owner.
- During normal report submission, the existing draft/upload/finalize sequence runs. For a transcript, the Edge Function reads the caller's actual private uploaded audio, checks its hash against the receipt and binds the receipt to that path. The finalization RPC consumes a self-owned, unexpired, bound, unused receipt and atomically saves evidence/incident state. Browser-supplied text cannot create a machine result. If corrected text differs from the trusted original, it is always labeled citizen-reviewed even if the browser review flag is false.
- `evidence.transcript` retains the submitted correction; `machine_transcript` retains provider output. Provider/model, selected/detected language, transcribed time and reviewed time are separate columns. Existing transcription CHECK values (`ready`, `confirmed`, `failed`, `not_connected`) remain compatible. `not_connected` is retained as the legacy storage value for audio without a transcript, and displayed as “No transcript available.” No existing rows are backfilled.
- Failed binding/finalization uses existing draft/file cleanup. A lost finalized response preserves successfully committed evidence. Local audio/correction remains on the form after failed submission. Choose **Keep audio without transcript** to bypass transcription or an expired receipt and retry submission. Recording is not destroyed by transcription failure.
- Re-recording clears results and aborts/ignores stale requests. **Keep audio without transcript** cancels the frontend request and discards the selected transcript while preserving audio; an already-running server request may still finish and consume quota. While transcription is in progress, submission waits; choose the keep-audio action to submit immediately without it. Failed transcription never blocks submission.
- Operations sees **Machine transcript** or **Citizen-reviewed transcript**, the original machine text when reviewed, and existing private audio playback. Neither is called verified evidence. Evidence previews retain the existing two-minute signed URLs.

## Exact live test steps

1. Complete 006, secrets and deployment. Sign in as a normal Citizen. Open Report Incident and enter category, title, description and area; attach current GPS and a valid photo.
2. Record a short Urdu voice report, stop and play it back. Tap **Transcribe recording** with Urdu selected. Verify loading, actual returned Urdu script and audio retained.
3. Correct a word in the editable transcript or check **I reviewed this transcript**. Submit. In Operations, open the real incident → evidence. Confirm private audio playback, **Citizen-reviewed transcript**, the correction and expandable original machine transcript.
4. Repeat with English and automatic/mixed Urdu-English speech. Submit an unedited/unconfirmed result and check **Machine transcript**. Compare with audio rather than assuming mixed-language accuracy.
5. Record audio and click **Keep audio without transcript**. Submit successfully; Operations should show audio and “No transcript available.” Also submit a photo/GPS report without voice.
6. Temporarily test an unavailable/misconfigured function or key in your own test setup. Confirm a truthful error, preserved playable recording, retry control and successful audio-only submission. Restore configuration before retrying transcription.
7. Re-record after receiving a transcript. Confirm old text is gone and the new audio must be transcribed independently. Do not reuse an expired receipt; keep audio-only or transcribe again.
8. Verify Operations can still advance workflow and Citizen My Reports receives the updated status. Dashboard/Live Map remain functional.

## Local verification

```powershell
npm test
node tests/transcription-migration-check.mjs
node tests/workspace-migration-check.mjs
node tests/transcription-render-check.mjs
node tests/render-check.mjs
npm run build
```

Tests use isolated synthetic provider responses and PostgreSQL fixtures, not credentials. They cover state/edit/review/failure/retry/reset, transcript/no-transcript submission, cleanup, real handler authentication/CORS/file validation/quotas/provider errors and hash binding, Unicode and atomic provenance, browser write restrictions, preserved RLS/private bucket, existing status workflow, and transcript display. Browser interaction checks also exercised loading, retry, Urdu edits/review, audio-only selection and re-record/stale-request reset in `tests/voice-browser` with a clearly labeled fixture; no test service is imported by production. They do not prove actual microphone capture on your device, deployed Edge runtime compatibility, actual Groq accuracy or live Supabase integration. Those require the live steps above. No external transcription API was called.

## Files created/changed

Created: `supabase/migrations/006_voice_transcription.sql`, `supabase/config.toml`, `supabase/functions/transcribe-recording/{index.ts,handler.js}`, `src/utils/transcriptState.js`, `src/services/transcriptionClient.js`, `src/hooks/useTranscription.js`, `src/components/{VoiceTranscript,EvidenceTranscript}.jsx`, `tests/transcription.test.js`, `tests/transcription-migration-check.mjs`, `tests/transcription-render-check.mjs`, `tests/voice-browser-server.mjs`, `tests/voice-browser/{service.js,fixture.jsx}`, and this guide.

Changed: `src/services/{transcription,reports,incidentSubmission}.js`, `src/components/{IncidentForm,EvidenceViewer}.jsx`, `src/index.css`, `tests/render-check.mjs`, README, and MULTI_WORKSPACE_TESTING.md. No application dependencies added. Deployed migrations 002–005, local `.env`, original recording limits, map functionality and Rollup WASM override remain intact.
