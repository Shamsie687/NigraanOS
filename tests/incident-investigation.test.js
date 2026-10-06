import test from "node:test";
import assert from "node:assert/strict";
import {
  createInvestigationController,
  validateInvestigation,
  INVESTIGATION_DISCLAIMER,
} from "../src/services/incidentInvestigation.js";
import { AgentError } from "../src/services/agentTools.js";
import { planAgentMessage } from "../src/utils/agentConversation.js";
const initial = Date.parse("2026-10-07T00:00:00Z");
const row = (ref, n = 0) => ({
  ref,
  category: "traffic",
  priority: n ? "normal" : "high",
  status: "reported",
  ageHours: 18,
  id: "PRIVATE_UUID",
  latitude: 24.12345,
  title: "PRIVATE_TITLE",
  transcript: "PRIVATE_TRANSCRIPT",
});
function fixture({
  count = 3,
  fail = {},
  changed = false,
  onCall,
  activity = true,
} = {}) {
  let version = 0,
    time = initial,
    running = 0,
    max = 0,
    expired = false,
    timer;
  const calls = [],
    tools = {
      referenceVersion: () => version,
      assertReference(ref, v) {
        if (expired || v !== version)
          throw new AgentError("stale_reference", "PRIVATE_ERROR");
      },
      async run(name, input, signal) {
        running++;
        max = Math.max(max, running);
        calls.push({ name, input });
        try {
          await Promise.resolve();
          if (onCall)
            await onCall(name, input, signal, {
              replace: () => version++,
              advance: (v) => (time += v),
              expire: () => (expired = true),
              deadline: () => timer(),
            });
          if (fail[name] && (!fail[name].ref || fail[name].ref === input.ref))
            throw new AgentError(fail[name].code || "read", "PRIVATE_ERROR");
          const base = {
            snapshotAt: time,
            notice: "PRIVATE_NOTICE",
            omitted: 0,
          };
          if (name === "get_city_status") {
            version++;
            return {
              ...base,
              incidents: [row("I1")],
              facts: {
                submitted: 5,
                unresolved: 4,
                resolved: 1,
                awaitingAcknowledgement: 2,
                private: "PRIVATE_SECRET",
              },
            };
          }
          if (name === "get_urgent_incidents") {
            version++;
            return {
              ...base,
              incidents: Array.from({ length: count }, (_, n) =>
                row("I" + (n + 1), n),
              ),
              omitted: 2,
            };
          }
          if (name === "get_incident_details")
            return {
              ...base,
              incidents: [
                {
                  ...row(input.ref),
                  ...(changed
                    ? { priority: "normal", status: "in_progress" }
                    : {}),
                },
              ],
            };
          if (name === "get_incident_activity")
            return {
              ...base,
              incidents: [row(input.ref)],
              facts: { publishedUpdates: activity ? 1 : 0, publishedEdits: 0 },
              activity: activity
                ? [
                    {
                      ref: input.ref,
                      kind: "update",
                      publishedAt: new Date(time - 1000).toISOString(),
                      body: "PRIVATE_BODY",
                    },
                  ]
                : [],
            };
          if (name === "get_city_conditions")
            return {
              ...base,
              context: {
                weather: {
                  status: "current",
                  validAt: new Date(time).toISOString(),
                  fetchedAt: new Date(time).toISOString(),
                  temperatureC: 25,
                  precipitationMm: 0,
                  intervalSeconds: 900,
                  source: "PRIVATE_URL",
                },
                air: {
                  status: "unavailable",
                  validAt: null,
                  fetchedAt: null,
                  aqi: null,
                },
                disclaimer: "PRIVATE_PROSE",
              },
            };
          throw Error("Unexpected or mutation tool");
        } finally {
          running--;
        }
      },
    };
  const controller = createInvestigationController({
    tools,
    now: () => time,
    setTimer: (fn) => {
      timer = fn;
      return 1;
    },
    clearTimer: () => {},
  });
  return { controller, calls, tools, max: () => max };
}
test("exact sequential seven-call workflow uses at most first two server-ordered candidates", async () => {
  const f = fixture(),
    r = await f.controller.run();
  assert.deepEqual(
    f.calls.map((c) => c.name),
    [
      "get_city_status",
      "get_urgent_incidents",
      "get_incident_details",
      "get_incident_details",
      "get_incident_activity",
      "get_incident_activity",
      "get_city_conditions",
    ],
  );
  assert.equal(f.max(), 1);
  assert.equal(f.calls.length, 7);
  assert.equal(r.coverage.inspected, 2);
  assert.equal(r.coverage.candidatesReturned, 3);
  assert.equal(r.coverage.omitted, 3);
  assert.deepEqual(
    f.calls.filter((c) => c.input.ref).map((c) => c.input.ref),
    ["I1", "I2", "I1", "I2"],
  );
  assert.ok(
    f.calls
      .filter((c) => c.input.ref)
      .every((c) => c.input.referenceVersion === 2),
  );
  assert.ok(!r.facts.some((f) => f.ref === "I3"));
  assert.equal(r.status, "complete");
});
for (const count of [0, 1, 2, 8])
  test(`bounded candidate count ${count}`, async () => {
    const f = fixture({ count }),
      r = await f.controller.run();
    assert.equal(r.coverage.inspected, Math.min(2, count));
    assert.equal(f.calls.length, 3 + Math.min(2, count) * 2);
    assert.equal(
      f.calls.filter((c) => c.name === "get_incident_details").length,
      Math.min(2, count),
    );
  });
