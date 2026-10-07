# Citizen accountability — M4C

Migration 012 is applied to production, and automated validation and manual
acceptance are complete. Production migration history records 002–012. Do not
rerun applied migrations or the historical bootstrap. For future migrations,
inspect linked history and a linked push dry-run before separately authorized
application.

The new baseline timestamp is a recording cutoff, not an old report transition.
An AFTER incident trigger observes publication, canonical status changes and
assignment changes transactionally. Existing incidents receive no backfill;
text/evidence/updated_at-only edits create no workflow events. Combined assignment
and status changes produce one observation. Submission rollback removes its
observation too. Citizen publication is not attributed as an Operations action.

Raw event/update/baseline tables have RLS with no browser policies or privileges.
Owner-only `nigraan_read_accountability` returns current status, safe events,
explicit public messages, cutoff and an approved assignment organization label.
It never returns internal actor/author/assignment UUIDs or evidence metadata.
Approved Operations can read the safe event/message projection through
`nigraan_read_operations_updates`. Reads return at most 50 records per collection;
RPC cursor parameters support older records, while this UI displays latest 50.

Approved Operations can post immutable messages only for submitted active
processing incidents. Retry receipts are bound to actor, incident, message and
kind. The generic status RPC preserves the earlier sequential transitions but
rejects resolution. The dedicated resolution RPC locks and verifies in-progress
status, then updates status and inserts the required public message atomically.
The observation trigger records exactly one resolved event. Map and Urgent
Operations inspectors open full details for resolution; no message-less browser
resolution path remains. Historical missing messages are never invented.
No reopening, dispatch or attendance claim is introduced.

Citizen detail alone polls every 30 seconds while visible, with one request in
flight, a 10-second abort deadline, 60/120-second error backoff, manual refresh,
identity isolation and cleanup on close or account change. Authorization denial
stops polling; reopening after restoring access creates a new watcher.

Local verification:

```cmd
node tests/accountability-migration-check.mjs
node --test tests/accountability.test.js
node tests/accountability-render-check.mjs
npm test
npm --prefix server/mcp test
npm run build
git diff --check
```

The SQL fixture uses the existing optional PGlite review runtime; it never reads
or writes production data. After an approved deployment, manually verify a new
photo report's Reported event, every allowed transition, public update visibility,
assignment approval loss, atomic resolution, a legacy report's history gap, and
other-account denial. Use existing honest data; do not fabricate history.
