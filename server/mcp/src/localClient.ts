import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { clientFlow } from "./clientFlow.js";
const config = {
  origin: "http://127.0.0.1:8787",
  consentUrl: "http://127.0.0.1:5173/",
  clientId: "nigraan-local",
  clientName: "Nigraan local MCP test client",
  redirectUri: "http://127.0.0.1:8788/callback",
};
let complete = false,
  pending = false,
  flow = clientFlow(config);
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.headers.host !== "127.0.0.1:8788" || req.method !== "GET") {
    res.writeHead(403);
    res.end("Request rejected.");
    return;
  }
  const url = new URL(req.url || "/", config.redirectUri);
  if (url.pathname === "/") {
    if (pending) {
      res.end("Authorization is active.");
      return;
    }
    flow = clientFlow(config);
    complete = false;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><html><body><h1>Local Nigraan MCP test</h1><p>Uses your NigraanOS login and explicit read-only consent.</p><a href="' +
        flow.authorizeUrl.replaceAll("&", "&amp;") +
        '">Start authorization</a></body></html>',
    );
    return;
  }
  if (url.pathname === "/complete") {
    res.end(
      complete
        ? "Local MCP initialization, five-tool listing and city-status read succeeded. Grant revoked after this test."
        : "Authorization denied, expired, or failed. Start a new request from the local client home page.",
    );
    return;
  }
  if (url.pathname !== "/callback" || pending) {
    res.writeHead(400);
    res.end("Request rejected.");
    return;
  }
  pending = true;
  let access: string | undefined;
  const client = new Client({ name: "nigraan-local", version: "0.1.0" });
  try {
    const body = flow.consume(url.href);
    const response = await fetch(config.origin + "/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("Authorization failed");
    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) throw new Error("Authorization failed");
    access = data.access_token;
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.origin + "/mcp"), {
        requestInit: { headers: { Authorization: "Bearer " + access } },
      }),
    );
    const tools = await client.listTools();
    if (tools.tools.length !== 5) throw new Error("Unexpected tools");
    const result = await client.callTool({
      name: "get_city_status",
      arguments: {},
    });
    if (result.isError || !result.structuredContent)
      throw new Error("Read failed");
    complete = true;
  } catch {
    /* Never print response bodies, code, tokens, or provider errors. */
  } finally {
    await client.close().catch(() => {});
    if (access)
      await fetch(config.origin + "/oauth/revoke", {
        method: "POST",
        headers: { Authorization: "Bearer " + access },
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    access = undefined;
    pending = false;
    res.writeHead(303, { Location: "/complete" });
    res.end();
  }
});
server.listen(8788, "127.0.0.1", () =>
  console.info(
    "Local MCP test client ready. Open http://127.0.0.1:8788/ to start.",
  ),
);
process.on("SIGINT", () => server.close());
process.on("SIGTERM", () => server.close());
