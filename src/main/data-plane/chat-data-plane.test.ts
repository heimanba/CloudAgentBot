import { describe, expect, it, vi, afterEach } from "vitest";
import { ChatDataPlane } from "./chat-data-plane";
import type { ChatAdapter } from "./chat-adapter";
import { isHostError } from "@shared/errors";
import { API_KEY_SCOPE_METADATA_KEY, apiKeyScopeId } from "../api-key-scope";

/**
 * ChatDataPlane 组装测试。保护的风险：
 * - connectionId 没有绑定到返回的 ref（Renderer 无法路由后续调用）；
 * - management 标志没有从 BotCatalogView 映射到 BotView；
 * - unknown connection/provider 的错误分类漂移。
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return handler(url, init);
  });
  return calls;
}

function createPlane() {
  const chatAdapter: ChatAdapter = {
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
    createChat: (agentId, environmentId) =>
      Promise.resolve({
        ref: { connectionId: "", agentId, sessionId: "s-new" },
        title: "New Chat",
        remoteStatus: environmentId,
      }),
    sendMessage: () => Promise.resolve({ ok: true }),
    subscribe: () => Promise.resolve(() => {}),
    archiveChat: () => Promise.resolve(),
    deleteChat: () => Promise.resolve(),
  };

  return new ChatDataPlane({
    chatAdapters: { qoder: () => chatAdapter },
    botCatalogs: {
      qoder: () => ({
        listBots: () =>
          Promise.resolve([
            { agentId: "a1", name: "Bot One", managed: true },
            {
              agentId: "a2",
              name: "Bot Two",
              managed: false,
              shared: true,
              keyScopeMarker: apiKeyScopeId("qoder", "k"),
            },
          ]),
      }),
    },
    resolveCredential: (connectionId) => {
      if (connectionId !== "conn_1") {
        return Promise.reject({
          code: "not-found",
          message: `connection not found: ${connectionId}`,
        });
      }
      return Promise.resolve({ provider: "qoder", credential: "k" });
    },
  });
}

describe("ChatDataPlane", () => {
  it("listBots binds connectionId and maps management", async () => {
    const plane = createPlane();
    const bots = await plane.listBots("conn_1");
    expect(bots).toHaveLength(2);
    expect(bots[0]).toMatchObject({
      ref: { connectionId: "conn_1", agentId: "a1" },
      management: "managed",
    });
    expect(bots[1]).toMatchObject({
      ref: { connectionId: "conn_1", agentId: "a2" },
      management: "remote-only",
      shared: true,
      keyScope: "current",
    });
  });

  it("marks Bot scope without exposing the fingerprint and preserves Provider-visible sharing across scopes", async () => {
    const currentScope = apiKeyScopeId("qoder", "k");
    const plane = new ChatDataPlane({
      chatAdapters: {},
      botCatalogs: {
        qoder: () => ({
          listBots: () =>
            Promise.resolve([
              {
                agentId: "current",
                name: "Current",
                managed: false,
                shared: true,
                keyScopeMarker: currentScope,
              },
              {
                agentId: "foreign",
                name: "Foreign",
                managed: false,
                shared: true,
                keyScopeMarker: "foreign",
              },
              { agentId: "legacy", name: "Legacy", managed: false, shared: true },
            ]),
        }),
      },
      resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
    });
    const bots = await plane.listBots("conn_1");
    expect(bots.map(({ ref, keyScope, shared }) => [ref.agentId, keyScope, shared])).toEqual([
      ["current", "current", true],
      ["foreign", "other", true],
      ["legacy", "ungrouped", true],
    ]);
    expect(JSON.stringify(bots)).not.toContain(currentScope);
  });

  it("listChats binds connectionId into each chat ref", async () => {
    const plane = createPlane();
    const chats = await plane.listChats("conn_1", "a1");
    expect(chats[0]?.ref).toEqual({ connectionId: "conn_1", agentId: "a1", sessionId: "s1" });
  });

  it("shows current-key and explicitly shared foreign Sessions and strips the stored marker", async () => {
    const current = apiKeyScopeId("qoder", "k");
    const adapter: ChatAdapter = {
      listChats: () =>
        Promise.resolve([
          {
            ref: { connectionId: "", agentId: "a", sessionId: "mine" },
            title: "Mine",
            keyScopeMarker: current,
          },
          { ref: { connectionId: "", agentId: "a", sessionId: "legacy" }, title: "Legacy" },
          {
            ref: { connectionId: "", agentId: "a", sessionId: "other" },
            title: "Other",
            keyScopeMarker: "foreign-scope",
          },
          {
            ref: { connectionId: "", agentId: "a", sessionId: "shared" },
            title: "Shared",
            keyScopeMarker: "foreign-scope",
            shared: true,
          },
        ]),
      getChat: async () => {
        throw new Error("unused");
      },
      getKeyScopeMarker: () => Promise.resolve(undefined),
      createChat: async () => {
        throw new Error("unused");
      },
      sendMessage: async () => ({ ok: true }),
      subscribe: async () => () => undefined,
      archiveChat: async () => undefined,
      deleteChat: async () => undefined,
    };
    const plane = new ChatDataPlane({
      chatAdapters: { qoder: () => adapter },
      botCatalogs: {},
      resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
    });
    const chats = await plane.listChats("conn_1", "a");
    expect(chats.map((chat) => [chat.ref.sessionId, chat.keyScope, chat.shared])).toEqual([
      ["mine", "current", undefined],
      ["shared", "other", true],
    ]);
    expect(JSON.stringify(chats)).not.toContain(current);
  });

  it("blocks direct access to a Session marked for another API Key", async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ ok: true }));
    const adapter: ChatAdapter = {
      listChats: async () => [],
      getChat: async () => ({
        chat: {
          ref: { connectionId: "", agentId: "a", sessionId: "foreign" },
          title: "Other",
          keyScopeMarker: "foreign-scope",
        },
        messages: [],
        events: [],
      }),
      getKeyScopeMarker: () => Promise.resolve("foreign-scope"),
      createChat: async () => {
        throw new Error("unused");
      },
      sendMessage,
      subscribe: async () => () => undefined,
      archiveChat: async () => undefined,
      deleteChat: async () => undefined,
    };
    const plane = new ChatDataPlane({
      chatAdapters: { qoder: () => adapter },
      botCatalogs: {},
      resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
    });
    await expect(plane.getChat("conn_1", "foreign")).rejects.toMatchObject({ code: "not-found" });
    await expect(plane.sendMessage("conn_1", "foreign", "hello")).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(plane.subscribe("conn_1", "foreign", () => undefined)).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(plane.archiveChat("conn_1", "foreign")).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(plane.deleteChat("conn_1", "foreign")).rejects.toMatchObject({
      code: "not-found",
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("allows shared foreign Sessions to be read and continued but blocks owner actions", async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ ok: true }));
    const archiveChat = vi.fn(() => Promise.resolve());
    const deleteChat = vi.fn(() => Promise.resolve());
    const setChatShared = vi.fn(async () => ({
      ref: { connectionId: "", agentId: "a", sessionId: "shared" },
      title: "Shared",
      keyScopeMarker: "foreign-scope",
      shared: true,
    }));
    const adapter: ChatAdapter = {
      listChats: async () => [],
      getChat: async () => ({
        chat: {
          ref: { connectionId: "", agentId: "a", sessionId: "shared" },
          title: "Shared",
          keyScopeMarker: "foreign-scope",
          shared: true,
        },
        messages: [],
        events: [],
      }),
      getKeyScopeMarker: () => Promise.resolve("foreign-scope"),
      getChatAccess: () => Promise.resolve({ keyScopeMarker: "foreign-scope", shared: true }),
      setChatShared,
      createChat: async () => {
        throw new Error("unused");
      },
      sendMessage,
      subscribe: async () => () => undefined,
      archiveChat,
      deleteChat,
    };
    const plane = new ChatDataPlane({
      chatAdapters: { qoder: () => adapter },
      botCatalogs: {},
      resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
    });

    await expect(plane.getChat("conn_1", "shared")).resolves.toMatchObject({
      chat: { keyScope: "other", shared: true },
    });
    await expect(plane.sendMessage("conn_1", "shared", "hello")).resolves.toEqual({ ok: true });
    await expect(plane.subscribe("conn_1", "shared", () => undefined)).resolves.toEqual(
      expect.any(Function),
    );
    await expect(plane.archiveChat("conn_1", "shared")).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(plane.deleteChat("conn_1", "shared")).rejects.toMatchObject({ code: "not-found" });
    await expect(plane.setChatShared("conn_1", "shared", false)).rejects.toMatchObject({
      code: "not-found",
    });
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith("shared", "hello", undefined);
    expect(archiveChat).not.toHaveBeenCalled();
    expect(deleteChat).not.toHaveBeenCalled();
    expect(setChatShared).not.toHaveBeenCalled();
  });

  it("blocks direct access to ungrouped Sessions", async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ ok: true }));
    const getChat = vi.fn(async () => ({
      chat: { ref: { connectionId: "", agentId: "a", sessionId: "legacy" }, title: "Legacy" },
      messages: [],
      events: [],
    }));
    const adapter: ChatAdapter = {
      listChats: async () => [],
      getChat,
      getKeyScopeMarker: () => Promise.resolve(undefined),
      createChat: async () => {
        throw new Error("unused");
      },
      sendMessage,
      subscribe: async () => () => undefined,
      archiveChat: async () => undefined,
      deleteChat: async () => undefined,
    };
    const plane = new ChatDataPlane({
      chatAdapters: { qoder: () => adapter },
      botCatalogs: {},
      resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
    });
    await expect(plane.getChat("conn_1", "legacy")).rejects.toMatchObject({ code: "not-found" });
    await expect(plane.sendMessage("conn_1", "legacy", "hello")).rejects.toMatchObject({
      code: "not-found",
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(getChat).not.toHaveBeenCalled();
  });

  it("getChat binds connectionId into the chat ref", async () => {
    const plane = createPlane();
    const detail = await plane.getChat("conn_1", "s1");
    expect(detail.chat.ref.connectionId).toBe("conn_1");
  });

  describe("deployment run session scope inheritance", () => {
    /**
     * Qoder 合同：Deployment Run Session 不继承 Deployment metadata（只带
     * deployment_id）。无归属标记的 Run Session 继承所属 Deployment 的范围。
     */
    function createInheritancePlane(deployment: {
      keyScopeMarker?: string;
      shared?: boolean;
    }) {
      const runChat = {
        ref: { connectionId: "", agentId: "a1", sessionId: "run-session" },
        title: "Run",
        deploymentId: "dep_1",
      };
      const getChatAccess = vi.fn(async () => ({
        shared: false,
        deploymentId: "dep_1",
      }));
      const getDeployment = vi.fn(async () => ({
        agentId: "a1",
        deploymentId: "dep_1",
        name: "d",
        status: "active" as const,
        prompt: "p",
        shared: deployment.shared ?? false,
        metadata: {},
        ...(deployment.keyScopeMarker
          ? { keyScopeMarker: deployment.keyScopeMarker }
          : {}),
      }));
      const adapter: ChatAdapter = {
        listChats: () => Promise.resolve([runChat]),
        getChat: () =>
          Promise.resolve({ chat: runChat, messages: [], events: [] }),
        getKeyScopeMarker: () => Promise.resolve(undefined),
        getChatAccess,
        createChat: () => Promise.reject(new Error("unused")),
        sendMessage: () => Promise.resolve({ ok: true }),
        subscribe: () => Promise.resolve(() => undefined),
        archiveChat: () => Promise.resolve(),
        deleteChat: () => Promise.resolve(),
      };
      const plane = new ChatDataPlane({
        chatAdapters: { qoder: () => adapter },
        botCatalogs: {},
        deploymentAdapters: {
          qoder: () => ({ getDeployment }) as never,
        },
        resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
      });
      return { plane, getChatAccess, getDeployment };
    }

    it("run session of current-scope deployment is listed, readable and writable", async () => {
      const current = apiKeyScopeId("qoder", "k");
      const { plane } = createInheritancePlane({ keyScopeMarker: current });
      const chats = await plane.listChats("conn_1", "a1");
      expect(chats.map((c) => [c.ref.sessionId, c.keyScope])).toEqual([
        ["run-session", "current"],
      ]);
      const detail = await plane.getChat("conn_1", "run-session");
      expect(detail.chat.keyScope).toBe("current");
      await expect(
        plane.sendMessage("conn_1", "run-session", "hi"),
      ).resolves.toMatchObject({ ok: true });
      expect(JSON.stringify(chats)).not.toContain(current);
    });

    it("run session of other-scope unshared deployment stays hidden", async () => {
      const { plane } = createInheritancePlane({ keyScopeMarker: "foreign-scope" });
      expect(await plane.listChats("conn_1", "a1")).toEqual([]);
      await expect(plane.getChat("conn_1", "run-session")).rejects.toMatchObject({
        code: "not-found",
      });
    });

    it("run session of other-scope shared deployment is visible; archive stays owner-only", async () => {
      const { plane } = createInheritancePlane({
        keyScopeMarker: "foreign-scope",
        shared: true,
      });
      const chats = await plane.listChats("conn_1", "a1");
      expect(chats.map((c) => [c.keyScope, c.shared])).toEqual([["other", true]]);
      await expect(
        plane.sendMessage("conn_1", "run-session", "hi"),
      ).resolves.toMatchObject({ ok: true });
      await expect(plane.archiveChat("conn_1", "run-session")).rejects.toMatchObject({
        code: "not-found",
      });
    });

    it("deployment without marker leaves run session ungrouped (hidden)", async () => {
      const { plane } = createInheritancePlane({});
      expect(await plane.listChats("conn_1", "a1")).toEqual([]);
    });

    it("deployment lookup failure leaves run session hidden", async () => {
      const { plane, getDeployment } = createInheritancePlane({
        keyScopeMarker: "x",
      });
      getDeployment.mockRejectedValue(new Error("boom"));
      expect(await plane.listChats("conn_1", "a1")).toEqual([]);
      await expect(plane.getChat("conn_1", "run-session")).rejects.toMatchObject({
        code: "not-found",
      });
    });
  });

  it("unknown connection surfaces not-found", async () => {
    const plane = createPlane();
    await expect(plane.listBots("nope")).rejects.toMatchObject({ code: "not-found" });
  });

  it("unknown provider surfaces invalid-input", async () => {
    const plane = new ChatDataPlane({
      chatAdapters: {},
      botCatalogs: {},
      resolveCredential: () => Promise.resolve({ provider: "unknown", credential: "k" }),
    });
    await expect(plane.listBots("conn_1")).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("archiveChat and deleteChat delegate to the adapter", async () => {
    const actions: Array<{ type: string; sessionId: string }> = [];
    const adapter: ChatAdapter = {
      listChats: () => Promise.resolve([]),
      getChat: () =>
        Promise.resolve({
          chat: {
            ref: { connectionId: "", agentId: "a", sessionId: "s" },
            title: "t",
            keyScopeMarker: apiKeyScopeId("qoder", "k"),
          },
          messages: [],
          events: [],
        }),
      getKeyScopeMarker: () => Promise.resolve(apiKeyScopeId("qoder", "k")),
      createChat: () =>
        Promise.resolve({ ref: { connectionId: "", agentId: "a", sessionId: "s" }, title: "t" }),
      sendMessage: () => Promise.resolve({ ok: true }),
      subscribe: () => Promise.resolve(() => {}),
      archiveChat: (sessionId) => {
        actions.push({ type: "archive", sessionId });
        return Promise.resolve();
      },
      deleteChat: (sessionId) => {
        actions.push({ type: "delete", sessionId });
        return Promise.resolve();
      },
    };
    const plane = new ChatDataPlane({
      chatAdapters: { qoder: () => adapter },
      botCatalogs: {
        qoder: () => ({
          listBots: () => Promise.resolve([]),
        }),
      },
      resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
    });
    await plane.archiveChat("conn_1", "s1");
    await plane.deleteChat("conn_1", "s1");
    expect(actions).toEqual([
      { type: "archive", sessionId: "s1" },
      { type: "delete", sessionId: "s1" },
    ]);
  });
});

