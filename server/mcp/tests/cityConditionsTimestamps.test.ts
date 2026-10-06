import test from "node:test";
import assert from "node:assert/strict";
import { runTool, validateOutput } from "../src/tools.js";
import { fixtures } from "./helpers.js";
import { MemoryStore, type Grant } from "../src/state.js";

const canonical = "2026-10-06T00:00:00.000Z";
async function read(
  weather: Record<string, unknown>,
  air: Record<string, unknown>,
) {
  const caller = fixtures().factory("fixture-token");
  caller.conditions = async () => ({ weather, air_quality: air });
  const grant: Grant = {
    userId: "owner",
    clientId: "test",
    grantId: "test",
    upstream: "fixture-token",
    expiresAt: Date.now() + 60000,
    resource: "https://mcp.example/mcp",
    scope: "nigraan:read",
  };
  const store = new MemoryStore();
  try {
    return (await runTool(
      "get_city_conditions",
      {},
      caller,
      grant,
      store,
      new AbortController().signal,
    )) as any;
  } finally {
    store.close();
  }
}
const dataset = (stamp: unknown, status = "current") => ({
  status,
  valid_at: stamp,
  fetched_at: stamp,
  temperature_c: 25,
  aqi: 55,
  precipitation: { amount_mm: 0, interval_seconds: 900 },
});
test("cached PostgreSQL offset timestamps become canonical UTC without weakening schema", async () => {
  const result = await read(
    dataset("2026-10-06T00:00:00+00:00"),
    dataset("2026-10-06T05:00:00+05:00", "stale"),
  );
  for (const part of [result.context.weather, result.context.air]) {
    assert.equal(part.validAt, canonical);
    assert.equal(part.fetchedAt, canonical);
  }
  assert.equal(result.context.air.status, "stale");
  result.context.weather.fetchedAt = "2026-10-06T00:00:00+00:00";
  assert.throws(() => validateOutput("get_city_conditions", result), {
    code: "read_unavailable",
    status: 503,
  });
});
test("canonical Z timestamps preserve their instant", async () => {
  const result = await read(dataset(canonical), dataset(canonical));
  assert.equal(result.context.weather.validAt, canonical);
  assert.equal(result.context.air.fetchedAt, canonical);
});
test("mixed fresh and cached weather/AQ timestamps normalize independently", async () => {
  for (const [weather, air] of [
    [canonical, "2026-10-06T00:00:00+00:00"],
    ["2026-10-06T00:00:00+00:00", canonical],
  ]) {
    const result = await read(dataset(weather), dataset(air, "stale"));
    assert.equal(result.context.weather.fetchedAt, canonical);
    assert.equal(result.context.air.fetchedAt, canonical);
    assert.equal(result.context.air.status, "stale");
  }
});
test("unavailable datasets remain legitimate nullable context", async () => {
  const result = await read(
    { status: "unavailable" },
    { status: "unavailable" },
  );
  for (const part of [result.context.weather, result.context.air]) {
    assert.equal(part.status, "unavailable");
    assert.equal(part.validAt, null);
    assert.equal(part.fetchedAt, null);
  }
  assert.equal(result.context.weather.temperatureC, null);
  assert.equal(result.context.air.aqi, null);
});
test("invalid timestamps retain existing null projection rather than inventing dates", async () => {
  const result = await read(dataset("not-a-timestamp"), dataset(null, "stale"));
  assert.equal(result.context.weather.validAt, null);
  assert.equal(result.context.weather.fetchedAt, null);
  assert.equal(result.context.air.validAt, null);
  assert.equal(result.context.air.status, "stale");
});
