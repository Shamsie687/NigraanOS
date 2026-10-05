import { createHash } from "node:crypto";
import { opaque } from "./state.js";
import { SafeError } from "./errors.js";
import type { Config } from "./oauth.js";
// Public development client. Verifier and state remain in client process memory.
export function clientFlow(config: Config, now = Date.now) {
  const verifier = opaque(),
    state = opaque(),
    expires = now() + 120000;
  let used = false;
  const url = new URL(config.origin + "/oauth/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    resource: config.origin + "/mcp",
    scope: "nigraan:read",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return {
    authorizeUrl: url.href,
    consume(callback: string) {
      if (used || now() >= expires) throw new SafeError("invalid_grant");
      const target = new URL(callback),
        expected = new URL(config.redirectUri);
      if (
        target.origin !== expected.origin ||
        target.pathname !== expected.pathname ||
        target.hash ||
        target.searchParams.getAll("state").length !== 1 ||
        target.searchParams.get("state") !== state ||
        [...target.searchParams.keys()].some(
          (k) => !["code", "state", "error"].includes(k),
        )
      )
        throw new SafeError("invalid_grant");
      used = true;
      if (
        target.searchParams.get("error") ||
        target.searchParams.getAll("code").length !== 1 ||
        !target.searchParams.get("code")
      )
        throw new SafeError("access_denied", 403);
      return {
        grant_type: "authorization_code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        resource: config.origin + "/mcp",
        code: target.searchParams.get("code")!,
        code_verifier: verifier,
      };
    },
  };
}
