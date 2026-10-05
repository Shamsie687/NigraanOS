import test from "node:test";
import assert from "node:assert/strict";
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { EncryptCommand, DecryptCommand } from "@aws-sdk/client-kms";
import { DynamoStore, type DynamoSender } from "../src/dynamoStore.js";
import {
  KmsProtection,
  type CredentialProtection,
} from "../src/credentialProtection.js";
import { hash, type Grant, type StoredCode } from "../src/state.js";
import { Delegation } from "../src/oauth.js";
import { createLambdaHandler } from "../src/lambda.js";
import { fixtures, upstream } from "./helpers.js";

// Atomic command emulator, not a production adapter. No AWS credentials/network.
export class FakeDynamo implements DynamoSender {
  rows = new Map<string, any>();
  commands: any[] = [];
  async send(command: any) {
    // Yield before the atomic operation so races perform competing stale reads.
    await Promise.resolve();
    this.commands.push(command);
    const p = command.input,
      key = p.Key?.pk ?? p.Item?.pk,
      old = this.rows.get(key);
    const fail = () => {
      throw Object.assign(new Error("condition"), {
        name: "ConditionalCheckFailedException",
      });
    };
    const c = p.ConditionExpression,
      a = p.ExpressionAttributeValues;
    if (c === "attribute_not_exists(pk)" && old) fail();
    if (c === "#version = :version" && old?.version !== a[":version"]) fail();
    if (c === "expiresAt > :now" && !(old?.expiresAt > a[":now"])) fail();
    if (
      c?.startsWith("expiresAt > :now AND") &&
      (!(old?.expiresAt > a[":now"]) ||
        (old.value.userId && old.value.userId !== a[":user"]))
    )
      fail();
    if (c === "lease = :lease" && old?.lease !== a[":lease"]) fail();
    if (command instanceof GetCommand) {
      assert.equal(p.ConsistentRead, true);
      return { Item: old && structuredClone(old) };
    }
    if (command instanceof PutCommand) {
      this.rows.set(key, structuredClone(p.Item));
      return {};
    }
    if (command instanceof DeleteCommand) {
      this.rows.delete(key);
      return { Attributes: old && structuredClone(old) };
    }
    if (command instanceof UpdateCommand) {
      if (p.UpdateExpression.startsWith("SET")) old.value.userId = a[":user"];
      else {
        delete old.lease;
        delete old.leaseExpiresAt;
        old.version++;
      }
      return {};
    }
    throw new Error("Unexpected command");
  }
}
function setup() {
  let n = Date.now();
  const secrets = new Map<string, { token: string; binding: string }>();
  const protection: CredentialProtection = {
    async encrypt(token, binding) {
      const id = `cipher-${secrets.size}`;
      secrets.set(id, { token, binding });
      return id;
    },
    async decrypt(id, binding) {
      const v = secrets.get(id);
      assert.equal(v?.binding, binding);
      return v!.token;
    },
  };
  const db = new FakeDynamo(),
    store = new DynamoStore(db, "test-table", protection, () => n);
  return {
    db,
    store,
    protection,
    advance: (ms: number) => (n += ms),
    now: () => n,
  };
}
const binding = { userId: "user", clientId: "client", grantId: "grant" };
const code = (n: number): StoredCode => ({
  authorizationCode: "raw-code",
  expiresAt: new Date(n + 120000),
  redirectUri: "https://client.example/callback",
  client: { id: "client" },
  user: {
    id: "user",
    upstream: "PRIVATE_UPSTREAM",
    upstreamExpiry: n + 600000,
  },
  scope: ["nigraan:read"],
});
const grant = (n: number): Grant => ({
  ...binding,
  upstream: "PRIVATE_UPSTREAM",
  expiresAt: n + 600000,
  resource: "https://mcp.example/mcp",
  scope: "nigraan:read",
});

