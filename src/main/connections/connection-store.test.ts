import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConnectionStore } from "./connection-store";

describe("ConnectionStore", () => {
  it("adds and lists connections without credentials in the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-conn-"));
    try {
      const store = new ConnectionStore(join(dir, "connections.json"));
      expect(await store.list()).toEqual([]);

      const a = await store.add({ provider: "qoder", displayName: "主账号" });
      const b = await store.add({ provider: "qoder", displayName: "备用" });
      expect(a.id).not.toBe(b.id);
      expect(a.credentialKey).not.toBe(b.credentialKey);

      const listed = await store.list();
      expect(listed.map((c) => c.displayName)).toEqual(["主账号", "备用"]);

      const onDisk = await readFile(join(dir, "connections.json"), "utf8");
      expect(JSON.parse(onDisk).version).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects corrupt file content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-conn-"));
    try {
      const file = join(dir, "connections.json");
      await writeFile(file, '{"version":2}', "utf8");
      const store = new ConnectionStore(file);
      await expect(store.list()).rejects.toThrow("corrupt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists defaultEnvironmentId via setDefaultEnvironmentId", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-conn-"));
    try {
      const store = new ConnectionStore(join(dir, "connections.json"));
      const added = await store.add({ provider: "qoder", displayName: "主账号" });
      expect(added.defaultEnvironmentId).toBeUndefined();

      const updated = await store.setDefaultEnvironmentId(added.id, "env_shared");
      expect(updated?.defaultEnvironmentId).toBe("env_shared");

      const listed = await store.list();
      expect(listed[0]?.defaultEnvironmentId).toBe("env_shared");

      const cleared = await store.setDefaultEnvironmentId(added.id, null);
      expect(cleared?.defaultEnvironmentId).toBeUndefined();
      expect((await store.list())[0]?.defaultEnvironmentId).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("update with clearDefaultEnvironmentId removes the binding in one write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-conn-"));
    try {
      const store = new ConnectionStore(join(dir, "connections.json"));
      const added = await store.add({ provider: "bailian", displayName: "百炼", workspaceId: "ws-1" });
      await store.setDefaultEnvironmentId(added.id, "env_shared");

      const updated = await store.update(added.id, {
        displayName: "百炼新",
        workspaceId: "ws-2",
        clearDefaultEnvironmentId: true,
      });
      expect(updated?.workspaceId).toBe("ws-2");
      expect(updated?.defaultEnvironmentId).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-string defaultEnvironmentId as corrupt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-conn-"));
    try {
      const file = join(dir, "connections.json");
      await writeFile(
        file,
        JSON.stringify({
          version: 1,
          connections: [
            {
              id: "conn_1",
              provider: "qoder",
              displayName: "x",
              credentialKey: "cred_1",
              defaultEnvironmentId: 123,
            },
          ],
        }),
        "utf8",
      );
      const store = new ConnectionStore(file);
      await expect(store.list()).rejects.toThrow("corrupt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
