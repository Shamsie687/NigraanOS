# Nigraan MCP — local development and AWS staging architecture

**NOT YET DEPLOYED TO AWS.** Milestone 2C adds DynamoDB/KMS adapters, a Lambda
entry point and isolated infrastructure as code after the pre-Amazon baseline.
The owner confirms Milestone 2B's real local consent/delegated Supabase acceptance
test passed. Local development remains unchanged. No AWS resources, credentials,
Alexa production connection, write tools or migration 011 were created.
Supabase and Netlify production configuration are unchanged.

## Local prerequisites and commands

Use Node.js 22.23+ (the implementation was tested on 22.23.3; Node 24 is the
planned Lambda runtime). Dependencies are isolated under `server/mcp/`.

From `C:\Users\User\Downloads\huggingface\server\mcp`:

```powershell
npm ci
npm run typecheck
npm test
npm run dev
```

`npm run dev` reads the already ignored root `.env` using Node's env-file option.
It accepts existing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, or process
environment `SUPABASE_URL` / `SUPABASE_ANON_KEY`. Only browser-safe publishable/
anon configuration belongs here. A privileged key is rejected. Never use a
service-role credential or send tokens in chat. No new secret is required.

In another terminal, start the existing frontend with `npm run dev` from the
project root. Use **http://127.0.0.1:5173** and sign in normally as an approved
Operations user. Sessions on localhost and 127.0.0.1 have different browser
storage; sign in on the exact origin the consent flow opens.

In a third terminal, from `server/mcp/`:

```powershell
npm run client
```

Open **http://127.0.0.1:8788/** and click Start authorization. The explicitly
registered public client is `nigraan-local`, with exact redirect URI
`http://127.0.0.1:8788/callback`; the resource is
`http://127.0.0.1:8787/mcp`. The client validates callback state and PKCE, connects
using the official MCP SDK, lists five tools and reads current city status.
It prints no result bodies or credentials and revokes its grant after the test.
The final browser page reports success/failure without secrets.

Approve and Deny are explicit. An invalid/expired transaction or an unapproved
account fails closed. Restart the test from the client's home page to repeat.
No mock data is available through the normal server; tests inject isolated
fixtures. Real Supabase integration requires the owner's live login and has
not been performed by the coding agent.

The browser's `#/agent-consent?transaction=...` route is additive. Its local
development default is port 8787. Optional `VITE_NIGRAAN_MCP_URL` is public
configuration. Local mode accepts exactly `http://127.0.0.1:8787`, with the exact
`http://127.0.0.1:8788/callback` callback. Neither variable is required locally.
For AWS staging, explicitly configure an HTTPS MCP origin (no path/trailing
slash) and `VITE_NIGRAAN_MCP_REDIRECT_URI`, matching the server's preregistered
HTTPS callback exactly. No production default or dynamic callback trust exists.
Do not deploy the MemoryStore/local entry point.

## Protocol and authorization

Official `@modelcontextprotocol/sdk` **1.32.0** is locked in the server lockfile.
Its installed protocol constants and automated real-SDK-client tests confirm
`2025-11-25`. The canonical `/mcp` endpoint uses stateless Streamable HTTP with
JSON responses. It supports initialize, initialized notifications, tools/list,
tools/call and SDK JSON-RPC errors. Initialization offers 2025-11-25 when a client
proposes another version; clients unable to support it must disconnect. Unsupported
explicit protocol headers on subsequent requests are rejected.
No transport session ID, SSE stream or remote navigation tool is offered.

OAuth resource metadata is published at
`/.well-known/oauth-protected-resource/mcp`; authorization-server metadata at
`/.well-known/oauth-authorization-server`. No dynamic registration is offered.
The authorization-code flow requires S256 PKCE, exact registered client/redirect/
resource, nonempty high-entropy state, explicit logged-in consent and single-use
code redemption. Transaction and code lifetime are at most two minutes.
The fixed OAuth library revokes a code before checking the verifier: a wrong
verifier consumes the code to prevent online guessing. Start fresh afterward.

