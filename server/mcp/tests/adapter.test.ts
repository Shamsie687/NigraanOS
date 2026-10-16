import test from "node:test";
import assert from "node:assert/strict";
import { supabaseFactory } from "../src/supabaseAdapter.js";
import { row, upstream } from "./helpers.js";
test('adapter uses database access deadline and fails closed after temporary expiry',async()=>{
 const expiry=new Date(Date.now()+60000).toISOString();let allowed=true;
 const caller=supabaseFactory('https://supabase.example.test','synthetic-key',async()=>
   Response.json({allowed,permanent:false,status:"active",started_at:new Date(Date.parse(expiry)-3600000).toISOString(),expires_at:expiry}))('synthetic-token');
 assert.equal(await caller.accessDeadline!(),Date.parse(expiry));allowed=false;
 await assert.rejects(()=>caller.accessDeadline!());
});
test('MCP denies unstarted or malformed temporary capability even if allowed is supplied',async()=>{
 for(const data of [
  {allowed:true,permanent:false,status:'approved',expires_at:new Date(Date.now()+3600000).toISOString()},
  {allowed:true,permanent:false,status:'active',started_at:new Date().toISOString(),expires_at:new Date(Date.now()+7200000).toISOString()},
 ]){
  const caller=supabaseFactory('https://supabase.example.test','synthetic-key',async()=>Response.json(data))('synthetic-token');
  await assert.rejects(()=>caller.accessDeadline!());
 }
});
test("actual Supabase client delegates user token and metadata projections with no write RPCs", async () => {
  const seen: { url: URL; headers: Headers; method: string; body?: string }[] =
    [];
  const token = upstream();
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      headers = new Headers(init?.headers);
    seen.push({
      url,
      headers,
      method: init?.method || "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    let data: unknown;
    if (url.pathname === "/auth/v1/user")
      data = {
        id: "owner",
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      };
    else if (url.pathname.endsWith("/rpc/is_approved_operations")) data = true;
    else if (url.pathname === "/rest/v1/incidents")
      data = url.searchParams.has("id") ? row(1) : [row(1)];
    else if (url.pathname === "/rest/v1/nigraan_citizen_changes") data = [];
    else
      data = {
        version: 1,
        context_only: true,
        city: { id: "karachi" },
        weather: {},
        air_quality: {},
      };
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const caller = supabaseFactory(
      "https://test.supabase.co",
      "sb_publishable_test",
      fetcher,
    )(token),
    signal = new AbortController().signal;
  assert.equal(await caller.authorize("owner", signal), "owner");
  await caller.incidents(0, 500, signal);
  await caller.incident(row(1).id, signal);
  await caller.activity(
    [row(1).id],
    Date.now() - 86400000,
    Date.now(),
    0,
    500,
    signal,
  );
  await caller.conditions(signal);
  assert.ok(
    seen.every((r) => r.headers.get("authorization") === "Bearer " + token),
  );
  assert.ok(
    seen.every((r) => r.headers.get("apikey") === "sb_publishable_test"),
  );
  for (const request of seen) {
    if (request.url.pathname.includes("incidents")) {
      assert.equal(
        request.url.searchParams.get("select"),
        "id,category,status,priority,reported_at,submission_state",
      );
      assert.equal(
        request.url.searchParams.get("submission_state"),
        "eq.submitted",
      );
    }
    if (request.url.pathname.includes("nigraan_citizen_changes")) {
      assert.equal(
        request.url.searchParams.get("select"),
        "id,incident_id,kind,published_at",
      );
      assert.equal(
        request.url.searchParams.get("submission_state"),
        "eq.published",
      );
    }
    if (request.method !== "GET")
      assert.ok(
        request.url.pathname.endsWith("/rpc/is_approved_operations") ||
          request.url.pathname.endsWith("/functions/v1/city-context"),
      );
  }
});
test("actual Supabase adapter denies changed identity and unapproved capability", async () => {
  let approved = true;
  const factory = supabaseFactory(
    "https://test.supabase.co",
    "sb_publishable_test",
    async (input) =>
      new Response(
        JSON.stringify(
          String(input).includes("/user")
            ? { id: "other", aud: "authenticated", role: "authenticated" }
            : approved,
        ),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  const caller = factory(upstream());
  await assert.rejects(
    caller.authorize("owner"),
    (e) => (e as { code: string }).code === "invalid_token",
  );
  approved = false;
  await assert.rejects(
    caller.authorize("other"),
    (e) => (e as { code: string }).code === "access_denied",
  );
});


test('MCP accepts exact twelve-hour database sessions but rejects longer or unversioned grants',async()=>{
 const expires_at=new Date(Date.now()+43200000).toISOString(),started_at=new Date(Date.parse(expires_at)-43200000).toISOString();
 for(const seconds of [43200,3600,undefined,99999]){
  const caller=supabaseFactory('https://supabase.example.test','synthetic-key',async()=>Response.json({allowed:true,permanent:false,status:'active',session_seconds:seconds,started_at,expires_at}))('synthetic-token');
  if(seconds===43200)assert.equal(await caller.accessDeadline!(),Date.parse(expires_at));else await assert.rejects(()=>caller.accessDeadline!());
 }
});