describe("ChatDataPlane with real Qoder adapter", () => {
  it("401 from provider maps to authentication without leaking body", async () => {
    mockFetch(() => json(401, { error: "bad token" }));
    const { createQoderChatAdapter } = await import("./providers/qoder/qoder-chat-adapter");
    const plane = new ChatDataPlane({
      chatAdapters: { qoder: createQoderChatAdapter },
      botCatalogs: {},
      resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
    });
    try {
      await plane.listChats("conn_1", "a1");
      expect.unreachable();
    } catch (e) {
      expect(isHostError(e)).toBe(true);
      if (isHostError(e)) {
        expect(e.code).toBe("authentication");
        expect(e.message).not.toContain("bad token");
      }
    }
  });
});

/**
 * createChat 的环境解析。保护的风险：环境解析顺序（managed state → Connection 默认）
 * 漂移会导致建错环境或拒建。
 */
describe("ChatDataPlane createChat environment resolution", () => {
  function createResolutionPlane(
    bot: {
      agentId: string;
      name: string;
      managed: boolean;
      shared?: boolean;
      keyScopeMarker?: string;
    },
    options?: {
      managedEnvironmentId?: string | null;
      defaultEnvironmentId?: string | null;
      resolveDefaultEnvironmentId?: () => Promise<string | null>;
    },
  ) {
    let capturedEnvironmentId: string | undefined;
    let capturedMetadata: Record<string, string> | undefined;
    const adapter: ChatAdapter = {
      listChats: () => Promise.resolve([]),
      getChat: () =>
        Promise.resolve({
          chat: { ref: { connectionId: "", agentId: "a", sessionId: "s" }, title: "t" },
          messages: [],
          events: [],
        }),
      getKeyScopeMarker: () => Promise.resolve(undefined),
      createChat: (agentId, environmentId, _title, metadata) => {
        capturedEnvironmentId = environmentId;
        capturedMetadata = metadata;
        return Promise.resolve({
          ref: { connectionId: "", agentId, sessionId: "s-new" },
          title: "t",
          keyScopeMarker:
            typeof metadata?.[API_KEY_SCOPE_METADATA_KEY] === "string"
              ? metadata[API_KEY_SCOPE_METADATA_KEY]
              : undefined,
        });
      },
      sendMessage: () => Promise.resolve({ ok: true }),
      subscribe: () => Promise.resolve(() => {}),
      archiveChat: () => Promise.resolve(),
      deleteChat: () => Promise.resolve(),
    };
    const plane = new ChatDataPlane({
      chatAdapters: { qoder: () => adapter },
      botCatalogs: {
        qoder: () => ({
          listBots: () => Promise.resolve([bot]),
        }),
      },
      resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "k" }),
      resolveManagedEnvironmentId: () => Promise.resolve(options?.managedEnvironmentId ?? null),
      resolveDefaultEnvironmentId:
        options?.resolveDefaultEnvironmentId ??
        (() => Promise.resolve(options?.defaultEnvironmentId ?? null)),
    });
    return {
      plane,
      environmentId: () => capturedEnvironmentId,
      metadata: () => capturedMetadata,
    };
  }

  it("跨 Key 共享允许创建自己的 Session，取消共享后拒绝新建", async () => {
    const bot = {
      agentId: "shared-other",
      name: "Shared",
      managed: false,
      shared: true,
      keyScopeMarker: "other-key",
    };
    const { plane, metadata } = createResolutionPlane(bot, { defaultEnvironmentId: "env-default" });
    const chat = await plane.createChat("conn_1", bot.agentId);
    expect(chat.ref).toEqual({ connectionId: "conn_1", agentId: bot.agentId, sessionId: "s-new" });
    expect(metadata()).toEqual({ openagentbot_key_scope: apiKeyScopeId("qoder", "k") });
    bot.shared = false;
    await expect(plane.createChat("conn_1", bot.agentId)).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("managed uses the environment remote ID from local OAP state even after a bot rename", async () => {
    const { plane, environmentId, metadata } = createResolutionPlane(
      { agentId: "a1", name: "已改名Bot", managed: true },
      { managedEnvironmentId: "env-9", defaultEnvironmentId: "env-default" },
    );
    const chat = await plane.createChat("conn_1", "a1");
    expect(environmentId()).toBe("env-9");
    expect(metadata()).toEqual({ openagentbot_key_scope: apiKeyScopeId("qoder", "k") });
    expect(chat.keyScope).toBe("current");
  });

  it("managed state environment short-circuits the Connection default lookup", async () => {
    const { plane, environmentId } = createResolutionPlane(
      { agentId: "a1", name: "Managed", managed: true },
      {
        managedEnvironmentId: "env_managed",
        resolveDefaultEnvironmentId: () =>
          Promise.reject(new Error("default environment should not be read")),
      },
    );

    await plane.createChat("conn_1", "a1");

    expect(environmentId()).toBe("env_managed");
  });

  it("falls back to the connection default environment when no managed state exists", async () => {
    const { plane, environmentId } = createResolutionPlane(
      { agentId: "a1", name: "验收Bot", managed: false },
      { managedEnvironmentId: null, defaultEnvironmentId: "env-default" },
    );
    await plane.createChat("conn_1", "a1");
    expect(environmentId()).toBe("env-default");
  });

  it("both managed state and connection default missing is a conflict", async () => {
    const { plane } = createResolutionPlane(
      { agentId: "a1", name: "验收Bot", managed: false },
      { managedEnvironmentId: null, defaultEnvironmentId: null },
    );
    await expect(plane.createChat("conn_1", "a1")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("environment"),
    });
  });

  it("unknown bot is not-found", async () => {
    const { plane } = createResolutionPlane({ agentId: "a1", name: "验收Bot", managed: false });
    await expect(plane.createChat("conn_1", "missing")).rejects.toMatchObject({
      code: "not-found",
    });
  });
});