The normal Supabase credential appears only in authenticated delegation requests.
It never becomes an MCP bearer token. The separate opaque MCP token is stored
by hash and resolves to a user/client/resource/read-scope grant. Grant expiry is
the earlier of ten minutes or upstream JWT expiry. No refresh tokens are stored
or issued. Reauthorization is required after expiry.

Each server-backed read creates a request-local Supabase client, verifies current
identity and Operations approval, preserves caller JWT/RLS, and rechecks approval
before delivery. Supabase requests have a ten-second network abort budget inside
the twelve-second tool deadline. Approval denial invalidates the grant; unavailable
authorization fails closed. Sign-out is not claimed to instantly revoke all JWTs;
`POST /oauth/revoke` explicitly invalidates the MCP grant and its references.

## Five tools and output

| Tool | Input | Result |
| --- | --- | --- |
| get_city_status | `{}` | Exact authorized submitted/unresolved/resolved/awaiting counts, up to eight unresolved references |
| get_urgent_incidents | `{}` | Existing Urgent Operations calculation/order/reasons, overlapping counts, up to eight candidates |
| get_incident_details | `{context, ref}` | Fresh submitted incident metadata read through RLS |
| get_city_conditions | `{}` | Existing city-context modeled Karachi weather/AQ, projected provenance/status/times |
| get_incident_activity | `{}` or `{context, ref}` | Previous 24-hour published edit/update metadata, bounded aliases/events |

Inputs are closed schemas; output schemas are validated explicitly. Annotation
hints are read-only/non-destructive/idempotent, but never substitute for access
checks. No arbitrary table, query, UUID, coordinates, city or time window inputs.
Output contains no Citizen identity/contact/prose, UUIDs, exact GPS, evidence,
transcripts, media or Storage URLs. Environmental context does not verify incidents.

Reference contexts are random opaque handles containing no UUID payload. Their
server mapping is bound to user, grant and client, expires after five minutes
(or grant expiry if earlier), and is never an authorization substitute. Details
re-read the current submitted row. Facts identify `collected_reads` consistency:
paginated reads are not a transactionally atomic snapshot.

## Limits and errors

Eight incident cards, eight activity items; 5,000 incident rows and 10,000 activity
rows processed per call; maximum 500-row pages and 200-parent activity batches.
An extra bounded probe distinguishes exactly-at-cap collections from truncation;
overflow raises `read_budget_exceeded` and returns no purported exact total.
Urgent activity availability failure may return known candidates with a partial
flag, null recent-update count and fixed warning. Overflow and timeout are not
silently converted to partial exact facts.

16 KiB request and 64 KiB whole MCP response caps; twelve-second tool deadline.
Thirty attempts per rolling minute and 500 per rolling day per user; one active
tool call with a thirteen-second expiring lease. Failed/admitted tool attempts
consume quota. Busy rejection does not. Invalid known-tool input admitted at the
HTTP boundary also consumes an attempt. Initialize/list/discovery do not consume
tool quota; separate bounded control traffic limits apply.

HTTP 401/403 authentication/authorization failures and 429 quotas/busy responses
remain separate from ordinary MCP execution failures (`isError`). Safe tool codes:
`invalid_input`, `unknown_reference`, `stale_reference`, `incident_unavailable`,
`read_unavailable`, `read_budget_exceeded`, `timeout`. Do not expose SQL/provider
messages. Unknown expired contexts after cleanup may report `unknown_reference`.

Browser Origin allowlist remains exactly Netlify, 127.0.0.1:5173 and localhost:5173.
Reject supplied foreign origins and invalid Host headers. Origin-less clients
still need authentication. No cookie authentication or query-string bearer tokens.
OAuth authorization codes necessarily use the registered callback; they are
never logged. Responses use no-store/no-referrer.

## State adapter boundary and known limitations