test("Dynamo code encrypted, hash-only key, reconstructed Date and one-time concurrent consume", async () => {
  const s = setup();
  await s.store.putCode("raw-code", code(s.now()));
  const persisted = JSON.stringify([...s.db.rows.values()]);
  assert.ok(!persisted.includes("PRIVATE_UPSTREAM"));
  assert.ok(!persisted.includes("raw-code"));
  assert.equal(
    (await s.store.getCode("raw-code"))?.authorizationCode,
    "raw-code",
  );
  assert.ok((await s.store.getCode("raw-code"))?.expiresAt instanceof Date);
  const results = await Promise.all(
    Array.from({ length: 16 }, () => s.store.consumeCode("raw-code")),
  );
  assert.equal(results.filter(Boolean).length, 1);
});
test("expired code remains physically present but cannot be read or redeemed", async () => {
  const s = setup();
  await s.store.putCode("raw-code", code(s.now()));
  s.advance(120000);
  assert.equal(await s.store.getCode("raw-code"), undefined);
  assert.equal(await s.store.consumeCode("raw-code"), false);
  assert.equal(s.db.rows.size, 1);
});
test("transaction binding cannot switch users and atomic consume returns one transaction", async () => {
  const s = setup();
  await s.store.putTransaction("tx", {
    query: { state: "state" },
    expiresAt: s.now() + 120000,
  });
  assert.equal(await s.store.bindTransaction("tx", "user"), true);
  assert.equal(await s.store.bindTransaction("tx", "attacker"), false);
  assert.equal(
    (
      await Promise.all([
        s.store.consumeTransaction("tx"),
        s.store.consumeTransaction("tx"),
      ])
    ).filter(Boolean).length,
    1,
  );
  await s.store.putTransaction("expired", {
    query: {},
    expiresAt: s.now() - 1,
  });
  assert.equal(await s.store.bindTransaction("expired", "user"), false);
});
test("grant hash lookup encrypts upstream; revocation invalidates grants and contexts on another instance", async () => {
  const s = setup(),
    second = new DynamoStore(s.db, "test-table", s.protection, s.now);
  await s.store.putGrant("RAW_MCP_TOKEN", grant(s.now()));
  await s.store.putReference("context", {
    ...binding,
    expiresAt: s.now() + 300000,
    mapping: { I1: "private-row-id" },
  });
  assert.equal(
    (await second.getGrant("RAW_MCP_TOKEN"))?.upstream,
    "PRIVATE_UPSTREAM",
  );
  assert.equal(await second.getGrant("wrong"), undefined);
  const persisted = JSON.stringify([...s.db.rows.values()]);
  assert.ok(!persisted.includes("RAW_MCP_TOKEN"));
  assert.ok(!persisted.includes("PRIVATE_UPSTREAM"));
  assert.ok(s.db.rows.has("grant:" + hash("RAW_MCP_TOKEN")));
  await second.revokeGrant(binding.grantId);
  assert.equal(await s.store.getGrant("RAW_MCP_TOKEN"), undefined);
  await assert.rejects(s.store.resolveReference("context", "I1", binding), {
    code: "unknown_reference",
  });
});
test("grant expiry checked before decryption, no TTL cleanup needed", async () => {
  const s = setup();
  await s.store.putGrant("token", grant(s.now()));
  s.advance(600000);
  assert.equal(await s.store.getGrant("token"), undefined);
});
test("references enforce user/client/grant binding, alias and expiry", async () => {
  const s = setup();
  await s.store.putReference("ctx", {
    ...binding,
    expiresAt: s.now() + 300000,
    mapping: { I1: "private-id" },
  });
  assert.equal(
    await s.store.resolveReference("ctx", "I1", binding),
    "private-id",
  );
  for (const field of ["userId", "clientId", "grantId"])
    await assert.rejects(
      s.store.resolveReference("ctx", "I1", { ...binding, [field]: "wrong" }),
      { code: "unknown_reference" },
    );
  await assert.rejects(s.store.resolveReference("ctx", "I2", binding), {
    code: "unknown_reference",
  });
  s.advance(300000);
  await assert.rejects(s.store.resolveReference("ctx", "I1", binding), {
    code: "stale_reference",
  });
});
test("distributed admission allows one winner; busy requests do not spend quota", async () => {
  const s = setup();
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => s.store.admit("user")),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(s.db.rows.get("budget:" + hash("user")).calls.length, 1);
  for (const r of results)
    if (r.status === "rejected") assert.equal(r.reason.code, "busy");
});
test("lease expiry recovers crashes; stale release cannot clear new lease", async () => {
  const s = setup(),
    first = await s.store.admit("user");
  s.advance(13000);
  const second = await s.store.admit("user");
  await s.store.release("user", first);
  await assert.rejects(s.store.admit("user"), { code: "busy" });
  await s.store.release("user", second);
  await s.store.admit("user");
});
test("rolling minute quota is 30 and resets exactly at its boundary", async () => {
  const s = setup();
  for (let i = 0; i < 30; i++) {
    const lease = await s.store.admit("u");
    await s.store.release("u", lease);
  }
  await assert.rejects(s.store.admit("u"), { code: "rate_limited" });
  s.advance(60000);
  await s.store.admit("u");
});
test("rolling day quota is 500 and remains across minute resets", async () => {
  const s = setup();
  for (let i = 0; i < 500; i++) {
    if (i && i % 30 === 0) s.advance(60000);
    const lease = await s.store.admit("u");
    await s.store.release("u", lease);
  }
  await assert.rejects(s.store.admit("u"), { code: "rate_limited" });
  s.advance(86400000);
  await s.store.admit("u");
});
test("atomic control counter admits only remaining slot under contention", async () => {
  const s = setup();
  for (let i = 0; i < 59; i++) await s.store.control("ip");
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => s.store.control("ip")),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  s.advance(60000);
  await s.store.control("ip");
});
test("KMS commands bind ciphertext to record, round trip and fail closed", async () => {
  const commands: any[] = [];
  const client = {
    async send(c: any) {
      commands.push(c);
      return c instanceof EncryptCommand
        ? { CiphertextBlob: Buffer.from("ciphertext") }
        : { Plaintext: Buffer.from("UPSTREAM") };
    },
  };
  const p = new KmsProtection(client, "key");
  const encrypted = await p.encrypt("UPSTREAM", "grant:hash");
  assert.equal(await p.decrypt(encrypted, "grant:hash"), "UPSTREAM");
  assert.ok(commands[1] instanceof DecryptCommand);
  for (const c of commands)
    assert.deepEqual(c.input.EncryptionContext, {
      application: "nigraan-mcp",
      record: "grant:hash",
    });
  const broken = new KmsProtection(
    {
      async send() {
        throw new Error("PRIVATE_PROVIDER_MESSAGE");
      },
    },
    "key",
  );
  await assert.rejects(broken.encrypt("SECRET", "hash"), {
    code: "read_unavailable",
  });
  await assert.rejects(broken.decrypt(encrypted, "hash"), {
    code: "read_unavailable",
  });
});
test("KMS failure never writes plaintext credentials", async () => {
  const db = new FakeDynamo(),
    broken = {
      async encrypt() {
        throw new Error("kms");
      },
      async decrypt() {
        throw new Error("kms");
      },
    };
  const store = new DynamoStore(db, "test", broken);
  await assert.rejects(store.putGrant("token", grant(Date.now())));
  assert.equal(db.rows.size, 0);
  await assert.rejects(store.putCode("code", code(Date.now())));
  assert.equal(db.rows.size, 0);
});
test("real OAuth library concurrent exchange produces one grant with Dynamo state", async () => {
  const s = setup(),
    f = fixtures();
  const config = {
    origin: "https://mcp.example",
    consentUrl: "https://frontend.example/",
    clientId: "client",
    clientName: "Test",
    redirectUri: "https://client.example/callback",
  };
  const d = new Delegation(config, s.store, f.factory, s.now);
  const verifier = "v".repeat(43);
  const challenge = Buffer.from(hash(verifier), "hex").toString("base64url");
  const target = await d.start({
    response_type: "code",
    client_id: "client",
    redirect_uri: config.redirectUri,
    resource: d.resource,
    scope: "nigraan:read",
    state: "s".repeat(24),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const tx = new URLSearchParams(new URL(target).hash.split("?")[1]).get(
    "transaction",
  )!;
  await d.inspect(tx, upstream(s.now() + 3600000));
  const decision = await d.decide(
    { transaction: tx, state: "s".repeat(24), decision: "approve" },
    upstream(s.now() + 3600000),
  );
  const issued = new URL(decision.redirect).searchParams.get("code")!;
  const request = {
    grant_type: "authorization_code",
    client_id: "client",
    redirect_uri: config.redirectUri,
    resource: d.resource,
    code: issued,
    code_verifier: verifier,
  };
  const results = await Promise.allSettled([
    d.exchange(request),
    d.exchange(request),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

test("Lambda SDK city-status read uses distributed state and revocation", async () => {
  const s = setup(), f = fixtures();
  const live = new DynamoStore(s.db, "test-table", s.protection);
  const config = {origin: "https://mcp.example", consentUrl: "https://frontend.example/",
    clientId: "client", clientName: "Test", redirectUri: "https://client.example/callback"};
  await live.putGrant("token", {...grant(Date.now()), userId: "owner", upstream: upstream()});
  const invoke = createLambdaHandler(config, f.factory, live);
  const request = {version: "2.0", rawPath: "/mcp", rawQueryString: "", isBase64Encoded: false,
    requestContext: {http: {method: "POST", sourceIp: "192.0.2.2"}},
    headers: {host: "mcp.example", authorization: "Bearer token", "content-type": "application/json",
      accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "tools/call", params: {name: "get_city_status", arguments: {}}})};
  const response = await invoke(structuredClone(request)) as any;
  assert.equal(response.statusCode, 200);
  assert.ok(!JSON.parse(response.body).result.isError);
  assert.equal([...s.db.rows.values()].filter(row => row.pk.startsWith("reference:")).length, 1);
  await live.revokeGrant("grant");
  assert.equal((await invoke(structuredClone(request)) as any).statusCode, 401);
});
