import { useEffect, useState } from "react";
import {
  completeBrowserCallback,
  getSimulatorSession,
} from "../services/mcpSimulatorRuntime";
export default function AgentCallbackPage({ userId, approved }) {
  const [status, setStatus] = useState(
      "Completing read-only MCP authorization…",
    ),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    if (!userId || !approved) {
      getSimulatorSession().clearPending();
      delete window.__nigraanMcpCallback;
      setError(true);
      setStatus(
        "An approved Operations session is required. Sign in and start authorization again.",
      );
      return;
    }
    completeBrowserCallback(userId)
      .then(() => {
        if (active) {
          setStatus("Read-only MCP connected. Open Nigraan Agent to continue.");
          window.history.replaceState(null, "", "/#/operations");
          window.dispatchEvent(new Event("hashchange"));
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          setStatus(
            getSimulatorSession().snapshot().error ||
              "MCP authorization failed. Return to Nigraan Agent and start again.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [userId, approved]);
  return (
    <main className="citizen-main">
      <section className="panel">
        <h2>Simulated Alexa+ experience</h2>
        <p role={error ? "alert" : "status"}>{status}</p>
        {error && <a href="/#/operations">Return to Operations</a>}
      </section>
    </main>
  );
}
