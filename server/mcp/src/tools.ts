import { calculateAttention } from "../../../src/utils/emergencyOperations.js";
import {
  projectAgentIncident,
  projectAgentConditions,
} from "../../../src/services/agentProjection.js";
import { DAY, timestamp } from "../../../src/utils/operationsAnalytics.js";
import { SafeError } from "./errors.js";
import { opaque, type Grant, type StateStore } from "./state.js";
import { inputs, outputs, type ToolName } from "./schemas.js";
import type { Caller, IncidentRow, ActivityRow } from "./supabaseAdapter.js";
export const BOUNDS = {
  incidents: 5000,
  activity: 10000,
  page: 500,
  batch: 200,
  cards: 8,
  deadline: 12000,
  response: 65536,
};
export function validateOutput(name: ToolName, value: unknown) {
  const result = outputs[name].safeParse(value);
  if (!result.success) throw new SafeError("read_unavailable", 503);
  return result.data;
}
export async function runTool(
  name: ToolName,
  input: unknown,
  caller: Caller,
  grant: Grant,
  store: StateStore,
  signal: AbortSignal,
  now = Date.now,
) {
  const parsed = inputs[name].safeParse(input);
  if (!parsed.success) throw new SafeError("invalid_input");
  const args = parsed.data as { context?: string; ref?: string };
  const to = now();
  const check = () => {
    if (signal.aborted) throw new SafeError("timeout", 504);
    if (now() >= grant.expiresAt) throw new SafeError("invalid_token", 401);
  };
  const authorize = async () => {
    check();
    await caller.authorize(grant.userId, signal);
    check();
  };
  await authorize();
  const base = {
    kind: "FACT",
    collectedAt: new Date(to).toISOString(),
    consistency: "collected_reads",
    omitted: 0,
    completeness: "complete",
    warnings: ["collected_reads_not_atomic"],
  };
  async function allIncidents() {
    let processed = 0;
    const rows = new Map<string, IncidentRow>();
    for (;;) {
      check();
      const page = await caller.incidents(
        processed,
        Math.min(BOUNDS.page, BOUNDS.incidents - processed + 1),
        signal,
      );
      processed += page.length;
      if (processed > BOUNDS.incidents)
        throw new SafeError("read_budget_exceeded");
      for (const row of page)
        if (row.submission_state === "submitted") rows.set(row.id, row);
      if (!page.length) break;
    }
    return [...rows.values()];
  }
  async function detail() {
    const id = await store.resolveReference(args.context!, args.ref!, grant);
    const row = await caller.incident(id, signal);
    check();
    if (!row || row.id !== id || row.submission_state !== "submitted")
      throw new SafeError("incident_unavailable");
    return row;
  }
  async function events(rows: IncidentRow[]) {
    let processed = 0;
    const found = new Map<string, ActivityRow>();
    const ids = rows.map((i) => i.id);
    for (let b = 0; b < ids.length; b += BOUNDS.batch) {
      const batch = ids.slice(b, b + BOUNDS.batch);
      let offset = 0;
      for (;;) {
        check();
        const page = await caller.activity(
          batch,
          to - DAY,
          to,
          offset,
          Math.min(BOUNDS.page, BOUNDS.activity - processed + 1),
          signal,
        );
        processed += page.length;
        if (processed > BOUNDS.activity)
          throw new SafeError("read_budget_exceeded");
        for (const e of page) {
          const at = timestamp(e.published_at);
          if (
            batch.includes(e.incident_id) &&
            ["edit", "update"].includes(e.kind) &&
            at !== null &&
            at >= to - DAY &&
            at < to
          )
            found.set(e.id, e);
        }
        if (!page.length) break;
        offset += page.length;
      }
    }
    return [...found.values()];
  }
  async function bind(rows: IncidentRow[]) {
    const context = opaque(),
      mapping: Record<string, string> = {};
    const incidents = rows.slice(0, 8).map((r, n) => {
      const ref = "I" + (n + 1);
      mapping[ref] = r.id;
      return {
        ...projectAgentIncident(r, ref, to),
        ...("reasons" in r ? { reasons: r.reasons } : {}),
      };
    });
    check();
    await store.putReference(context, {
      userId: grant.userId,
      clientId: grant.clientId,
      grantId: grant.grantId,
      mapping,
      expiresAt: Math.min(to + 300000, grant.expiresAt),
    });
    return { context, incidents };
  }
  let result: unknown;
  if (name === "get_city_conditions") {
    const context = projectAgentConditions(await caller.conditions(signal));
    // Cached PostgreSQL timestamptz values may use offsets rather than Z.
    // Projection already maps invalid/missing timestamps to null; preserve that.
    for (const dataset of [context.weather, context.air]) {
      for (const field of ["validAt", "fetchedAt"] as const) {
        const value = dataset[field];
        if (typeof value === "string" && Number.isFinite(Date.parse(value)))
          dataset[field] = new Date(value).toISOString();
      }
    }
    result = {
      kind: "CONTEXT",
      collectedAt: base.collectedAt,
      context,
    };
  } else if (name === "get_incident_details") {
    const row = await detail();
    result = {
      ...base,
      context: args.context,
      incidents: [projectAgentIncident(row, args.ref!, to)],
    };
  } else {
    const rows = args.ref ? [await detail()] : await allIncidents();
    if (name === "get_city_status") {
      const unresolved = rows.filter((i) => i.status !== "resolved");
      result = {
        ...base,
        ...(await bind(unresolved)),
        omitted: Math.max(0, unresolved.length - 8),
        facts: {
          submitted: rows.length,
          unresolved: unresolved.length,
          resolved: rows.length - unresolved.length,
          awaitingAcknowledgement: rows.filter((i) => i.status === "reported")
            .length,
        },
      };
    } else if (name === "get_urgent_incidents") {
      let activity: ActivityRow[] | null;
      try {
        activity = await events(rows.filter((i) => i.status !== "resolved"));
      } catch (error) {
        check();
        if (error instanceof SafeError && error.code === "read_unavailable")
          activity = null;
        else throw error;
      }
      const urgent = calculateAttention(rows, activity, to);
      result = {
        ...base,
        ...(await bind(urgent.candidates)),
        omitted: Math.max(0, urgent.candidates.length - 8),
        completeness: activity === null ? "partial" : "complete",
        warnings:
          activity === null
            ? [...base.warnings, "recent_activity_unavailable"]
            : base.warnings,
        facts: {
          recordedCritical: urgent.counts[0],
          recordedHigh: urgent.counts[1],
          newAwaitingAcknowledgement: urgent.counts[2],
          recentlyCitizenUpdated: urgent.counts[3],
        },
      };
    } else {
      const activity = await events(rows);
      activity.sort(
        (a, b) =>
          Date.parse(b.published_at) - Date.parse(a.published_at) ||
          a.id.localeCompare(b.id),
      );
      let list: {
        context: string;
        incidents: ReturnType<typeof projectAgentIncident>[];
      };
      if (args.ref)
        list = {
          context: args.context!,
          incidents: [projectAgentIncident(rows[0], args.ref, to)],
        };
      else {
        const map = new Map(rows.map((r) => [r.id, r]));
        list = await bind(
          [...new Set(activity.map((e) => e.incident_id))].map(
            (id) => map.get(id)!,
          ),
        );
      }
      const mapping = new Map(
        list.incidents.map((i, n) => [
          args.ref
            ? rows[0].id
            : [...new Set(activity.map((e) => e.incident_id))][n],
          i.ref,
        ]),
      );
      const displayed = activity
        .filter((e) => mapping.has(e.incident_id))
        .slice(0, 8)
        .map((e) => ({
          ref: mapping.get(e.incident_id),
          kind: e.kind,
          publishedAt: new Date(e.published_at).toISOString(),
        }));
      result = {
        ...base,
        ...list,
        activity: displayed,
        omitted: Math.max(0, activity.length - displayed.length),
        facts: {
          publishedUpdates: activity.filter((e) => e.kind === "update").length,
          publishedEdits: activity.filter((e) => e.kind === "edit").length,
        },
      };
    }
  }
  await authorize();
  return validateOutput(name, result);
}
