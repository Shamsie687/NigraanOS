import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { harness, grant, rpc, call, upstream, row } from "./helpers.js";
import { clientFlow } from "../src/clientFlow.js";
import { MemoryStore, opaque, type Grant } from "../src/state.js";
import { Delegation } from "../src/oauth.js";
import { SafeError } from "../src/errors.js";
import { bufferResponse, withDeadline } from "../src/handler.js";
import { createServer } from "node:http";
import { once } from "node:events";
import type { Response } from "express";
const rejected = (code: string) => (e: unknown) =>
  e instanceof SafeError && e.code === code;
async function pending(h: Awaited<ReturnType<typeof harness>>) {
  const flow = clientFlow(h.config);
  const url = await h.delegation.start(
    Object.fromEntries(new URL(flow.authorizeUrl).searchParams),
  );
  const transaction = new URLSearchParams(new URL(url).hash.split("?")[1]).get(
    "transaction",
  )!;
  const details = await h.delegation.inspect(transaction, upstream());
  return { flow, transaction, details };
}
test("PKCE consent produces separate opaque token, no refresh/upstream/client identity fields", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  assert.notEqual(g.access, g.token);
  assert.match(g.access, /^[A-Za-z0-9_-]{43}$/);
  const record = await h.store.getGrant(g.access);
  assert.equal(record?.upstream, g.token);
  assert.ok(record!.expiresAt <= Date.now() + 600000);
  assert.equal(await h.store.getCode(g.body.code), undefined);
});
test("wrong PKCE verifier consumes code to prevent brute force; new authorization succeeds", async (t) => {
  const h = await harness(t),
    p = await pending(h),
    decision = await h.delegation.decide(
      {
        transaction: p.transaction,
        state: p.details.state,
        decision: "approve",
      },
      upstream(),
    ),
    body = p.flow.consume(decision.redirect);
  await assert.rejects(
    h.delegation.exchange({ ...body, code_verifier: opaque() }),
    rejected("invalid_grant"),
  );
  await assert.rejects(h.delegation.exchange(body), rejected("invalid_grant"));
  assert.ok((await grant(h)).access);
});
test("short verifier, wrong redirect, wrong resource and wrong registered client are denied", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  for (const change of [
    { code_verifier: "short" },
    { redirect_uri: "http://evil.example/callback" },
    { resource: h.origin + "/other" },
    { client_id: "unknown" },
  ])
    await assert.rejects(
      h.delegation.exchange({ ...g.body, ...change }),
      rejected("invalid_grant"),
    );
  for (const change of [
    { redirect_uri: "http://evil.example/callback" },
    { resource: h.origin + "/other" },
    { client_id: "unknown" },
    { code_challenge_method: "plain" },
    { state: "" },
  ]) {
    const input = Object.fromEntries(
      new URL(clientFlow(h.config).authorizeUrl).searchParams,
    );
    await assert.rejects(
      h.delegation.start({ ...input, ...change }),
      rejected("invalid_request"),
    );
  }
});
test("transaction state and subject are checked; explicit deny issues no code", async (t) => {
  const h = await harness(t),
    p = await pending(h);
  await assert.rejects(
    h.delegation.decide(
      { transaction: p.transaction, state: opaque(), decision: "approve" },
      upstream(),
    ),
    rejected("invalid_request"),
  );
  h.state.user = "other";
  await assert.rejects(
    h.delegation.inspect(p.transaction, upstream()),
    rejected("access_denied"),
  );
  h.state.user = "owner";
  const d = await h.delegation.decide(
    { transaction: p.transaction, state: p.details.state, decision: "deny" },
    upstream(),
  );
  assert.equal(new URL(d.redirect).searchParams.get("error"), "access_denied");
  assert.equal(new URL(d.redirect).searchParams.has("code"), false);
  assert.throws(() => p.flow.consume(d.redirect), rejected("access_denied"));
  await assert.rejects(
    h.delegation.decide(
      {
        transaction: p.transaction,
        state: p.details.state,
        decision: "approve",
      },
      upstream(),
    ),
    rejected("invalid_request"),
  );
});
test("client validates state/exact callback and consumes callback only once", () => {
  const config = {
      origin: "http://127.0.0.1:8787",
      consentUrl: "http://127.0.0.1:5173/",
      clientId: "nigraan-local",
      clientName: "test",
      redirectUri: "http://127.0.0.1:8788/callback",
    },
    flow = clientFlow(config),
    state = new URL(flow.authorizeUrl).searchParams.get("state")!;
  assert.throws(
    () => flow.consume(config.redirectUri + "?code=test&state=" + opaque()),
    rejected("invalid_grant"),
  );
  assert.throws(
    () => flow.consume("http://evil.example/callback?code=test&state=" + state),
    rejected("invalid_grant"),
  );
  assert.throws(
    () =>
      flow.consume(
        config.redirectUri + "?code=test&state=" + state + "&state=" + state,
      ),
    rejected("invalid_grant"),
  );
  const b = flow.consume(config.redirectUri + "?code=test&state=" + state);
  assert.equal(b.resource, config.origin + "/mcp");
  assert.throws(
    () => flow.consume(config.redirectUri + "?code=test&state=" + state),
    rejected("invalid_grant"),
  );
});
test("expired transaction, code and grant are rejected; no refresh authorization", async (t) => {
  const h = await harness(t);
  let clock = Date.now();
  const store = new MemoryStore(() => clock),
    delegation = new Delegation(h.config, store, h.factory, () => clock);
  const flow = clientFlow(h.config),
    url = await delegation.start(
      Object.fromEntries(new URL(flow.authorizeUrl).searchParams),
    );
  const transaction = new URLSearchParams(new URL(url).hash.split("?")[1]).get(
    "transaction",
  )!;
  clock += 120001;
  await assert.rejects(
    delegation.inspect(transaction, upstream()),
    rejected("invalid_request"),
  );
  clock = Date.now();
  const u = await delegation.start(
    Object.fromEntries(new URL(clientFlow(h.config).authorizeUrl).searchParams),
  );
  const tx = new URLSearchParams(new URL(u).hash.split("?")[1]).get(
    "transaction",
  )!;
  const d = await delegation.inspect(tx, upstream());
  const decision = await delegation.decide(
    { transaction: tx, state: d.state, decision: "approve" },
    upstream(),
  );
  const code = new URL(decision.redirect).searchParams.get("code")!;
  clock += 120001;
  assert.equal(await store.getCode(code), undefined);
  const token = opaque(),
    g: Grant = {
      grantId: "grant",
      userId: "owner",
      clientId: h.config.clientId,
      upstream: upstream(),
      scope: "nigraan:read",
      resource: h.origin + "/mcp",
      expiresAt: clock + 1,
    };
  await store.putGrant(token, g);
  clock += 2;
  await assert.rejects(delegation.resolve(token), rejected("invalid_token"));
  await assert.rejects(
    h.delegation.exchange({ grant_type: "refresh_token" }),
    rejected("invalid_grant"),
  );
  store.close();
});
test("grant expiry never exceeds verified upstream JWT expiry; expired JWT not delegated", async (t) => {
  const h = await harness(t),
    expiry = Date.now() + 30000,
    g = await grant(h, upstream(expiry));
  assert.ok((await h.store.getGrant(g.access))!.expiresAt <= expiry);
  const p = await pending(h);
  await assert.rejects(
    h.delegation.decide(
      {
        transaction: p.transaction,
        state: p.details.state,
        decision: "approve",
      },
      upstream(Date.now() - 1000),
    ),
    rejected("invalid_token"),
  );
});
test("revocation endpoint invalidates bearer and reference contexts", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  const result = (await rpc(h.origin, g.access, call("get_city_status"))).data
    .result.structuredContent;
  const binding = await h.store.getGrant(g.access);
  assert.ok(await h.store.resolveReference(result.context, "I1", binding!));
  assert.equal(
    (
      await fetch(h.origin + "/oauth/revoke", {
        method: "POST",
        headers: { Authorization: "Bearer " + g.access },
      })
    ).status,
    204,
  );
  assert.equal(
    (await rpc(h.origin, g.access, call("get_city_status"))).res.status,
    401,
  );
  await assert.rejects(
    h.store.resolveReference(result.context, "I1", binding!),
    rejected("unknown_reference"),
  );
});
test("Citizen-only, pending/rejected and invalid identity cannot inspect or approve consent", async (t) => {
  const h = await harness(t);
  for (const approved of [false, false, false]) {
    h.state.approved = approved;
    const flow = clientFlow(h.config),
      url = await h.delegation.start(
        Object.fromEntries(new URL(flow.authorizeUrl).searchParams),
      );
    const tx = new URLSearchParams(new URL(url).hash.split("?")[1]).get(
      "transaction",
    )!;
    await assert.rejects(
      h.delegation.inspect(tx, upstream()),
      rejected("access_denied"),
    );
  }
  h.state.approved = true;
  const p = await pending(h);
  await assert.rejects(
    h.delegation.inspect(p.transaction, "invalid"),
    rejected("invalid_token"),
  );
  h.state.approvalError = true;
  await assert.rejects(
    h.delegation.inspect(p.transaction, upstream()),
    rejected("read_unavailable"),
  );
});
test("wrong user/client/grant, unknown alias and five-minute stale references fail", async () => {
  let n = Date.now();
  const store = new MemoryStore(() => n),
    context = opaque(),
    binding = { userId: "owner", clientId: "local", grantId: "grant" };
  await store.putReference(context, {
    ...binding,
    expiresAt: n + 300000,
    mapping: { I1: row(1).id },
  });
  assert.equal(await store.resolveReference(context, "I1", binding), row(1).id);
  for (const bad of [
    { ...binding, userId: "other" },
    { ...binding, clientId: "other" },
    { ...binding, grantId: "other" },
  ])
    await assert.rejects(
      store.resolveReference(context, "I1", bad),
      rejected("unknown_reference"),
    );
  await assert.rejects(
    store.resolveReference(context, "I8", binding),
    rejected("unknown_reference"),
  );
  n += 300000;
  await assert.rejects(
    store.resolveReference(context, "I1", binding),
    rejected("stale_reference"),
  );
  store.close();
});
test("reference copied between actual grants is refused despite same approved user", async (t) => {
  const h = await harness(t),
    g1 = await grant(h),
    g2 = await grant(h),
    result = (await rpc(h.origin, g1.access, call("get_city_status"))).data
      .result.structuredContent;
  const r = await rpc(
    h.origin,
    g2.access,
    call("get_incident_details", { context: result.context, ref: "I1" }),
  );
  assert.equal(
    JSON.parse(r.data.result.content[0].text).error.code,
    "unknown_reference",
  );
  h.state.user = "other";
  assert.equal(
    (await rpc(h.origin, g1.access, call("get_city_status"))).res.status,
    401,
  );
});
test("rolling minute/day limits and expiring lease use atomic admission with guarded release", async () => {
  let clock = Date.now();
  const store = new MemoryStore(() => clock);
  const first = await store.admit("owner");
  await assert.rejects(store.admit("owner"), rejected("busy"));
  clock += 13001;
  const next = await store.admit("owner");
  await store.release("owner", first);
  await assert.rejects(store.admit("owner"), rejected("busy"));
  await store.release("owner", next);
  for (let i = 2; i < 30; i++) {
    const lease = await store.admit("owner");
    await store.release("owner", lease);
  }
  await assert.rejects(store.admit("owner"), rejected("rate_limited"));
  clock += 60001;
  for (let i = 30; i < 500; i++) {
    const lease = await store.admit("owner");
    await store.release("owner", lease);
    clock += 2100;
  }
  await assert.rejects(store.admit("owner"), rejected("rate_limited"));
  clock += 86400001;
  await store.release("owner", await store.admit("owner"));
  store.close();
});
test("concurrent HTTP tool calls get distinct busy HTTP error", async (t) => {
  const h = await harness(t),
    g = await grant(h);
  h.state.delay = 30;
  const a = rpc(h.origin, g.access, call("get_city_status"));
  await new Promise((r) => setTimeout(r, 5));
  const b = await rpc(h.origin, g.access, call("get_city_status"));
  assert.equal(b.res.status, 429);
  assert.equal(b.data.error, "busy");
  assert.equal((await a).res.status, 200);
});
test("tool deadline cancels and prevents late fact delivery", async (t) => {
  const h = await harness(t, 40),
    g = await grant(h);
  h.state.delay = 30;
  const r = await rpc(h.origin, g.access, call("get_city_status"));
  assert.equal(r.res.status, 200);
  assert.equal(JSON.parse(r.data.result.content[0].text).error.code, "timeout");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(h.logs.filter((l) => l.code === "ok").length, 0);
  await assert.rejects(
    withDeadline(async () => new Promise(() => {}), 5),
    rejected("timeout"),
  );
});
test("whole HTTP response cap blocks chunked excessive content before delivery", async (t) => {
  const server = createServer((_req, res) => {
    bufferResponse(res as Response, () => undefined, "http://local", 64);
    res.setHeader("Content-Type", "application/json");
    res.write("PRIVATE_".repeat(20));
    res.end("END");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const r = await fetch(
    "http://127.0.0.1:" + (server.address() as { port: number }).port,
  );
  const text = await r.text();
  assert.equal(r.status, 500);
  assert.ok(text.includes("read_budget_exceeded"));
  assert.ok(!text.includes("PRIVATE_"));
});
test("actual hostile Host header rejected before auth", async (t) => {
  const h = await harness(t);
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      h.origin + "/mcp",
      { headers: { Host: "evil.example" } },
      (r) => {
        r.resume();
        resolve(r.statusCode!);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
});
test("real HTTP OAuth flow publishes discovery, enforces consent, binds resource and handles replay", async (t) => {
  const h = await harness(t),
    flow = clientFlow(h.config);
  const metadata = await fetch(
    h.origin + "/.well-known/oauth-authorization-server",
  ).then((r) => r.json());
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.equal(metadata.registration_endpoint, undefined);
  const start = await fetch(flow.authorizeUrl, { redirect: "manual" });
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get("location")!);
  const tx = new URLSearchParams(location.hash.split("?")[1]).get(
    "transaction",
  )!;
  const details = await fetch(
    h.origin + "/delegation/request?transaction=" + tx,
    {
      headers: {
        Authorization: "Bearer " + upstream(),
        Origin: "http://127.0.0.1:5173",
      },
    },
  ).then((r) => r.json());
  assert.equal(details.capabilities.length, 5);
  const d = await fetch(h.origin + "/delegation/decision", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + upstream(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transaction: tx,
      state: details.state,
      decision: "approve",
    }),
  }).then((r) => r.json());
  const body = flow.consume(d.redirect);
  const request = () =>
    fetch(h.origin + "/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
  const token = await request();
  assert.equal(token.status, 200);
  const access = await token.json();
  assert.deepEqual(Object.keys(access).sort(), [
    "access_token",
    "expires_in",
    "scope",
    "token_type",
  ]);
  assert.equal((await request()).status, 400);
  assert.ok(!JSON.stringify(h.logs).includes(body.code));
});
test("atomic transaction/code consumption prevents concurrent replay", async (t) => {
  const h = await harness(t),
    p = await pending(h);
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      h.delegation.decide(
        {
          transaction: p.transaction,
          state: p.details.state,
          decision: "approve",
        },
        upstream(),
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const success = results.find(
    (r) => r.status === "fulfilled",
  ) as PromiseFulfilledResult<{ redirect: string }>;
  const body = p.flow.consume(success.value.redirect);
  const tokens = await Promise.allSettled([
    h.delegation.exchange(body),
    h.delegation.exchange(body),
  ]);
  assert.equal(tokens.filter((r) => r.status === "fulfilled").length, 1);
});
