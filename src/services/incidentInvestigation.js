import { AgentError } from "./agentTools.js";

export const INVESTIGATION_LIMITS = Object.freeze({
  calls: 7,
  details: 2,
  deadlineMs: 60000,
  optionalRemainingMs: 15000,
});
export const INVESTIGATION_DISCLAIMER =
  "Modeled context does not verify incident severity or confirm flooding.";
const categories = [
  "traffic",
  "flood",
  "garbage",
  "air_quality",
  "water",
  "power",
  "road_damage",
  "other",
  "unknown",
];
const statuses = [
  "reported",
  "acknowledged",
  "assigned",
  "in_progress",
  "resolved",
  "unknown",
];
const priorities = ["low", "normal", "medium", "high", "critical", "unknown"];
const codes = [
  "access",
  "connection",
  "cancelled",
  "timeout",
  "stale_reference",
  "incident_unavailable",
  "read",
  "read_budget_exceeded",
  "rate_limited",
  "busy",
  "deadline",
  "skipped",
];
const abort = (code) =>
  new AgentError(
    code,
    code === "access" || code === "connection"
      ? "Authorization unavailable. Reconnect before investigating."
      : code === "stale_reference"
        ? "References changed or expired. Start a fresh investigation."
        : "Investigation cancelled.",
  );
const invalid = () => {
  throw new AgentError("read", "Investigation facts unavailable.");
};
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : invalid());
const numeric = (v) =>
  v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0)
    ? v
    : invalid();
const stamp = (v) =>
  v === null
    ? null
    : typeof v === "string" && Number.isFinite(Date.parse(v))
      ? new Date(v).toISOString()
      : invalid();
const enumValue = (v, list) => (list.includes(v) ? v : invalid());
const alias = (v) =>
  typeof v === "string" && /^I[1-8]$/.test(v) ? v : invalid();
const metadata = (row) => ({
  ref: alias(row.ref),
  category: enumValue(row.category, categories),
  status: enumValue(row.status, statuses),
  priority: enumValue(row.priority, priorities),
  ageHours: numeric(row.ageHours),
});

/** @typedef {{id:string, sourceId:string, ref?:string, field:string, value:number|string|null, unit?:string}} InvestigationFact */
/** @typedef {{version:1, status:'complete'|'partial', startedAt:string, completedAt:string, consistency:'collected_reads_not_atomic', coverage:{candidatesReturned:number,inspected:number,omitted:number}, sources:Array<object>, facts:InvestigationFact[], modeledContext:object|null, reviewReasons:Array<object>, humanNextSteps:Array<object>, unavailableSections:Array<object>}} Investigation */

