import { useEffect, useState } from "react";
import { displayStatus } from "../data/reportOptions";
import {
  presentInvestigation,
  investigationProgress,
} from "../utils/investigationPresentation";

const time = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Karachi" })
    : "Unavailable";
const label = (value) =>
  value === null ? "Unavailable" : displayStatus(value);
const aggregateLabels = {
  submitted: "Submitted",
  unresolved: "Unresolved",
  resolved: "Resolved",
  awaitingAcknowledgement: "Awaiting acknowledgement",
};
export default function InvestigationBriefing({
  result,
  referenceVersion,
  busy,
  onSubmit,
  isReferenceCurrent = () => false,
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  let view;
  try {
    view = presentInvestigation(result);
  } catch {
    return (
      <p role="alert">
        Investigation briefing unavailable. Run a fresh investigation.
      </p>
    );
  }
  const fresh = () => onSubmit("What needs attention right now and why?");
  const current = (ref) => {
    try {
      return (
        Number.isSafeInteger(referenceVersion) &&
        isReferenceCurrent(ref, referenceVersion)
      );
    } catch {
      return false;
    }
  };
  const stale = view.candidates.some((c) => !current(c.ref));
  const open = view.actions.some((a) => a.action === "open_incidents");
  return (
    <section
      className="investigation-briefing"
      aria-label="Incident investigation briefing"
    >
      <header className="investigation-header">
        <div>
          <span className="eyebrow">READ-ONLY INVESTIGATION</span>
          <h3>Incident investigation · remote MCP</h3>
        </div>
        <span className={"investigation-status " + view.status}>
          {view.status === "complete" ? "Complete" : "Partial"}
        </span>
      </header>
      <p className="investigation-time">
        Collected {time(view.startedAt)} – {time(view.completedAt)} PKT
      </p>
      <p className="agent-caveat">
        Collected reads are not an atomic snapshot. Human operators make
        operational decisions. Report age is measured in hours since report
        start.
      </p>
      {stale && (
        <div className="investigation-stale" role="status">
          <strong>Stale references · read again before inspecting</strong>
          <p>
            These observations remain historical. Details require a fresh
            reference set.
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={fresh}
          >
            Run a fresh investigation
          </button>
        </div>
      )}
      <section className="investigation-summary">
        <h4>Human review briefing</h4>
        <p>{view.summary}</p>
        <p>{view.reasonSummary}</p>
      </section>
      {!!view.aggregates.length && (
        <dl
          className="investigation-aggregates"
          aria-label="Recorded city facts"
        >
          {view.aggregates.map((f) => (
            <div key={f.field}>
              <dt>{aggregateLabels[f.field]}</dt>
              <dd>{f.value ?? "Unavailable"}</dd>
            </div>
          ))}
        </dl>
      )}
      <section aria-label="Review candidates">
        <h4>Review candidates</h4>
        {!view.candidates.length ? (
          <p>
            No candidates were inspected. This does not establish that the city
            is safe.
          </p>
        ) : (
          <div className="investigation-cards">
            {view.candidates.map((c) => (
              <article key={c.ref} className="investigation-candidate">
                <div className="investigation-card-heading">
                  <h5>
                    {c.ref} · {label(c.category)}
                  </h5>
                  <span className="agent-kind">FACT</span>
                </div>
                <p className="investigation-observation">
                  {c.inspected
                    ? "Latest detail observation"
                    : "Candidate observation · details not inspected"}{" "}
                  · {time(c.observedAt)} PKT
                </p>
                <dl>
                  <div>
                    <dt>Observed status</dt>
                    <dd>{label(c.status)}</dd>
                  </div>
                  <div>
                    <dt>Recorded priority</dt>
                    <dd>{label(c.priority)}</dd>
                  </div>
                  <div>
                    <dt>Report age</dt>
                    <dd>
                      {c.ageHours === null
                        ? "Unavailable"
                        : c.ageHours.toLocaleString("en-GB", {
                            maximumFractionDigits: 1,
                          }) + " hours since report start"}
                    </dd>
                  </div>
                </dl>
                <div className="investigation-reasons">
                  <h6>Reason for review</h6>
                  {c.reasons.length ? (
                    <ul>
                      {c.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No configured review reason identified.</p>
                  )}
                  <small>
                    Review support only · not an operational decision.
                  </small>
                </div>
                {!!c.changes.length && (
                  <div className="investigation-changes">
                    <strong>Changed during collected reads</strong>
                    {c.changes.map((change) => (
                      <div key={change.field}>
                        <p>
                          Candidate list observed {change.field}:{" "}
                          {label(change.before)}{" "}
                          <small>· {time(change.beforeAt)}</small>
                        </p>
                        <p>
                          Later detail read observed {change.field}:{" "}
                          {label(change.after)}{" "}
                          <small>· {time(change.afterAt)}</small>
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {c.actions.some((a) => a.action === "review_details") && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || !current(c.ref)}
                    aria-label={"Review " + c.ref + " details"}
                    onClick={() =>
                      onSubmit("Tell me more about " + c.ref, {
                        tool: "get_incident_details",
                        input: { ref: c.ref, referenceVersion },
                      })
                    }
                  >
                    Details
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      {view.modeledContext && (
        <section className="investigation-modeled" aria-label="Modeled context">
          <span className="agent-kind agent-kind-context">MODELED CONTEXT</span>
          <h4>Modeled city context</h4>
          <p className="agent-caveat">{view.modeledContext.disclaimer}</p>
          <div className="investigation-context-grid">
            {[
              ["weather", "Weather"],
              ["air", "Air quality"],
            ].map(([key, title]) => {
              const p = view.modeledContext[key];
              return (
                <article key={key}>
                  <h5>
                    {title} · {p.status}
                  </h5>
                  {p.status === "unavailable" ? (
                    <p>Context unavailable</p>
                  ) : (
                    <p>
                      {key === "weather"
                        ? `${p.temperatureC ?? "Unavailable"} °C · Precipitation ${p.precipitationMm ?? "Unavailable"} mm / ${p.intervalSeconds ?? "Unavailable"} seconds`
                        : `Modeled US AQI: ${p.aqi ?? "Unavailable"}`}
                    </p>
                  )}
                  <small>
                    {p.source}
                    <br />
                    Valid: {time(p.validAt)}
                    <br />
                    Fetched: {time(p.fetchedAt)}
                  </small>
                </article>
              );
            })}
          </div>
        </section>
      )}
      <section className="investigation-coverage">
        <h4>Coverage and availability</h4>
        <dl>
          <div>
            <dt>Candidates returned</dt>
            <dd>{view.coverage.candidatesReturned}</dd>
          </div>
          <div>
            <dt>Inspected</dt>
            <dd>{view.coverage.inspected}</dd>
          </div>
          <div>
            <dt>Not inspected among returned</dt>
            <dd>{view.coverage.notInspected}</dd>
          </div>
        </dl>
        {view.coverage.omitted > 0 && (
          <p>
            {view.coverage.omitted} candidates outside the selected inspection
            set or omitted by the bounded server list. Open Incidents for
            broader review.
          </p>
        )}
        {!!view.unavailable.length && (
          <ul className="investigation-unavailable">
            {view.unavailable.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        )}
        <details>
          <summary>What was checked · {view.checked.length} reads</summary>
          <ul>
            {view.checked.map((s, n) => (
              <li key={n}>
                {investigationProgress(s.tool).replace(/…$/, "")} ·{" "}
                {s.status === "success" ? "Read completed" : "Unavailable"}
                {s.collectedAt ? " · " + time(s.collectedAt) + " PKT" : ""}
              </li>
            ))}
          </ul>
        </details>
      </section>
      <footer className="investigation-next">
        <h4>Human next step</h4>
        <p>
          Review the recorded observations in the existing Operations workspace.
        </p>
        {open && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              onSubmit("Open Incidents", {
                tool: "navigate_to_view",
                input: { view: "Incidents" },
              })
            }
          >
            Open Incidents workspace
          </button>
        )}
        {view.actions.some((a) => a.action === "refresh_investigation") && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={fresh}
          >
            Run a fresh investigation
          </button>
        )}
      </footer>
    </section>
  );
}
