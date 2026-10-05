import { createHash, randomBytes } from "node:crypto";
import { SafeError } from "./errors.js";
export const opaque = () => randomBytes(32).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export interface Binding {
  userId: string;
  clientId: string;
  grantId: string;
}
export interface Grant extends Binding {
  upstream: string;
  expiresAt: number;
  resource: string;
  scope: "nigraan:read";
}
export interface Transaction {
  query: Record<string, string>;
  expiresAt: number;
  userId?: string;
}
export interface StoredCode {
  expiresAt: Date;
  authorizationCode: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  client: { id: string };
  user: Record<string, unknown>;
  scope?: string[];
}
export interface Reference extends Binding {
  expiresAt: number;
  mapping: Record<string, string>;
}
// Each mutation must be atomic in future distributed adapters. No callback-based
// read/modify/write contracts: these become DynamoDB conditional writes/transactions.
export interface StateStore {
  putTransaction(id: string, value: Transaction): Promise<void>;
  getTransaction(id: string): Promise<Transaction | undefined>;
  consumeTransaction(id: string): Promise<Transaction | undefined>;
  bindTransaction(id: string, userId: string): Promise<boolean>;
  putCode(code: string, value: StoredCode): Promise<void>;
  getCode(code: string): Promise<StoredCode | undefined>;
  consumeCode(code: string): Promise<boolean>;
  putGrant(token: string, value: Grant): Promise<void>;
  getGrant(token: string): Promise<Grant | undefined>;
  revokeGrant(grantId: string): Promise<void>;
  putReference(context: string, value: Reference): Promise<void>;
  resolveReference(
    context: string,
    ref: string,
    binding: Binding,
  ): Promise<string>;
  admit(userId: string): Promise<string>;
  release(userId: string, lease: string): Promise<void>;
  control(key: string): Promise<void>;
  sweep(): void;
  close(): void;
}
// DEVELOPMENT/TEST ONLY. Credentials are plaintext in bounded process memory.
// No disk persistence, encryption claim, refresh tokens, or multi-instance safety.
export class MemoryStore implements StateStore {
  private transactions = new Map<string, Transaction>();
  private codes = new Map<string, StoredCode>();
  private grants = new Map<string, Grant>();
  private references = new Map<string, Reference>();
  private calls = new Map<string, number[]>();
  private leases = new Map<string, { id: string; expiresAt: number }>();
  private controls = new Map<string, number[]>();
  constructor(
    private now = Date.now,
    private capacity = 2000,
  ) {}
  sweep() {
    const n = this.now();
    for (const [k, v] of this.transactions)
      if (v.expiresAt <= n) this.transactions.delete(k);
    for (const [k, v] of this.codes)
      if (v.expiresAt.getTime() <= n) this.codes.delete(k);
    for (const [k, v] of this.grants)
      if (v.expiresAt <= n) this.grants.delete(k);
    for (const [k, v] of this.references)
      if (v.expiresAt <= n) this.references.delete(k);
    for (const [k, v] of this.leases)
      if (v.expiresAt <= n) this.leases.delete(k);
    for (const [k, v] of this.calls) {
      const a = v.filter((t) => t > n - 86400000);
      if (a.length) this.calls.set(k, a);
      else this.calls.delete(k);
    }
    for (const [k, v] of this.controls) {
      const a = v.filter((t) => t > n - 60000);
      if (a.length) this.controls.set(k, a);
      else this.controls.delete(k);
    }
  }
  private room(map: Map<string, unknown>) {
    this.sweep();
    if (map.size >= this.capacity) throw new SafeError("rate_limited", 429, 60);
  }
  async putTransaction(id: string, v: Transaction) {
    this.room(this.transactions);
    this.transactions.set(hash(id), v);
  }
  async getTransaction(id: string) {
    this.sweep();
    return this.transactions.get(hash(id));
  }
  async consumeTransaction(id: string) {
    const key = hash(id),
      v = this.transactions.get(key);
    if (!v || v.expiresAt <= this.now()) return undefined;
    this.transactions.delete(key);
    return v;
  }
  async bindTransaction(id: string, userId: string) {
    const v = this.transactions.get(hash(id));
    if (!v || v.expiresAt <= this.now() || (v.userId && v.userId !== userId))
      return false;
    v.userId = userId;
    return true;
  }
  async putCode(code: string, v: StoredCode) {
    this.room(this.codes);
    this.codes.set(hash(code), v);
  }
  async getCode(code: string) {
    this.sweep();
    return this.codes.get(hash(code));
  }
  async consumeCode(code: string) {
    const key = hash(code),
      v = this.codes.get(key);
    if (!v || v.expiresAt.getTime() <= this.now()) return false;
    return this.codes.delete(key);
  }
  async putGrant(token: string, v: Grant) {
    this.room(this.grants);
    this.grants.set(hash(token), v);
  }
  async getGrant(token: string) {
    this.sweep();
    return this.grants.get(hash(token));
  }
  async revokeGrant(id: string) {
    for (const [k, v] of this.grants)
      if (v.grantId === id) this.grants.delete(k);
    for (const [k, v] of this.references)
      if (v.grantId === id) this.references.delete(k);
  }
  async putReference(context: string, v: Reference) {
    this.room(this.references);
    this.references.set(hash(context), v);
  }
  async resolveReference(context: string, ref: string, b: Binding) {
    const v = this.references.get(hash(context));
    if (!v) throw new SafeError("unknown_reference");
    if (v.expiresAt <= this.now()) {
      this.references.delete(hash(context));
      throw new SafeError("stale_reference");
    }
    if (
      v.userId !== b.userId ||
      v.clientId !== b.clientId ||
      v.grantId !== b.grantId
    )
      throw new SafeError("unknown_reference");
    if (!v.mapping[ref]) throw new SafeError("unknown_reference");
    return v.mapping[ref];
  }
  async admit(userId: string) {
    this.sweep();
    const n = this.now();
    if (this.leases.has(userId)) throw new SafeError("busy", 429, 13);
    const a = this.calls.get(userId) || [];
    if (a.length >= 500)
      throw new SafeError(
        "rate_limited",
        429,
        Math.max(1, Math.ceil((a[0] + 86400000 - n) / 1000)),
      );
    const recent = a.filter((t) => t > n - 60000);
    if (recent.length >= 30)
      throw new SafeError(
        "rate_limited",
        429,
        Math.max(1, Math.ceil((recent[0] + 60000 - n) / 1000)),
      );
    if (!this.calls.has(userId)) this.room(this.calls);
    a.push(n);
    this.calls.set(userId, a);
    const id = opaque();
    this.leases.set(userId, { id, expiresAt: n + 13000 });
    return id;
  }
  async release(userId: string, lease: string) {
    if (this.leases.get(userId)?.id === lease) this.leases.delete(userId);
  }
  async control(key: string) {
    this.sweep();
    const a = this.controls.get(key) || [];
    if (a.length >= 60) throw new SafeError("rate_limited", 429, 60);
    if (!this.controls.has(key)) this.room(this.controls);
    a.push(this.now());
    this.controls.set(key, a);
  }
  close() {
    this.transactions.clear();
    this.codes.clear();
    this.grants.clear();
    this.references.clear();
    this.calls.clear();
    this.leases.clear();
    this.controls.clear();
  }
}
