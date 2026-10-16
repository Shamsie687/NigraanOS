# NigraanOS — Amazon Developer Hackathon Judge Guide

> Current deployed release: migration 020 and compatible frontend/MCP/notification worker are live. New activations last twelve hours. Started legacy one-hour grants retain their original expiry. Access requires organizer approval; confirm reviewer coverage throughout judging.

**Hosted demo:** [https://nigraanos.netlify.app/](https://nigraanos.netlify.app/)

NigraanOS connects Citizen reporting with authorized Operations review in Karachi, Pakistan. It brings reports about traffic, flooding, waste, air quality, water, power and road damage into a shared workflow so operators can inspect recorded facts, locate reports and decide what needs human attention. It supports review and coordination; it does not guarantee emergency response or independently verify a report.

## What to evaluate

| Experience | Implemented behavior |
| --- | --- |
| Citizen reporting | A signed-in Citizen supplies category, title, description, area, browser location and a required photo. Optional voice recording and configured transcription support review before submission. Citizens can follow their own reports and published Operations updates. |
| Operations workspace | Approved accounts review submitted reports, dashboard summaries, recorded priorities, activity and analytics. Status changes and resolution messages use explicit human-operated workflows. |
| City map | Authorized submitted incidents appear on an OpenStreetMap basemap with category/workflow filters and incident review. Refresh indicators distinguish connectivity and polling behavior. |
| Modeled city conditions | Karachi weather, precipitation and air-quality context carries provenance, timestamps and current/stale/unavailable states. Model output is context, not evidence that an incident occurred or is severe. |
| Nigraan Agent | Supported English text requests retrieve bounded facts and assemble a read-only investigation through MCP. The separate Nigraan AI feature is not the Agent's planner. |

**Alexa+ disclosure:** Nigraan Agent is a simulated Alexa+ web interface. It is **not an official Alexa+ integration, certified Alexa+ skill, or voice-assistant connection**. The simulation uses a real, read-only AWS-hosted MCP backend, rather than hardcoded tool answers. Text routing uses deterministic supported intents; it is not an unrestricted conversational AI.

The team confirms that the frontend is working on Netlify and the MCP endpoint is deployed in **ap-south-1**, under CloudFormation stack **`nigraan-mcp-staging`**. All five tools passed local and earlier hosted acceptance. Hosted Operations login, MCP authorization and both empty and populated investigations were manually verified by the team. The renewed twelve-hour judge cycle passed immediate acceptance: server timestamps were checked in the administrator UI; refresh/relogin persistence, one remote get_city_status read and Citizen access were user-observed in the private judge browser. These acceptance statements do not imply that every optional feature or device has been tested.

## Judge access and evaluation

1. Open the hosted demo and sign up/sign in using existing email authentication. In Citizen → **Operations access**, select **Request Temporary Operations Access**. The organizer must review it; signup, email addresses and permanent-application pending status grant no temporary privileges.
2. After approval, sign in and use **Check access status**. Select **Start My 12-Hour Access** before the displayed activation deadline (48 hours by default, or a bounded administrator-selected deadline). Approval and email opening start no session timer. Successful activation starts one server-authoritative twelve-hour session; refresh/relogin cannot restart it and there are no self-service renewals; contact the organizer for administrator-only renewal after expiry. Open Operations and inspect Dashboard, Live Map, Incidents and modeled conditions. Permanent applications remain separate. Expiry removes Operations and retains Citizen. Previously downloaded information cannot be recalled.
3. Open **Nigraan Agent**. Select **Connect read access**, review the client and five disclosed read capabilities, then approve consent. Confirm the connection shows **connected**. Approval grants bounded read access, not permission to alter incidents.
4. Ask **“Give me a city status briefing.”** Inspect the recorded counts and any returned references. Ask **“Which unresolved incidents should I review?”** for the review-candidate list.
5. If a current reference is returned, ask **“Tell me more about the first one.”** and **“Show activity for I1”**, replacing I1 with a reference actually returned. If no reference exists, skip detail follow-ups; do not invent one.
6. Ask **“What are the current city conditions?”** Inspect modeled provenance and freshness. Then ask **“What needs attention right now and why?”** to run the investigation described below.
7. Check the safety boundary with **“Resolve the first one.”** Expect a refusal of operational action. Do not change reports through the separate Operations controls during evaluation unless the team has designated disposable test records.
8. Select **Disconnect and revoke read access**. Confirm further remote reads require reconnection. If desired, reconnect and choose **Deny** in consent to evaluate a clean denial. Reloading loses the in-memory grant and requires reconnecting.

Citizen submission is optional for evaluation and creates real data. Only submit a team-authorized, clearly labeled test report with non-sensitive media. Location, camera and microphone permissions are explicit; inspect existing team-authorized examples instead if you do not want to provide location or create a report.

## Five MCP tools

The backend uses protocol **2025-11-25** and Streamable HTTP. Navigation remains a browser action, not an additional remote MCP tool.

| Tool | Judge-visible purpose |
| --- | --- |
| `get_city_status` | Authorized submitted, unresolved, resolved and awaiting-acknowledgement counts; up to eight unresolved references. |
| `get_urgent_incidents` | Bounded candidates and recorded reasons for review, using existing priority, acknowledgement and published-activity rules. |
| `get_incident_details` | A fresh authorized metadata read for a current grant-bound reference. |
| `get_city_conditions` | Modeled Karachi weather and air quality with provenance, timestamps and availability. |
| `get_incident_activity` | Published Citizen edit/update metadata from the previous 24 hours, optionally scoped to a current reference. |

### Investigation workflow

The investigation reads city status and the review-candidate list, inspects **at most the first two returned candidates**, optionally collects their published activity, and reads modeled conditions. It makes at most seven sequential tool calls. The briefing separates recorded facts, reasons for review, modeled context, coverage and human next steps. Reads are collected over time rather than forming one atomic database snapshot; partial failures and changed observations are disclosed.

Earlier hosted tests covered both a valid zero-candidate result and a populated investigation. Results depend on the current authorized records; do not promise urgent incidents or fabricate candidates. An empty result does not establish that Karachi is safe or that no incidents exist.

If a run is still active, **Cancel investigation** stops delivery of late results. References expire after at most five minutes (and no later than delegation expiry) and can become stale when context changes. Use a fresh investigation when prompted. Open Incidents leads to the existing authorized workspace for human review rather than exposing database identifiers.

## Privacy, control and limitations

- Citizen ownership and approved Operations access are enforced through database authorization/RLS. Uploaded evidence remains in private Storage; temporary judges use an authenticated expiry-checked evidence proxy; permanent-member signed preview links must not be shared.
- MCP returns allowlisted incident/activity metadata, not Citizen identities, contact details, private descriptions, database UUIDs, exact GPS, evidence, transcripts or Storage links. Active temporary and permanent Operations views have broader authorized access; avoid capturing private records in screenshots or video.
- Explicit consent uses OAuth authorization codes with S256 PKCE and exact callback/state/resource binding. The MCP bearer is distinct from the Supabase credential and stays in browser memory. Grants are short-lived; disconnect/signout attempt revocation, with expiry as fallback if the network fails.
- The Agent cannot dispatch, assign, resolve, change priority, send notifications or delete records. Consequential decisions remain with authorized humans in separate workflows.
- Modeled weather/AQ does not verify incident severity. Browser GPS can be spoofed; submitted reports are observations requiring review. Optional transcription, media capture and providers depend on configuration, device permissions and service availability.
- Results are bounded, subject to quotas and current authorization. Stale references, partial data and errors are surfaced rather than replaced with invented facts. This is not an emergency service or a production-readiness certification.

## 2–3-minute walkthrough / video outline

| Time | Screen and narration |
| --- | --- |
| 0:00–0:25 | Show the hosted app. “NigraanOS helps Karachi Citizens report local issues and gives approved Operations teams a shared place to review them.” Briefly show the reporting form without submitting or exposing personal data. |
| 0:25–0:50 | Show Dashboard, map and conditions. “Recorded reports and modeled environmental context are kept distinct. Human operators remain responsible for decisions.” Use only team-authorized, non-sensitive views. |
| 0:50–1:20 | Open Nigraan Agent and connect. “This is an Alexa+ web simulation, not an official integration. Consent connects it to our real read-only AWS MCP backend.” Show approval and connected state without exposing callback codes. |
| 1:20–2:05 | Request a city briefing, then “What needs attention right now and why?” Explain coverage and context. If empty: “Our verified run returned zero review candidates. We show that result honestly; it is not a claim that the city is safe.” Follow a reference only if one is actually returned. |
| 2:05–2:35 | Demonstrate refusal of a resolve request, then disconnect. “The Agent reads and helps review; it does not take operational action. Access can be denied or revoked, and references expire.” |

Email is advisory: use **Check access status** on the website if notification delivery is missing or delayed. MCP connections remain short-lived and may need fresh consent during a longer Operations session.

## Submission readiness items

- Confirm a reviewer-access arrangement throughout judging. Each twelve-hour session requires activation. Repeat access after expiry requires administrator renewal; organizer availability is necessary. Do not publish credentials or silently widen permissions.
- Judging runs November 9–20, 2026. Maintain runnable source and agreed demo access throughout it. Gmail External Testing tokens expire after seven days; an October renewal does not cover November. See GMAIL_NOTIFICATION_SETUP.md. Availability is not guaranteed by this guide.
- Keep the walkthrough compatible with both empty and populated authorized results. Record only non-sensitive, authorized screens and exclude credentials, authorization URLs/codes and private report content.
- Hosted acceptance evidence distinguishes administrator-UI observations from judge-browser results reported by the user. Genuine twelve-hour expiry remains pending until observed; no token/request trace from the private judge browser is claimed. Historical engineering documents describe earlier deployment stages and should not override the current verified facts above.
