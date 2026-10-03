# One account, multiple workspaces

002, 003 and 004 are deployed and unchanged. Run **only**
`supabase/migrations/005_multi_workspace_access.sql` next, as project owner in
Supabase SQL Editor. The agent has not applied SQL to the real project.

005 preserves existing identities, organization applications/approvals, incidents,
evidence and private Storage objects. It adds an optional organization explanation
and protected application/workflow RPCs. `profiles.account_type` remains for legacy
compatibility but no longer determines workspace access. Every authenticated
profile can report as a Citizen, including legacy Operations, pending and rejected
accounts. Operations approval is checked from `operations_profiles` by backend
helpers used by existing RLS/Storage policies and the status RPC.

## Apply with your existing account

1. Sign in using the same email/password you already use for Citizen reports.
2. Select **Apply for Operations Access** in Citizen, or **Operations · Apply**
   in the workspace switcher.
3. Enter organization name/type and an optional explanation, then submit.
4. The application becomes **pending**. Citizen reporting stays available.
   Rejected applications can be edited and resubmitted for pending review.
   Existing pending applications and approved organization details are not editable
   through this initial application form.

## Project-owner approval for testing

In Supabase SQL Editor only, open
`supabase/admin/approve_operations_for_testing.sql`. Replace **both** occurrences
of `REPLACE_WITH_YOUR_EXISTING_ACCOUNT_EMAIL` with your existing account email,
privately in the editor, then run the script as project owner.

It finds exactly one existing Auth identity, requires a pending application, and
changes only that application's verification status to approved. A missing email,
missing application or non-pending status aborts the transaction. The final result
shows the user ID, email, organization and approval. It does not create another
identity, change `account_type`, or expose an approval action in the frontend.

For reference, the guarded update performed after identifying the user is:

```sql
-- Project owner only. Replace the email privately in SQL Editor.
UPDATE public.operations_profiles AS o
SET verification_status = 'approved'
FROM auth.users AS u
WHERE o.user_id = u.id
  AND lower(u.email) = lower('YOUR_EXISTING_ACCOUNT_EMAIL')
  AND o.verification_status = 'pending'
RETURNING o.user_id, o.organization_name, o.verification_status;
```

The supplied file adds stricter checks before that update. Browser clients cannot
directly insert/update organization verification or incident workflow fields.

## Test the complete flow

1. In Citizen, submit an incident with GPS and a required photo; voice is optional.
   Existing successful incidents can also be used.
2. Apply and approve the same account as above.
3. Click **Refresh access** or **Check verification status**. Choose **Operations**
   in the switcher. No additional login is needed.
4. Open **Dashboard** or **Citizen Reports** and refresh reports. Both use real
   submitted incidents from Supabase, including your own incident.
5. Click **View incident details**. Check title/category, description, area, GPS,
   time, priority, status and the private photo/optional audio previews.
6. Advance one step at a time: **Acknowledged → Assigned → In Progress → Resolved**.
   Assignment initially associates the incident with the acting approved
   organization account. No external dispatch or notification is sent.
7. Choose **Citizen**, open **My reports**, and click **Refresh reports**. Confirm
   the new status. Separate devices/accounts also need an explicit refresh.
8. A Citizen without approval, a pending applicant, or a rejected/revoked account
   must not update workflow or read another Citizen's reports/private evidence.

The server checks approval, submitted visibility, expected current status, and the
next legal transition under a row lock. Skips, backward/repeated updates, stale
updates and changes to private drafts fail. Resolved is terminal for this initial
workflow. Legacy unrecognized statuses require owner review. Evidence continues
to use short-lived authenticated signed URLs; the bucket remains private. Previously
issued URLs retain their documented expiry behavior.

## What remains demonstration data

Sensors, analytics, alerts, notifications, emergency controls and the AI copilot
remain demonstration features. Operations Dashboard, Live Map, category maps and
Citizen Reports use real incidents; the OSM basemap replaces schematic markers.
See MAP_TESTING.md for Realtime/publication setup and map verification.
No AI analysis, traffic/flood API or Alexa was added. Optional voice transcription now has a Groq/Supabase Edge Function foundation; see VOICE_TRANSCRIPTION_SETUP.md for required configuration and tests.

## Local verification

- `npm test`: validation, access derivation, workflow sequence, evidence and recovery.
- `node tests/workspace-migration-check.mjs`: isolated PostgreSQL fixture applying
  002–005; existing-data/policy preservation, single identity/application approval,
  all Citizen access states, legacy Ops reporting, real RLS/private evidence,
  status sequence/stale writes, revocation and signup metadata safety. It also runs
  the supplied owner approval script against a synthetic account.
- `node tests/render-check.mjs`: entry, application, switcher, detail and form render.
- `npm run build`: production build; Rollup WASM override retained.

The PostgreSQL test uses the optional isolated PGlite runtime documented in README;
no application dependency or real database is needed. Local checks do not replace
the real Supabase end-to-end test above.
