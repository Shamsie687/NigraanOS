import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import { harness, grant, rpc, call, row } from "./helpers.js";
import { names } from "../src/schemas.js";
import { validateOutput } from "../src/tools.js";
test("pinned official SDK supports required protocol exactly", () => {
  assert.equal(LATEST_PROTOCOL_VERSION, "2025-11-25");
  assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes("2025-11-25"));
});
test("real Streamable HTTP SDK client initializes, lists five tools, calls them and closes", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  const client = new Client({ name: "test", version: "1" });
  const transport = new StreamableHTTPClientTransport(
    new URL(h.origin + "/mcp"),
    { requestInit: { headers: { Authorization: "Bearer " + g.access } } },
  );
  await client.connect(transport);
  assert.equal(transport.sessionId, undefined);
  const list = await client.listTools();
  assert.deepEqual(
    list.tools.map((x) => x.name),
    names,
  );
  for (const tool of list.tools) {
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.annotations?.idempotentHint, true);
  }
  const status = await client.callTool({
    name: "get_city_status",
    arguments: {},
  });
  assert.equal(status.isError, undefined);
  const data = status.structuredContent as Record<string, any>;
  assert.equal(data.facts.submitted, 2);
  assert.equal(data.consistency, "collected_reads");
  assert.ok(data.context);
  const detail = await client.callTool({
    name: "get_incident_details",
    arguments: { context: data.context, ref: "I1" },
  });
  assert.equal((detail.structuredContent as any).incidents.length, 1);
  for (const name of [
    "get_urgent_incidents",
    "get_city_conditions",
    "get_incident_activity",
  ])
    assert.equal(
      (await client.callTool({ name, arguments: {} })).isError,
      undefined,
    );
  await client.close();
  assert.ok(h.state.seenTokens.every((token) => token === g.token));
});
test("initialize and initialized notification do not consume tool budget", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  const init = await rpc(h.origin, g.access, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  });
  assert.equal(init.res.status, 200);
  assert.equal(init.data.result.protocolVersion, "2025-11-25");
  const n = await fetch(h.origin + "/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + g.access,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });
  assert.equal(n.status, 202);
  for (let i = 0; i < 30; i++)
    assert.equal(
      (await rpc(h.origin, g.access, call("get_city_status"))).res.status,
      200,
    );
  assert.equal(
    (await rpc(h.origin, g.access, call("get_city_status"))).res.status,
    429,
  );
});
test("malformed JSON-RPC and unsupported method/version fail safely", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  assert.equal((await rpc(h.origin, g.access, "{")).res.status, 400);
  const malformed = await rpc(h.origin, g.access, {
    jsonrpc: "bad",
    id: 1,
    method: "tools/list",
  });
  assert.ok(malformed.res.status >= 400 || malformed.data.error);
  const unknown = await rpc(h.origin, g.access, {
    jsonrpc: "2.0",
    id: 1,
    method: "unsupported",
  });
  assert.equal(unknown.data.error.code, -32601);
  const negotiated = await rpc(h.origin, g.access, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2099-01-01",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  });
  assert.equal(negotiated.data.result.protocolVersion, "2025-11-25");
  assert.equal(
    (
      await rpc(
        h.origin,
        g.access,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { "MCP-Protocol-Version": "2026-07-28" },
      )
    ).res.status,
    400,
  );
});
test("unknown tools, arbitrary UUID, extra keys and missing context are refused", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  const unknown = await rpc(h.origin, g.access, call("navigate_to_incident"));
  assert.equal(unknown.data.error.code, -32602);
  for (const args of [
    { ref: "I1" },
    { context: "x", ref: "I1" },
    { incidentId: row(1).id },
    { context: "a".repeat(43), ref: row(1).id },
    { unexpected: 1 },
  ]) {
    const result = await rpc(
      h.origin,
      g.access,
      call("get_incident_details", args),
    );
    assert.equal(result.data.result.isError, true);
    assert.equal(
      JSON.parse(result.data.result.content[0].text).error.code,
      "invalid_input",
    );
    assert.ok(!JSON.stringify(result.data).includes(row(1).id));
  }
});
test("strict output schema refuses arbitrary fields, values and excessive result cards", () => {
  for (const data of [
    { kind: "FACT", title: "PRIVATE" },
    { kind: "CONTEXT", context: { city: "Other" } },
    { kind: "FACT", incidents: Array(9).fill({}) },
  ])
    assert.throws(
      () => validateOutput("get_city_status", data),
      /Authorized read unavailable/,
    );
});
test("legacy batch requests cannot bypass per-user tool admission", async (t) => {
  const h = await harness(t),
    g = await grant(h),
    before = h.state.pageCalls;
  const r = await rpc(h.origin, g.access, [
    call("get_city_status"),
    call("get_urgent_incidents"),
  ]);
  assert.equal(r.res.status, 400);
  assert.equal(r.data.error.code, -32600);
  assert.equal(h.state.pageCalls, before);
});
test("all tool outputs and diagnostics omit fixture private data", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  h.state.events = [
    {
      id: row(99).id,
      incident_id: row(1).id,
      kind: "update",
      published_at: new Date(Date.now() - 1000).toISOString(),
    },
  ];
  for (const name of names.filter((n) => n !== "get_incident_details")) {
    const result = await rpc(h.origin, g.access, call(name));
    const text = JSON.stringify(result.data);
    for (const forbidden of [
      "PRIVATE_",
      row(1).id,
      row(99).id,
      "24.123456",
      g.token,
      g.access,
      "title",
      "description",
      "transcript",
      "storage",
    ])
      assert.ok(!text.includes(forbidden), forbidden);
  }
  assert.ok(h.logs.length >= 4);
  for (const log of h.logs) {
    assert.deepEqual(
      Object.keys(log).sort(),
      ["code", "durationMs", "requestId", "stage", "status", "tool"].sort(),
    );
    assert.ok(!/[0-9a-f]{8}-[0-9a-f-]{27}/i.test(JSON.stringify(log)));
    assert.ok(!JSON.stringify(log).includes("PRIVATE"));
  }
});
test("auth and quota are distinct HTTP errors; revocation between reads suppresses result", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  assert.equal(
    (await rpc(h.origin, "not-a-grant", call("get_city_status"))).res.status,
    401,
  );
  const before = h.state.authorizationCalls;
  h.state.revokeAt = before + 3;
  const result = await rpc(h.origin, g.access, call("get_city_status"));
  assert.equal(result.res.status, 403);
  assert.ok(!result.data.result);
  assert.equal(
    (await rpc(h.origin, g.access, call("get_city_status"))).res.status,
    401,
  );
});
test("row removal and lower PostgREST page cap are handled without guessed totals", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  h.state.maxPage = 1;
  const status = await rpc(h.origin, g.access, call("get_city_status"));
  assert.equal(status.data.result.structuredContent.facts.submitted, 2);
  assert.equal(h.state.pageCalls, 3);
  h.state.removed = true;
  const r = await rpc(
    h.origin,
    g.access,
    call("get_incident_details", {
      context: status.data.result.structuredContent.context,
      ref: "I1",
    }),
  );
  assert.equal(
    JSON.parse(r.data.result.content[0].text).error.code,
    "incident_unavailable",
  );
});
test("urgent logic reuses existing priority ordering and honest activity failure", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  h.state.rows = [
    row(1, { priority: "high" }),
    row(2, { priority: "critical" }),
    row(3, { status: "resolved", priority: "critical" }),
  ];
  h.state.activityError = true;
  const r = (await rpc(h.origin, g.access, call("get_urgent_incidents"))).data
    .result.structuredContent;
  assert.equal(r.completeness, "partial");
  assert.equal(r.facts.recentlyCitizenUpdated, null);
  assert.equal(r.facts.recordedCritical, 1);
  assert.equal(r.incidents[0].priority, "critical");
  assert.ok(r.warnings.includes("recent_activity_unavailable"));
});
test("card/activity output bounded at eight; context-only projection retains modeled provenance", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  h.state.rows = Array.from({ length: 20 }, (_, n) => row(n + 1));
  h.state.events = h.state.rows.map((r, n) => ({
    id: row(n + 100).id,
    incident_id: r.id,
    kind: "update",
    published_at: new Date(Date.now() - 1000 - n).toISOString(),
  }));
  const r = (await rpc(h.origin, g.access, call("get_incident_activity"))).data
    .result.structuredContent;
  assert.equal(r.incidents.length, 8);
  assert.equal(r.activity.length, 8);
  assert.equal(r.omitted, 12);
  assert.equal(r.facts.publishedUpdates, 20);
  const context = (await rpc(h.origin, g.access, call("get_city_conditions")))
    .data.result.structuredContent;
  assert.equal(context.kind, "CONTEXT");
  assert.equal(context.context.air.status, "stale");
  assert.ok(context.context.disclaimer.includes("does not verify"));
});
test("incident workload cap fails instead of returning truncated exact totals", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  h.state.rows = Array.from({ length: 5001 }, (_, n) => row(n + 1));
  const r = await rpc(h.origin, g.access, call("get_city_status"));
  assert.equal(
    JSON.parse(r.data.result.content[0].text).error.code,
    "read_budget_exceeded",
  );
  assert.ok(!r.data.result.structuredContent);
});
test("activity workload cap and parent batch bound enforced", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  h.state.rows = Array.from({ length: 201 }, (_, n) => row(n + 1));
  h.state.events = Array.from({ length: 10001 }, (_, n) => ({
    id: row(n + 1000).id,
    incident_id: row(1).id,
    kind: "update" as const,
    published_at: new Date(Date.now() - 1000).toISOString(),
  }));
  const r = await rpc(h.origin, g.access, call("get_incident_activity"));
  assert.equal(
    JSON.parse(r.data.result.content[0].text).error.code,
    "read_budget_exceeded",
  );
  assert.ok(h.state.batchCalls.every((n) => n <= 200));
});
test("CORS, host, query-token, cookie-only auth, body limit, discovery and GET policy", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  assert.equal(
    (
      await rpc(h.origin, g.access, call("get_city_status"), {
        Origin: "https://evil.example",
      })
    ).res.status,
    403,
  );
  const allowed = await rpc(h.origin, g.access, call("get_city_status"), {
    Origin: "https://nigraanos.netlify.app",
  });
  assert.equal(
    allowed.res.headers.get("access-control-allow-origin"),
    "https://nigraanos.netlify.app",
  );
  assert.equal(
    (await fetch(h.origin + "/mcp?access_token=" + g.access)).status,
    400,
  );
  assert.equal(
    (
      await fetch(h.origin + "/mcp", {
        headers: { Cookie: "token=" + g.access },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(h.origin + "/mcp", {
        headers: { Authorization: "Bearer " + g.access },
      })
    ).status,
    405,
  );
  const tooBig = await rpc(h.origin, g.access, " ".repeat(16385));
  assert.equal(tooBig.res.status, 413);
  const metadata = await fetch(
    h.origin + "/.well-known/oauth-protected-resource/mcp",
  ).then((r) => r.json());
  assert.equal(metadata.resource, h.origin + "/mcp");
  assert.equal((await fetch(h.origin + "/get_city_status")).status, 404);
});