test("city status failure allows urgent path and retains no city aliases/facts", async () => {
  const f = fixture({ fail: { get_city_status: {} } }),
    r = await f.controller.run();
  assert.equal(r.status, "partial");
  assert.equal(r.coverage.inspected, 2);
  assert.ok(!r.facts.some((f) => f.field === "submitted"));
  assert.equal(f.calls.length, 7);
});
test("urgent failure stops all candidate-dependent reads", async () => {
  const f = fixture({ fail: { get_urgent_incidents: {} } }),
    r = await f.controller.run();
  assert.equal(r.coverage.inspected, 0);
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["get_city_status", "get_urgent_incidents", "get_city_conditions"],
  );
  assert.equal(r.reviewReasons.length, 0);
});
test("detail partial failure preserves candidate observations without fabricating detail", async () => {
  const f = fixture({ fail: { get_incident_details: { ref: "I1" } } }),
    r = await f.controller.run();
  assert.equal(r.coverage.inspected, 1);
  assert.equal(r.status, "partial");
  assert.equal(r.sources.find((s) => s.id === "S3").status, "unavailable");
  assert.ok(!r.facts.some((f) => f.sourceId === "S3"));
});
test("conditions failure omits modeled context", async () => {
  const r = await fixture({
    fail: { get_city_conditions: {} },
  }).controller.run();
  assert.equal(r.modeledContext, null);
  assert.equal(r.status, "partial");
});
test("optional activity failure omits update reasons and does not retry", async () => {
  const f = fixture({ fail: { get_incident_activity: {} } }),
    r = await f.controller.run();
  assert.ok(!r.reviewReasons.some((r) => r.rule === "recent_published_update"));
  assert.equal(f.calls.length, 7);
});
for (const code of ["access", "connection"])
  test(`authorization ${code} mid-investigation returns no accumulated facts`, async () => {
    const f = fixture({ fail: { get_incident_details: { code } } });
    await assert.rejects(
      f.controller.run(),
      (e) => e.code === code && !e.message.includes("PRIVATE"),
    );
    assert.equal(f.controller.referenceVersion(), null);
    assert.equal(f.calls.length, 3);
  });
for (const mode of ["expire", "replace"])
  test(`reference ${mode} stops dependent reads and requires fresh investigation`, async () => {
    const f = fixture({
      onCall: (name, _i, _s, ops) => {
        if (name === "get_incident_details") ops[mode]();
      },
    });
    await assert.rejects(
      f.controller.run(),
      (e) => e.code === "stale_reference",
    );
    assert.equal(f.calls.length, 3);
    assert.equal(f.controller.referenceVersion(), null);
  });
test("replacement on final conditions read suppresses stale final results", async () => {
  const f = fixture({
    onCall: (name, _i, _s, ops) => {
      if (name === "get_city_conditions") ops.replace();
    },
  });
  await assert.rejects(f.controller.run(), (e) => e.code === "stale_reference");
});
test("one active investigation; cancellation suppresses ignored-signal late results", async () => {
  let release, started;
  const ready = new Promise((r) => (started = r));
  const f = fixture({
    onCall: async (name) => {
      if (name === "get_city_status") {
        started();
        await new Promise((r) => (release = r));
      }
    },
  });
  const promise = f.controller.run();
  await ready;
  await assert.rejects(f.controller.run(), (e) => e.code === "busy");
  f.controller.cancel();
  await assert.rejects(promise, (e) => e.code === "cancelled");
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.length, 1);
});
for (const event of ["account_change", "signout"])
  test(`${event} via hook abort signal cancels and suppresses late results`, async () => {
    let release, started;
    const ready = new Promise((r) => (started = r)),
      signal = new AbortController();
    const f = fixture({
      onCall: async () => {
        started();
        await new Promise((r) => (release = r));
      },
    });
    const promise = f.controller.run({ signal: signal.signal });
    await ready;
    signal.abort();
    await assert.rejects(promise, (e) => e.code === "cancelled");
    release();
    assert.equal(f.calls.length, 1);
  });