// Runtime validator for the constructed contract, including grounding links.
export function validateInvestigation(result) {
  const shape = (value, required, optional = []) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      required.some((k) => !Object.hasOwn(value, k)) ||
      Object.keys(value).some((k) => ![...required, ...optional].includes(k))
    )
      invalid();
  };
  const keys = [
    "version",
    "status",
    "startedAt",
    "completedAt",
    "consistency",
    "coverage",
    "sources",
    "facts",
    "modeledContext",
    "reviewReasons",
    "humanNextSteps",
    "unavailableSections",
  ];
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(result, k)) ||
    result.version !== 1 ||
    !["complete", "partial"].includes(result.status) ||
    result.consistency !== "collected_reads_not_atomic"
  )
    invalid();
  stamp(result.startedAt);
  stamp(result.completedAt);
  if (result.startedAt === null || result.completedAt === null) invalid();
  shape(result.coverage, ["candidatesReturned", "inspected", "omitted"]);
  count(result.coverage.candidatesReturned);
  count(result.coverage.inspected);
  count(result.coverage.omitted);
  if (result.coverage.inspected > 2 || result.sources.length > 7) invalid();
  const toolNames = [
    "get_city_status",
    "get_urgent_incidents",
    "get_incident_details",
    "get_incident_activity",
    "get_city_conditions",
  ];
  for (const source of result.sources) {
    shape(source, ["id", "tool", "collectedAt", "status"]);
    if (
      !/^S[1-7]$/.test(source.id) ||
      !toolNames.includes(source.tool) ||
      !["success", "unavailable"].includes(source.status)
    )
      invalid();
    stamp(source.collectedAt);
    if (source.status === "success" && source.collectedAt === null) invalid();
  }
  if (new Set(result.sources.map((s) => s.id)).size !== result.sources.length)
    invalid();
  const sources = new Set(
    result.sources.filter((s) => s.status === "success").map((s) => s.id),
  );
  const facts = new Map(result.facts.map((f) => [f.id, f]));
  if (facts.size !== result.facts.length) invalid();
  for (const fact of result.facts) {
    shape(fact, ["id", "sourceId", "field", "value"], ["ref", "unit"]);
    if (!/^F[1-9]\d?$/.test(fact.id) || !sources.has(fact.sourceId)) invalid();
    if (fact.ref !== undefined) alias(fact.ref);
    const fields = {
      category: categories,
      status: statuses,
      priority: priorities,
    };
    if (Object.hasOwn(fields, fact.field)) {
      enumValue(fact.value, fields[fact.field]);
      if (!fact.ref) invalid();
    } else if (fact.field === "ageHours") {
      numeric(fact.value);
      if (!fact.ref || fact.unit !== "hours_since_report_start") invalid();
    } else if (
      [
        "submitted",
        "unresolved",
        "resolved",
        "awaitingAcknowledgement",
        "publishedUpdates",
        "publishedEdits",
      ].includes(fact.field)
    ) {
      if (fact.value !== null) count(fact.value);
    } else invalid();
    if (fact.field !== "ageHours" && fact.unit !== undefined) invalid();
  }
  for (const reason of result.reviewReasons) {
    shape(reason, ["ref", "kind", "rule", "factIds"]);
    alias(reason.ref);
    const expected = {
      recorded_critical: ["priority", "critical"],
      recorded_high: ["priority", "high"],
      awaiting_acknowledgement: ["status", "reported"],
      recent_published_update: ["publishedUpdates", null],
    }[reason.rule];
    if (
      !expected ||
      reason.kind !== "REASON_FOR_REVIEW" ||
      !reason.factIds.length
    )
      invalid();
    for (const id of reason.factIds) {
      const fact = facts.get(id);
      if (
        !fact ||
        fact.ref !== reason.ref ||
        fact.field !== expected[0] ||
        (expected[1] === null
          ? !(typeof fact.value === "number" && fact.value > 0)
          : fact.value !== expected[1])
      )
        invalid();
    }
  }
  for (const step of result.humanNextSteps) {
    shape(step, ["kind", "action", "factIds"], ["ref"]);
    if (step.ref !== undefined) alias(step.ref);
    if (
      step.kind !== "HUMAN_NEXT_STEP" ||
      !["review_details", "open_incidents", "refresh_investigation"].includes(
        step.action,
      ) ||
      step.factIds.some((id) => !facts.has(id))
    )
      invalid();
  }
  for (const section of result.unavailableSections) {
    shape(section, ["section", "code"]);
    if (
      !codes.includes(section.code) ||
      !/^(?:get_city_status|get_urgent_incidents|get_incident_details|get_incident_activity|get_city_conditions|city_status|city_conditions|detail|activity|investigation)(?::I[1-8])?$/.test(
        section.section,
      )
    )
      invalid();
  }
  if (
    result.modeledContext &&
    (!sources.has(result.modeledContext.sourceId) ||
      result.modeledContext.disclaimer !== INVESTIGATION_DISCLAIMER)
  )
    invalid();
  if (result.modeledContext) {
    shape(result.modeledContext, ["sourceId", "weather", "air", "disclaimer"]);
    for (const [key, air] of [
      ["weather", false],
      ["air", true],
    ]) {
      const p = result.modeledContext[key];
      shape(p, [
        "status",
        "validAt",
        "fetchedAt",
        "source",
        ...(air
          ? ["aqi"]
          : ["temperatureC", "precipitationMm", "intervalSeconds"]),
      ]);
      enumValue(p.status, ["current", "stale", "unavailable"]);
      stamp(p.validAt);
      stamp(p.fetchedAt);
      if (
        p.source !==
        (air
          ? "CAMS global via Open-Meteo · modeled AQ · approximately 45 km"
          : "Open-Meteo · modeled weather")
      )
        invalid();
      if (air) numeric(p.aqi);
      else {
        if (
          p.temperatureC !== null &&
          (typeof p.temperatureC !== "number" ||
            !Number.isFinite(p.temperatureC))
        )
          invalid();
        numeric(p.precipitationMm);
        numeric(p.intervalSeconds);
      }
    }
  }
  return result;
}