`StateStore` defines atomic transaction/code consumption, grant/revocation,
reference resolution, quota/lease admission and guarded release. `MemoryStore`
is **development/test-only**: bounded maps, periodic/lazy expiry cleanup and no
disk persistence. Upstream access credentials exist as plaintext process-memory
strings until code/grant expiry or removal. This is not KMS encryption. JavaScript
does not provide reliable secure memory zeroization. Restart loses all grants,
contexts and limits. It does not enforce distributed quotas across processes.

Local HTTP on loopback is for development only. Production requires HTTPS,
durable atomic state, encrypted upstream credentials, secured IAM and reviewed
client onboarding. The development client is public/preregistered; arbitrary
third-party clients and production Alexa onboarding remain out of scope.

Diagnostics are disabled by default. The injectable safe hook emits only opaque
request ID, stage, known tool name, safe code, status and duration. No tokens,
codes, bodies, prompts, private fields, UUIDs, mappings, GPS or URLs. CLI logs
contain fixed startup messages only. No HTTP access logger is installed.

## Local validation recorded

Milestone 2B: server build/typecheck passed; **35 MCP/OAuth/security/adapter tests
passed, zero failed/skipped**. The existing frontend suite plus the consent route
regression passed **165 tests, zero failed/skipped**. Frontend production build
passed with the Rollup WASM override unchanged. Existing Citizen/Operations,
Analytics, Urgent Operations and Agent desktop/mobile browser regressions passed;
existing AI, transcription, environment and workspace render checks passed.
Consent presentation/service/browser checks passed using isolated fixtures.
The local CLI server startup with existing ignored configuration also passed.
Server dependency installation audit reported zero vulnerabilities.

These recorded automated/fixture results do not establish AWS production OAuth
or Alexa connectivity. The owner subsequently confirmed the real Milestone 2B
local login/approval/consent/initialize/five-tool-list/city-status-read/revoke
acceptance flow passed. Milestone 2C AWS behavior is not live-tested yet.

## Milestone 2C architecture and trust boundaries

Browser consent / preregistered MCP client -> API Gateway HTTP API (HTTPS,
payload v2) -> Node.js 24 arm64 Lambda -> existing Express/MCP/OAuth application.
Lambda uses DynamoDB for state, KMS for delegated credential protection, and
request-local caller JWT Supabase clients for all authorized reads. Supabase
remains the data/auth/RLS authority. Exactly five read tools remain; navigation
is client-only. There is no operational action executor.

`createApp` still defaults to `MemoryStore`; `local.ts` still selects it explicitly.
`lambda.ts` only selects `DynamoStore`/`KmsProtection`, with no memory fallback.
Lambda memory is not shared or durable across workers, so it cannot safely
enforce single-use codes, revocation, rolling quotas or leases. The Lambda
adapter forwards to the existing application, including the official SDK's
stateless JSON Streamable HTTP/protocol 2025-11-25. It synthesizes raw headers
for the SDK's Hono HTTP conversion. No business logic is duplicated.

The API Gateway source IP (not client X-Forwarded-For) drives the existing
control-traffic limiter. The supplied Host must equal the generated execute-api
origin. This first template targets commercial AWS regions and the default
execute-api HTTPS hostname, without custom domain mapping. Browser CORS is
exactly Netlify, 127.0.0.1:5173 and localhost:5173; the application owns CORS,
not a competing gateway configuration. Origin-less clients still need grants.

The owner-controlled registered client/redirect/resource is exact. HTTPS
registration alone does not make a client trustworthy: review the callback
implementation, state/PKCE storage and consent behavior before onboarding.
There is no arbitrary client registration, refresh token or Alexa onboarding.

## DynamoDB state and concurrency

One regional PAY_PER_REQUEST table, partition key `pk`, no scans, GSIs or global
tables. Each key is `kind:sha256(handle)`; raw MCP tokens, authorization codes,
transaction/context handles and lease tokens are not stored as keys/plaintext.