test("deadline returns bounded partial facts and suppresses late transport results", async () => {
  let release;
  const f = fixture({
    onCall: async (name, _i, _s, ops) => {
      if (name === "get_incident_details") {
        ops.deadline();
        await new Promise((r) => (release = r));
      }
    },
  });
  const r = await f.controller.run();
  assert.equal(r.status, "partial");
  assert.ok(r.unavailableSections.some((s) => s.code === "deadline"));
  assert.equal(r.coverage.inspected, 0);
  release();
});
test("optional reads skipped with insufficient remaining time", async () => {
  const f = fixture({
      onCall: (name, _i, _s, ops) => {
        if (name === "get_incident_details") ops.advance(23000);
      },
    }),
    r = await f.controller.run();
  assert.equal(f.calls.length, 4);
  assert.equal(r.modeledContext, null);
  assert.equal(
    r.unavailableSections.filter((s) => s.code === "skipped").length,
    3,
  );
});
test("privacy allowlist, report-age units and modeled disclaimer remain deterministic", async () => {
  const r = await fixture().controller.run(),
    serialized = JSON.stringify(r);
  assert.ok(!serialized.includes("PRIVATE"));
  assert.ok(!serialized.includes("referenceVersion"));
  assert.ok(!serialized.includes("24.12345"));
  assert.ok(
    r.facts
      .filter((f) => f.field === "ageHours")
      .every((f) => f.unit === "hours_since_report_start"),
  );
  assert.ok(!serialized.includes("unresolved duration"));
  assert.equal(r.modeledContext.disclaimer, INVESTIGATION_DISCLAIMER);
  assert.ok(
    r.reviewReasons.every(
      (r) => !r.rule.includes("weather") && !r.rule.includes("severity"),
    ),
  );
});
test("latest detail observation supersedes candidate status/priority for review reasons", async () => {
  const r = await fixture({ changed: true, activity: false }).controller.run();
  assert.ok(r.facts.some((f) => f.field === "priority" && f.value === "high"));
  assert.ok(
    r.facts.some((f) => f.field === "priority" && f.value === "normal"),
  );
  assert.equal(r.reviewReasons.length, 0);
  assert.equal(r.consistency, "collected_reads_not_atomic");
  assert.ok(
    r.sources.filter((s) => s.status === "success").every((s) => s.collectedAt),
  );
});
test("reason validation requires successful matching facts", async () => {
  const r = await fixture().controller.run();
  r.reviewReasons[0].factIds = ["UNKNOWN"];
  assert.throws(() => validateInvestigation(r));
});
test("investigation intents are separate from unchanged direct requests and blocked actions", () => {
  for (const message of [
    "What needs attention right now and why?",
    "Investigate what needs attention.",
    "Which incidents should I review and why?",
  ])
    assert.equal(planAgentMessage(message, {}).investigation, true);
  for (const [message, tool] of [
    ["What needs attention right now?", "get_urgent_incidents"],
    ["City status", "get_city_status"],
    ["Current city conditions", "get_city_conditions"],
    ["Recent Citizen activity", "get_incident_activity"],
    ["Tell me more about I1", "get_incident_details"],
    ["Open Incidents", "navigate_to_view"],
  ])
    assert.equal(planAgentMessage(message, {}).tool, tool);
  assert.ok(
    planAgentMessage("Dispatch crews and investigate attention", {}).message,
  );
});

test("deadline cannot return accumulated facts after concurrent authorization loss", async () => {
  const f = fixture({
    onCall: (name, _i, _s, ops) => {
      if (name === "get_incident_details") {
        f.tools.assertSession = () => {
          throw new AgentError("access", "PRIVATE");
        };
        ops.deadline();
      }
    },
  });
  await assert.rejects(f.controller.run(), (e) => e.code === "access");
  assert.equal(f.controller.referenceVersion(), null);
});

test("validated result rejects extra private fields and invented reason values", async () => {
  const result = await fixture().controller.run();
  result.facts[0].private = "PRIVATE";
  assert.throws(() => validateInvestigation(result));
  delete result.facts[0].private;
  result.reviewReasons[0].rule = "probably_flooding";
  assert.throws(() => validateInvestigation(result));
});

test('progress reports actual reads, selected aliases and real preparation only',async()=>{
 const f=fixture(),events=[];await f.controller.run({onProgress:(stage,ref)=>events.push({stage,ref})});
 assert.deepEqual(events.slice(0,-1).map(e=>e.stage),f.calls.map(c=>c.name));assert.equal(events.at(-1).stage,'prepare_briefing');
 assert.deepEqual(events.filter(e=>e.stage==='get_incident_details').map(e=>e.ref),['I1','I2']);
 const skipped=fixture({onCall:(name,_i,_s,ops)=>{if(name==='get_incident_details')ops.advance(23000);}}),short=[];await skipped.controller.run({onProgress:s=>short.push(s)});assert.ok(!short.includes('get_city_conditions'));assert.ok(!short.includes('get_incident_activity'));
});
