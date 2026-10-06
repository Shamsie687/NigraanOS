import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  createSimulatorSession,
  simulatorConfig,
  SIMULATOR_CLIENT_ID,
  MCP_TOOLS,
  OAUTH_STORAGE_KEY,
  verifyTools,
  projectRemoteResult,
} from "../src/services/mcpSimulator.js";
const endpoint = "https://mcp.example",
  origin = "https://nigraanos.netlify.app";
function fixture() {
  let time = Date.now(),
    exchangeFailed = false,
    connectFailed = false,
    read, readError;
  const map = new Map(),
    sent = [],
    calls = [];
  const storage = {
    getItem: (k) => map.get(k) || null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
  let closed = 0;
  const session = createSimulatorSession({
    storage,
    now: () => time,
    fetcher: async (url, options) => {
      sent.push({ url, options });
      if (url.endsWith("/oauth/token"))
        return new Response(
          JSON.stringify({
            access_token: "t".repeat(43),
            token_type: "Bearer",
            scope: "nigraan:read",
            expires_in: 600,
          }),
          { status: exchangeFailed ? 400 : 200 },
        );
      return new Response(null, { status: 204 });
    },
    connect: async (_endpoint, token) => {
      assert.equal(token, "t".repeat(43));
      if (connectFailed) throw new Error("PRIVATE_ERROR");
      return {
        async call(name, args) {
          calls.push({ name, args });
          if(readError)return {isError:true,content:[{type:'text',text:JSON.stringify({error:{code:readError,message:'PRIVATE_PROVIDER_MESSAGE'}})}]};
          return {
            structuredContent: read || {
              kind: "FACT",
              collectedAt: new Date(time).toISOString(),
              context: "c".repeat(43),
              incidents: [
                {
                  ref: "I1",
                  category: "traffic",
                  status: "reported",
                  priority: "high",
                  ageHours: 18,
                },
              ],
              omitted: 0,
              completeness: "complete",
              facts: {
                submitted: 1,
                unresolved: 1,
                resolved: 0,
                awaitingAcknowledgement: 1,
              },
            },
          };
        },
        async close() {
          closed++;
        },
      };
    },
  });
  const config = simulatorConfig(endpoint, origin);
  async function begin() {
    return new URL(await session.begin(config, "account"));
  }
  const callback = (url, query = {}) =>
    config.redirectUri +
    "?" +
    new URLSearchParams({
      state: url.searchParams.get("state"),
      code: "a".repeat(43),
      ...query,
    });
  return {
    session,
    config,
    begin,
    callback,
    storage,
    map,
    sent,
    calls,
    setRead: (v) => (read = v),
    setReadError: v => (readError = v),
    advance: (v) => (time += v),
    exchangeFail: () => (exchangeFailed = true),
    connectFail: () => (connectFailed = true),
    closed: () => closed,
  };
}
test("simulator configuration is explicit, origin-bound and has a real fragment-free callback", () => {
  assert.equal(
    simulatorConfig(endpoint, origin).redirectUri,
    "https://nigraanos.netlify.app/agent-callback",
  );
  assert.equal(
    simulatorConfig("http://127.0.0.1:8787", "http://localhost:5173")
      .redirectUri,
    "http://localhost:5173/agent-callback",
  );
  for (const [e, o] of [
    ["", origin],
    ["http://foreign.example", origin],
    [endpoint + "/mcp", origin],
    [endpoint, "https://foreign.example"],
  ])
    assert.throws(() => simulatorConfig(e, o));
});
test("PKCE S256/state bind exact client, callback and MCP resource; persistence is only short-lived transaction", async () => {
  const f = fixture(),
    u = await f.begin(),
    p = JSON.parse(f.storage.getItem(OAUTH_STORAGE_KEY));
  assert.equal(u.searchParams.get("client_id"), SIMULATOR_CLIENT_ID);
  assert.equal(u.searchParams.get("redirect_uri"), f.config.redirectUri);
  assert.equal(u.searchParams.get("resource"), endpoint + "/mcp");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    u.searchParams.get("code_challenge"),
    createHash("sha256").update(p.verifier).digest("base64url"),
  );
  assert.ok(p.expiresAt <= Date.now() + 120000);
  assert.ok(!Object.hasOwn(p, "token"));
  assert.ok(!Object.hasOwn(p, "upstream"));
  await f.session.disconnect();
  assert.equal(f.map.size, 0);
});
test("callback success exchanges verifier, removes transaction, connects and keeps bearer only in memory", async () => {
  const f = fixture(),
    u = await f.begin();
  await f.session.finish(f.callback(u), f.config, "account");
  assert.equal(f.session.snapshot().status, "connected");
  assert.equal(f.map.size, 0);
  assert.equal(f.sent[0].options.body.get("client_id"), SIMULATOR_CLIENT_ID);
  assert.equal(f.sent[0].options.body.get("resource"), endpoint + "/mcp");
  assert.ok(f.sent[0].options.body.get("code_verifier"));
  assert.equal(f.sent[0].options.credentials, "omit");
  assert.equal(new URL(f.sent[0].url).search, "");
  await f.session.disconnect();
});
test("state mismatch, account mismatch, duplicate state, callback fragment and expired transaction fail closed", async () => {
  for (const mode of ["state", "account", "duplicate", "fragment", "expired"]) {
    const f = fixture(),
      u = await f.begin();
    let callback = f.callback(u),
      id = "account";
    if (mode === "state") callback = f.callback(u, { state: "wrong" });
    if (mode === "account") id = "another";
    if (mode === "duplicate") callback += "&state=duplicate";
    if (mode === "fragment") callback += "#/agent-callback";
    if (mode === "expired") f.advance(120000);
    await assert.rejects(f.session.finish(callback, f.config, id));
    assert.equal(f.map.size, 0);
    assert.equal(f.sent.length, 0);
    await f.session.disconnect();
  }
});
test("callback denial clears transaction and never exchanges a token", async () => {
  const f = fixture(),
    u = await f.begin();
  await assert.rejects(
    f.session.finish(
      f.callback(u, { error: "access_denied" }),
      f.config,
      "account",
    ),
    (e) => e.code === "denied",
  );
  assert.equal(f.map.size, 0);
  assert.equal(f.sent.length, 0);
});
test("token exchange failure and SDK verification failure clear state; issued grant is revoked on connection failure", async () => {
  const f = fixture(),
    u = await f.begin();
  f.exchangeFail();
  await assert.rejects(
    f.session.finish(f.callback(u), f.config, "account"),
    (e) => e.code === "exchange",
  );
  assert.equal(f.map.size, 0);
  const g = fixture(),
    v = await g.begin();
  g.connectFail();
  await assert.rejects(g.session.finish(g.callback(v), g.config, "account"));
  assert.ok(g.sent.some((s) => s.url.endsWith("/oauth/revoke")));
  assert.equal(g.session.snapshot().status, "failed");
});
test("exact five tools required; missing, duplicate, extra, pagination and write tools fail", () => {
  const valid = { tools: MCP_TOOLS.map((name) => ({ name })) };
  verifyTools(valid);
  for (const tools of [
    valid.tools.slice(1),
    [...valid.tools, { name: "write_incident" }],
    [...valid.tools.slice(1), valid.tools[1]],
  ])
    assert.throws(() => verifyTools({ tools }));
  assert.throws(() => verifyTools({ ...valid, nextCursor: "more" }));
});
test("remote calls pass grant-bound context, stale card rejection and privacy-only projected output", async () => {
  const f = fixture(),
    u = await f.begin();
  await f.session.finish(f.callback(u), f.config, "account");
  const result = await f.session.run("get_city_status");
  assert.equal(result.facts.submitted, 1);
  const version = f.session.referenceVersion();
  assert.equal(f.session.resolveOrdinal(0), "I1");
  await f.session.run("get_incident_details", {
    ref: "I1",
    referenceVersion: version,
  });
  assert.deepEqual(f.calls[1].args, { ref: "I1", context: "c".repeat(43) });
  await f.session.run("get_city_status");
  await assert.rejects(
    f.session.run("get_incident_details", {
      ref: "I1",
      referenceVersion: version,
    }),
    (e) => e.code === "stale_reference",
  );
  f.advance(300000);
  assert.throws(() => f.session.resolveOrdinal(0));
  await f.session.disconnect();
});
test("disconnect/signout and account change clear refs, pending state and revoke memory grant", async () => {
  const f = fixture(),
    u = await f.begin();
  await f.session.finish(f.callback(u), f.config, "account");
  await f.session.run("get_city_status");
  await f.session.accountChanged("another");
  assert.equal(f.session.snapshot().status, "disconnected");
  assert.equal(f.closed(), 1);
  assert.equal(
    f.sent.at(-1).options.headers.Authorization,
    "Bearer " + "t".repeat(43),
  );
  assert.equal(f.map.size, 0);
  assert.throws(() => f.session.resolveOrdinal(0));
  const g = fixture();
  await g.begin();
  await g.session.accountChanged(undefined);
  assert.equal(g.map.size, 0);
  await g.session.disconnect();
});
test("account change during in-flight exchange prevents connection and revokes issued grant", async () => {
  const f = fixture(),
    u = await f.begin();
  const pending = f.session.finish(f.callback(u), f.config, "account");
  await f.session.accountChanged(undefined);
  await assert.rejects(pending);
  assert.equal(f.session.snapshot().status, "disconnected");
  assert.equal(f.map.size, 0);
});
test("privacy projection drops private fields and navigation stays client-only without UUID resolution", async () => {
  const f = fixture(),
    u = await f.begin();
  await f.session.finish(f.callback(u), f.config, "account");
  const privateResult = {
    kind: "FACT",
    collectedAt: new Date().toISOString(),
    incidents: [
      {
        ref: "I1",
        category: "traffic",
        status: "reported",
        priority: "high",
        ageHours: 18,
        id: "PRIVATE_UUID",
        description: "PRIVATE_PROSE",
      },
    ],
    omitted: 0,
    completeness: "complete",
    facts: {
      submitted: 1,
      unresolved: 1,
      resolved: 0,
      awaitingAcknowledgement: 1,
      secret: "PRIVATE_SECRET",
    },
  };
  assert.ok(
    !JSON.stringify(
      projectRemoteResult("get_city_status", privateResult),
    ).includes("PRIVATE_"),
  );
  await f.session.run("get_city_status");
  const views = [],
    tools = f.session.facade((v) => views.push(v));
  await tools.run("navigate_to_incident", { ref: "I1" });
  assert.deepEqual(views, ["Citizen Reports"]);
  assert.equal(f.calls.length, 1);
  await f.session.disconnect();
});
test("callback bootstrap scrubs code/state from history before app and never persists payload", async () => {
  const script = await readFile(
    new URL("../public/agent-callback-bootstrap.js", import.meta.url),
    "utf8",
  );
  let replaced;
  const window = {
    location: {
      pathname: "/agent-callback",
      href: origin + "/agent-callback?code=TEST&state=TEST",
    },
    history: { replaceState: (_s, _t, u) => (replaced = u) },
  };
  vm.runInNewContext(script, { window });
  assert.equal(replaced, "/agent-callback#/agent-callback");
  assert.ok(window.__nigraanMcpCallback.includes("code="));
  assert.ok(!script.includes("sessionStorage"));
  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  assert.ok(
    html.indexOf("agent-callback-bootstrap.js") < html.indexOf("/src/main.jsx"),
  );
});

