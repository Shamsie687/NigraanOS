# Amazon hackathon development log

## Pre-existing baseline

Regional-round baseline: commit `193014f`, Initial NigraanOS release.
The 4 October 2026 baseline audit identified existing Citizen reporting/private
evidence, Groq transcription, human Operations workflow, Leaflet map, Command
Center, real Analytics, Urgent Operations, grounded read-only Nigraan AI and
Open-Meteo/CAMS context. These are **not new Amazon hackathon work**.

## 5 October 2026 — Amazon Milestone 1, local implementation

New after baseline:
- Dedicated lazy-loaded Nigraan Agent Operations navigation destination.
- Explicitly labeled simulated Alexa+ text experience using NigraanOS visuals.
- Operator/Agent thread, tool completion/loading indicators and structured
  factual/context cards, without hardcoded production answers.
- Seven stable validated read/navigation tools.
- Metadata-only authenticated incident collection; existing activity/context
  services and Urgent eligibility reused.
- Projected alias-based results that exclude Citizen free text/media/IDs/GPS.
- Five-minute, eight-reference context with ordinal follow-ups and old-card
  version protection; twenty-entry in-memory thread and cancellation/reset.
- Explicit refusal of consequential actions and navigation to existing views.
- Agent unit, render and isolated browser tests; responsive desktop/mobile UX.
- Internal architecture and future MCP mapping documentation.

No Alexa production connection, AWS service, MCP server, new AI planner/provider,
voice-input feature, operational write tool, migration 011, notification backend,
permanent conversation memory or production deployment is implemented.
Existing Groq AI/transcription and backend source remain unchanged.

Validation results and manual acceptance steps are recorded in the final task
report. Synthetic browser fixtures are isolated tests, not production data or
evidence of live deployment.

## 5 October 2026 — Amazon Milestone 2B, local implementation

New after Milestone 1:
- Isolated TypeScript server package and exact lockfile; official MCP SDK 1.32.0.
- Local `/mcp` stateless JSON Streamable HTTP, protocol 2025-11-25.
- Exactly five closed-schema read tools with explicit output validation.
- Shared browser/server metadata projection and unchanged Urgent Operations logic.
- Separate opaque MCP grant via authorization code/S256 PKCE, exact client/redirect/
  resource/state checks, explicit logged-in consent and single-use code consumption.
- Two-minute authorization transactions/codes, bounded ten-minute grants and
  five-minute user/grant/client-bound opaque references with fresh row authorization.
- Caller-scoped Supabase adapter, current Operations checks, before-delivery recheck.
- Resource caps, rolling quotas and expiring single-request lease through a state
  interface with a development-only in-memory implementation.
- Local public test client, consent page, safe error/diagnostic boundaries and
  automated HTTP/SDK/OAuth/security/adapter tests.

**LOCAL DEVELOPMENT IMPLEMENTATION — NOT YET DEPLOYED TO AWS.** No DynamoDB/KMS
implementation or encryption claim, AWS resources, Lambda wrapper, production
Alexa connection, write tools, migration 011, new provider or permanent memory.
Existing Supabase production configuration and Groq behavior remain unchanged.
The automated suite uses isolated fixtures; a real owner login/Supabase delegated
read has not been performed in this coding session.

## 5 October 2026 — Amazon Milestone 2C, AWS implementation without deployment

The owner confirmed Milestone 2B's real local acceptance flow passed before this
milestone. New after the pre-Amazon regional baseline:
- Production DynamoDB StateStore behind the existing interface; MemoryStore stays
  the default local/test implementation. Atomic consumption, guarded binding,
  strong reads, rolling quota/lease CAS, revocation tombstones and explicit expiry.
- KMS encryption of upstream credentials before persistent code/grant writes;
  hashed bearer/code keys, record-bound encryption context, fail-closed errors.
- Lambda payload-v2 adapter routes through the existing Express/official MCP SDK,
  including required raw-header bridging and trustworthy Gateway source-IP use.
- Isolated SAM/CloudFormation template for Lambda, HTTP API, DynamoDB, KMS,
  restricted IAM, seven-day logs, soft gateway throttles and an error alarm.
- Explicit HTTPS MCP/callback deployment configuration for the existing consent
  service, preserving exact local defaults and callback binding.
- Conditional-write/KMS/Lambda/IaC tests and local infrastructure-check command;
  source-only SAM packaging; deployment/trust/cost/rollback documentation.

Validation: 55 server tests and 166 root tests passed, zero failed/skipped;
server typecheck/build, frontend production build and local infrastructure checks
passed. Existing 35 MCP/adapter/OAuth/security tests remain. AWS/SAM CLI were
unavailable: full SAM lint/container packaging and real AWS integration are not
claimed. Conditional operations/KMS are tested with isolated local mocks.

NOT DEPLOYED. No AWS resources/account upgrade, promotional-credit assumption,
AWS key, Git push, Netlify/Supabase deployment, schema/migration 011, priority
history, write/action tool, Bedrock, AgentCore, Alexa connection or changes to
working Groq AI/transcription/city-context were made. A reviewed HTTPS staging
client and approved owner deployment remain prerequisites to live AWS acceptance.

## 6 October 2026 — Milestone 2C native Windows packaging correction

- Removed the custom makefile BuildMethod and safely removed its sole Makefile.
- Native SAM NodejsNpmBuilder runs npm prepack -> existing tsc build. An explicit
  npm files allowlist includes compiled server/shared source only; SAM installs
  production dependencies from the copied lockfile.
- Preserved Node.js 24 arm64 deployment target, Lambda handler path, all AWS
  resources/IAM and Milestone 2B/2C runtime/auth/privacy behavior.
- Updated packaging regression tests and deployment instructions to native SAM
  build without Docker/Make, with the owner's selected ap-south-1 staging region.
- 56 server tests and 166 root tests passed, zero failed/skipped; typecheck,
  server/root builds and local infrastructure checks passed.
- Actual native Windows SAM CLI 1.166.2 build succeeded using Node.js 22.23.3.
  Updated SAM template lint validation also passed in ap-south-1.
  Exported handler, 16 application JS files/shared import closure, production
  dependencies and exclusion of tests/env/compiler/native binaries verified in
  the generated artifact.

No deployment, AWS resources, new dependency/global software, architecture or
security change, backend migration, write tool, credential or push was made.


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
