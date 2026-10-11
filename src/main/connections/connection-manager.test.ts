import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConnectionManager } from "./connection-manager";
import { ConnectionStore } from "./connection-store";
import type { QoderVerifier } from "./qoder-verifier";
import type { CredentialStore } from "../credentials/credential-store";
import { hostError } from "@shared/errors";

class MemoryCredentialStore implements CredentialStore {
  readonly secrets = new Map<string, string>();
  async set(key: string, secret: string): Promise<void> {
    this.secrets.set(key, secret);
  }
  async get(key: string): Promise<string | null> {
    return this.secrets.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
  }
}

const acceptingVerifier: QoderVerifier = { verify: () => Promise.resolve() };
const rejectingVerifier: QoderVerifier = {
  verify: () => Promise.reject(hostError("authentication", "invalid token")),
};

function togglingVerifier(): QoderVerifier {
  let calls = 0;
  return {
    verify: () => {
      calls++;
      return calls === 1 ? Promise.resolve() : Promise.reject(hostError("authentication", "bad"));
    },
  };
}

async function makeManager(
  verifier: QoderVerifier,
  options?: {
    setupEnvironment?: (
      connectionId: string,
      environmentId?: string,
    ) => Promise<import("@shared/models").EnvironmentSetupResult>;
    hasManagedScopes?: (connectionId: string) => Promise<boolean>;
  },
): Promise<{
  manager: ConnectionManager;
  credentials: MemoryCredentialStore;
  store: ConnectionStore;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "v2-connmgr-"));
  const credentials = new MemoryCredentialStore();
  const store = new ConnectionStore(join(dir, "connections.json"));
  const manager = new ConnectionManager({
    connectionStore: store,
    credentialStore: credentials,
    verifiers: { qoder: verifier, bailian: verifier },
    ...(options?.setupEnvironment ? { setupEnvironment: options.setupEnvironment } : {}),
    ...(options?.hasManagedScopes ? { hasManagedScopes: options.hasManagedScopes } : {}),
  });
  return {
    manager,
    credentials,
    store,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

const INPUT = { provider: "qoder", displayName: "主账号", credential: "pat-under-test" };

describe("ConnectionManager", () => {
  it("connect verifies then persists; list reflects stored credential", async () => {
    const { manager, credentials, cleanup } = await makeManager(acceptingVerifier);
    try {
      const view = await manager.connect(INPUT);
      expect(view.credentialStored).toBe(true);
      // 凭据只在安全存储，视图与元数据不回显。
      expect(JSON.stringify(view)).not.toContain(INPUT.credential);
      expect([...credentials.secrets.values()]).toEqual([INPUT.credential]);

      const listed = await manager.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ displayName: "主账号", credentialStored: true });
    } finally {
      await cleanup();
    }
  });

  it("rejects invalid credential without persisting anything", async () => {
    const { manager, credentials, cleanup } = await makeManager(rejectingVerifier);
    try {
      await expect(manager.connect(INPUT)).rejects.toMatchObject({
        code: "authentication",
      });
      expect(await manager.list()).toEqual([]);
      expect(credentials.secrets.size).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it("rolls back metadata when credential write fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-connmgr-"));
    try {
      const failingCredentials = new MemoryCredentialStore();
      failingCredentials.set = () => Promise.reject(new Error("disk full"));
      const manager = new ConnectionManager({
        connectionStore: new ConnectionStore(join(dir, "connections.json")),
        credentialStore: failingCredentials,
        verifiers: { qoder: acceptingVerifier },
      });

      await expect(manager.connect(INPUT)).rejects.toThrow("disk full");
      // 回滚后不应留下任何 Connection 元数据。
      expect(await manager.list()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("disconnect deletes only the credential; metadata remains", async () => {
    const { manager, credentials, cleanup } = await makeManager(acceptingVerifier);
    try {
      const view = await manager.connect(INPUT);
      await manager.disconnect(view.id);
      expect(credentials.secrets.size).toBe(0);
      const listed = await manager.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.credentialStored).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("disconnect of unknown connection is not-found", async () => {
    const { manager, cleanup } = await makeManager(acceptingVerifier);
    try {
      await expect(manager.disconnect("conn_missing")).rejects.toMatchObject({
        code: "not-found",
      });
    } finally {
      await cleanup();
    }
  });

  it("reconnect verifies and restores credential for disconnected connection", async () => {
    const { manager, credentials, cleanup } = await makeManager(acceptingVerifier);
    try {
      const view = await manager.connect(INPUT);
      await manager.disconnect(view.id);
      expect((await manager.list())[0]?.credentialStored).toBe(false);

      const restored = await manager.reconnect({ connectionId: view.id, credential: "new-pat" });
      expect(restored.credentialStored).toBe(true);
      expect(restored.displayName).toBe(INPUT.displayName);
      expect(restored.provider).toBe(INPUT.provider);
      expect([...credentials.secrets.values()]).toEqual(["new-pat"]);

      const listed = await manager.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.credentialStored).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("reconnect rejects invalid credential without writing", async () => {
    const { manager, credentials, cleanup } = await makeManager(togglingVerifier());
    try {
      const view = await manager.connect(INPUT);
      await manager.disconnect(view.id);
      await expect(
        manager.reconnect({ connectionId: view.id, credential: "bad-pat" }),
      ).rejects.toMatchObject({ code: "authentication" });
      expect(credentials.secrets.size).toBe(0);
      expect((await manager.list())[0]?.credentialStored).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("reconnect of unknown connection is not-found", async () => {
    const { manager, cleanup } = await makeManager(acceptingVerifier);
    try {
      await expect(
        manager.reconnect({ connectionId: "conn_missing", credential: "pat" }),
      ).rejects.toMatchObject({ code: "not-found" });
    } finally {
      await cleanup();
    }
  });

  it("rejects empty input and unknown provider before any network call", async () => {
    const { manager, cleanup } = await makeManager(acceptingVerifier);
    try {
      await expect(manager.connect({ ...INPUT, displayName: "  " })).rejects.toMatchObject({
        code: "invalid-input",
      });
      await expect(manager.connect({ ...INPUT, provider: "other" })).rejects.toMatchObject({
        code: "invalid-input",
      });
    } finally {
      await cleanup();
    }
  });

  it("updates local metadata without changing identity", async () => {
    const { manager, cleanup } = await makeManager(acceptingVerifier);
    try {
      const created = await manager.connect(INPUT);
      const updated = await manager.update({ connectionId: created.id, displayName: "新名称" });
      expect(updated).toMatchObject({
        id: created.id,
        provider: "qoder",
        displayName: "新名称",
        credentialStored: true,
      });
    } finally {
      await cleanup();
    }
  });

  it("verifies the currently stored credential", async () => {
    const { manager, cleanup } = await makeManager(togglingVerifier());
    try {
      const created = await manager.connect(INPUT);
      await expect(manager.verify(created.id)).rejects.toMatchObject({ code: "authentication" });
    } finally {
      await cleanup();
    }
  });

  it("removes an unreferenced connection and requires explicit managed-data removal", async () => {
    const { manager, cleanup } = await makeManager(acceptingVerifier);
    try {
      const created = await manager.connect(INPUT);
      await manager.remove(created.id, { removeManagedBotData: false });
      expect(await manager.list()).toEqual([]);
    } finally {
      await cleanup();
    }

    const dir = await mkdtemp(join(tmpdir(), "v2-connmgr-"));
    try {
      const guarded = new ConnectionManager({
        connectionStore: new ConnectionStore(join(dir, "connections.json")),
        credentialStore: new MemoryCredentialStore(),
        verifiers: { qoder: acceptingVerifier },
        countManagedScopes: () => Promise.resolve(1),
      });
      const created = await guarded.connect(INPUT);
      await expect(
        guarded.remove(created.id, { removeManagedBotData: false }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(await guarded.list()).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("removes managed local data only after explicit confirmation", async () => {
    const removeManagedScopes = vi.fn(() => Promise.resolve());
    const dir = await mkdtemp(join(tmpdir(), "v2-connmgr-"));
    try {
      const manager = new ConnectionManager({
        connectionStore: new ConnectionStore(join(dir, "connections.json")),
        credentialStore: new MemoryCredentialStore(),
        verifiers: { qoder: acceptingVerifier },
        countManagedScopes: () => Promise.resolve(2),
        removeManagedScopes,
      });
      const created = await manager.connect(INPUT);

      await manager.remove(created.id, { removeManagedBotData: true });

      expect(removeManagedScopes).toHaveBeenCalledWith(created.id);
      expect(await manager.list()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("setupEnvironment writes defaultEnvironmentId and returns ready", async () => {
    const { manager, cleanup } = await makeManager(acceptingVerifier, {
      setupEnvironment: async () => ({ status: "ready", environmentId: "env_shared" }),
    });
    try {
      const created = await manager.connect(INPUT);
      const result = await manager.setupEnvironment(created.id);
      expect(result).toEqual({ status: "ready", environmentId: "env_shared" });
      expect((await manager.list())[0]?.environmentReady).toBe(true);
      expect(await manager.getDefaultEnvironmentId(created.id)).toBe("env_shared");
    } finally {
      await cleanup();
    }
  });

  it("setupEnvironment selection-required does not write defaultEnvironmentId", async () => {
    const { manager, cleanup } = await makeManager(acceptingVerifier, {
      setupEnvironment: async () => ({
        status: "selection-required",
        candidates: [{ environmentId: "env_1", name: "one" }],
      }),
    });
    try {
      const created = await manager.connect(INPUT);
      const result = await manager.setupEnvironment(created.id);
      expect(result.status).toBe("selection-required");
      expect((await manager.list())[0]?.environmentReady).toBe(false);
      expect(await manager.getDefaultEnvironmentId(created.id)).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("workspace change is atomic: new credential + new workspaceId + clear binding in one write", async () => {
    const { manager, credentials, store, cleanup } = await makeManager(acceptingVerifier, {
      setupEnvironment: async () => ({ status: "ready", environmentId: "env_shared" }),
    });
    try {
      const created = await manager.connect(INPUT);
      await manager.setupEnvironment(created.id);
      expect((await manager.list())[0]?.environmentReady).toBe(true);

      const updated = await manager.update({
        connectionId: created.id,
        displayName: "新名称",
        workspaceId: "ws-2",
        credential: "new-pat",
      });
      expect(updated.workspaceId).toBe("ws-2");
      expect(updated.environmentReady).toBe(false);
      const stored = await store.list();
      expect(credentials.secrets.get(stored[0]!.credentialKey)).toBe("new-pat");
    } finally {
      await cleanup();
    }
  });

  it("workspace change rolls back credential when store update fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-connmgr-"));
    try {
      const credentials = new MemoryCredentialStore();
      const store = new ConnectionStore(join(dir, "connections.json"));
      const failingStore = {
        list: store.list.bind(store),
        add: store.add.bind(store),
        remove: store.remove.bind(store),
        update: async () => {
          throw new Error("store write failed");
        },
        setDefaultEnvironmentId: store.setDefaultEnvironmentId.bind(store),
      } as unknown as ConnectionStore;
      const manager = new ConnectionManager({
        connectionStore: failingStore,
        credentialStore: credentials,
        verifiers: { qoder: acceptingVerifier },
      });

      const created = await manager.connect(INPUT);
      const stored = await store.list();
      const credentialKey = stored[0]!.credentialKey;
      const originalCredential = credentials.secrets.get(credentialKey);

      await expect(
        manager.update({
          connectionId: created.id,
          displayName: "新名称",
          workspaceId: "ws-2",
          credential: "new-pat",
        }),
      ).rejects.toThrow("store write failed");

      // 回滚后凭据恢复为旧值，workspaceId 未变。
      expect(credentials.secrets.get(credentialKey)).toBe(originalCredential);
      const listed = await manager.list();
      expect(listed[0]?.workspaceId).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("workspace change without credential throws invalid-input before any write", async () => {
    const { manager, credentials, cleanup } = await makeManager(acceptingVerifier);
    try {
      const created = await manager.connect(INPUT);
      await expect(
        manager.update({
          connectionId: created.id,
          displayName: "新名称",
          workspaceId: "ws-2",
        }),
      ).rejects.toMatchObject({ code: "invalid-input" });
      expect(credentials.secrets.size).toBe(1);
      expect((await manager.list())[0]?.workspaceId).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it("displayName-only update keeps credential and environment binding untouched", async () => {
    const { manager, credentials, store, cleanup } = await makeManager(acceptingVerifier, {
      setupEnvironment: async () => ({ status: "ready", environmentId: "env_shared" }),
    });
    try {
      const created = await manager.connect(INPUT);
      await manager.setupEnvironment(created.id);
      const stored = await store.list();
      const credentialKey = stored[0]!.credentialKey;
      const originalCredential = credentials.secrets.get(credentialKey);

      const updated = await manager.update({
        connectionId: created.id,
        displayName: "新名称",
      });
      expect(updated.displayName).toBe("新名称");
      expect(updated.environmentReady).toBe(true);
      expect(credentials.secrets.get(credentialKey)).toBe(originalCredential);
    } finally {
      await cleanup();
    }
  });

  it("bailian workspaceId change requires credential and clears binding", async () => {
    const { manager, cleanup } = await makeManager(acceptingVerifier, {
      setupEnvironment: async () => ({ status: "ready", environmentId: "env_shared" }),
    });
    try {
      const created = await manager.connect({
        provider: "bailian",
        displayName: "百炼",
        credential: "dashscope-key",
        workspaceId: "ws-1",
      });
      await manager.setupEnvironment(created.id);
      expect((await manager.list())[0]?.environmentReady).toBe(true);

      const updated = await manager.update({
        connectionId: created.id,
        displayName: "百炼新",
        workspaceId: "ws-2",
        credential: "new-dashscope-key",
      });
      expect(updated.workspaceId).toBe("ws-2");
      expect(updated.environmentReady).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
