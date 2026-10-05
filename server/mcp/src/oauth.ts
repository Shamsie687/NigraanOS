import OAuth from "@node-oauth/oauth2-server";
import { z } from "zod";
import {
  opaque,
  type StateStore,
  type Grant,
  type StoredCode,
} from "./state.js";
import { SafeError, safe } from "./errors.js";
import type { CallerFactory } from "./supabaseAdapter.js";
export interface Config {
  origin: string;
  consentUrl: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
}
export const capabilities = [
  "Current city status",
  "Urgent review candidates",
  "Referenced incident metadata",
  "Modeled weather and air quality",
  "Published Citizen activity metadata",
];
const text = z.string().min(1).max(512);
const authInput = z
  .object({
    response_type: z.literal("code"),
    client_id: text,
    redirect_uri: text,
    resource: text,
    scope: z.literal("nigraan:read"),
    state: z.string().regex(/^[A-Za-z0-9_-]{22,128}$/),
    code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code_challenge_method: z.literal("S256"),
  })
  .strict();
const tokenInput = z
  .object({
    grant_type: z.literal("authorization_code"),
    client_id: text,
    redirect_uri: text,
    resource: text,
    code: text,
    code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  })
  .strict();
const decisionInput = z
  .object({
    transaction: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    state: authInput.shape.state,
    decision: z.enum(["approve", "deny"]),
  })
  .strict();
