import { reportProgress } from "../utils/reportProgress";
export default function ReportProgress({ status, events=[] }) {
  const steps = reportProgress(status);
  return (
    <section className="report-progress" aria-label="Report workflow progress">
      <h3>Report progress</h3>
      <p>
        {events.length?'Times shown are genuine recorded workflow observations. Missing times are unavailable.':"Progress shows the report's current workflow stage. Earlier transition times are not recorded here."}
      </p>
      {steps ? (
        <ol>
          {steps.map((step) => (
            <li
              key={step.status}
              className={"report-step " + step.state}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              <strong>{step.label}</strong>
              <span>
                {step.state === "completed"
                  ? "Earlier stage"
                  : step.state === "current"
                    ? "Current stage"
                    : "Future stage"}
              </span>
              {step.state!=='future'&&events.find(event=>event.status===step.status&&event.kind!=='assignment')&&<time dateTime={events.find(event=>event.status===step.status&&event.kind!=='assignment').recordedAt}>{new Date(events.find(event=>event.status===step.status&&event.kind!=='assignment').recordedAt).toLocaleString()}</time>}
            </li>
          ))}
        </ol>
      ) : (
        <p role="status">
          Workflow progress is unavailable for this status. Refresh your report.
        </p>
      )}
    </section>
  );
}