| Kind | Stored state | Expiry / atomic operation |
| --- | --- | --- |
| transaction | PKCE challenge, bound query/state and approved user | <=2 minutes; conditional user binding; conditional delete returns one winner |
| code | OAuth metadata, encrypted upstream token; raw code omitted | <=2 minutes/upstream expiry; conditional delete is one-time redemption |
| grant | user/client/resource/scope/grant binding, encrypted upstream token | <=10 minutes/upstream JWT expiry; strongly consistent hash lookup |
| revoked | hashed grant-ID tombstone | 11 minutes after revocation; invalidates grant and refs across workers |
| reference | private alias-to-row mapping and user/client/grant binding | <=5 minutes/grant expiry; expiry, binding, alias and revocation checks |
| budget | rolling attempt timestamps, hashed active lease, version | 30/minute, 500/day; lease 13 seconds; atomic compare-and-swap of budget AND lease |
| control | rolling control request timestamps, version | 60/minute per hashed source-IP control key; atomic compare-and-swap |

Every read/consume enforces millisecond `expiresAt` immediately. `ttl` is epoch
seconds for asynchronous cleanup, never authorization. AWS notes deletion can
take days: [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html).
All reads are strongly consistent. Conditional writes prevent double consumption
and lost counter updates. CAS retries are bounded to 12; excessive contention
fails closed with a retryable rate-limit response. Busy requests do not spend
quota; admitted failures still do. Guarded release checks the hashed lease AND
increments the version, so an old worker cannot release a newer worker's lease
or overwrite a concurrent budget update. Expiring leases recover crashed workers.

Revocation uses an immediately checked tombstone rather than scanning for rows.
Expired/revoked encrypted grant records and mappings may remain physically until
TTL deletion; they are unusable. This is short-lived distributed security state,
not conversation memory. Shutdown does not delete other workers' state.

## KMS protection and security