// JWT claims here provide a LOWER expiry bound only, after Auth verifies identity.
// They are never accepted as proof of authentication or Operations approval.
export function jwtExpiry(token: string) {
  try {
    const p = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    if (!Number.isSafeInteger(p.exp) || p.exp <= 0) throw 0;
    return p.exp * 1000;
  } catch {
    throw new SafeError("invalid_token", 401);
  }
}
export class Delegation {
  private oauth: OAuth;
  readonly resource: string;
  constructor(
    readonly config: Config,
    private store: StateStore,
    private factory: CallerFactory,
    private now = Date.now,
  ) {
    this.resource = config.origin + "/mcp";
    const client: OAuth.Client = {
      id: config.clientId,
      grants: ["authorization_code"],
      redirectUris: [config.redirectUri],
    };
    const model: OAuth.AuthorizationCodeModel = {
      getClient: async (id) => (id === config.clientId ? client : false),
      generateAccessToken: async () => opaque(),
      generateAuthorizationCode: async () => opaque(),
      generateRefreshToken: async () => "",
      getAccessToken: async () => false,
      validateScope: async (_u, _c, scope) =>
        scope?.length === 1 && scope[0] === "nigraan:read" ? scope : false,
      validateRedirectUri: async (uri) => uri === config.redirectUri,
      saveAuthorizationCode: async (code, c, u) => {
        const exp = Math.min(
          code.expiresAt.getTime(),
          Number(u.upstreamExpiry),
        );
        if (exp <= this.now()) throw new SafeError("invalid_token", 401);
        const record = {
          ...code,
          expiresAt: new Date(exp),
          client: c,
          user: u,
        };
        await store.putCode(code.authorizationCode, record as StoredCode);
        return record;
      },
      getAuthorizationCode: async (code) =>
        ((await store.getCode(code)) as OAuth.AuthorizationCode) || false,
      revokeAuthorizationCode: async (code) =>
        store.consumeCode(code.authorizationCode),
      saveToken: async (token, c, u) => {
        const expiry = Math.min(this.now() + 600000, Number(u.upstreamExpiry));
        if (expiry <= this.now()) throw new SafeError("invalid_grant");
        await factory(String(u.upstream)).authorize(String(u.id));
        const grant: Grant = {
          grantId: opaque(),
          userId: String(u.id),
          clientId: c.id,
          upstream: String(u.upstream),
          expiresAt: expiry,
          scope: "nigraan:read",
          resource: this.resource,
        };
        await store.putGrant(token.accessToken, grant);
        return {
          accessToken: token.accessToken,
          accessTokenExpiresAt: new Date(expiry),
          scope: ["nigraan:read"],
          client: c,
          user: { id: u.id },
        };
      },
    };
    this.oauth = new OAuth({
      model,
      authorizationCodeLifetime: 120,
      accessTokenLifetime: 600,
      allowEmptyState: false,
    });
  }
  async start(value: unknown) {
    const p = authInput.safeParse(value);
    if (!p.success) throw new SafeError("invalid_request");
    const q = p.data;
    if (
      q.client_id !== this.config.clientId ||
      q.redirect_uri !== this.config.redirectUri ||
      q.resource !== this.resource
    )
      throw new SafeError("invalid_request");
    const id = opaque();
    await this.store.putTransaction(id, {
      query: q,
      expiresAt: this.now() + 120000,
    });
    const url = new URL(this.config.consentUrl);
    url.hash = "/agent-consent?transaction=" + id;
    return url.href;
  }
  async inspect(id: string, upstream: string) {
    const tx = await this.store.getTransaction(id);
    if (!tx) throw new SafeError("invalid_request");
    const userId = await this.factory(upstream).authorize();
    if (!(await this.store.bindTransaction(id, userId)))
      throw new SafeError("access_denied", 403);
    return {
      clientName: this.config.clientName,
      scope: "nigraan:read",
      capabilities,
      state: tx.query.state,
      expiresAt: new Date(tx.expiresAt).toISOString(),
    };
  }
  async decide(value: unknown, upstream: string) {
    const p = decisionInput.safeParse(value);
    if (!p.success) throw new SafeError("invalid_request");
    const body = p.data;
    const tx = await this.store.getTransaction(body.transaction);
    if (!tx || tx.query.state !== body.state || !tx.userId)
      throw new SafeError("invalid_request");
    const userId = await this.factory(upstream).authorize(tx.userId);
    const exp = jwtExpiry(upstream);
    if (exp <= this.now()) throw new SafeError("invalid_token", 401);
    // Revalidate user/state inside atomic consume boundary. Concurrent requests
    // may inspect, but only one can consume a transaction and issue a code.
    const consumed = await this.store.consumeTransaction(body.transaction);
    if (
      !consumed ||
      consumed.userId !== userId ||
      consumed.query.state !== body.state
    )
      throw new SafeError("invalid_request");
    const target = new URL(this.config.redirectUri);
    target.searchParams.set("state", body.state);
    if (body.decision === "deny") {
      target.searchParams.set("error", "access_denied");
      return { redirect: target.href };
    }
    const request = new OAuth.Request({
        method: "GET",
        query: tx.query,
        headers: {},
      }),
      response = new OAuth.Response();
    try {
      const code = await this.oauth.authorize(request, response, {
        authenticateHandler: {
          handle: async () => ({ id: userId, upstream, upstreamExpiry: exp }),
        },
      });
      target.searchParams.set("code", code.authorizationCode);
      return { redirect: target.href };
    } catch {
      throw new SafeError("invalid_grant");
    }
  }
  async exchange(value: unknown) {
    const p = tokenInput.safeParse(value);
    if (!p.success) throw new SafeError("invalid_grant");
    const b = p.data;
    if (
      b.client_id !== this.config.clientId ||
      b.redirect_uri !== this.config.redirectUri ||
      b.resource !== this.resource
    )
      throw new SafeError("invalid_grant");
    try {
      const token = await this.oauth.token(
        new OAuth.Request({
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "content-length": String(
              Buffer.byteLength(new URLSearchParams(b).toString()),
            ),
          },
          query: {},
          body: b,
        }),
        new OAuth.Response(),
        { requireClientAuthentication: { authorization_code: false } },
      );
      return {
        access_token: token.accessToken,
        token_type: "Bearer",
        expires_in: Math.max(
          0,
          Math.floor(
            (token.accessTokenExpiresAt!.getTime() - this.now()) / 1000,
          ),
        ),
        scope: "nigraan:read",
      };
    } catch (error) {
      if (error instanceof SafeError) throw error;
      throw new SafeError("invalid_grant");
    }
  }
  async resolve(token: string) {
    const grant = await this.store.getGrant(token);
    if (
      !grant ||
      grant.resource !== this.resource ||
      grant.clientId !== this.config.clientId ||
      grant.scope !== "nigraan:read" ||
      grant.expiresAt <= this.now()
    )
      throw new SafeError("invalid_token", 401);
    return grant;
  }
}
