import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDesktopHost } from "./desktop-host";
import { ConnectionManager } from "./connections/connection-manager";
import { ConnectionStore } from "./connections/connection-store";
import type { CredentialStore } from "./credentials/credential-store";
import { ChatDataPlane } from "./data-plane/chat-data-plane";
import { ManagedBotStore } from "./control-plane/managed-bot-store";
import { ScopeLock } from "./control-plane/scope-lock";
import { BotControlPlane } from "./control-plane/bot-control-plane";
import { apiKeyScopeId } from "./api-key-scope";

const stubCredentialStore: CredentialStore = {
  set: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  delete: () => Promise.resolve(),
};

const stubBailianConsoleLogin = {
  start: () => Promise.reject(new Error("unused")),
  cancel: () => undefined,
};

function createPlane(botKeyScopeMarker?: string): ChatDataPlane {
  return new ChatDataPlane({
    chatAdapters: {
      qoder: () => ({
        listChats: () =>
          Promise.resolve([
            {
              ref: { connectionId: "", agentId: "a1", sessionId: "s1" },
              title: "Chat One",
              keyScopeMarker: apiKeyScopeId("qoder", "k"),
            },
          ]),
        getChat: () =>
          Promise.resolve({
            chat: {
              ref: { connectionId: "", agentId: "a1", sessionId: "s1" },
              title: "Chat One",
              keyScopeMarker: apiKeyScopeId("qoder", "k"),
            },
            messages: [],
            events: [],
          }),
        getKeyScopeMarker: () => Promise.resolve(apiKeyScopeId("qoder", "k")),
        createChat: (agentId, environmentId, _title, metadata) =>
          Promise.resolve({
            ref: { connectionId: "", agentId, sessionId: "s-new" },
            title: "New Chat",
            remoteStatus: environmentId,
            keyScopeMarker: metadata?.openagentbot_key_scope,
          }),
        sendMessage: () => Promise.resolve({ ok: true }),
        subscribe: () => Promise.resolve(() => {}),
        archiveChat: () => Promise.resolve(),
        deleteChat: () => Promise.resolve(),
      }),
    },
    botCatalogs: {
      qoder: () => ({
        listBots: () =>
          Promise.resolve([
            {
              agentId: "a1",
              name: "Bot One",
              managed: false,
              ...(botKeyScopeMarker ? { keyScopeMarker: botKeyScopeMarker } : {}),
            },
          ]),
      }),
    },
    resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
    resolveDefaultEnvironmentId: () => Promise.resolve("env-1"),
  });
}

/** 组装完整 DesktopHostOptions；store/control-plane 指向临时目录，不触发远程调用。 */
async function makeHost(
  dir: string,
  writeClipboardText = () => {},
): Promise<ReturnType<typeof createDesktopHost>> {
  const manager = new ConnectionManager({
    connectionStore: new ConnectionStore(join(dir, "connections.json")),
    credentialStore: stubCredentialStore,
    verifiers: {},
  });
  const managedBotStore = new ManagedBotStore(join(dir, "managed-bots"));
  const controlPlaneLock = new ScopeLock();
  const botControlPlane = new BotControlPlane({
    store: managedBotStore,
    lock: controlPlaneLock,
    resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
    resolveDefaultEnvironmentId: () => Promise.resolve("env-1"),
  });
  return createDesktopHost({
    version: "1.2.3",
    writeClipboardText,
    connectionManager: manager,
    bailianConsoleLogin: stubBailianConsoleLogin,
    chatDataPlane: createPlane(),
    botControlPlane,
    managedBotStore,
  });
}

