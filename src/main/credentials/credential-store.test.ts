import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  EncryptedFileCredentialStore,
  SecureStorageUnavailableError,
} from "./credential-store";
import type { SafeStorageLike } from "./credential-store";

function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`, "utf8"),
    decryptString: (encrypted: Buffer) => {
      const text = encrypted.toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("bad blob");
      return text.slice(4);
    },
  };
}

describe("EncryptedFileCredentialStore", () => {
  it("set/get/delete round-trips without plaintext on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-cred-"));
    try {
      const store = new EncryptedFileCredentialStore(
        join(dir, "credentials.enc"),
        fakeSafeStorage(),
      );
      const secret = "qoder-pat-unit-test-secret";

      expect(await store.get("k1")).toBeNull();
      await store.set("k1", secret);
      expect(await store.get("k1")).toBe(secret);

      // 磁盘上不得出现明文凭据。
      const onDisk = await readFile(join(dir, "credentials.enc"), "utf8");
      expect(onDisk).not.toContain(secret);

      await store.delete("k1");
      expect(await store.get("k1")).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails closed when encryption is unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-cred-"));
    try {
      const store = new EncryptedFileCredentialStore(
        join(dir, "credentials.enc"),
        fakeSafeStorage(false),
      );
      await expect(store.set("k", "s")).rejects.toBeInstanceOf(
        SecureStorageUnavailableError,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails closed on unreadable file (EACCES) instead of returning empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-cred-"));
    try {
      const file = join(dir, "credentials.enc");
      const store = new EncryptedFileCredentialStore(file, fakeSafeStorage());
      await store.set("k1", "secret-1");

      // 使文件不可读
      await chmod(file, 0o000);

      // get 应抛错，不能静默返回 null
      await expect(store.get("k1")).rejects.toThrow();
      // set 同样必须失败：不得用空 map 覆盖销毁已有凭据
      await expect(store.set("k2", "secret-2")).rejects.toThrow();

      // 恢复权限以便校验与清理
      await chmod(file, 0o600);
      // 文件未被覆盖：原有凭据仍可读取
      await expect(store.get("k1")).resolves.toBe("secret-1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails closed on plaintext or corrupt file content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-cred-"));
    try {
      const file = join(dir, "credentials.enc");
      await writeFile(
        file,
        JSON.stringify({ version: 1, secrets: { k: "plaintext-secret" } }),
        "utf8",
      );
      const store = new EncryptedFileCredentialStore(file, fakeSafeStorage());
      await expect(store.get("k")).rejects.toThrow();

      await writeFile(file, "not-json", "utf8");
      await expect(store.get("k")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
