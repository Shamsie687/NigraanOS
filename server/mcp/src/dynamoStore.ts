import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  hash,
  opaque,
  type StateStore,
  type Transaction,
  type StoredCode,
  type Grant,
  type Reference,
  type Binding,
} from "./state.js";
import type { CredentialProtection } from "./credentialProtection.js";
import { SafeError } from "./errors.js";

export interface DynamoSender {
  send(command: any): Promise<any>;
}
type Row = Record<string, any>;
const conditional = (e: unknown) =>
  (e as { name?: string })?.name === "ConditionalCheckFailedException";
// One regional table, no scans/indexes. Strong reads + conditional writes.
// expiresAt (ms) is authoritative; TTL (seconds) is asynchronous cleanup only.
export class DynamoStore implements StateStore {
  constructor(
    private db: DynamoSender,
    private table: string,
    private protection: CredentialProtection,
    private now = Date.now,
  ) {}
  private key(kind: string, id: string) {
    return kind + ":" + hash(id);
  }
  private async read(pk: string): Promise<Row | undefined> {
    return (
      await this.db.send(
        new GetCommand({
          TableName: this.table,
          Key: { pk },
          ConsistentRead: true,
        }),
      )
    ).Item;
  }
  private async put(pk: string, value: Row, expiresAt: number) {
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...value, pk, expiresAt, ttl: Math.ceil(expiresAt / 1000) },
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
  }
  private async live(pk: string) {
    const r = await this.read(pk);
    return r && r.expiresAt > this.now() ? r : undefined;
  }
  private async consume(pk: string): Promise<Row | undefined> {
    try {
      return (
        await this.db.send(
          new DeleteCommand({
            TableName: this.table,
            Key: { pk },
            ConditionExpression: "expiresAt > :now",
            ExpressionAttributeValues: { ":now": this.now() },
            ReturnValues: "ALL_OLD",
          }),
        )
      ).Attributes;
    } catch (e) {
      if (conditional(e)) return undefined;
      throw e;
    }
  }
  async putTransaction(id: string, value: Transaction) {
    await this.put(this.key("transaction", id), { value }, value.expiresAt);
  }
  async getTransaction(id: string) {
    return (await this.live(this.key("transaction", id)))?.value as
      | Transaction
      | undefined;
  }
  async consumeTransaction(id: string) {
    return (await this.consume(this.key("transaction", id)))?.value as
      | Transaction
      | undefined;
  }
  async bindTransaction(id: string, userId: string) {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk: this.key("transaction", id) },
          UpdateExpression: "SET #v.#u = :user",
          ConditionExpression:
            "expiresAt > :now AND (attribute_not_exists(#v.#u) OR #v.#u = :user)",
          ExpressionAttributeNames: { "#v": "value", "#u": "userId" },
          ExpressionAttributeValues: { ":now": this.now(), ":user": userId },
        }),
      );
      return true;
    } catch (e) {
      if (conditional(e)) return false;
      throw e;
    }
  }
  async putCode(code: string, value: StoredCode) {
    const pk = this.key("code", code);
    const { authorizationCode: _raw, expiresAt, user, ...rest } = value;
    const { upstream, ...safeUser } = user;
    if (typeof upstream !== "string") throw new SafeError("invalid_grant");
    const upstreamCiphertext = await this.protection.encrypt(upstream, pk);
    await this.put(
      pk,
      { value: { ...rest, user: safeUser }, upstreamCiphertext },
      expiresAt.getTime(),
    );
  }
  async getCode(code: string): Promise<StoredCode | undefined> {
    const pk = this.key("code", code),
      r = await this.live(pk);
    if (!r) return undefined;
    return {
      ...r.value,
      authorizationCode: code,
      expiresAt: new Date(r.expiresAt),
      user: {
        ...r.value.user,
        upstream: await this.protection.decrypt(r.upstreamCiphertext, pk),
      },
    };
  }
  async consumeCode(code: string) {
    return !!(await this.consume(this.key("code", code)));
  }
  async putGrant(token: string, value: Grant) {
    if (value.expiresAt <= this.now() || value.expiresAt > this.now() + 600000)
      throw new SafeError("invalid_grant");
    const pk = this.key("grant", token),
      { upstream, ...rest } = value;
    await this.put(
      pk,
      {
        value: rest,
        upstreamCiphertext: await this.protection.encrypt(upstream, pk),
      },
      value.expiresAt,
    );
  }
  async getGrant(token: string): Promise<Grant | undefined> {
    const pk = this.key("grant", token),
      r = await this.live(pk);
    if (!r || (await this.live(this.key("revoked", r.value.grantId))))
      return undefined;
    return {
      ...r.value,
      upstream: await this.protection.decrypt(r.upstreamCiphertext, pk),
    };
  }
  async revokeGrant(grantId: string) {
    // Tombstone lasts longer than every possible grant/ref, idempotent overwrite.
    const expiresAt = this.now() + 660000;
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          pk: this.key("revoked", grantId),
          expiresAt,
          ttl: Math.ceil(expiresAt / 1000),
        },
      }),
    );
  }
  async putReference(context: string, value: Reference) {
    if (value.expiresAt > this.now() + 300000)
      throw new SafeError("invalid_input");
    await this.put(this.key("reference", context), { value }, value.expiresAt);
  }
  async resolveReference(context: string, ref: string, binding: Binding) {
    const r = await this.read(this.key("reference", context));
    if (!r) throw new SafeError("unknown_reference");
    if (r.expiresAt <= this.now()) throw new SafeError("stale_reference");
    const v = r.value as Reference;
    if (
      v.userId !== binding.userId ||
      v.clientId !== binding.clientId ||
      v.grantId !== binding.grantId ||
      (await this.live(this.key("revoked", v.grantId))) ||
      !Object.hasOwn(v.mapping, ref)
    )
      throw new SafeError("unknown_reference");
    return v.mapping[ref];
  }
  // The user budget AND lease share one item. A CAS replacement atomically
  // admits both or neither. Rolling timestamps preserve the local quota semantics.
  private async mutate(pk: string, change: (row: Row | undefined) => Row) {
    for (let retry = 0; retry < 12; retry++) {
      const old = await this.read(pk),
        next = change(old);
      try {
        await this.db.send(
          new PutCommand({
            TableName: this.table,
            Item: {
              ...next,
              pk,
              version: (old?.version ?? 0) + 1,
              ttl: Math.ceil(next.expiresAt / 1000),
            },
            ConditionExpression: old
              ? "#version = :version"
              : "attribute_not_exists(pk)",
            ...(old
              ? {
                  ExpressionAttributeNames: { "#version": "version" },
                  ExpressionAttributeValues: { ":version": old.version },
                }
              : {}),
          }),
        );
        return next;
      } catch (e) {
        if (!conditional(e)) throw e;
      }
    }
    throw new SafeError("rate_limited", 429, 1);
  }
  async admit(userId: string) {
    const id = opaque();
    await this.mutate(this.key("budget", userId), (r) => {
      const n = this.now();
      if (r?.leaseExpiresAt > n) throw new SafeError("busy", 429, 13);
      const calls: number[] = (r?.calls ?? []).filter(
        (t: number) => t > n - 86400000,
      );
      const recent = calls.filter((t) => t > n - 60000);
      if (calls.length >= 500 || recent.length >= 30) {
        const end =
          calls.length >= 500 ? calls[0] + 86400000 : recent[0] + 60000;
        throw new SafeError(
          "rate_limited",
          429,
          Math.max(1, Math.ceil((end - n) / 1000)),
        );
      }
      return {
        calls: [...calls, n],
        lease: hash(id),
        leaseExpiresAt: n + 13000,
        expiresAt: n + 86400000,
      };
    });
    return id;
  }
  async release(userId: string, lease: string) {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk: this.key("budget", userId) },
          UpdateExpression:
            "REMOVE lease, leaseExpiresAt SET #version = #version + :one",
          ConditionExpression: "lease = :lease",
          ExpressionAttributeNames: { "#version": "version" },
          ExpressionAttributeValues: { ":lease": hash(lease), ":one": 1 },
        }),
      );
    } catch (e) {
      if (!conditional(e)) throw e;
    }
  }
  async control(key: string) {
    await this.mutate(this.key("control", key), (r) => {
      const n = this.now(),
        calls = (r?.calls ?? []).filter((t: number) => t > n - 60000);
      if (calls.length >= 60) throw new SafeError("rate_limited", 429, 60);
      return { calls: [...calls, n], expiresAt: n + 60000 };
    });
  }
  sweep() {
    /* DynamoDB TTL is cleanup, not authorization. */
  }
  close() {
    /* Never erase distributed state on Lambda shutdown. */
  }
}
