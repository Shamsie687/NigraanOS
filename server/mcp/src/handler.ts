import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  InitializeRequestSchema,
  JSONRPCRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Delegation, type Config } from "./oauth.js";
import { MemoryStore, hash, opaque, type StateStore } from "./state.js";
import { SafeError, safe } from "./errors.js";
import { inputs, outputs, names, type ToolName } from "./schemas.js";
import { BOUNDS, runTool } from "./tools.js";
import type { CallerFactory } from "./supabaseAdapter.js";
export const ORIGINS = [
  "https://nigraanos.netlify.app",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];
export interface Diagnostic {
  requestId: string;
  stage: "http" | "tool";
  code: string;
  status: number;
  durationMs: number;
  tool?: ToolName;
}
export function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
) {
  const controller = new AbortController();
  let timer: NodeJS.Timeout;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SafeError("timeout", 504));
    }, ms);
  });
  return Promise.race([work(controller.signal), timeout]).finally(() =>
    clearTimeout(timer),
  );
}
export function createApp(
  config: Config,
  factory: CallerFactory,
  store: StateStore = new MemoryStore(),
  diagnostic: (value: Diagnostic) => void = () => {},
  deadline = BOUNDS.deadline,
  sourceAddress: (req: Request) => string = (req) => req.socket.remoteAddress || "local",
) {
  const app = express(),
    delegation = new Delegation(config, store, factory);
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  const emit = (d: Diagnostic) => {
    try {
      diagnostic({
        requestId: d.requestId,
        stage: d.stage,
        code: d.code,
        status: d.status,
        durationMs: d.durationMs,
        ...(d.tool && names.includes(d.tool) ? { tool: d.tool } : {}),
      });
    } catch {
      /* diagnostics cannot affect authorization */
    }
  };
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    const origin = req.get("origin");
    if (origin && !ORIGINS.includes(origin)) {
      res.status(403).json({ error: "access_denied" });
      return;
    }
    if (req.get("host") !== new URL(config.origin).host) {
      res.status(403).json({ error: "access_denied" });
      return;
    }
    if (origin)
      res.set({
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type, MCP-Protocol-Version",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Expose-Headers":
          "WWW-Authenticate, Retry-After, MCP-Protocol-Version",
      });
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    if (Object.keys(req.query).some((k) => /token|authorization/i.test(k))) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    next();
  });
  app.use(express.json({ limit: 16384 }));
  app.use(
    express.urlencoded({ extended: false, limit: 16384, parameterLimit: 12 }),
  );
  const bearer = (req: Request) => {
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(
      req.get("authorization") || "",
    );
    if (!match) throw new SafeError("invalid_token", 401);
    return match[1];
  };
  const route =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };
  const control = async (req: Request) =>
    store.control("ip:" + hash(sourceAddress(req)));
  const grantCheck = async (req: Request) => {
    const grant = await delegation.resolve(bearer(req));
    try {
      await withDeadline(
        (signal) => factory(grant.upstream).authorize(grant.userId, signal),
        deadline,
      );
    } catch (error) {
      const e = safe(error);
      if (e.status === 401 || e.status === 403)
        await store.revokeGrant(grant.grantId);
      throw e;
    }
    return grant;
  };
  app.get(
    "/.well-known/oauth-protected-resource/mcp",
    route(async (req, res) => {
      await control(req);
      res.json({
        resource: delegation.resource,
        authorization_servers: [config.origin],
        scopes_supported: ["nigraan:read"],
        bearer_methods_supported: ["header"],
      });
    }),
  );
  app.get(
    "/.well-known/oauth-authorization-server",
    route(async (req, res) => {
      await control(req);
      res.json({
        issuer: config.origin,
        authorization_endpoint: config.origin + "/oauth/authorize",
        token_endpoint: config.origin + "/oauth/token",
        revocation_endpoint: config.origin + "/oauth/revoke",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["nigraan:read"],
      });
    }),
  );
  app.get(
    "/oauth/authorize",
    route(async (req, res) => {
      await control(req);
      res.redirect(302, await delegation.start(req.query));
    }),
  );
  app.get(
    "/delegation/request",
    route(async (req, res) => {
      await control(req);
      if (
        Object.keys(req.query).some((k) => k !== "transaction") ||
        typeof req.query.transaction !== "string"
      )
        throw new SafeError("invalid_request");
      res.json(
        await withDeadline(
          () =>
            delegation.inspect(req.query.transaction as string, bearer(req)),
          deadline,
        ),
      );
    }),
  );
  app.post(
    "/delegation/decision",
    route(async (req, res) => {
      await control(req);
      res.json(
        await withDeadline(
          () => delegation.decide(req.body, bearer(req)),
          deadline,
        ),
      );
    }),
  );
  app.post(
    "/oauth/token",
    route(async (req, res) => {
      await control(req);
      res.json(
        await withDeadline(() => delegation.exchange(req.body), deadline),
      );
    }),
  );
  app.post(
    "/oauth/revoke",
    route(async (req, res) => {
      await control(req);
      const grant = await delegation.resolve(bearer(req));
      await store.revokeGrant(grant.grantId);
      res.sendStatus(204);
    }),
  );
  app.all(
    "/mcp",
    route(async (req, res) => {
      const requestId = opaque(),
        start = Date.now(),
        grant = await delegation.resolve(bearer(req));
      let lease: string | undefined;
      let server: McpServer | undefined;
      let transport: StreamableHTTPServerTransport | undefined;
      let accessFailure: SafeError | undefined;
      try {
        if (req.method !== "POST") {
          await grantCheck(req);
          res.set("Allow", "POST, OPTIONS").sendStatus(405);
          return;
        }
        if (
          req.body?.method !== "initialize" &&
          req.get("mcp-protocol-version") &&
          req.get("mcp-protocol-version") !== "2025-11-25"
        )
          throw new SafeError("invalid_request");
        // The SDK retains legacy batch handling. This version-specific boundary
        // forbids batches, including mixed calls that could otherwise skip admission.
        if (Array.isArray(req.body)) {
          await control(req);
          await grantCheck(req);
          res.status(400).json({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32600,
              message: "Batch requests are not supported.",
            },
          });
          return;
        }
        const call =
          req.body?.method === "tools/call" &&
          JSONRPCRequestSchema.safeParse(req.body).success;
        if (call) lease = await store.admit(grant.userId);
        else await control(req);
        await grantCheck(req);
        if (call) {
          const name = req.body?.params?.name;
          if (!names.includes(name)) {
            res.json({
              jsonrpc: "2.0",
              id: req.body?.id ?? null,
              error: { code: -32602, message: "Unsupported tool." },
            });
            return;
          }
          if (
            !inputs[name as ToolName].safeParse(req.body.params.arguments ?? {})
              .success
          ) {
            res.json({
              jsonrpc: "2.0",
              id: req.body?.id ?? null,
              result: {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      error: {
                        code: "invalid_input",
                        message: "Unsupported tool input.",
                      },
                    }),
                  },
                ],
              },
            });
            return;
          }
        }
        server = new McpServer({
          name: "NigraanOS read tools",
          version: "0.1.0",
        });
        // Public SDK handler extension: this server supports one version. During
        // initialization the lifecycle specification requires offering a supported
        // alternative, rather than rejecting a client's proposed version outright.
        // No sampling, prompts, resources or server-initiated capabilities are used.
        server.server.setRequestHandler(InitializeRequestSchema, async () => ({
          protocolVersion: "2025-11-25",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "NigraanOS read tools", version: "0.1.0" },
        }));
        for (const name of names) {
          server.registerTool(
            name,
            {
              description:
                name === "get_city_conditions"
                  ? "Modeled context, not incident verification."
                  : "Authorized recorded metadata only; not verified severity or emergency confirmation.",
              inputSchema: inputs[name],
              outputSchema: outputs[name],
              annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              },
            },
            async (args: unknown) => {
              try {
                const result = await withDeadline(
                  (signal) =>
                    runTool(
                      name,
                      args,
                      factory(grant.upstream),
                      grant,
                      store,
                      signal,
                    ),
                  Math.max(1, deadline - (Date.now() - start)),
                );
                if (!(await store.getGrant(bearer(req))))
                  throw new SafeError("invalid_token", 401);
                const envelope = {
                  content: [
                    { type: "text" as const, text: JSON.stringify(result) },
                  ],
                  structuredContent: result,
                };
                if (
                  Buffer.byteLength(
                    JSON.stringify({
                      jsonrpc: "2.0",
                      id: req.body.id,
                      result: envelope,
                    }),
                  ) > BOUNDS.response
                )
                  throw new SafeError("read_budget_exceeded");
                emit({
                  requestId,
                  stage: "tool",
                  tool: name,
                  code: "ok",
                  status: 200,
                  durationMs: Date.now() - start,
                });
                return envelope;
              } catch (error) {
                const e = safe(error);
                if (e.status === 401 || e.status === 403) {
                  await store.revokeGrant(grant.grantId);
                  accessFailure = e;
                }
                emit({
                  requestId,
                  stage: "tool",
                  tool: name,
                  code: e.code,
                  status: e.status,
                  durationMs: Date.now() - start,
                });
                return {
                  isError: true,
                  content: [
                    {
                      type: "text" as const,
                      text: JSON.stringify({
                        error: { code: e.code, message: e.message },
                      }),
                    },
                  ],
                };
              }
            },
          );
        }
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await server.connect(transport);
        // SDK owns JSON-RPC and transport semantics. Buffer only this bounded JSON
        // response to enforce whole-response size, including schema/list envelopes.
        bufferResponse(res, () => accessFailure, config.origin);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        const e = safe(error);
        emit({
          requestId,
          stage: "http",
          code: e.code,
          status: e.status,
          durationMs: Date.now() - start,
        });
        throw e;
      } finally {
        await server?.close();
        await transport?.close();
        if (lease) await store.release(grant.userId, lease);
      }
    }),
  );
  app.use((_req, res) => {
    res.status(404).json({ error: "invalid_request" });
  });
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (res.headersSent) return;
      const syntax = error instanceof SyntaxError;
      const large = (error as { type?: string })?.type === "entity.too.large";
      const e =
        syntax || large
          ? new SafeError("invalid_request", large ? 413 : 400)
          : safe(error);
      if (e.status === 401)
        res.set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`,
        );
      if (e.retryAfter) res.set("Retry-After", String(e.retryAfter));
      res.status(e.status).json({ error: e.code, message: e.message });
    },
  );
  return { app, delegation, store };
}
// Streamable HTTP is JSON-only here: bounded buffering also prevents delivery
// of a success body after authorization is revoked during an SDK tool callback.
export function bufferResponse(
  res: Response,
  failure: () => SafeError | undefined,
  origin: string,
  limit = BOUNDS.response,
) {
  const end = res.end.bind(res),
    writeHead = res.writeHead,
    write = res.write;
  const chunks: Buffer[] = [];
  let bytes = 0,
    overflow = false;
  const append = (chunk: unknown) => {
    if (chunk === undefined || chunk === null) return;
    const b = Buffer.isBuffer(chunk)
      ? chunk
      : ArrayBuffer.isView(chunk)
        ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : Buffer.from(String(chunk));
    bytes += b.length;
    if (bytes > limit) {
      overflow = true;
      chunks.length = 0;
    } else if (!overflow) chunks.push(b);
  };
  res.writeHead = ((status: number, ...args: unknown[]) => {
    res.statusCode = status;
    const headers = args.find((v) => v && typeof v === "object");
    if (headers && !Array.isArray(headers))
      for (const [k, v] of Object.entries(headers))
        if (v !== undefined) res.setHeader(k, v as string);
    return res;
  }) as typeof res.writeHead;
  res.write = ((chunk: unknown, ...args: unknown[]) => {
    append(chunk);
    const callback = args.find((v) => typeof v === "function");
    if (callback) (callback as Function)();
    return true;
  }) as typeof res.write;
  res.end = ((chunk?: unknown, ...args: unknown[]) => {
    append(chunk);
    const error = failure();
    let body = Buffer.concat(chunks);
    if (error || overflow) {
      res.statusCode = error?.status ?? 500;
      body = Buffer.from(
        JSON.stringify({
          error: error?.code ?? "read_budget_exceeded",
          message: error?.message ?? "Response budget exceeded.",
        }),
      );
      res.removeHeader("content-length");
      res.setHeader("Content-Type", "application/json");
      if (error?.status === 401)
        res.setHeader(
          "WWW-Authenticate",
          `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`,
        );
    }
    res.writeHead = writeHead;
    res.write = write;
    return (end as Function)(body, ...args);
  }) as typeof res.end;
}
