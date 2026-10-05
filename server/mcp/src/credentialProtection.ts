import { EncryptCommand, DecryptCommand } from "@aws-sdk/client-kms";
import { SafeError } from "./errors.js";

export interface CredentialProtection {
  encrypt(token: string, binding: string): Promise<string>;
  decrypt(ciphertext: string, binding: string): Promise<string>;
}
export interface KmsSender {
  send(command: any): Promise<any>;
}
// Context binds ciphertext to this application and hashed state-record key.
// Never pass user IDs, bearer tokens or upstream tokens as encryption context.
export class KmsProtection implements CredentialProtection {
  constructor(
    private client: KmsSender,
    private keyId: string,
  ) {}
  private context(binding: string) {
    return { application: "nigraan-mcp", record: binding };
  }
  async encrypt(token: string, binding: string) {
    try {
      const result = await this.client.send(
        new EncryptCommand({
          KeyId: this.keyId,
          Plaintext: Buffer.from(token),
          EncryptionContext: this.context(binding),
        }),
      );
      if (!result.CiphertextBlob?.length) throw 0;
      return Buffer.from(result.CiphertextBlob).toString("base64");
    } catch {
      throw new SafeError("read_unavailable", 503);
    }
  }
  async decrypt(ciphertext: string, binding: string) {
    try {
      const result = await this.client.send(
        new DecryptCommand({
          KeyId: this.keyId,
          CiphertextBlob: Buffer.from(ciphertext, "base64"),
          EncryptionContext: this.context(binding),
        }),
      );
      if (!result.Plaintext?.length) throw 0;
      return Buffer.from(result.Plaintext).toString();
    } catch {
      throw new SafeError("read_unavailable", 503);
    }
  }
}
