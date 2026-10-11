/**
 * CredentialStore：原始凭据的唯一持有者。
 * 生产实现：Electron safeStorage 加密后落盘 credentials.enc；
 * 测试注入确定性 fake。凭据不出现在日志、IPC 或明文文件中。
 */

import { readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { writeFileAtomic } from "../atomic-file";

export interface CredentialStore {
  set(key: string, secret: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

/** 与 Electron safeStorage 对齐的最小 seam，便于测试注入。 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux 上返回 "basic_text" 表示未加密回退。 */
  getSelectedStorageBackend?(): string;
}

interface CredentialsFile {
  version: 1;
  secrets: Record<string, string>;
}

export class SecureStorageUnavailableError extends Error {
  constructor() {
    super("secure storage unavailable");
    this.name = "SecureStorageUnavailableError";
  }
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function looksPlaintext(entries: Record<string, string>): boolean {
  return Object.values(entries).some((v) => !BASE64.test(v) || v.length % 4 !== 0);
}

export class EncryptedFileCredentialStore implements CredentialStore {
  readonly #filePath: string;
  readonly #safeStorage: SafeStorageLike;

  constructor(filePath: string, safeStorage: SafeStorageLike) {
    this.#filePath = filePath;
    this.#safeStorage = safeStorage;
  }

  #assertAvailable(): void {
    // Linux basic_text 是未加密回退：凭据落盘等价于明文，fail closed。
    if (
      process.platform === "linux" &&
      this.#safeStorage.getSelectedStorageBackend?.() === "basic_text"
    ) {
      throw new SecureStorageUnavailableError();
    }
    if (!this.#safeStorage.isEncryptionAvailable()) {
      throw new SecureStorageUnavailableError();
    }
  }

  async #readAll(): Promise<Record<string, string>> {
    let raw: string;
    try {
      raw = await readFile(this.#filePath, "utf8");
    } catch (error) {
      // 仅文件不存在视为空；EACCES/EPERM 等读取故障必须 fail closed，
      // 否则后续 set() 的 read-modify-write 会用空对象覆盖磁盘上的既有凭据。
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    let parsed: CredentialsFile;
    try {
      parsed = JSON.parse(raw) as CredentialsFile;
    } catch {
      throw new Error("credentials file corrupt");
    }
    if (parsed.version !== 1 || typeof parsed.secrets !== "object") {
      throw new Error("credentials file corrupt");
    }
    if (looksPlaintext(parsed.secrets)) {
      throw new Error("credentials file contains unencrypted data");
    }
    return parsed.secrets;
  }

  async #writeAll(secrets: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    const file: CredentialsFile = { version: 1, secrets };
    await writeFileAtomic(this.#filePath, JSON.stringify(file));
  }

  async set(key: string, secret: string): Promise<void> {
    this.#assertAvailable();
    const secrets = await this.#readAll();
    secrets[key] = this.#safeStorage.encryptString(secret).toString("base64");
    await this.#writeAll(secrets);
  }

  async get(key: string): Promise<string | null> {
    const secrets = await this.#readAll();
    const encoded = secrets[key];
    if (encoded === undefined) return null;
    this.#assertAvailable();
    return this.#safeStorage.decryptString(Buffer.from(encoded, "base64"));
  }

  async delete(key: string): Promise<void> {
    const secrets = await this.#readAll();
    if (!(key in secrets)) return;
    delete secrets[key];
    await this.#writeAll(secrets);
  }
}
