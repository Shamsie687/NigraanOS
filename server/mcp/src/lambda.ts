import serverless from "serverless-http";
import type { Request } from "express";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { createApp, type Diagnostic } from "./handler.js";
import type { Config } from "./oauth.js";
import type { StateStore } from "./state.js";
import type { CallerFactory } from "./supabaseAdapter.js";
import { supabaseFactory } from "./supabaseAdapter.js";
import { DynamoStore } from "./dynamoStore.js";
import { KmsProtection } from "./credentialProtection.js";

export function createLambdaHandler(
  config: Config,
  factory: CallerFactory,
  store: StateStore,
  diagnostic: (d: Diagnostic) => void = () => {},
) {
  const addresses = new WeakMap<Request, string>();
  const { app } = createApp(
    config,
    factory,
    store,
    diagnostic,
    undefined,
    (req) => addresses.get(req) || "unknown",
  );
  const wrapped = serverless(app, {
    requestId: "",
    request: (req: Request, event: any) => {
      // Gateway-generated sourceIp only. Never trust X-Forwarded-For from clients.
      addresses.set(req, event.requestContext.http.sourceIp);
      // Hono (used by the official MCP SDK) reads IncomingMessage.rawHeaders.
      // serverless-http synthesizes headers but leaves rawHeaders empty.
      req.rawHeaders = Object.entries(req.headers).flatMap(([key, value]) =>
        value === undefined
          ? []
          : [key, Array.isArray(value) ? value.join(", ") : String(value)],
      );
    },
  });
  return async (event: any, context: object = {}) => {
    // This entry is solely HTTP API payload v2, not a generic Lambda invocation.
    if (
      event?.version !== "2.0" ||
      typeof event?.requestContext?.http?.sourceIp !== "string" ||
      typeof event?.requestContext?.http?.method !== "string" ||
      typeof event?.rawPath !== "string"
    )
      return {
        statusCode: 400,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
        body: JSON.stringify({ error: "invalid_request" }),
      };
    try {
      return await wrapped(event, context);
    } catch {
      return {
        statusCode: 503,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
        body: JSON.stringify({ error: "read_unavailable" }),
      };
    }
  };
}

export function productionConfig(env: NodeJS.ProcessEnv): Config {
  const required = (name: string) => {
    const v = env[name];
    if (!v) throw new Error("Missing production configuration.");
    return v;
  };
  const url = new URL(required("SUPABASE_URL")),
    key = required("SUPABASE_ANON_KEY");
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Invalid production configuration.");
  if (key.startsWith("sb_secret_"))
    throw new Error("Browser-safe configuration required.");
  if (!key.startsWith("sb_publishable_")) {
    try {
      if (
        JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString())
          .role !== "anon"
      )
        throw 0;
    } catch {
      throw new Error("Browser-safe configuration required.");
    }
  }
  const api = required("MCP_API_ID"),
    region = required("AWS_REGION");
  if (!/^[a-z0-9]+$/.test(api) || !/^[a-z]{2}-[a-z]+-\d$/.test(region))
    throw new Error("Invalid production configuration.");
  const consent = new URL(required("MCP_CONSENT_URL")),
    redirect = new URL(required("MCP_REDIRECT_URI"));
  for (const u of [consent, redirect])
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.hash ||
      u.search
    )
      throw new Error("HTTPS deployment configuration required.");
  required("MCP_STATE_TABLE");
  required("MCP_KMS_KEY_ID");
  return {
    origin: `https://${api}.execute-api.${region}.amazonaws.com`,
    consentUrl: consent.href,
    redirectUri: redirect.href,
    clientId: required("MCP_CLIENT_ID"),
    clientName: required("MCP_CLIENT_NAME"),
  };
}
let runtime: ReturnType<typeof createLambdaHandler> | undefined;
export async function handler(event: unknown, context: object) {
  try {
    if (!runtime) {
      const config = productionConfig(process.env);
      const options = {
        maxAttempts: 2,
        requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 },
      };
      const store = new DynamoStore(
        DynamoDBDocumentClient.from(new DynamoDBClient(options), {
          marshallOptions: { removeUndefinedValues: true },
        }),
        process.env.MCP_STATE_TABLE!,
        new KmsProtection(new KMSClient(options), process.env.MCP_KMS_KEY_ID!),
      );
      runtime = createLambdaHandler(
        config,
        supabaseFactory(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_ANON_KEY!,
        ),
        store,
        (d) =>
          console.info(
            JSON.stringify({
              stage: d.stage,
              code: d.code,
              status: d.status,
              durationMs: d.durationMs,
              ...(d.tool ? { tool: d.tool } : {}),
            }),
          ),
      );
    }
    return await runtime(event, context);
  } catch {
    // No raw SDK/config exceptions or invocation events reach CloudWatch.
    console.info(
      JSON.stringify({
        stage: "startup",
        code: "configuration_unavailable",
        status: 503,
      }),
    );
    return {
      statusCode: 503,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: JSON.stringify({ error: "read_unavailable" }),
    };
  }
}
