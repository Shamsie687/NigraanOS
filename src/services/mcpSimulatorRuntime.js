import { createSimulatorSession, simulatorConfig } from "./mcpSimulator.js";
let session, callbackPromise;
export function getSimulatorSession() {
  let storage;
  try {
    storage = typeof window !== "undefined" ? window.sessionStorage : undefined;
  } catch {
    /* blocked storage produces a clean authorization failure */
  }
  return session || (session = createSimulatorSession({ storage }));
}
export function configuredSimulator() {
  return simulatorConfig(
    import.meta.env.VITE_NIGRAAN_MCP_URL,
    window.location.origin,
  );
}
export function completeBrowserCallback(accountId) {
  if (!callbackPromise) {
    const callback = window.__nigraanMcpCallback;
    delete window.__nigraanMcpCallback;
    callbackPromise = (async () => {
      const s = getSimulatorSession();
      try {
        if (!callback) throw new Error("Missing callback");
        return await s.finish(callback, configuredSimulator(), accountId);
      } catch (e) {
        s.clearPending();
        throw e;
      }
    })();
  }
  return callbackPromise;
}
