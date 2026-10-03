# Competition MVP transcription quota tuning

Apply this upgrade to the existing deployed 006 setup. Do not edit or rerun 002–006.

1. Supabase SQL Editor: run `supabase/migrations/007_transcription_quota_tuning.sql` once.
2. From `C:\Users\User\Downloads\huggingface`, redeploy the updated Edge Function:

```powershell
$transcriptionProjectRef = Read-Host 'Supabase Project Reference ID'
npx supabase functions deploy transcribe-recording --project-ref $transcriptionProjectRef
```

If your existing CLI session has expired, first run `npx supabase login`. Existing Groq key, allowed origins and frontend environment remain unchanged. Run 007 before deploying this function version, because completion now uses `active_until`.

## Effective behavior

- Ten attempts per rolling ten minutes, one hundred per rolling twenty-four hours, per authenticated account. All admitted jobs count, including failed, cancelled, inaccurate and repeated transcripts. No existing counts are reset.
- The existing profile-row lock serializes admission across sessions, tabs and workers. A second request while a pending job has an active lease is rejected without creating a job or calling Groq. Other accounts remain independent.
- New requests have a two-minute lease. Success/failure clears it; expired leases are ignored so crashed workers do not block an account forever. The existing 45-second provider timeout remains. Late results cannot be committed after lease expiry. This is a bounded admission guard, not a promise that an external provider immediately stops work after network cancellation.
- Legacy pending jobs have no new lease value; they participate using `created_at + 2 minutes`. Old jobs, status, text, audio hashes, receipt expiry, binding and provenance are not rewritten. Existing pending duplicates are preserved and admission waits until none has an unexpired lease.
- Completed, failed and abandoned receipts still count toward rolling quotas. The migration adds only a nullable `active_until` column and replaces the service-only admission RPC. RLS, grants and finalization/binding rules remain intact.
- Application short-window errors return HTTP 429 / `app_quota_short`; daily errors return HTTP 429 / `app_quota_daily`; active requests return HTTP 409 / `transcription_busy`; Groq HTTP 429 returns `provider_rate_limited`. No substring matching of unrelated errors is used. Safe error text is displayed in the Citizen UI with an approximate wait when provided.
- The application calculates retry time from the job timestamps needed to fall below the relevant limit. Daily quota takes precedence if both are exhausted. `Retry-After` and JSON `retryAfter` are seconds; they are an estimate and another session's request can use newly available capacity. Groq's numeric Retry-After is forwarded when available.

## Existing exhausted window

Before applying 007, the old five-attempt quota becomes available when fewer than five jobs remain newer than ten minutes. With exactly five recent jobs, this is ten minutes after the earliest of those jobs, not ten minutes after the error. Rejected requests do not extend the window.

After 007, an account with five recent jobs immediately has room for five more, provided there is no active job or exhausted daily allowance. Once ten recent jobs exist, capacity returns as old jobs age out; all short-window jobs are outside the window ten minutes after the most recent admitted job if no new jobs are admitted. No exact clock time can be reported without the account's remote timestamps.

## Verification

`npm test` checks structured quota/provider/busy mapping, no provider calls on rejection, lease completion filters and Citizen retry text. `node tests/transcription-migration-check.mjs` checks preservation and RLS, exactly ten/one hundred admitted jobs, failed attempts, rejection without new rows, account isolation, stale lease recovery and rolling expiry in isolated PostgreSQL fixtures. Existing UI/workspace checks and production build should continue to pass. These checks do not deploy 007 or make real Groq requests.

For a live check after deployment, start a real transcription in one tab and immediately try another signed-in tab under the same account. The second request should say another recording is processing; no extra job should appear. Then confirm a completed/failed request permits the next attempt, and retry/correction submission still preserves private audio and original machine text.

Changed files: the new 007 migration, Edge Function `handler.js`, frontend `transcriptionClient.js`, quota/handler tests, and setup documentation. No secrets or deployed migrations were edited.
