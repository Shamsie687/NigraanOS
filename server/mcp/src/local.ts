import { createApp } from "./handler.js";
import { MemoryStore } from "./state.js";
import { supabaseFactory } from "./supabaseAdapter.js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key)
  throw new Error(
    "Configure local SUPABASE_URL and SUPABASE_ANON_KEY. Never use a service-role key.",
  );
// Public anon/publishable configuration only. Fail closed on privileged JWTs.
if (key.startsWith("sb_secret_")) throw new Error("Browser-safe key required.");
try {
  if (
    key.split(".").length === 3 &&
    JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role ===
      "service_role"
  )
    throw new Error("Privileged key rejected.");
} catch (error) {
  throw new Error("Invalid or privileged configuration.");
}
const port = 8787;
const simulator = process.argv.includes("--simulator");
const frontend = process.argv.includes("--localhost") ? "http://localhost:5173" : "http://127.0.0.1:5173";
const store = new MemoryStore();
const { app } = createApp(
  {
    origin: "http://127.0.0.1:" + port,
    consentUrl: frontend + "/",
    clientId: simulator ? "nigraanos-alexa-simulator" : "nigraan-local",
    clientName: simulator ? "NigraanOS Alexa+ Simulator" : "Nigraan local MCP test client",
    redirectUri: simulator ? frontend + "/agent-callback" : "http://127.0.0.1:8788/callback",
  },
  supabaseFactory(url, key),
  store,
);
const cleanup = setInterval(() => store.sweep(), 30000);
cleanup.unref();
const server = app.listen(port, "127.0.0.1", () =>
  console.info("LOCAL DEVELOPMENT ONLY: Nigraan MCP listening on loopback."),
);
const close = () => {
  clearInterval(cleanup);
  store.close();
  server.close();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
