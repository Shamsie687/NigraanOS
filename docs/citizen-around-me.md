# Around Me — M4D accepted, migration 013 applied

Around Me is an aggregate-only map, not an incident browser. No canonical IDs,
report prose, evidence, transcripts, assignment, priority or individual locations
enter the response. My Reports and Operations keep their existing boundaries.

The V1 application rectangle is latitude [24.70,25.30), longitude [66.80,67.60),
approved as product coverage only. It is not an official municipal boundary. Fixed 0.02°
cells are approximately 2.2 km north/south and 2.0 km east/west around Karachi.
Geometry depends on grid indices only. Requests carry row/column indices, not GPS.
Configuration is centralized in `src/config/aroundMe.js` and the private database
`nigraan_around_me_config()` helper. Future coverage changes require a reviewed
migration and synchronized frontend configuration, not new privacy rules.

A group is cell × category × public workflow state. Release requires at least
five distinct reporter accounts; repeat reports by one account cannot qualify.
Counts are report-count bands 5–9, 10–19, 20–49 or 50+, not supporter counts.
Assigned/in-progress share “In Operations workflow”. Resolved means “Marked
resolved in NigraanOS”, not verified physical resolution.

Each Karachi calendar day has one immutable published snapshot. Its report-start
window is the 30 days ending at Karachi midnight at the start of that day. Reports
submitted today first become eligible tomorrow. Workflow status is sampled when
that day's snapshot is first prepared; it is NOT reconstructed historical status
at midnight. The first request lazily builds all eligible groups atomically under
an advisory transaction lock. Failure rolls back the build; no partial projection
is readable. Published snapshots are reused. Only this new cache older than seven
days is pruned; canonical data is never rewritten or deleted.

Authenticated registered accounts receive exactly the same safe projection,
regardless of ownership/Operations approval. A 3×3 neighborhood returns at most
nine cells with at most 32 category/state groups each. No radius, arbitrary time
range, totals, pagination or incident lookup exists. Category/status filters are
client-side only. Raw release/rate tables have RLS and no browser privileges.
Private helpers have no PUBLIC/anon/authenticated EXECUTE. Only the safe RPC is
granted to authenticated users; all objects use fixed empty search paths.

Limits are six successful requests per rolling minute and 100 per rolling 24
hours. Account-row locks serialize admission. Request state holds only account
and at most 100 timestamps, never viewing coordinates. Failed statements do not
consume quota. The hook checks day rollover every minute while visible, without
requesting unchanged daily data; manual refresh/location changes perform reads.
There is one request at a time, an abort deadline and account/unmount cleanup.

Location is optional and explicit. Browser coordinates are generalized immediately
and never stored. Basemap tile requests reveal the viewed region to the provider;
existing OSM attribution/referrer behavior is preserved. No tile prefetching.

An empty map means no groups are available under the privacy rules, not that no
incidents exist. Sparse production data may intentionally show no groups. Never
lower k=5 or create fake production reports for a demo. This reduces risk but is
NOT differential privacy or guaranteed anonymity: auxiliary knowledge, Sybil
accounts and differences between daily releases remain limitations. Quotas do
not prove physical presence or prevent distributed scraping of safe releases.

Migration 013 passed the final privacy/security review and was applied through
the linked migration workflow after a dry run proposed only 013, with no seeds
or roles. Production history contains 002–013; historical bootstrap 001 remains
absent. Post-apply security verification and M4D manual acceptance passed.
No new keys, accounts, packages, scheduler, AWS or Edge Function configuration
is required. “Same Issue” remains deferred.
