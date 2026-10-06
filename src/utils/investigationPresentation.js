import { validateInvestigation } from "../services/incidentInvestigation.js";

export const reasonLabels = Object.freeze({
  recorded_critical: "Recorded priority: Critical",
  recorded_high: "Recorded priority: High",
  awaiting_acknowledgement: "Awaiting acknowledgement",
  recent_published_update: "Recent published update",
});
export function investigationProgress(stage, ref) {
  const safeRef = /^I[1-8]$/.test(ref || "") ? ref : "";
  return (
    {
      get_city_status: "Reading current city status…",
      get_urgent_incidents: "Finding incidents for review…",
      get_incident_details: safeRef
        ? "Inspecting " + safeRef + "…"
        : "Inspecting returned incident…",
      get_incident_activity: safeRef
        ? "Checking published activity for " + safeRef + "…"
        : "Checking published activity…",
      get_city_conditions: "Checking modeled city conditions…",
      prepare_briefing: "Preparing grounded briefing…",
    }[stage] || ""
  );
}
export function unavailableLabel(section) {
  const [name, ref] = section.split(":");
  const safeRef = /^I[1-8]$/.test(ref || "") ? ref : "";
  if (name === "get_city_status" || name === "city_status")
    return "City aggregate unavailable";
  if (name === "get_urgent_incidents") return "Review candidates unavailable";
  if (name === "get_incident_details" || name === "detail")
    return safeRef
      ? "Details unavailable for " + safeRef
      : "Incident details unavailable";
  if (name === "get_incident_activity" || name === "activity")
    return safeRef
      ? "Published activity unavailable for " + safeRef
      : "Published activity unavailable";
  if (name === "get_city_conditions" || name === "city_conditions")
    return "Modeled context unavailable";
  return "Investigation ended at its time limit";
}
// Copy only validated facts into deterministic presentation; never raw MCP text.
export function presentInvestigation(input) {
  const result = validateInvestigation(input);
  const sourceById = new Map(result.sources.map((s) => [s.id, s]));
  const observations = result.facts.filter(
    (f) =>
      f.ref && ["category", "status", "priority", "ageHours"].includes(f.field),
  );
  const refs = [...new Set(observations.map((f) => f.ref))].slice(0, 2);
  const candidates = refs.map((ref) => {
    const facts = observations.filter((f) => f.ref === ref),
      values = {};
    for (const field of ["category", "status", "priority", "ageHours"])
      values[field] =
        facts.filter((f) => f.field === field).at(-1)?.value ?? null;
    const detailSource = result.sources.find(
      (s) =>
        s.tool === "get_incident_details" &&
        s.status === "success" &&
        facts.some((f) => f.sourceId === s.id),
    );
    const latestSource = sourceById.get(facts.at(-1)?.sourceId);
    const changes = ["status", "priority"].flatMap((field) => {
      const first = facts.find((f) => f.field === field),
        last = facts.filter((f) => f.field === field).at(-1);
      return first && last && first.value !== last.value
        ? [
            {
              field,
              before: first.value,
              after: last.value,
              beforeAt: sourceById.get(first.sourceId).collectedAt,
              afterAt: sourceById.get(last.sourceId).collectedAt,
            },
          ]
        : [];
    });
    return {
      ref,
      ...values,
      inspected: Boolean(detailSource),
      observedAt: latestSource?.collectedAt,
      changes,
      reasons: result.reviewReasons
        .filter((r) => r.ref === ref)
        .map((r) => reasonLabels[r.rule]),
      actions: result.humanNextSteps.filter((s) => s.ref === ref),
    };
  });
  return {
    status: result.status,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    summary: `${result.coverage.inspected} of ${result.coverage.candidatesReturned} returned candidates were inspected for human review.`,
    reasonSummary: candidates.some((c) => c.inspected && c.reasons.length)
      ? "Recorded observations identify reasons for human review."
      : "No inspected incident matched the configured review-reason rules.",
    coverage: {
      ...result.coverage,
      notInspected:
        result.coverage.candidatesReturned - result.coverage.inspected,
    },
    candidates,
    aggregates: result.facts
      .filter((f) => !f.ref)
      .map((f) => ({ field: f.field, value: f.value })),
    modeledContext: result.modeledContext,
    unavailable: [
      ...new Set(
        result.unavailableSections.map((s) => unavailableLabel(s.section)),
      ),
    ],
    checked: result.sources.map((s) => ({
      tool: s.tool,
      collectedAt: s.collectedAt,
      status: s.status,
    })),
    actions: result.humanNextSteps.filter((s) => !s.ref),
  };
}
