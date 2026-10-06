import { AgentError, validateToolInput, AGENT_VIEWS } from "./agentTools.js";
export const SIMULATOR_CLIENT_ID = "nigraanos-alexa-simulator";
export const SIMULATOR_CLIENT_NAME = "NigraanOS Alexa+ Simulator";
export const MCP_TOOLS = [
  "get_city_status",
  "get_urgent_incidents",
  "get_incident_details",
  "get_city_conditions",
  "get_incident_activity",
];
export const OAUTH_STORAGE_KEY = "nigraan.mcp.pkce.v1";
const fail = (code, message) => {
  throw new AgentError(code, message);
};
const opaque = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const toolErrors = {
  invalid_token: ['access', 'MCP authorization expired. Connect again.'],
  access_denied: ['access', 'MCP authorization unavailable. Connect again.'],
  stale_reference: ['stale_reference', 'Reference expired. Start a fresh investigation.'],
  unknown_reference: ['stale_reference', 'Reference unavailable. Start a fresh investigation.'],
  incident_unavailable: ['incident_unavailable', 'Incident read unavailable.'],
  read_unavailable: ['read', 'Authorized read unavailable.'],
  read_budget_exceeded: ['read_budget_exceeded', 'Read budget exceeded.'],
  timeout: ['timeout', 'Read timed out.'],
  rate_limited: ['rate_limited', 'Read limit reached. Retry later.'],
  busy: ['busy', 'Another read is active. Retry later.'],
};
function safeToolError(response) {
  try {
    const text = response.content?.find(part => part.type === 'text')?.text;
    if (typeof text === 'string' && text.length <= 2048) {
      const code = JSON.parse(text)?.error?.code;
      if (Object.hasOwn(toolErrors, code)) return new AgentError(...toolErrors[code]);
    }
  } catch { /* never surface raw response content */ }
  return new AgentError('read', 'MCP read unavailable. Retry later or request a fresh incident list.');
}
const origins = [
  "https://nigraanos.netlify.app",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];
