# Nigraan Agent — Amazon Milestone 1

Implemented after pre-Amazon baseline commit `193014f` (Initial NigraanOS release).
This is a text-based **simulated Alexa+ experience**, not an Alexa service integration.

## Implemented flow

```text
Operations UI / simulated Alexa+ text input
    → bounded conversation controller
    → deterministic English intent orchestration
    → validated stable safe-tool interface
    → existing authenticated Supabase client / authorization RPCs
       + published activity metadata service
       + existing Urgent Operations calculation
       + existing city-context service
    → Supabase RLS / existing Edge Function
```

No LLM planner is used. Text matches supported intents; unknown requests explain
the limits rather than producing a made-up answer. Existing Nigraan AI and Groq
transcription remain unchanged and separate. No AI quota is consumed by Agent
reads. The only Edge Function invoked here is the existing `city-context`.

## Stable internal tools

All inputs are plain objects; extra keys, unsupported tool names and invalid
references/views are rejected. `AgentInput`/`AgentResult` JSDoc and runtime
validation define the JavaScript contract in `src/services/agentTools.js`.

| Name | Input | Output / effect |
|---|---|---|
| `get_city_status` | `{}` | FACT: submitted/current unresolved/resolved/awaiting counts; up to eight unresolved references |
| `get_urgent_incidents` | `{}` | FACT: existing critical/high/new/published-update logic, overlapping counts and reasons; up to eight candidates |
| `get_incident_details` | `{ref, referenceVersion?}` | FACT: re-read submitted incident category/status/recorded priority/report age |
| `get_city_conditions` | `{}` | CONTEXT: allowlisted modeled weather/AQ values, status/times and provenance |
| `get_incident_activity` | `{ref?, referenceVersion?}` | FACT: published edit/update metadata from previous 24 hours; bounded references/events |
| `navigate_to_incident` | `{ref, referenceVersion?}` | Authenticated re-read, then client-side navigation/selection; no incident mutation |
| `navigate_to_view` | `{view}` | Client navigation to Command Center, Live Map, Incidents, Urgent Operations or Analytics |

Result envelopes contain `kind`, `headline`, `snapshotAt` and applicable
`facts`, `incidents`, `activity`, `context`, `omitted` or `notice` fields.
Incident cards expose aliases/category/status/priority/age/reasons, not titles,
descriptions, reporter IDs, UUIDs, GPS or evidence. Activity excludes bodies,
snapshots and event UUIDs. Conditions explicitly project fixed numeric fields
and provenance; raw provider objects/coordinates/URLs are not returned.

The metadata-only incident query uses the same authenticated submitted-incidents
source/RLS as existing Operations. It paginates until an empty page, including
when a PostgREST row cap is lower than the requested page size. No database-query
strings or client-selected columns/tables are accepted as tool arguments.

Urgent eligibility delegates to `calculateAttention`; there is no second urgency
definition. Update eligibility reads metadata for all unresolved parents before
derivation. Activity failure leaves known priority/new candidates available and
reports update eligibility as unavailable, never zero. All reads use one local
collection timestamp per result; paginated browser reads are not a transactionally
atomic database snapshot.

## Authorization and privacy

- Operations-only UI remains under the existing application approval gate.
- Every tool checks `auth.getUser()` against the mounted account and calls the
  existing `is_approved_operations` RPC. Data reads recheck access before delivery.
- Incident reads remain authenticated and RLS-controlled; no service-role client.
- Detail/navigation rechecks the referenced incident is still submitted/readable.
- No Agent request reaches an AI provider. Operator input is not logged/persisted.
- Unexpected server error content is replaced with a generic read failure.
- Facts are current recorded data, not verification. Environmental values are
  CONTEXT only. INTERPRETATION is not generated in this milestone. Suggested
  next steps require human judgment; there are no executable write suggestions.
- The existing city-context read can maintain its environmental cache internally;
  this is not an Agent operational write or incident mutation.

