# City Environment deployment and acceptance

Local implementation only. No provider key or frontend environment variable is required.

1. Run `supabase/migrations/010_city_environment_context.sql` in the linked project's Supabase SQL Editor. Do not rerun 002–009. This creates only the environmental cache and service-only claim/finish RPCs.
2. From the project root run `supabase functions deploy city-context --no-verify-jwt`.
3. Reload the local Vite app. Restart Vite if it was running when package/configuration changes were made.
4. Use an approved Operations account. Open Dashboard; inspect the `city-context` Network response: HTTP 200, version 1, `context_only: true`, separate weather and AQ statuses. Values must have valid/fetch times and source provenance.
5. Open Live Map and expand City Environment. It reuses the same mounted hook/cache data. Moving the map or using My Location must not change environmental coordinates.
6. Repeat refresh within TTL: successful dataset `fetched_at` must remain unchanged. Browser refresh does not force upstream refresh. Empty-cache clients competing with another active refresh can briefly see unavailable; the next automatic/manual refresh retrieves the completed cache.
7. Verify Citizen-only, pending/rejected Operations and signed-out callers cannot invoke it successfully. Browser direct cache writes and both cache RPCs must be denied.
8. Verify weather/AQ failures independently in local tests; never introduce failures by changing live incident data. Check cached results become stale and headline values disappear beyond 2h weather / 6h AQ valid/fetch age.
9. Verify Citizen report, Operations workflow, incident markers, transcript and Nigraan AI still work. This function does not read incidents or integrate environmental data into AI.

Supabase supplies the built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions. The server's privileged client is used only through two fixed environmental-cache RPCs; no `.from()` access or incident/evidence queries are present. The service key itself is privileged: never expose it to frontend configuration. No custom secret needs changing for the local MVP origins. For hosting elsewhere, configure `CITY_CONTEXT_ALLOWED_ORIGINS` with explicit deployed app origins; do not use wildcard CORS.

Cache: independently keyed by city/dataset/version. Weather TTL 15m, AQ TTL 60m. Atomic 30s refresh leases; provider timeout 8s, bounded 100KB provider JSON. Failure keeps last success and backs off at least 30s (default 60s), respecting numeric/date Retry-After up to 24h. Expired leases recover on demand. No scheduler/Redis and no browser force-refresh bypass.

Requests contain only allowlisted city ID. Provider URLs, fields and coarse coordinates are server-owned. Model-valid time differs from fetch time. Current precipitation includes the provider interval. Previous/next 24h totals include exactly 24 distinct valid hourly endpoints; missing/null/duplicate intervals produce partial coverage and a null total, never zero.

Weather is modeled. Air quality is Open-Meteo/CAMS global (~45km model grid), US AQI scale, not a sensor or measured citywide average. Open-Meteo/Copernicus attribution appears in the UI. The free provider is intended for noncommercial use; revisit provider licensing for commercial deployment.

Tests: `npm test`, `npm run test:city-context`, `npm run test:ai`, `npm run build`. SQL tests use the repository's existing isolated PGlite dependency, not remote Supabase. Public Karachi JSON fixtures are real smoke-test responses; they are test-only, never runtime fallbacks. Optional headless layout verification: pass the installed Playwright `index.mjs` path to `node tests/city-context-render-check.mjs` (local Chrome required).