export function simulatorConfig(endpoint, origin) {
  if (!endpoint)
    fail(
      "configuration",
      "MCP endpoint is not configured. Configure the public MCP URL before connecting.",
    );
  if (!origins.includes(origin))
    fail("configuration", "Unsupported simulator origin.");
  const u = new URL(endpoint);
  if (
    u.origin !== endpoint ||
    u.username ||
    u.password ||
    !(u.protocol === "https:" || endpoint === "http://127.0.0.1:8787")
  )
    fail(
      "configuration",
      "MCP endpoint must be a canonical HTTPS origin or the exact local development endpoint.",
    );
  return {
    endpoint,
    redirectUri: origin + "/agent-callback",
    clientId: SIMULATOR_CLIENT_ID,
  };
}
const base64 = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export async function officialConnection(endpoint, token, fetcher) {
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ]);
  const client = new Client({ name: SIMULATOR_CLIENT_NAME, version: "0.2.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(endpoint + "/mcp"),
    {
      requestInit: {
        headers: { Authorization: "Bearer " + token },
        credentials: "omit",
      },
      fetch: fetcher,
    },
  );
  try {
    await client.connect(transport, { timeout: 15000 });
    if (client.getServerVersion()?.name !== "NigraanOS read tools")
      throw new Error("Unexpected server");
    const tools = await client.listTools({}, { timeout: 15000 });
    verifyTools(tools);
    return {
      call: (name, args, signal) =>
        client.callTool({ name, arguments: args }, undefined, {
          signal,
          timeout: 15000,
        }),
      close: () => client.close(),
    };
  } catch {
    await client.close().catch(() => {});
    fail(
      "connection",
      "MCP initialization or five-tool verification failed. Reconnect to retry.",
    );
  }
}
export function verifyTools(result) {
  const names = result?.tools?.map((t) => t.name);
  if (
    result?.nextCursor ||
    !Array.isArray(names) ||
    names.length !== 5 ||
    new Set(names).size !== 5 ||
    MCP_TOOLS.some((n) => !names.includes(n))
  )
    fail(
      "connection",
      "The MCP server did not expose exactly the five expected read tools.",
    );
}
// Only PKCE transaction data survives the full-page consent redirect.
// MCP bearer and SDK transport are memory-only and never serialized.
export function createSimulatorSession({
  storage,
  crypto = globalThis.crypto,
  fetcher = globalThis.fetch,
  connect = officialConnection,
  now = Date.now,
} = {}) {
  let grant = null,
    connection = null,
    revision = 0,
    timer = null,
    pendingTimer = null,
    flowOwner = null,
    context = null,
    refs = [],
    contextExpiry = 0,
    referenceVersion = 0;
  let state = { status: "disconnected", error: "" };
  const listeners = new Set();
  const emit = (status, error = "") => {
    state = { status, error };
    for (const fn of listeners) fn(state);
  };
  const clearRefs = () => {
    context = null;
    refs = [];
    contextExpiry = 0;
    referenceVersion++;
  };
  const clearPending = () => {
    clearTimeout(pendingTimer);
    pendingTimer = null;
    storage?.removeItem(OAUTH_STORAGE_KEY);
  };
  function schedulePending() {
    try {
      const p = JSON.parse(storage?.getItem(OAUTH_STORAGE_KEY) || "null");
      if (p) {
        if (
          !Number.isFinite(p.expiresAt) ||
          p.expiresAt <= now() ||
          p.expiresAt > now() + 120000
        )
          clearPending();
        else {
          pendingTimer = setTimeout(clearPending, p.expiresAt - now());
          pendingTimer.unref?.();
        }
      }
    } catch {
      clearPending();
    }
  }
  schedulePending();
  async function revoke(g) {
    if (!g) return;
    try {
      await fetcher(g.endpoint + "/oauth/revoke", {
        method: "POST",
        headers: { Authorization: "Bearer " + g.token },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      /* bounded grant expiry remains the fallback */
    }
  }
  async function disconnect() {
    revision++;
    clearPending();
    clearRefs();
    clearTimeout(timer);
    timer = null;
    const g = grant,
      c = connection;
    grant = null;
    connection = null;
    emit("disconnected");
    await Promise.allSettled([revoke(g), c?.close()]);
  }
  function snapshot() {
    if (grant && grant.expiresAt <= now()) {
      void disconnect();
      return {
        status: "disconnected",
        error: "MCP authorization expired. Connect again.",
      };
    }
    return state;
  }
  async function begin(config, accountId) {
    await disconnect();
    const rev = revision;
    if (!accountId || !storage)
      fail("access", "Sign in with an approved Operations account first.");
    const verifier = base64(crypto.getRandomValues(new Uint8Array(32))),
      nonce = base64(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    if (rev !== revision) fail("cancelled", "Authorization cancelled.");
    storage.setItem(
      OAUTH_STORAGE_KEY,
      JSON.stringify({
        ...config,
        accountId,
        verifier,
        state: nonce,
        expiresAt: now() + 120000,
      }),
    );
    flowOwner = accountId;
    schedulePending();
    const url = new URL(config.endpoint + "/oauth/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      resource: config.endpoint + "/mcp",
      scope: "nigraan:read",
      state: nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    emit("authorizing");
    return url.href;
  }
  async function finish(callback, config, accountId) {
    const raw = storage?.getItem(OAUTH_STORAGE_KEY);
    clearPending();
    const rev = ++revision;
    let issued = null;
    try {
      flowOwner = accountId;
      emit("connecting");
      const p = JSON.parse(raw || "null"),
        u = new URL(callback),
        expected = new URL(config.redirectUri);
      if (
        !p ||
        !Number.isFinite(p.expiresAt) ||
        p.expiresAt <= now() ||
        p.expiresAt > now() + 120000 ||
        p.accountId !== accountId ||
        p.endpoint !== config.endpoint ||
        p.clientId !== config.clientId ||
        p.redirectUri !== config.redirectUri ||
        !opaque(p.state) ||
        !opaque(p.verifier) ||
        u.origin !== expected.origin ||
        u.pathname !== expected.pathname ||
        u.hash ||
        u.username ||
        u.password ||
        u.searchParams.getAll("state").length !== 1 ||
        u.searchParams.get("state") !== p.state ||
        [...u.searchParams.keys()].some(
          (k) => !["code", "state", "error"].includes(k),
        )
      )
        fail(
          "callback",
          "Authorization callback is invalid, expired, or belongs to another account. Start again.",
        );
      if (u.searchParams.has("error"))
        fail(
          "denied",
          "Read access was denied. You can start a new authorization request.",
        );
      if (
        u.searchParams.getAll("code").length !== 1 ||
        !opaque(u.searchParams.get("code"))
      )
        fail("callback", "Authorization code is missing or invalid.");
      const started = now();
      const response = await fetcher(config.endpoint + "/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          redirect_uri: config.redirectUri,
          resource: config.endpoint + "/mcp",
          code: u.searchParams.get("code"),
          code_verifier: p.verifier,
        }),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        fail("exchange", "Authorization exchange failed. Start a new request.");
      const t = await response.json();
      if (
        !opaque(t.access_token) ||
        t.token_type !== "Bearer" ||
        t.scope !== "nigraan:read" ||
        !Number.isInteger(t.expires_in) ||
        t.expires_in <= 0 ||
        t.expires_in > 600 ||
        t.refresh_token
      )
        fail(
          "exchange",
          "Authorization exchange returned an unsupported grant.",
        );
      issued = {
        endpoint: config.endpoint,
        accountId,
        token: t.access_token,
        expiresAt: started + t.expires_in * 1000,
      };
      const c = await connect(config.endpoint, issued.token, fetcher);
      if (rev !== revision || issued.expiresAt <= now()) {
        await c.close();
        await revoke(issued);
        fail("cancelled", "Authorization cancelled or expired.");
      }
      grant = issued;
      connection = c;
      clearRefs();
      emit("connected");
      timer = setTimeout(
        () => void disconnect(),
        Math.max(0, grant.expiresAt - now()),
      );
      timer.unref?.();
      return true;
    } catch (error) {
      if (issued && grant !== issued) await revoke(issued);
      if (rev === revision) {
        grant = null;
        connection = null;
        clearRefs();
        emit(
          "failed",
          error instanceof AgentError
            ? error.message
            : "MCP connection failed. Start a new request.",
        );
      }
      throw error instanceof AgentError
        ? error
        : new AgentError(
            "connection",
            "MCP connection failed. Start a new request.",
          );
    }
  }
  function reference(ref, version) {
    if (
      !context ||
      now() >= contextExpiry ||
      (version !== undefined && version !== referenceVersion) ||
      !refs.includes(ref)
    )
      fail(
        "stale_reference",
        "Reference expired or belongs to an older result. Request a fresh incident list.",
      );
    return context;
  }
  async function run(name, input = {}, signal) {
    validateToolInput(name, input);
    if (!grant || grant.expiresAt <= now() || !connection) {
      await disconnect();
      fail("access", "Connect read access before asking for MCP facts.");
    }
    const rev = revision;
    if (!MCP_TOOLS.includes(name)) fail("input", "Unsupported remote tool.");
    const args = input.ref
      ? {
          ref: input.ref,
          context: reference(input.ref, input.referenceVersion),
        }
      : {};
    try {
      const response = await connection.call(name, args, signal);
      if (rev !== revision || signal?.aborted)
        fail("cancelled", "Request cancelled.");
      if (response.isError) throw safeToolError(response);
      const v = response.structuredContent;
      const result = projectRemoteResult(name, v);
      if (name !== "get_city_conditions" && !input.ref && v.context) {
        if (!opaque(v.context)) fail("read", "Invalid reference context.");
        context = v.context;
        refs = result.incidents.map((i) => i.ref);
        contextExpiry = Math.min(
          Date.parse(v.collectedAt) + 300000,
          grant.expiresAt,
        );
        referenceVersion++;
      }
      return result;
    } catch (e) {
      if (
        e?.code === 'access' || e?.name === "UnauthorizedError" ||
        [e?.code, e?.status, e?.statusCode].some(
          (value) => value === 401 || value === 403,
        )
      ) {
        await disconnect();
        fail("access", "MCP authorization is unavailable. Connect again.");
      }
      throw e instanceof AgentError
        ? e
        : new AgentError("read", "MCP read failed. Retry or reconnect.");
    }
  }
  return {
    snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    begin,
    finish,
    disconnect,
    run,
    clear: clearRefs,
    clearPending,
    referenceVersion: () => referenceVersion,
    resolveOrdinal(index) {
      const ref = refs[index];
      reference(ref);
      return ref;
    },
    async accountChanged(id) {
      if (
        (grant && grant.accountId !== id) ||
        (state.status === "connecting" && flowOwner !== id)
      )
        await disconnect();
      else {
        let p;
        try {
          p = JSON.parse(storage?.getItem(OAUTH_STORAGE_KEY) || "null");
        } catch {
          clearPending();
        }
        if (p && (p.accountId !== id || p.expiresAt <= now())) clearPending();
      }
    },
    facade(onView) {
      return {
        clear: clearRefs,
        referenceVersion: () => referenceVersion,
        assertSession() {
          if (!grant || grant.expiresAt <= now() || !connection)
            fail('access', 'MCP authorization expired. Connect again.');
        },
        assertReference(ref, version) {
          if (!grant || grant.expiresAt <= now() || !connection)
            fail('access', 'MCP authorization expired. Connect again.');
          reference(ref, version);
        },
        resolveOrdinal(index) {
          const ref = refs[index];
          reference(ref);
          return ref;
        },
        async run(name, input = {}, signal) {
          validateToolInput(name, input);
          if (name === "navigate_to_view") {
            onView(AGENT_VIEWS[input.view]);
            return {
              kind: "NAVIGATION",
              headline: "Opened " + input.view,
              snapshotAt: now(),
            };
          }
          if (name === "navigate_to_incident") {
            reference(input.ref, input.referenceVersion);
            onView("Citizen Reports");
            return {
              kind: "NAVIGATION",
              headline:
                "Opened Incidents for human review of " +
                input.ref +
                ". Remote aliases do not disclose database IDs.",
              snapshotAt: now(),
            };
          }
          return run(name, input, signal);
        },
      };
    },
  };
}
const headlines = {
  get_city_status: "Current city status · remote MCP",
  get_urgent_incidents: "Urgent Attention · remote MCP",
  get_incident_details: "Current incident details · remote MCP",
  get_incident_activity: "Published Citizen activity · remote MCP",
  get_city_conditions: "City conditions · remote MCP",
};
export function projectRemoteResult(name, v) {
  if (!v || !Number.isFinite(Date.parse(v.collectedAt)))
    fail("read", "Unsupported MCP output.");
  const number = (x) => {
    if (x !== null && (typeof x !== "number" || !Number.isFinite(x)))
      fail("read", "Unsupported MCP number.");
    return x;
  };
  const count = (x) => {
    if (x !== null && (!Number.isSafeInteger(x) || x < 0))
      fail("read", "Unsupported MCP count.");
    return x;
  };
  const result = {
    kind: name === "get_city_conditions" ? "CONTEXT" : "FACT",
    headline: headlines[name],
    snapshotAt: Date.parse(v.collectedAt),
  };
  if (name === "get_city_conditions") {
    const part = (p, air) => {
      if (!p || !["current", "stale", "unavailable"].includes(p.status))
        fail("read", "Unsupported city context.");
      const stamp = (x) =>
        x === null
          ? null
          : Number.isFinite(Date.parse(x))
            ? x
            : fail("read", "Unsupported timestamp.");
      return {
        status: p.status,
        validAt: stamp(p.validAt),
        fetchedAt: stamp(p.fetchedAt),
        source: air
          ? "CAMS global via Open-Meteo · modeled AQ · approximately 45 km"
          : "Open-Meteo · modeled weather",
        ...(air
          ? { aqi: number(p.aqi) }
          : {
              temperatureC: number(p.temperatureC),
              precipitationMm: number(p.precipitationMm),
              intervalSeconds: number(p.intervalSeconds),
            }),
      };
    };
    result.context = {
      city: "Karachi",
      weather: part(v.context?.weather, false),
      air: part(v.context?.air, true),
      disclaimer:
        "Modeled context does not verify incident severity or confirm flooding.",
    };
    return result;
  }
  if (
    v.kind !== "FACT" ||
    !Array.isArray(v.incidents) ||
    v.incidents.length > 8
  )
    fail("read", "Unsupported incident output.");
  result.incidents = v.incidents.map((i) => {
    if (
      !/^I[1-8]$/.test(i.ref) ||
      ![
        "traffic",
        "flood",
        "garbage",
        "air_quality",
        "water",
        "power",
        "road_damage",
        "other",
        "unknown",
      ].includes(i.category) ||
      ![
        "reported",
        "acknowledged",
        "assigned",
        "in_progress",
        "resolved",
        "unknown",
      ].includes(i.status) ||
      !["low", "normal", "medium", "high", "critical", "unknown"].includes(
        i.priority,
      )
    )
      fail("read", "Unsupported incident metadata.");
    const reasons = (i.reasons || []).filter((r) =>
      [
        "Recorded critical priority",
        "Recorded high priority",
        "New · Awaiting acknowledgement",
        "Recent Citizen update",
      ].includes(r),
    );
    return {
      ref: i.ref,
      category: i.category,
      status: i.status,
      priority: i.priority,
      ageHours: number(i.ageHours),
      ...(reasons.length ? { reasons } : {}),
    };
  });
  const keys = {
    get_city_status: [
      "submitted",
      "unresolved",
      "resolved",
      "awaitingAcknowledgement",
    ],
    get_urgent_incidents: [
      "recordedCritical",
      "recordedHigh",
      "newAwaitingAcknowledgement",
      "recentlyCitizenUpdated",
    ],
    get_incident_activity: ["publishedUpdates", "publishedEdits"],
  }[name];
  if (keys)
    result.facts = Object.fromEntries(
      keys.map((k) => [k, count(v.facts?.[k])]),
    );
  result.omitted = count(v.omitted);
  result.notice =
    v.completeness === "partial"
      ? "Partial facts: recent activity unavailable."
      : "Collected reads are not an atomic snapshot.";
  if (name === "get_incident_activity") {
    if (!Array.isArray(v.activity) || v.activity.length > 8)
      fail("read", "Unsupported activity output.");
    result.activity = v.activity.map((a) => {
      if (
        !/^I[1-8]$/.test(a.ref) ||
        !["edit", "update"].includes(a.kind) ||
        !Number.isFinite(Date.parse(a.publishedAt))
      )
        fail("read", "Unsupported activity metadata.");
      return { ref: a.ref, kind: a.kind, publishedAt: a.publishedAt };
    });
  }
  return result;
}
