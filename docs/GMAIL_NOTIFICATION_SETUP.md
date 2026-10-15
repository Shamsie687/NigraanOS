> **Source-release status, 16 October 2026:** The owner reports the updated worker and controlled request/approval deliveries working. The earlier rollout notes below are historical. No real credentials or hosted delivery were tested during source preparation.

# Gmail notification setup

**14 October:** the deployed worker needs a separately approved update after migration 019. New approval messages explain Start My 60-Minute Access and the 48-hour activation deadline; approval/email opening starts no session timer. Existing secrets and retry controls remain unchanged. See JUDGE_ACTIVATION_ROLLOUT.md.

Only the organizer authorizes Gmail. Judges sign in through unchanged Supabase Auth. No custom domain, Gmail password, app password or additional Google identity scope is required. Gmail consumer sending limits are roughly 500 emails/day, shared with normal mailbox use; anti-abuse restrictions and bounces can limit sending earlier. Inbox delivery is not guaranteed.

## Private Windows authorization

1. In Google Auth Platform → Clients, download the existing **Desktop** client's JSON. Save it outside the repository, for example `C:\Users\User\Documents\NigraanOS_Email_Private\client.json`. Create this private folder yourself; avoid shared or cloud-synced folders. Never upload this JSON, tokens or screenshots of secrets to chat/GitHub.
2. Open PowerShell. Run (adjust only the private file paths if needed):

   ```powershell
   Set-Location 'C:\Users\User\Downloads\nigraanos-hackathon-release'
   node .\scripts\authorize-gmail.mjs --client 'C:\Users\User\Documents\NigraanOS_Email_Private\client.json' --output 'C:\Users\User\Documents\NigraanOS_Email_Private\gmail-credentials.dpapi.json'
   ```

3. Select **nigraanos.admin@gmail.com** in Google's browser consent screen. Confirm the only requested capability is sending email. A test/unverified warning may appear: continue only for your own correctly configured project. Do not authorize a different account. `login_hint` is a suggestion, not identity proof; `gmail.send` cannot inspect the mailbox's identity. No identity/read scope is requested. Later verify a controlled notification actually originates from the correct Gmail account before enabling judge requests.
4. Return to PowerShell. Success reports that encrypted credentials were saved; it never prints credentials. The helper uses state, S256 PKCE, a random loopback-only callback, five-minute deadline and no automatic email send. It refuses repository paths and overwriting an output file. The saved JSON is encrypted with Windows DPAPI for the current Windows user; the original downloaded client JSON remains private and unchanged. If authorization fails, inspect Google setup/account selection privately; do not send callback URLs or raw responses to chat.
5. To renew after publishing or expiry, run again with a **new output filename**. Do not overwrite existing private credentials. A newly granted token does not automatically update hosted secrets.

## Testing mode and evaluation availability

External OAuth **Testing** authorizations, including offline refresh tokens for `gmail.send`, expire seven days after consent. An automatic access-token refresh cannot extend that deadline. Do not rely on this token through the hackathon evaluation period.

Before deployment, review Google Auth Platform → Audience → Publish app / In production. Google's personal-use exception may apply because only the organizer authorizes the mailbox; receiving notification emails does not make judges OAuth users. Follow Google's console requirements and API policies; publishing is not Google verification and an unverified warning can remain. If verification is required by the console or the use case changes to public mailbox authorization, complete that process. Do not claim verified status. After publishing, run authorization again and privately configure the new refresh token. Tokens can still be revoked; monitor safe error categories and retain a manual notification fallback.

References: [Google testing expiry](https://support.google.com/cloud/answer/15549945?hl=en), [personal-use verification exception](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [Desktop OAuth/PKCE](https://developers.google.com/identity/protocols/oauth2/native-app), [Gmail send format](https://developers.google.com/workspace/gmail/api/guides/sending), [consumer limits](https://support.google.com/mail/answer/22839?hl=en).

## Hosted secret setup — only after separate rollout approval

Do not run hosted commands as part of local authorization. In the explicitly approved original project's Edge Function Secrets, set the four values from the encrypted file plus your existing private `JUDGE_WEBHOOK_SECRET`. Never use `VITE_` variables or commit credentials. No production secrets were set by this implementation.

To copy a single value privately without printing it, open PowerShell under the same Windows user. Run:

```powershell
$privateGmailFile = 'C:\Users\User\Documents\NigraanOS_Email_Private\gmail-credentials.dpapi.json'
$privateEncrypted = (Get-Content -LiteralPath $privateGmailFile -Raw | ConvertFrom-Json).credentials
$privateSecure = ConvertTo-SecureString $privateEncrypted
$privatePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($privateSecure)
try {
  $privateGmailSecrets = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($privatePointer) | ConvertFrom-Json
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($privatePointer)
}
$privateGmailSecrets.GMAIL_CLIENT_ID | Set-Clipboard
```

Paste into the matching secret field. Repeat just the last line with `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` and `JUDGE_EMAIL_FROM`. Disable clipboard history/sync beforehand. Then clear the clipboard with `Set-Clipboard -Value ''` and close this PowerShell window. Plaintext necessarily exists briefly in local process/clipboard memory; never display or save it. DPAPI is local at-rest protection, not protection against a compromised Windows account.

Apply notification-only migration **016 after 015** before enabling the Gmail worker. Do not change historical migrations. It preserves authorization, audit and counts while preventing replay of uncertain/stale sends. Known rejected/pre-send failures retain existing admin retry limits. A crash after claiming a job can leave it blocked even if no email was sent; investigate privately instead of blindly resetting state. No guaranteed exactly-once delivery is claimed.

After approved deployment, test a controlled request, approve/reject/revoke notifications, correct sender and inbox/spam delivery, token failures and unchanged 60-minute timestamps. Local mocked tests do not verify actual Google credentials or hosted delivery.
