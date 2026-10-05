import { createServer } from "node:http";
import { once } from "node:events";
import type { TestContext } from "node:test";
import { createApp, type Diagnostic } from "../src/handler.js";
import { MemoryStore } from "../src/state.js";
import { SafeError } from "../src/errors.js";
import { clientFlow } from "../src/clientFlow.js";
import type {
  Caller,
  CallerFactory,
  IncidentRow,
  ActivityRow,
} from "../src/supabaseAdapter.js";
export const upstream = (expiry = Date.now() + 3600000) =>
  "test." +
  Buffer.from(JSON.stringify({ exp: Math.floor(expiry / 1000) })).toString(
    "base64url",
  ) +
  ".test";
export const row = (n: number, extra: Record<string, unknown> = {}) =>
  ({
    id: "00000000-0000-4000-8000-" + String(n).padStart(12, "0"),
    category: "traffic",
    status: "reported",
    priority: "high",
    reported_at: new Date(Date.now() - 7200000).toISOString(),
    submission_state: "submitted",
    title: "PRIVATE_TITLE",
    description: "PRIVATE_PROSE",
    email: "PRIVATE_EMAIL",
    latitude: 24.123456,
    ...extra,
  }) as IncidentRow;
export function fixtures() {
  const state = {
    user: "owner",
    approved: true,
    approvalError: false,
    authorizationCalls: 0,
    revokeAt: Infinity,
    rows: [row(1), row(2)],
    events: [] as ActivityRow[],
    activityError: false,
    removed: false,
    delay: 0,
    seenTokens: [] as string[],
    pageCalls: 0,
    maxPage: 500,
    batchCalls: [] as number[],
  };
  const factory: CallerFactory = (token) => {
    state.seenTokens.push(token);
    const caller: Caller = {
      async authorize(expected, signal) {
        state.authorizationCalls++;
        if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
        if (signal?.aborted) throw new SafeError("timeout", 504);
        if (
          token === "invalid" ||
          !state.user ||
          (expected && expected !== state.user)
        )
          throw new SafeError("invalid_token", 401);
        if (state.approvalError) throw new SafeError("read_unavailable", 503);
        if (!state.approved || state.authorizationCalls >= state.revokeAt)
          throw new SafeError("access_denied", 403);
        return state.user;
      },
      async incidents(offset, limit) {
        state.pageCalls++;
        return state.rows
          .filter((r) => r.submission_state === "submitted")
          .slice(offset, offset + Math.min(limit, state.maxPage));
      },
      async incident(id) {
        return state.removed
          ? null
          : state.rows.find((r) => r.id === id) || null;
      },
      async activity(ids, from, to, offset, limit) {
        state.batchCalls.push(ids.length);
        if (state.activityError) throw new SafeError("read_unavailable", 503);
        return state.events
          .filter(
            (e) =>
              ids.includes(e.incident_id) &&
              Date.parse(e.published_at) >= from &&
              Date.parse(e.published_at) < to,
          )
          .slice(offset, offset + limit);
      },
      async conditions() {
        return {
          version: 1,
          context_only: true,
          city: { id: "karachi", latitude: 24.123456 },
          weather: {
            status: "current",
            temperature_c: 30,
            valid_at: new Date().toISOString(),
            fetched_at: new Date().toISOString(),
            precipitation: { amount_mm: 0, interval_seconds: 3600 },
            private: "PRIVATE_PROSE",
          },
          air_quality: {
            status: "stale",
            aqi: 55,
            valid_at: new Date().toISOString(),
            fetched_at: new Date().toISOString(),
          },
          storage: "PRIVATE_URL",
        };
      },
    };
    return caller;
  };
  return { state, factory };
}
export async function harness(t: TestContext, deadline?: number) {
  const http = createServer();
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address() as { port: number };
  const origin = "http://127.0.0.1:" + address.port;
  const config = {
    origin,
    consentUrl: "http://127.0.0.1:5173/",
    clientId: "nigraan-local",
    clientName: "Nigraan local MCP test client",
    redirectUri: "http://127.0.0.1:8788/callback",
  };
  const f = fixtures(),
    store = new MemoryStore(),
    logs: Diagnostic[] = [];
  const system = createApp(
    config,
    f.factory,
    store,
    (d) => logs.push(d),
    deadline,
  );
  http.on("request", system.app);
  t.after(() => {
    store.close();
    http.closeAllConnections();
    http.close();
  });
  return { ...system, ...f, config, origin, logs };
}
export async function grant(
  h: Awaited<ReturnType<typeof harness>>,
  token = upstream(),
) {
  const flow = clientFlow(h.config),
    query = Object.fromEntries(new URL(flow.authorizeUrl).searchParams);
  const consent = await h.delegation.start(query);
  const tx = new URLSearchParams(new URL(consent).hash.split("?")[1]).get(
    "transaction",
  )!;
  const details = await h.delegation.inspect(tx, token);
  const decision = await h.delegation.decide(
    { transaction: tx, state: details.state, decision: "approve" },
    token,
  );
  const body = flow.consume(decision.redirect);
  const access = await h.delegation.exchange(body);
  return { access: access.access_token, body, tx, details, token };
}
export async function rpc(
  origin: string,
  access: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(origin + "/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + access,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { res, data: await res.json() };
}
export const call = (name: string, args: unknown = {}) => ({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: { name, arguments: args },
});