Authorization-code and grant upstream Supabase tokens are encrypted before each
DynamoDB write. Only ciphertext is persisted. Direct symmetric KMS Encrypt/
Decrypt uses the key ARN and encryption context `application=nigraan-mcp` plus
the hashed record key. No UUID/token is in the context. Binding prevents copying
ciphertext between records. KMS failures fail closed; there is no plaintext
fallback. Decryption happens only inside Lambda when the existing application
needs a caller-scoped client; plaintext is transient process memory, not a
secure-zeroization claim. Direct KMS encryption supports tokens up to 4,096
bytes; larger credentials fail closed, never truncate. See
[KMS Encrypt](https://docs.aws.amazon.com/kms/latest/APIReference/API_Encrypt.html).

The runtime IAM role can only Get/Put/Update/Delete on this table, Encrypt/Decrypt
on this key with the application context, and CreateLogStream/PutLogEvents in
its precreated log group. No Scan, service-role reader, AWS key in source,
KMS administration, S3 access, or broad database privileges are granted.
The account-root key policy enables account IAM delegation; Lambda itself has
only the scoped cryptographic permissions. API Gateway alone has invocation
permission scoped to this account/API. The deployer, separately, must have
CloudFormation/SAM provisioning permissions for these resource types, iam:PassRole
for the runtime role and IAM role/policy creation. Runtime IAM is not deployer IAM.

Application diagnostics contain only stage, known tool, safe code, status and
duration. No application UUIDs, tokens, authorization codes/verifier, citizen
content, upstream errors, URLs, GPS, event bodies or mappings are logged.
API Gateway access logging and tracing are not enabled. AWS-generated platform
invocation identifiers/timing may appear in native Lambda system logs; these
are not Citizen identifiers. KMS encryption context is visible in CloudTrail,
which is why it contains only application name and hashed state key.

CloudWatch log retention is seven days. Standard Lambda/API metrics remain
available; one alarm monitors Lambda's native Errors metric, without SNS/email
resources or automatic alarm delivery. Handled HTTP/MCP failures use safe logs
and may not increment Lambda Errors; inspect API 5XX and safe status/code logs
as well. No custom metrics namespace or permanent conversation log is created.

## Resources, public configuration and cost controls

`infra/mcp/template.json` is SAM/CloudFormation IaC defining Lambda, HTTP API,
integration/route/default stage/invoke permission, one DynamoDB table, one
customer-managed KMS key/alias, scoped IAM role, log group and error alarm.
No VPC, EC2, RDS, application S3, Bedrock, AgentCore, Cognito, DynamoDB streams,
provisioned concurrency or other application service is provisioned.

SAM ZIP uploads require a deployment-artifact S3 bucket. `--resolve-s3` may create
SAM's managed packaging bucket/stack on a future deployment; this is not an
application storage service and Lambda has no S3 permission. Approve this
packaging prerequisite before running SAM. Nothing has been created now.

| Deployment parameter / environment name | Classification |
| --- | --- |
| SupabaseUrl / SUPABASE_URL | Public project endpoint |
| SupabaseAnonKey / SUPABASE_ANON_KEY | Browser-safe anon/publishable key only; NoEcho reduces accidental display |
| ConsentUrl / MCP_CONSENT_URL | Reviewed HTTPS frontend base URL, default Netlify |
| ClientId, ClientName / MCP_CLIENT_ID, MCP_CLIENT_NAME | Public preregistered client metadata |
| RedirectUri / MCP_REDIRECT_URI | Exact reviewed HTTPS client callback; no query/fragment/userinfo |
| MCP_API_ID, AWS_REGION | Generated API/region configuration |
| MCP_STATE_TABLE, MCP_KMS_KEY_ID | Generated internal resource identifiers; not access credentials |
| ReservedConcurrency | 0 (default): no reservation; 2: optional account-supported cap |
| VITE_NIGRAAN_MCP_URL | Public frontend origin from stack output, without `/mcp` or trailing slash |
| VITE_NIGRAAN_MCP_REDIRECT_URI | Same exact callback as RedirectUri |

No new secret API key is needed. Supabase and MCP delegated tokens are sensitive
runtime credentials, never deployment parameters or frontend configuration.
AWS deployment credentials come from the owner's normal profile/SSO tooling;
Lambda uses its execution role. No `.env` is packaged; only compiled production
source/shared projections, package files and production dependencies are copied.
`.aws-sam/` is ignored. Keep all personal parameter files outside Git.

SAM now uses its native `NodejsNpmBuilder` (no custom BuildMethod). Its npm pack
step runs `prepack: npm run build` in the original server package, allowing tsc
to include the existing shared root projections. The npm files allowlist
packages only `dist/server/mcp/src/` and `dist/src/`, plus package metadata.
The native builder copies the lockfile and installs production dependencies.
No Makefile, GNU Make, Docker, esbuild or global TypeScript is needed. Install
the server's locked dependencies (`npm ci`) first so local tsc is available.
Local Node.js 22.23.3 produces ES2022 JavaScript; deployment remains Node.js 24
arm64. Current runtime dependencies are JavaScript, without native binaries
requiring Linux/arm64 compilation. Do not use `--build-in-source`, which can
link local dependencies into the artifact. Use the normal native build.

256 MiB on-demand Lambda, 20-second platform timeout, API soft throttle 2 req/sec
with burst 5, short retention, and application quotas reduce staging usage.
Reserved concurrency defaults to omitted, because new/low-quota accounts may
not support reservations while preserving AWS's unreserved capacity. Set it to
2 only after checking the account: [Lambda concurrency](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html).
Gateway throttles/budget alerts are not hard spend guarantees.

Main costs: customer-managed KMS key approximately $1/month plus cryptographic
requests, Lambda invocations/duration, API requests, DynamoDB reads/writes/storage,
logs, alarm and deployment-artifact storage. Each grant read decrypts through
KMS; no long-lived token cache bypasses revocation. Actual costs depend on region
and usage: [KMS pricing](https://aws.amazon.com/kms/pricing/).
The account has $100 Free Tier credit and an existing zero-spend budget alert;
do not assume the additional $150 promotional credit was approved. No account
upgrade is required for local coding/testing. Before staging verify service
availability/credits/quotas in the current Free Plan; stop and review if AWS
reports a restriction rather than upgrading automatically.

## Local checks (no AWS credentials)

From `server/mcp`:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run validate:infra
```

From the repository root:

```powershell
npm test
npm run build
```

Milestone 2C recorded results: **55 MCP/server tests passed, 0 failed, 0 skipped**;
**166 root tests passed, 0 failed, 0 skipped**; server typecheck/build and frontend
production build passed. Infrastructure local JSON/security checks passed.
AWS/SAM CLI were unavailable during the original Milestone 2C implementation;
that original report did not establish SAM packaging or real AWS operation.
Mocks emulate conditional operations locally; they do not claim live AWS proof.
Initial sandbox loopback/build access failures were resolved by rerunning the
same checks with approved execution permissions, without weakening tests.

## First staging deployment — future owner actions, NOT executed

1. Review this diff and account/region/credits/budget and service quotas. Confirm
   the existing Supabase approval/RLS behavior and normal Operations test account.
2. Ensure AWS CLI v2, AWS SAM CLI and Node/npm are available through normal owner
   tooling. Docker/GNU Make are not required. No global tool was installed.
   Authenticate with
   the owner's existing profile/SSO configuration; never paste access keys in chat.
3. The owner selected ap-south-1 for staging. Approve the SAM artifact bucket,
   named staging stack and listed resources/IAM permissions.
4. Register a reviewed public staging MCP client with a working HTTPS callback,
   state/PKCE checking, and exact client ID/name. Production Alexa registration is
   a later task. The existing local test client is still local-only and cannot
   prove a remote HTTPS acceptance flow without a separately prepared client.
5. Obtain public Supabase URL/anon configuration privately from the existing
   project. No service-role key or Groq secret is involved. Do not save guided
   parameter answers to a committed samconfig file.

Only after explicit deployment approval, from the repository root:

```powershell
aws sts get-caller-identity --region ap-south-1
sam validate --lint --template-file infra/mcp/template.json --region ap-south-1
Set-Location server/mcp
npm ci
npm run typecheck
npm test
npm run build
npm run validate:infra
Set-Location ../..
sam build --template-file infra/mcp/template.json
sam deploy --guided --stack-name nigraan-mcp-staging --region ap-south-1 --capabilities CAPABILITY_IAM --resolve-s3 --confirm-changeset --no-execute-changeset
```

Enter only reviewed public configuration for parameters; keep ReservedConcurrency
at 0 unless the account supports 2. Keep rollback enabled. Answer No to saving
guided arguments. Review the resulting change set and billing implications.
Then, only after approval of that exact change set:

```powershell
aws cloudformation list-change-sets --stack-name nigraan-mcp-staging --region ap-south-1
aws cloudformation execute-change-set --stack-name nigraan-mcp-staging --change-set-name REVIEWED_CHANGE_SET_NAME --region ap-south-1
aws cloudformation wait stack-create-complete --stack-name nigraan-mcp-staging --region ap-south-1
aws cloudformation describe-stacks --stack-name nigraan-mcp-staging --region ap-south-1 --query "Stacks[0].Outputs"
```

Replace REVIEWED_CHANGE_SET_NAME with the actual reviewed name. These commands
for deployment have NOT been run. After the stack exists, configure the consent frontend's two
public MCP variables in a reviewed staging frontend build; this needs a separate
authorized Netlify deployment. No Supabase migrations, functions or secrets change.
The exact API origin is generated by the stack, not guessed in advance.

## Staging acceptance and rollback

Verify discovery exposes the exact HTTPS resource, all allowed browser origins
work, foreign Origin/Host fails, and Origin-less unauthenticated MCP fails.
Use the registered staging client and a real approved Operations login: consent
-> code/S256 exchange -> initialize 2025-11-25 -> exactly five tools -> real
city-status and reference/detail read -> revoke -> subsequent read denied.
Verify failed identity/approval, wrong redirect/resource/verifier, simultaneous
redemption, cross-grant references, expired grants/refs, rolling limits, busy
lease, worker reuse and KMS denial all fail closed. Inspect content-free logs;
never copy invocation/token payloads. This milestone did not execute these tests.

For a code rollback, redeploy the last reviewed artifact with the same table/key
and registrations; do not silently use MemoryStore. Short-lived existing grants
can then expire normally. For removal, stop new clients/consent, restore/remove
the frontend MCP variables in a separately authorized deployment, then:

```powershell
sam delete --stack-name nigraan-mcp-staging --region ap-south-1
```

Review prompts for SAM artifact cleanup. DynamoDB and KMS have Retain policies
to avoid accidental state/key loss during replacement/rollback. Stack deletion
does not remove them. After traffic stops, grants/refs expire within ten minutes;
budgets expire within a day; physical TTL cleanup may take longer. Explicitly
review/delete the retained table and schedule retained KMS key deletion through
the AWS console (7–30 day waiting period), including orphaned old resources
after replacements. Check artifact bucket and remaining alarms/log groups.
Retained keys can continue incurring costs until deletion is scheduled/completed.
Do not interpret stack deletion as proof of zero remaining resources/cost.

This AWS implementation was added **after the pre-Amazon regional baseline**.
No deployment, AWS resources, Supabase migration/data/RLS/Storage change,
Groq/transcription/city-context change, write tool, migration 011, Bedrock,
AgentCore or actual Alexa integration was performed.

## 6 October 2026 — native Windows packaging validation

The original template's `BuildMethod: makefile` selected CustomMakeBuilder and
failed because GNU Make was absent. That override and Makefile were removed.
Native NodejsNpmBuilder now compiles through npm prepack and packages the
compiled-file allowlist. No architecture, handler path, runtime, IAM, OAuth,
RLS, state adapter or credential protection behavior was changed.

Validation on Windows with local Node.js 22.23.3 / SAM CLI 1.166.2:
- 56 server tests passed, 0 failed/skipped, including two infrastructure/package tests.
- Server typecheck/build, infrastructure structural checks and root build passed.
- 166 root tests passed, 0 failed/skipped.
- `sam build --template-file infra/mcp/template.json` succeeded natively, without
  Docker or GNU Make, retaining Node.js 24 / arm64.
- Generated `.aws-sam/build/McpFunction/dist/server/mcp/src/lambda.js` imports
  successfully and exports `handler`; all 16 application JS files' static
  relative imports resolve inside the artifact, including shared projections.
- Production dependencies are included; tests, local .env, TS source/compiler
  and native `.node` binaries are absent from the application artifact.

- `sam validate --lint --template-file infra/mcp/template.json --region ap-south-1`
  also passed against the updated template in this session.

No AWS runtime
execution, deployment, resource creation or push is claimed by packaging success.


## Milestone 2D — simulated Alexa+ MCP demo client (post-baseline)

This capability was added after the pre-Amazon regional baseline. Per the
hackathon participant constraints, real Alexa+ developer tools/backend are
unavailable. This is a **Simulated Alexa+ experience**, not an official Alexa
integration. The OAuth broker and five read-only MCP tool executions are real;
the conversation remains bounded deterministic intent routing, not autonomous AI.

Staging registration (also the SAM parameter defaults):
- ClientId: `nigraanos-alexa-simulator`
- ClientName: `NigraanOS Alexa+ Simulator`
- RedirectUri: `https://nigraanos.netlify.app/agent-callback`
- ConsentUrl: `https://nigraanos.netlify.app/`

OAuth redirect URIs cannot contain fragments (RFC 6749 section 3.1.2).
The dedicated HTTPS callback is therefore rewritten to index.html by Netlify.
The bootstrap clears its query before React/auth loads and hands off internally
to the hash router. Callback headers disable referrers and caching. This route
must be published through a separately authorized frontend deployment before
staging authorization is usable; this milestone does not deploy it.

The Operations Nigraan Agent workspace now starts S256 PKCE authorization,
redirects to existing Operations-only consent, validates state/account/client/
redirect/resource binding, exchanges the one-use code, initializes the official
MCP SDK transport and verifies exactly the five expected read tools. No
Supabase JWT is used as the MCP bearer. The delegated opaque bearer stays in
memory; only a two-minute PKCE transaction (state, verifier, public configuration
and account binding) survives the redirect in sessionStorage. It is removed on
completion/failure/expiry. Reload loses the grant and requires reconnecting.
Disconnect/signout/account changes erase memory and attempt server revocation;
network failure leaves bounded server expiry as the fallback. No refresh tokens,
client secret, AWS credential or service-role key is required by the browser.

References remain bounded, request-context bound and short-lived. The browser
projects remote output to metadata only. Remote aliases do not disclose database
IDs: Open Incidents opens the existing Incidents workspace for human review,
not a UUID-based deep link. Navigation is local, never an MCP write tool.

### Local simulator acceptance

Privately set frontend `VITE_NIGRAAN_MCP_URL=http://127.0.0.1:8787` and restart
Vite. Do not put credentials in chat. From the repository root:

```powershell
cd server/mcp
npm run dev:simulator
```

In another terminal, from the repository root run `npm run dev`. Open
`http://127.0.0.1:5173`, sign in with approved Operations access, open Nigraan
Agent, select Connect read access, approve consent, and confirm Connected.
Try city status, urgent incidents, incident details/activity using a returned
reference, and city conditions; then Disconnect and confirm reads require
reconnection. Deny consent once and confirm a clean failure. Sign out and confirm
read access clears. Never paste authorization URLs/codes/tokens into reports.

For a localhost frontend use `npm run dev:simulator:localhost` instead and open
`http://localhost:5173`; its exact callback is
`http://localhost:5173/agent-callback`. The 127.0.0.1 variant uses
`http://127.0.0.1:5173/agent-callback`. Run only one server variant at a time.
Existing engineering `npm run dev` plus `npm run client` retains the separate
`nigraan-local` / `http://127.0.0.1:8788/callback` registration. Do not confuse
that acceptance client with the demo client. If an existing frontend
`VITE_NIGRAAN_MCP_REDIRECT_URI` override is set, it must match the selected exact
callback; remove the old engineering override for the simulator if necessary.

### Staging owner actions

Before creating the change set, review the updated template defaults above,
public Supabase URL/anon configuration and retained-resource/cost behavior.
No AWS URL is invented. After an independently authorized AWS deployment, take
the API Gateway origin output and privately set frontend `VITE_NIGRAAN_MCP_URL`
to that exact HTTPS origin (no trailing slash/path). Consent configuration must
use the same endpoint and production callback. Restart Vite after env changes;
Netlify requires a fresh separately authorized build/deployment to embed Vite
configuration and publish the callback route. Then perform the same real
Operations consent/PKCE/tool/revocation acceptance test against staging.

No AWS deployment/runtime acceptance is claimed by local tests. No Supabase
migrations, write tools, priority changes/migration 011, Bedrock, AgentCore,
real Alexa toolkit, voice assistant backend or autonomous actions were added.

Milestone 2D local validation: 178 root tests passed, 57 MCP/server tests passed,
zero failed/skipped. Both frontend render checks passed. Server typecheck/build,
infrastructure checks, production frontend build, SAM lint and native Windows
SAM build passed. The packaged Lambda handler exports a function; all 16
application JavaScript files have resolving static relative imports. Vite emitted
non-blocking dependency annotation and chunk-size warnings. These are local
checks, not deployed AWS or live Supabase simulator acceptance.
