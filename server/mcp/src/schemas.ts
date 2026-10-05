import { z } from "zod";
export const names = [
  "get_city_status",
  "get_urgent_incidents",
  "get_incident_details",
  "get_city_conditions",
  "get_incident_activity",
] as const;
export type ToolName = (typeof names)[number];
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const ref = z.enum(["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8"]);
const reference = z.object({ context: opaque, ref }).strict();
export const inputs = {
  get_city_status: z.object({}).strict(),
  get_urgent_incidents: z.object({}).strict(),
  get_incident_details: reference,
  get_city_conditions: z.object({}).strict(),
  get_incident_activity: z.union([z.object({}).strict(), reference]),
};
const number = z.number().finite().nonnegative(),
  count = number.int(),
  stamp = z.string().datetime(),
  nullable = number.nullable();
export const reasons = z.enum([
  "Recorded critical priority",
  "Recorded high priority",
  "New · Awaiting acknowledgement",
  "Recent Citizen update",
]);
const incident = z
  .object({
    ref,
    category: z.enum([
      "traffic",
      "flood",
      "garbage",
      "air_quality",
      "water",
      "power",
      "road_damage",
      "other",
      "unknown",
    ]),
    status: z.enum([
      "reported",
      "acknowledged",
      "assigned",
      "in_progress",
      "resolved",
      "unknown",
    ]),
    priority: z.enum([
      "low",
      "normal",
      "medium",
      "high",
      "critical",
      "unknown",
    ]),
    ageHours: nullable,
    reasons: z.array(reasons).max(4).optional(),
  })
  .strict();
const base = {
  kind: z.literal("FACT"),
  collectedAt: stamp,
  consistency: z.literal("collected_reads"),
  context: opaque.optional(),
  incidents: z.array(incident).max(8),
  omitted: count,
  completeness: z.enum(["complete", "partial"]),
  warnings: z
    .array(
      z.enum(["recent_activity_unavailable", "collected_reads_not_atomic"]),
    )
    .max(2),
};
const part = {
  status: z.enum(["current", "stale", "unavailable"]),
  validAt: stamp.nullable(),
  fetchedAt: stamp.nullable(),
};
export const outputs = {
  get_city_status: z
    .object({
      ...base,
      facts: z
        .object({
          submitted: count,
          unresolved: count,
          resolved: count,
          awaitingAcknowledgement: count,
        })
        .strict(),
    })
    .strict(),
  get_urgent_incidents: z
    .object({
      ...base,
      facts: z
        .object({
          recordedCritical: count,
          recordedHigh: count,
          newAwaitingAcknowledgement: count,
          recentlyCitizenUpdated: count.nullable(),
        })
        .strict(),
    })
    .strict(),
  get_incident_details: z
    .object({ ...base, incidents: z.array(incident).length(1) })
    .strict(),
  get_incident_activity: z
    .object({
      ...base,
      facts: z
        .object({ publishedUpdates: count, publishedEdits: count })
        .strict(),
      activity: z
        .array(
          z
            .object({
              ref,
              kind: z.enum(["edit", "update"]),
              publishedAt: stamp,
            })
            .strict(),
        )
        .max(8),
    })
    .strict(),
  get_city_conditions: z
    .object({
      kind: z.literal("CONTEXT"),
      collectedAt: stamp,
      context: z
        .object({
          city: z.literal("Karachi"),
          weather: z
            .object({
              ...part,
              source: z.literal("Open-Meteo · modeled weather"),
              temperatureC: z.number().finite().nullable(),
              precipitationMm: nullable,
              intervalSeconds: nullable,
            })
            .strict(),
          air: z
            .object({
              ...part,
              source: z.literal(
                "CAMS global via Open-Meteo · modeled AQ · approximately 45 km",
              ),
              aqi: nullable,
            })
            .strict(),
          disclaimer: z.literal(
            "Modeled context does not verify incident severity or confirm flooding.",
          ),
        })
        .strict(),
    })
    .strict(),
};