describe("DesktopHost", () => {
  it("returns app version and delegates connections", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-host-"));
    try {
      const host = await makeHost(dir);
      await expect(host.app.version()).resolves.toBe("1.2.3");
      await expect(host.connections.list()).resolves.toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("百炼 Console 重连将新 API Key 和 Workspace 交给 ConnectionManager", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-host-"));
    try {
      const existing = {
        id: "conn-bailian",
        provider: "bailian",
        displayName: "Bailian",
        workspaceId: "ws-old",
        credentialStored: false,
        managedBotDataCount: 0,
        environmentReady: true,
      };
      const updated = { ...existing, workspaceId: "ws-new", credentialStored: true };
      const update = vi.fn(() => Promise.resolve(updated));
      const manager = {
        list: vi.fn(() => Promise.resolve([existing])),
        update,
      } as unknown as ConnectionManager;
      const managedBotStore = new ManagedBotStore(join(dir, "managed-bots"));
      const host = createDesktopHost({
        version: "1.2.3",
        writeClipboardText: () => {},
        connectionManager: manager,
        bailianConsoleLogin: {
          start: () => Promise.resolve({ apiKey: "sk-new", workspaceId: "ws-new" }),
          cancel: () => undefined,
        },
        chatDataPlane: createPlane(),
        botControlPlane: new BotControlPlane({
          store: managedBotStore,
          lock: new ScopeLock(),
          resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
          resolveDefaultEnvironmentId: () => Promise.resolve("env-1"),
        }),
        managedBotStore,
      });

      await expect(host.connections.reconnectBailianConsole(existing.id)).resolves.toEqual(updated);
      expect(update).toHaveBeenCalledWith({
        connectionId: existing.id,
        displayName: "Bailian",
        workspaceId: "ws-new",
        credential: "sk-new",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("通过 Main 能力复制精确文本，不依赖 Renderer Web Clipboard 权限", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-host-"));
    const writeClipboardText = vi.fn();
    try {
      const host = await makeHost(dir, writeClipboardText);
      await expect(host.app.copyText("**Markdown**\n")).resolves.toBeUndefined();
      expect(writeClipboardText).toHaveBeenCalledWith("**Markdown**\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bots.list binds connectionId and marks unscoped remote agents remote-only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-host-"));
    try {
      const host = await makeHost(dir);
      const bots = await host.bots.list("conn_1");
      expect(bots[0]?.ref).toEqual({ connectionId: "conn_1", agentId: "a1" });
      // 本地无 scope 管理 a1：即使 Provider metadata 启发式也标 remote-only。
      expect(bots[0]?.management).toBe("remote-only");

      const bot = await host.bots.get({ connectionId: "conn_1", agentId: "a1" });
      expect(bot.name).toBe("Bot One");

      await expect(
        host.bots.get({ connectionId: "conn_1", agentId: "missing" }),
      ).rejects.toMatchObject({ code: "not-found" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bots.list 当前 state 缺失但配对 backup 存在时把远程 Agent 标为 state-missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-host-"));
    try {
      // 手工 seed 一个 scope：phase=managed + project + backup(state 记录 a1)，当前 state 缺失。
      // 模拟"成功 Sync 后当前 state 被删除"：只有 backup 能证明历史关联。
      const scope = "scope_test_s08";
      const scopeDir = join(dir, "managed-bots", "conn_1", scope);
      await mkdir(join(scopeDir, "backup"), { recursive: true });
      await writeFile(
        join(scopeDir, "manifest.json"),
        JSON.stringify({
          version: 1,
          scope,
          connectionId: "conn_1",
          provider: "qoder",
          projectName: "openagentbot-test",
          phase: "managed",
        }),
        "utf8",
      );
      await writeFile(
        join(scopeDir, "agents.yaml"),
        'version: "1"\nagents:\n  Bot One:\n    name: Bot One\n',
        "utf8",
      );
      await writeFile(
        join(scopeDir, "backup", "agents.yaml"),
        'version: "1"\nagents:\n  Bot One:\n    name: Bot One\n',
        "utf8",
      );
      // backup state 记录 a1（当前 state 缺失）。形状遵循 SDK StateFile（resources/remote_id）。
      await writeFile(
        join(scopeDir, "backup", "agents.state.json"),
        JSON.stringify({
          version: 1,
          resources: [
            {
              address: { provider: "qoder", type: "agent", name: "Bot One" },
              remote_id: "a1",
              content_hash: "h",
            },
          ],
        }),
        "utf8",
      );

      const host = await makeHost(dir);
      const bots = await host.bots.list("conn_1");
      // 当前 state 缺失、配对 backup 存有历史 agentId：标 state-missing（诊断可见、写关闭）。
      expect(bots[0]?.management).toBe("state-missing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bots.list 远程归属为其他 Key 范围时，本地管理资料不再标 managed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-host-"));
    try {
      // seed 一个完整 managed scope：当前 state 记录 a1（本机持有管理资料）。
      const scope = "scope_test_other_scope";
      const scopeDir = join(dir, "managed-bots", "conn_1", scope);
      await mkdir(scopeDir, { recursive: true });
      await writeFile(
        join(scopeDir, "manifest.json"),
        JSON.stringify({
          version: 1,
          scope,
          connectionId: "conn_1",
          provider: "qoder",
          projectName: "openagentbot-test",
          phase: "managed",
        }),
        "utf8",
      );
      await writeFile(
        join(scopeDir, "agents.yaml"),
        'version: "1"\nagents:\n  Bot One:\n    name: Bot One\n',
        "utf8",
      );
      await writeFile(
        join(scopeDir, "agents.state.json"),
        JSON.stringify({
          version: 1,
          resources: [
            {
              address: { provider: "qoder", type: "agent", name: "Bot One" },
              remote_id: "a1",
              content_hash: "h",
            },
          ],
        }),
        "utf8",
      );

      // 更换凭据后的视图：同一远程 Agent 的归属标记属于其他 Key 范围。
      const plane = createPlane(apiKeyScopeId("qoder", "other-key"));
      const managedBotStore = new ManagedBotStore(join(dir, "managed-bots"));
      const manager = new ConnectionManager({
        connectionStore: new ConnectionStore(join(dir, "connections.json")),
        credentialStore: stubCredentialStore,
        verifiers: {},
      });
      const host = createDesktopHost({
        version: "1.2.3",
        writeClipboardText: () => {},
        connectionManager: manager,
        bailianConsoleLogin: stubBailianConsoleLogin,
        chatDataPlane: plane,
        botControlPlane: new BotControlPlane({
          store: managedBotStore,
          lock: new ScopeLock(),
          resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
          resolveDefaultEnvironmentId: () => Promise.resolve("env-1"),
        }),
        managedBotStore,
      });

      const bots = await host.bots.list("conn_1");
      expect(bots[0]?.keyScope).toBe("other");
      expect(bots[0]?.management).toBe("remote-only");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bots.list 当前 state 与配对 backup 均缺失时不猜测归属，保持 remote-only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-host-"));
    try {
      // 手工 seed 一个 scope：phase=managed + project，但当前 state 与 backup 均缺失。
      const scope = "scope_test_s08_nobackup";
      const scopeDir = join(dir, "managed-bots", "conn_1", scope);
      await mkdir(scopeDir, { recursive: true });
      await writeFile(
        join(scopeDir, "manifest.json"),
        JSON.stringify({
          version: 1,
          scope,
          connectionId: "conn_1",
          provider: "qoder",
          projectName: "openagentbot-test",
          phase: "managed",
        }),
        "utf8",
      );
      await writeFile(
        join(scopeDir, "agents.yaml"),
        'version: "1"\nagents:\n  Bot One:\n    name: Bot One\n',
        "utf8",
      );

      const host = await makeHost(dir);
      const bots = await host.bots.list("conn_1");
      // 无任何可信关联证据：不按名称/metadata 认领，保持 remote-only。
      expect(bots[0]?.management).toBe("remote-only");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("chats.list and chats.get delegate to data plane", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-host-"));
    try {
      const host = await makeHost(dir);
      const chats = await host.chats.list({ connectionId: "conn_1", agentId: "a1" });
      expect(chats[0]?.ref).toEqual({ connectionId: "conn_1", agentId: "a1", sessionId: "s1" });

      const detail = await host.chats.get({
        connectionId: "conn_1",
        agentId: "a1",
        sessionId: "s1",
      });
      expect(detail.chat.title).toBe("Chat One");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("chats.create resolves environment and binds ref; chats.send delegates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-host-"));
    try {
      const host = await makeHost(dir);
      // createChat stub 把 environmentId 透传到 remoteStatus，验证 DataPlane 解析生效。
      const chat = await host.chats.create({ connectionId: "conn_1", agentId: "a1" });
      expect(chat.ref).toEqual({ connectionId: "conn_1", agentId: "a1", sessionId: "s-new" });
      expect(chat.remoteStatus).toBe("env-1");

      const send = await host.chats.send(
        { connectionId: "conn_1", agentId: "a1", sessionId: "s1" },
        "hello",
      );
      expect(send.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bots.archive forwards the exact ref to BotControlPlane and propagates its error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-host-"));
    try {
      const managedBotStore = new ManagedBotStore(join(dir, "managed-bots"));
      const archived: { connectionId: string; agentId: string }[] = [];
      let archiveError: { code: string; message: string } | null = null;
      const botControlPlane = new BotControlPlane({
        store: managedBotStore,
        lock: new ScopeLock(),
        resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
        resolveDefaultEnvironmentId: () => Promise.resolve("env-1"),
      });
      // 用 stub 替换真实归档：记录入参并按需抛错；不触发任何远程或文件副作用。
      botControlPlane.archive = (ref) => {
        archived.push({ connectionId: ref.connectionId, agentId: ref.agentId });
        return archiveError === null ? Promise.resolve() : Promise.reject(archiveError);
      };
      const host = createDesktopHost({
        version: "1.2.3",
        writeClipboardText: () => {},
        connectionManager: new ConnectionManager({
          connectionStore: new ConnectionStore(join(dir, "connections.json")),
          credentialStore: stubCredentialStore,
          verifiers: {},
        }),
        bailianConsoleLogin: stubBailianConsoleLogin,
        chatDataPlane: createPlane(),
        botControlPlane,
        managedBotStore,
      });

      const ref = { connectionId: "conn_1", agentId: "a1" };
      await expect(host.bots.archive(ref)).resolves.toBeUndefined();
      expect(archived).toEqual([{ connectionId: "conn_1", agentId: "a1" }]);

      archiveError = { code: "managed-state-missing", message: "state missing" };
      await expect(host.bots.archive(ref)).rejects.toMatchObject({
        code: "managed-state-missing",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