/** Pure orchestration over already-redacted MCP reads; no database/provider access. */
export function createInvestigationController({
  tools,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let active = null,
    binding = null;
  function cancel() {
    active?.abort();
    binding = null;
  }
  function referenceVersion() {
    return binding;
  }
  async function run({ signal, onProgress = () => {} } = {}) {
    if (active)
      throw new AgentError("busy", "An investigation is already active.");
    const request = new AbortController();
    active = request;
    binding = null;
    const started = now(),
      deadline = started + INVESTIGATION_LIMITS.deadlineMs;
    let expired = false,
      calls = 0;
    const externalAbort = () => request.abort();
    signal?.addEventListener("abort", externalAbort, { once: true });
    if (signal?.aborted) request.abort();
    const timer = setTimer(() => {
      expired = true;
      request.abort();
    }, INVESTIGATION_LIMITS.deadlineMs);
    const result = {
      version: 1,
      status: "complete",
      startedAt: new Date(started).toISOString(),
      completedAt: null,
      consistency: "collected_reads_not_atomic",
      coverage: { candidatesReturned: 0, inspected: 0, omitted: 0 },
      sources: [],
      facts: [],
      modeledContext: null,
      reviewReasons: [],
      humanNextSteps: [],
      unavailableSections: [],
    };
    let selected = [],
      latest = new Map();
    const check = () => {
      if (request.signal.aborted)
        throw abort(expired ? "deadline" : "cancelled");
      if (now() >= deadline) throw abort("deadline");
      tools.assertSession?.();
    };
    const reference = () => {
      for (const row of selected) {
        if (tools.referenceVersion() !== binding)
          throw abort("stale_reference");
        tools.assertReference(row.ref, binding);
      }
    };
    const unavailable = (section, code) => {
      result.status = "partial";
      result.unavailableSections.push({
        section,
        code: codes.includes(code) ? code : "read",
      });
    };
    const fact = (sourceId, field, value, ref, unit) => {
      const f = {
        id: "F" + (result.facts.length + 1),
        sourceId,
        field,
        value,
        ...(ref ? { ref } : {}),
        ...(unit ? { unit } : {}),
      };
      result.facts.push(f);
      return f.id;
    };
    // Race abort even if a transport ignores AbortSignal; late reads never publish.
    const wait = async (work) => {
      let listener;
      const aborted = new Promise((_, reject) => {
        listener = () => reject(abort(expired ? "deadline" : "cancelled"));
        request.signal.addEventListener("abort", listener, { once: true });
      });
      try {
        return await Promise.race([work, aborted]);
      } finally {
        request.signal.removeEventListener("abort", listener);
      }
    };
    async function call(tool, input = {}, optional = false, dependent = false) {
      check();
      if (dependent) reference();
      if (
        optional &&
        deadline - now() < INVESTIGATION_LIMITS.optionalRemainingMs
      ) {
        unavailable(tool + (input.ref ? ":" + input.ref : ""), "skipped");
        return null;
      }
      if (calls >= 7) invalid();
      calls++;
      onProgress(tool, input.ref);
      const source = {
        id: "S" + calls,
        tool,
        collectedAt: null,
        status: "unavailable",
      };
      result.sources.push(source);
      try {
        const value = await wait(
          Promise.resolve().then(() => {
            check();
            return tools.run(tool, input, request.signal);
          }),
        );
        check();
        if (dependent) reference();
        if (!value || !Number.isFinite(value.snapshotAt)) invalid();
        source.collectedAt = new Date(value.snapshotAt).toISOString();
        return { value, source };
      } catch (e) {
        const code = codes.includes(e?.code) ? e.code : "read";
        if (
          [
            "access",
            "connection",
            "cancelled",
            "deadline",
            "stale_reference",
          ].includes(code)
        )
          throw abort(code);
        unavailable(tool + (input.ref ? ":" + input.ref : ""), code);
        return null;
      }
    }
    function observation(read, ref) {
      const rows = read.value.incidents;
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].ref !== ref)
        throw abort("stale_reference");
      const row = metadata(rows[0]);
      const ids = {};
      for (const field of ["category", "status", "priority", "ageHours"])
        ids[field] = fact(
          read.source.id,
          field,
          row[field],
          ref,
          field === "ageHours" ? "hours_since_report_start" : undefined,
        );
      latest.set(ref, { row, ids });
      read.source.status = "success";
      return row;
    }
    try {
      const city = await call("get_city_status");
      if (city) {
        try {
          for (const k of [
            "submitted",
            "unresolved",
            "resolved",
            "awaitingAcknowledgement",
          ])
            fact(
              city.source.id,
              k,
              city.value.facts[k] === null ? null : count(city.value.facts[k]),
            );
          city.source.status = "success";
        } catch {
          result.facts = result.facts.filter(
            (f) => f.sourceId !== city.source.id,
          );
          unavailable("city_status", "read");
        }
      }
      const urgent = await call("get_urgent_incidents");
      if (urgent) {
        const rows = urgent.value.incidents;
        if (!Array.isArray(rows) || rows.length > 8) invalid();
        const candidates = rows.map(metadata);
        if (new Set(candidates.map((c) => c.ref)).size !== candidates.length)
          invalid();
        result.coverage.candidatesReturned = candidates.length;
        selected = candidates.slice(0, 2);
        binding = tools.referenceVersion();
        reference();
        result.coverage.omitted =
          count(urgent.value.omitted) +
          Math.max(0, candidates.length - selected.length);
        urgent.source.status = "success";
        for (const row of selected) {
          const ids = {};
          for (const field of ["category", "status", "priority", "ageHours"])
            ids[field] = fact(
              urgent.source.id,
              field,
              row[field],
              row.ref,
              field === "ageHours" ? "hours_since_report_start" : undefined,
            );
          latest.set(row.ref, { row, ids });
        }
        for (const row of selected) {
          const detail = await call(
            "get_incident_details",
            { ref: row.ref, referenceVersion: binding },
            false,
            true,
          );
          if (detail) {
            try {
              observation(detail, row.ref);
              result.coverage.inspected++;
            } catch (e) {
              if (e?.code === "stale_reference") throw e;
              result.facts = result.facts.filter(
                (f) => f.sourceId !== detail.source.id,
              );
              unavailable("detail:" + row.ref, "read");
            }
          }
        }
        for (const row of selected) {
          const activity = await call(
            "get_incident_activity",
            { ref: row.ref, referenceVersion: binding },
            true,
            true,
          );
          if (activity) {
            try {
              if (
                !Array.isArray(activity.value.activity) ||
                activity.value.activity.some((a) => a.ref !== row.ref)
              )
                throw abort("stale_reference");
              const updates = activity.value.facts.publishedUpdates,
                edits = activity.value.facts.publishedEdits;
              for (const [field, value] of [
                ["publishedUpdates", updates],
                ["publishedEdits", edits],
              ])
                fact(
                  activity.source.id,
                  field,
                  value === null ? null : count(value),
                  row.ref,
                );
              activity.source.status = "success";
            } catch (e) {
              if (e?.code === "stale_reference") throw e;
              result.facts = result.facts.filter(
                (f) => f.sourceId !== activity.source.id,
              );
              unavailable("activity:" + row.ref, "read");
            }
          }
        }
      }
      const conditions = await call("get_city_conditions", {}, true);
      if (conditions) {
        try {
          const part = (p, air) => ({
            status: enumValue(p.status, ["current", "stale", "unavailable"]),
            validAt: stamp(p.validAt),
            fetchedAt: stamp(p.fetchedAt),
            source: air
              ? "CAMS global via Open-Meteo · modeled AQ · approximately 45 km"
              : "Open-Meteo · modeled weather",
            ...(air
              ? { aqi: numeric(p.aqi) }
              : {
                  temperatureC:
                    p.temperatureC === null
                      ? null
                      : typeof p.temperatureC === "number" &&
                          Number.isFinite(p.temperatureC)
                        ? p.temperatureC
                        : invalid(),
                  precipitationMm: numeric(p.precipitationMm),
                  intervalSeconds: numeric(p.intervalSeconds),
                }),
          });
          result.modeledContext = {
            sourceId: conditions.source.id,
            weather: part(conditions.value.context.weather, false),
            air: part(conditions.value.context.air, true),
            disclaimer: INVESTIGATION_DISCLAIMER,
          };
          conditions.source.status = "success";
        } catch {
          unavailable("city_conditions", "read");
        }
      }
      check();
      reference();
      onProgress('prepare_briefing');
      for (const { row, ids } of latest.values()) {
        const addReason = (rule, id) =>
          result.reviewReasons.push({
            ref: row.ref,
            kind: "REASON_FOR_REVIEW",
            rule,
            factIds: [id],
          });
        if (row.priority === "critical" || row.priority === "high")
          addReason("recorded_" + row.priority, ids.priority);
        if (row.status === "reported")
          addReason("awaiting_acknowledgement", ids.status);
        const update = result.facts.find(
          (f) =>
            f.ref === row.ref && f.field === "publishedUpdates" && f.value > 0,
        );
        if (update) addReason("recent_published_update", update.id);
        result.humanNextSteps.push({
          ref: row.ref,
          kind: "HUMAN_NEXT_STEP",
          action: "review_details",
          factIds: [ids.status, ids.priority],
        });
      }
      result.humanNextSteps.push({
        kind: "HUMAN_NEXT_STEP",
        action: "open_incidents",
        factIds: [],
      });
      result.completedAt = new Date(now()).toISOString();
      return validateInvestigation(result);
    } catch (e) {
      if (e?.code === "deadline" && !signal?.aborted) {
        try {
          tools.assertSession?.();
          reference();
        } catch (error) {
          binding = null;
          throw abort(codes.includes(error?.code) ? error.code : "read");
        }
        unavailable("investigation", "deadline");
        onProgress('prepare_briefing');
        result.completedAt = new Date(now()).toISOString();
        binding = null;
        return validateInvestigation(result);
      }
      binding = null;
      // Never return partial private state on auth loss, cancellation or stale binding.
      throw e instanceof AgentError
        ? abort(e.code)
        : new AgentError("read", "Investigation unavailable.");
    } finally {
      clearTimer(timer);
      signal?.removeEventListener("abort", externalAbort);
      active = null;
    }
  }
  return { run, cancel, referenceVersion };
}
