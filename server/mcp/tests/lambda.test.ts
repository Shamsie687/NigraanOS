import test from "node:test";
import assert from "node:assert/strict";
import { createLambdaHandler, productionConfig } from "../src/lambda.js";
import { MemoryStore } from "../src/state.js";
import { fixtures, upstream } from "./helpers.js";
import { names } from "../src/schemas.js";
function event(
  path: string,
  method: string,
  body?: object,
  extra: Record<string, string> = {},
) {
  return {
    version: "2.0",
    rawPath: path,
    rawQueryString: "",
    headers: { host: "mcp.example", ...extra },
    requestContext: {
      http: { method, sourceIp: "192.0.2.1" },
      requestId: "private-request-id",
    },
    body: body ? JSON.stringify(body) : "",
    isBase64Encoded: false,
  };
}
function setup() {
  const f = fixtures(),
    store = new MemoryStore();
  const config = {
    origin: "https://mcp.example",
    consentUrl: "https://frontend.example/",
    clientId: "client",
    clientName: "Test",
    redirectUri: "https://client.example/callback",
  };
  const logs: unknown[] = [];
  return {
    f,
    store,
    logs,
    invoke: createLambdaHandler(config, f.factory, store, (d) => logs.push(d)),
  };
}
test("Lambda HTTP API v2 routes discovery and rejects foreign Origin/Host and missing token", async () => {
  const s = setup();
  const meta = (await s.invoke(
    event("/.well-known/oauth-authorization-server", "GET"),
  )) as any;
  assert.equal(meta.statusCode, 200);
  assert.equal(JSON.parse(meta.body).issuer, "https://mcp.example");
  assert.equal(
    ((await s.invoke(event("/mcp", "POST"))) as any).statusCode,
    401,
  );
  assert.equal(
    (
      (await s.invoke(
        event("/mcp", "POST", {}, { origin: "https://foreign.example" }),
      )) as any
    ).statusCode,
    403,
  );
  assert.equal(
    (
      (await s.invoke(
        event("/mcp", "POST", {}, { host: "foreign.example" }),
      )) as any
    ).statusCode,
    403,
  );
  assert.equal(((await s.invoke({ version: "1.0" })) as any).statusCode, 400);
});
test("Lambda preserves protocol 2025-11-25, five tools, RLS caller and privacy projection", async () => {
  const s = setup(),
    token = "opaque-token", upstreamToken = upstream();
  await s.store.putGrant(token, {
    userId: "owner",
    clientId: "client",
    grantId: "grant",
    upstream: upstreamToken,
    expiresAt: Date.now() + 600000,
    resource: "https://mcp.example/mcp",
    scope: "nigraan:read",
  });
  const headers = {
    authorization: "Bearer " + token,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-11-25",
  };
  const call = async (method: string, params: object = {}) => {
    const res = (await s.invoke(
      event("/mcp", "POST", { jsonrpc: "2.0", id: 1, method, params }, headers),
    )) as any;
    assert.equal(res.statusCode, 200);
    return JSON.parse(res.body);
  };
  assert.equal(
    (
      await call("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      })
    ).result.protocolVersion,
    "2025-11-25",
  );
  assert.deepEqual(
    (await call("tools/list")).result.tools.map((t: any) => t.name),
    names,
  );
  const result = await call("tools/call", {
    name: "get_city_status",
    arguments: {},
  });
  assert.ok(!result.result.isError);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_TITLE"));
  assert.ok(s.f.state.seenTokens.every((t) => t === upstreamToken));
  assert.ok(!JSON.stringify(s.logs).includes(token));
  await s.store.revokeGrant("grant");
  assert.equal(
    ((await s.invoke(event("/mcp", "POST", {}, headers))) as any).statusCode,
    401,
  );
});
test("Lambda CORS keeps all three browser origins and preflight headers", async () => {
  const s = setup();
  for (const origin of [
    "https://nigraanos.netlify.app",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ]) {
    const res = (await s.invoke(
      event("/mcp", "OPTIONS", undefined, { origin }),
    )) as any;
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers["access-control-allow-origin"], origin);
  }
});
test("production config rejects privileged keys, HTTP callbacks and missing distributed configuration", () => {
  const env = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_test",
    MCP_API_ID: "abc123",
    AWS_REGION: "us-east-1",
    MCP_STATE_TABLE: "table",
    MCP_KMS_KEY_ID: "key",
    MCP_CONSENT_URL: "https://nigraanos.netlify.app/",
    MCP_REDIRECT_URI: "https://client.example/callback",
    MCP_CLIENT_ID: "client",
    MCP_CLIENT_NAME: "Test",
  };
  assert.equal(
    productionConfig(env).origin,
    "https://abc123.execute-api.us-east-1.amazonaws.com",
  );
  assert.throws(() =>
    productionConfig({ ...env, SUPABASE_ANON_KEY: "sb_secret_test" }),
  );
  assert.throws(() =>
    productionConfig({
      ...env,
      MCP_REDIRECT_URI: "http://client.example/callback",
    }),
  );
  assert.throws(() => productionConfig({ ...env, MCP_STATE_TABLE: "" }));
});
