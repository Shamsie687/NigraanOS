# Real interactive incident map

No database schema migration is required. Deployed 002–005 are unchanged. No
users, incidents, evidence or Storage files were changed by the agent.

## Dependencies and files

Added only `leaflet` 1.9.4 and `react-leaflet` 4.2.1 (React 18 compatible), plus
React Leaflet's required transitive core package. React/Vite and the Rollup WASM
override remain unchanged. `package.json` and `package-lock.json` record the install.

Created application files:

- `src/config/city.js`: shared city center/zoom/timezone and OSM tile configuration.
- `src/utils/incidentMap.js`: coordinate validation, category/priority presentation,
  filtering and real priority sorting, independent of Leaflet.
- `src/services/incidentMapData.js`: all-page authenticated incident reads and
  debounced INSERT/UPDATE invalidation subscription.
- `src/hooks/useOperationalIncidents.js`: shared Operations dataset, request
  cancellation, read/error state, Realtime status and 30-second backup refresh.
- `src/components/IncidentMap.jsx`: geographic map, custom markers, popups, filters,
  location controls, attribution and resizing.
- `src/components/IncidentMapSection.jsx`: lazy map loading/error isolation.
- `src/components/RealPriorityIncidents.jsx`: genuine unresolved incidents, ordered
  critical/high first, with no simulated filler.

Updated `src/pages/OperationsPage.jsx`, `src/components/Sidebar.jsx`,
`src/components/AiCopilot.jsx`, `src/data/mockData.js`, and `src/index.css` to integrate
the real map and clarify demo labels. The existing IncidentDetail, private evidence
viewer, status RPC service and Citizen reporting flow are reused unchanged.

Created `tests/map.test.js`, `tests/map-browser-server.mjs`, and
`tests/map-browser/{fixture.jsx,feed.js,client.js}`. Updated the local workspace
database test to safely substitute the owner's customized approval email in memory
and check optional Realtime publication setup. The owner's approval file is untouched.
Updated README and MULTI_WORKSPACE_TESTING; this document describes map verification.

## How it works

Dashboard places the reusable map beside the real priority list. Live Map expands
the same component; category navigation also opens this real Citizen Incidents
layer with the corresponding category filter. Citizen Reports remains a real list.

The initial viewport is Karachi `[24.8607, 67.0011]`, zoom 11. Configure another
city through `src/config/city.js`; incident coordinates are never recentered,
fabricated or restricted to Karachi. **Fit filtered incidents** can show incidents
outside the initial viewport. Latitude/longitude must be finite numeric values
within their legal ranges; `(0,0)` is valid. Missing/invalid GPS rows are omitted
from markers with a count, but remain in the report list.

Authenticated, RLS-protected reads request only submitted incidents, page through
all results in 500-row batches, and deduplicate IDs. The map is not silently limited
to 50/1000 records. Individual read pages are not a database snapshot transaction;
the next refresh reconciles submissions that arrive during a paginated read.

Eight category colors/symbols identify traffic, flood, garbage, air quality, water,
power, road damage and other. High priority has a red ring, critical has a double
ring, and resolved markers are faded. Popup text is React-escaped; only fixed,
allowlisted style tokens enter marker HTML. Markers have meaningful keyboard labels.
Popup **View incident** opens the existing detail/evidence/workflow panel.

Category and workflow dropdowns update markers. Marker coordinates stay original.
The priority panel shows unresolved real records, critical/high first; when empty
it says so. No demo records are mixed into this dataset.

**Center on Karachi** uses the configured city name/center. **My Location** asks for
one browser position on click, shows a distinct blue location/accuracy overlay,
and does not continuously track or store the user's position. Denied/unavailable
location is an explicit error; the incident map remains usable. Use HTTPS or
localhost for browser geolocation. Pan/zoom buttons, drag, double-click and touch
gestures work; mouse-wheel zoom is disabled to avoid trapping dashboard scrolling.

Standard OpenStreetMap HTTPS tiles require no key/payment. Attribution stays
visible at bottom-left, away from the existing AI preview button. The browser uses
normal tile caching; no prefetch/offline-download feature was added. Follow the
[OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) when
deploying; the provider URL/attribution is centralized for future changes.

## Realtime setup and truthful fallback

The app subscribes to `public.incidents` INSERT/UPDATE where publication state is
submitted, including draft-to-submitted UPDATE after photo finalization. Events
debounce a fresh authenticated query rather than trusting/merging raw payloads.
Joining the channel also refreshes, closing the initial query/subscription gap.