## Bounded conversational state

Maximum 20 thread entries; maximum 600 characters per operator request. Up to
eight reference aliases live in an instance-local ID map with a five-minute
expiry. Lists replace the reference set, preserving result order for ordinal
follow-ups. Detail reads do not reorder the set. Result-card buttons carry a
reference version so an older I1 cannot resolve against a newer list.

Clear, account change, logout or navigation away cancels pending work and removes
conversation/reference state. No permanent memory, database history or browser
conversation storage is implemented. Session persistence is existing auth only.

Text and suggested prompts enter the same controller, leaving room for a future
voice-input adapter. No microphone recording, speech synthesis or Alexa assets
are included in Agent Milestone 1.

## Future MCP mapping — NOT implemented

```text
Alexa+/MCP client
    → future self-hosted MCP server
    → same conceptual Nigraan tools
    → per-user delegated authentication / server authorization
    → Supabase
```

The browser mapping above remains conceptual; **Milestone 2B now implements a
separate local-development MCP endpoint**, described below. It is not deployed
and does not establish an Alexa production connection. A cloud adapter must retain
protocol schemas, per-user identity and
approval, session-bound reference maps, cancellation, resource budgets, rate
limits, safe serialization and server-side navigation semantics. Browser-only
callbacks cannot simply become remote tools. No service-role incident reader
may replace user authorization. Any operational mutation needs a separately
approved, human-confirmed action design and durable audit trail.

## Limits and next milestone

Supported English intents are deterministic, not unrestricted natural-language
understanding. No AWS, new credentials, migration, hosting or deployment is
required to exercise this local milestone with an existing approved account.
City Conditions still depends on the already deployed function/configuration.

## Milestone 2B — LOCAL DEVELOPMENT IMPLEMENTATION

`server/mcp/` contains a separate TypeScript package and exact dependency lock.
Official MCP SDK 1.32.0 serves stateless JSON-mode Streamable HTTP at `/mcp`,
protocol 2025-11-25. Only five read tools are remote; browser navigation remains
unchanged. Output schemas and closed inputs enforce metadata-only projections.
The browser and server share `agentProjection.js`; urgency uses the unchanged
existing `calculateAttention` function.

```text
Preregistered local MCP client
    → OAuth authorization code + S256 PKCE + state/resource/redirect binding
    → existing NigraanOS login and explicit read-only consent
    → separate opaque, short-lived MCP bearer grant
    → authenticated /mcp request
    → caller-scoped Supabase client + current identity/Operations approval
    → bounded read adapters + RLS + approval recheck
    → validated FACT/CONTEXT output
```

`#/agent-consent?transaction=...` is additive and retains login context. Ordinary
Supabase JWTs are accepted only at the trusted consent/delegation boundary, never
as MCP bearer tokens. Credentials are temporarily held in bounded development-only
memory; no refresh token, disk persistence or encryption claim. Codes and grants
are hash-indexed. Codes/transactions expire in two minutes, grants within ten minutes
or upstream JWT expiry, contexts within five minutes or grant expiry. References
bind user/grant/client and require fresh authorized row reads.

`StateStore` supports atomic consume, revoke, resolve, quota admission and lease
release. The implemented `MemoryStore` works only in one local process. Production
DynamoDB conditional writes and KMS encryption are **NOT implemented**. Read budgets,
rate limits, bounded responses, deadlines and content-free diagnostics are implemented.
No AI provider is involved. Existing Groq/Nigraan AI, transcription, Supabase/RLS,
city-context and migrations are unchanged; no migration 011 exists.

See [local setup and limitations](./nigraan-mcp-deployment.md). Next milestone is
owner-approved **2C: distributed state/credential protection and Lambda/API Gateway
adapter, followed by separately authorized staging provisioning and real delegated
RLS tests**. No cloud or production Alexa compatibility is claimed yet.


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
