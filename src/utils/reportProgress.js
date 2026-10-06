const stages = [
  ["reported", "Reported"],
  ["acknowledged", "Acknowledged"],
  ["assigned", "Assigned"],
  ["in_progress", "In progress"],
  ["resolved", "Resolved"],
];
export function reportProgress(status) {
  const current = stages.findIndex(([key]) => key === status);
  return current < 0
    ? null
    : stages.map(([key, label], index) => ({
        status: key,
        label,
        state:
          index < current
            ? "completed"
            : index === current
              ? "current"
              : "future",
      }));
}