The interface distinguishes connecting, channel connected, event received, and
connection unavailable. **Channel connected does not prove publication membership
or remote event delivery.** A 30-second refresh runs while the tab is visible even
when the channel joins. Returning to the tab or going online refreshes immediately;
manual **Refresh incidents** is always available. Errors clear stale map data and
show the read failure. Unmount aborts queries and removes timers/listeners/channel.

To check your project, run this read-only query in Supabase SQL Editor:

```sql
SELECT pubname, schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename = 'incidents';
```

If it returns a row, incidents is already published. If not, enable
`public.incidents` under the project's `supabase_realtime` publication in
**Database → Publications**, or run the optional owner script
`supabase/admin/enable_incidents_realtime.sql`. It adds only incidents, is safe to
retry, and does not change data, RLS, grants, replica identity or bucket privacy.
It stops if the Supabase publication is missing instead of inventing configuration.
Evidence/Storage publication is unnecessary. See the
[Supabase Postgres Changes setup](https://supabase.com/docs/guides/realtime/postgres-changes).

The agent did not enable or verify remote Realtime. A local fake channel test checks
subscription options, INSERT/UPDATE callbacks, debounce, join refresh, fallback and
cleanup. The publication SQL was checked locally for idempotence/policy preservation.

## Exact authenticated end-to-end test

1. Restart Vite after dependency installation (`npm run dev`), sign in with your
   existing approved account and choose **Operations**.
2. Dashboard should show OpenStreetMap tiles and your real priority list. Use
   **Fit filtered incidents** if the existing incident is outside the initial view.
3. Click your marker; compare its title, area, category, status, priority and time
   with Citizen Reports. Choose **View incident** and check original GPS, full
   description, private photo and optional voice player.
4. Change Category and Workflow filters, including Other/Air quality/Resolved.
   Verify matching markers and the explicit empty state for no matches.
5. Open **Live Map** and check its larger view. Try center/fit, pan/zoom and resize
   the browser. On a phone use horizontal sidebar navigation; page content should
   not horizontally overflow. My Location is optional and requires permission.
6. On an unresolved test incident, advance one legal status step in the existing
   detail panel. The map popup/detail and priority list should reflect the update.
   Switch to Citizen → My reports → Refresh reports and confirm the same status.
7. Keep Operations open in one browser and submit a new Citizen incident from
   another signed-in tab/device, with GPS/photo and optionally voice. It should
   appear after the submission is finalized. With Realtime configured it triggers
   a change event; otherwise backup refresh updates within approximately 30 seconds
   while visible. Do not mistake that polling update for proof of Realtime.
8. Confirm signed-out/pending/rejected users cannot open the approved Operations
   workspace or read another citizen's incidents/evidence. No public evidence URL
   is placed in map markers or sent to the tile provider.

## Local test results and limits

- `npm test`: 23 tests, including GPS/category/status filters, real priority order,
  1201-row pagination, subscription/debounce/cleanup and existing Citizen/evidence
  recovery/workspace validation.
- `node tests/workspace-migration-check.mjs`: existing Citizen/Operations/RLS/private
  evidence/status flow plus optional publication setup tested in isolated PostgreSQL.
- `node tests/render-check.mjs`: existing auth/application/detail/Citizen form rendering.
- `npm run build`: production output with the map in a separate lazy-loaded chunk.
- `node tests/map-browser-server.mjs`: isolated browser-only fixture on port 5180.
  It substitutes a fake incident hook/client ONLY for this separate test server;
  production config/auth/RLS are not modified. Synthetic fixture banner is explicit.
  Browser tests verified OSM tiles, category filtering, popup → existing detail,
  status update propagation and laptop/phone layout without horizontal page scroll.
  It does not prove the user's remote incident or Realtime delivery.

Screenshots in `review/` use synthetic fixtures, never the user's private evidence.
No fixture users or records were created in Supabase. Existing schematic components
remain in the source but are not used by the Operations map routes. Analytics,
alerts/notifications, sensors, emergency controls and the Analytics AI preview remain clearly demonstration
features; no AI/transcription/weather/AQI/traffic/flood service was added.

Clustering/spatial server queries are future extensions; the data/filter/presentation
modules are separate from marker rendering, with stable incident IDs. No clustering
dependency or second map system was added.