test('remote error classification retains only safe codes; access loss clears the session',async()=>{
  for(const [remote,expected] of [['read_unavailable','read'],['rate_limited','rate_limited'],['busy','busy'],['timeout','timeout'],['stale_reference','stale_reference'],['unknown_reference','stale_reference'],['PRIVATE_CODE','read'],['invalid_token','access'],['access_denied','access']]){
    const f=fixture(),u=await f.begin();await f.session.finish(f.callback(u),f.config,'account');f.setReadError(remote);
    await assert.rejects(f.session.run('get_city_status'),e=>e.code===expected&&!e.message.includes('PRIVATE'));
    if(expected==='access')assert.equal(f.session.snapshot().status,'disconnected');
    await f.session.disconnect();
  }
});

test('facade reference guard refuses context replacement, expiry and signout',async()=>{
  const f=fixture(),u=await f.begin();await f.session.finish(f.callback(u),f.config,'account');
  const tools=f.session.facade(()=>{});await tools.run('get_city_status');const version=tools.referenceVersion();tools.assertReference('I1',version);
  await tools.run('get_city_status');assert.throws(()=>tools.assertReference('I1',version),e=>e.code==='stale_reference');
  f.advance(300000);assert.throws(()=>tools.assertReference('I1',tools.referenceVersion()),e=>e.code==='stale_reference');
  await f.session.accountChanged(undefined);assert.throws(()=>tools.assertReference('I1',tools.referenceVersion()),e=>e.code==='access');
});
