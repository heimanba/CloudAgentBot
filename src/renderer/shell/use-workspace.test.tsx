// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotView, ChatView, ConnectionView } from "@shared/models";
import type { DesktopHost } from "@shared/desktop-host-contract";
import App from "../app";
import { mount, type Mounted } from "../test-support/mount";
import { deriveWorkspaceConnectionState, useWorkspace } from "./use-workspace";

const CONNECTIONS: ConnectionView[] = [
  {
    id: "conn-qoder",
    provider: "qoder",
    displayName: "Qoder",
    credentialStored: true,
    managedBotDataCount: 1,
    environmentReady: true,
  },
  {
    id: "conn-bailian",
    provider: "bailian",
    displayName: "Bailian",
    credentialStored: true,
    managedBotDataCount: 0,
    environmentReady: true,
  },
];

const QODER_BOT: BotView = {
  ref: { connectionId: "conn-qoder", agentId: "agent-qoder" },
  name: "Qoder Bot",
  management: "managed",
};

const QODER_CHAT: ChatView = {
  ref: { ...QODER_BOT.ref, sessionId: "session-qoder" },
  title: "Qoder Chat",
};

type Workspace = ReturnType<typeof useWorkspace>;
const LAST_CONNECTION_STORAGE_KEY = "openagentbot:last-connection-id:v1";

function makeHost(createChat = () => Promise.resolve(QODER_CHAT)): DesktopHost {
  return {
    app: {
      version: () => Promise.resolve("test"),
      copyText: () => Promise.resolve(),
    },
    connections: {
      list: () => Promise.resolve(CONNECTIONS),
      connect: () => Promise.reject(new Error("unused")),
      connectBailianConsole: () => Promise.reject(new Error("unused")),
      reconnectBailianConsole: () => Promise.reject(new Error("unused")),
      cancelBailianConsoleLogin: () => Promise.resolve(),
      reconnect: () => Promise.reject(new Error("unused")),
      update: () => Promise.reject(new Error("unused")),
      verify: () => Promise.reject(new Error("unused")),
      disconnect: () => Promise.reject(new Error("unused")),
      remove: () => Promise.reject(new Error("unused")),
      setupEnvironment: () => Promise.reject(new Error("unused")),
    },
    bots: {
      list: (connectionId) => Promise.resolve(connectionId === "conn-qoder" ? [QODER_BOT] : []),
      listSkills: () => Promise.resolve([]),
      listSkillCatalog: () => Promise.resolve([]),
      addSkillFromCatalog: () => Promise.reject(new Error("unused")),
      get: () => Promise.resolve(QODER_BOT),
      getConfiguration: () => Promise.reject(new Error("unused")),
      create: () => Promise.reject(new Error("unused")),
      update: () => Promise.resolve(QODER_BOT),
      sync: () => Promise.resolve(QODER_BOT),
      archive: () => Promise.resolve(),
      setShared: () => Promise.resolve({} as BotView),
    },
    chats: {
      list: () => Promise.resolve([]),
      uploadFile: () =>
        Promise.resolve({ fileId: "file-1", filename: "f", mimeType: "text/plain" }),
      create: createChat,
      get: () => Promise.resolve({ chat: QODER_CHAT, messages: [], events: [] }),
      send: () => Promise.resolve({ ok: true }),
      subscribe: () => Promise.resolve(() => undefined),
      setShared: (ref, shared) => Promise.resolve({ ...QODER_CHAT, ref, shared }),
      archive: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      getArtifact: () => Promise.reject({ code: "not-found", message: "artifact not found" }),
    },
  };
}

function mountWorkspace(host: DesktopHost) {
  window.desktopHost = host;
  const latest: { current: Workspace | null } = { current: null };
  function Harness() {
    const workspace = useWorkspace();
    useEffect(() => {
      latest.current = workspace;
    });
    return null;
  }
  const view = mount(<Harness />);
  return {
    result() {
      if (latest.current === null) throw new Error("workspace not mounted");
      return latest.current;
    },
    unmount: view.unmount,
  };
}

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  delete (window as unknown as Record<string, unknown>).desktopHost;
  document.body.innerHTML = "";
});

describe("deriveWorkspaceConnectionState", () => {
  it("keeps onboarding open and excludes a credentialed connection until its environment is ready", () => {
    const pending = {
      id: "conn_pending",
      provider: "qoder",
      displayName: "Pending",
      credentialStored: true,
      managedBotDataCount: 0,
      environmentReady: false,
    };

    expect(deriveWorkspaceConnectionState([pending], pending.id, false)).toEqual({
      readyConnections: [],
      defaultConnectionId: null,
      needsConnection: true,
      activeConnection: null,
    });
  });

  it("uses only ready connections for default and active workspace selection", () => {
    const pending = {
      id: "conn_pending",
      provider: "qoder",
      displayName: "Pending",
      credentialStored: true,
      managedBotDataCount: 0,
      environmentReady: false,
    };
    const ready = { ...pending, id: "conn_ready", displayName: "Ready", environmentReady: true };

    expect(deriveWorkspaceConnectionState([pending, ready], pending.id, false)).toEqual({
      readyConnections: [ready],
      defaultConnectionId: ready.id,
      needsConnection: false,
      activeConnection: null,
    });
  });
});

describe("useWorkspace connection switching", () => {
  it.each([false, true])(
    "从 Qoder 设置页新增百炼后进入百炼首页（需要选环境：%s）",
    async (needsSelection) => {
      const host = makeHost();
      host.connections.list = async () => [CONNECTIONS[0]];
      host.connections.connect = async () => ({ ...CONNECTIONS[1], environmentReady: false });
      host.connections.setupEnvironment = async (_id, environmentId) =>
        needsSelection && !environmentId
          ? {
              status: "selection-required",
              candidates: [{ environmentId: "env-bailian", name: "Agents/base" }],
            }
          : { status: "ready", environmentId: "env-bailian" };
      window.desktopHost = host;
      window.localStorage.setItem(LAST_CONNECTION_STORAGE_KEY, "conn-qoder");
      const button = (text: string) =>
        [...document.querySelectorAll<HTMLButtonElement>("button")].find(
          (element) => element.textContent?.trim() === text,
        )!;
      const fill = (selector: string, value: string) => {
        const input = document.querySelector<HTMLInputElement>(selector)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const view = mount(<App />);
      const { container } = view;
      try {
        await act(async () => {
          container
            .querySelector('button[aria-label^="切换 Connection"]')!
            .dispatchEvent(
              new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
            );
        });
        await act(async () => {
          [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
            .find((element) => element.textContent?.includes("管理连接"))!
            .click();
        });
        await act(async () => button("添加连接").click());
        await act(async () =>
          (document.querySelector("#connection-provider-bailian") as HTMLButtonElement).click(),
        );
        await act(async () => button("手动输入 API Key").click());
        await act(async () => {
          fill("#connection-workspace-id", "ws-test");
          fill("#connection-credential", "test-key");
        });
        await act(async () => button("验证并添加").click());
        if (needsSelection) {
          expect(document.querySelector('textarea[aria-label="任务内容"]')).toBeNull();
          await act(async () => button("使用选定环境").click());
        }
        expect(document.querySelector('textarea[aria-label="任务内容"]')).not.toBeNull();
        expect(
          container
            .querySelector('button[aria-label^="切换 Connection"]')
            ?.getAttribute("aria-label"),
        ).toContain("Bailian");
        expect(window.localStorage.getItem(LAST_CONNECTION_STORAGE_KEY)).toBe("conn-bailian");
      } finally {
        view.unmount();
      }
    },
  );

  it("完整界面从任务草稿创建 Bot，返回草稿后发送首条消息", async () => {
    const host = makeHost();
    const createBot = vi.fn(async () => QODER_BOT);
    const createChat = vi.fn(host.chats.create);
    const send = vi.fn(host.chats.send);
    host.bots.list = async () => (createBot.mock.calls.length ? [QODER_BOT] : []);
    host.bots.create = createBot;
    host.chats.create = createChat;
    host.chats.send = send;
    window.desktopHost = host;
    const view = mount(<App />);
    const { container } = view;
    // 挂载链：列表加载 → 默认连接选择（宏任务）→ Bot 目录读取；每个 act 边界只推进一个宏任务跳。
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="新任务"]')!.click();
    });
    const draft = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="任务内容"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(draft, "整理客户会议议程");
      draft.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(createChat).not.toHaveBeenCalled();

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("创建助手"))!
        .click();
    });
    expect(container.querySelector("#create-bot-name")).not.toBeNull();
    const name = container.querySelector<HTMLInputElement>("#create-bot-name")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(name, "Qoder Bot");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "创建 Bot")!
        .click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(createBot).toHaveBeenCalledOnce();
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="任务内容"]')?.value,
    ).toBe("整理客户会议议程");
    expect(container.textContent).toContain("Qoder Bot");
    expect(createChat).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="发送任务"]')!.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(createChat).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledExactlyOnceWith(QODER_CHAT.ref, "整理客户会议议程", undefined);
    view.unmount();
  });

  it("Chat 已创建但订阅失败时保留首条消息供用户检查", async () => {
    const host = makeHost();
    host.chats.subscribe = () => Promise.reject({ code: "unavailable", message: "stream down" });
    const send = vi.fn(host.chats.send);
    host.chats.send = send;
    window.desktopHost = host;
    const view = mount(<App />);
    const { container } = view;
    // 挂载链：列表加载 → 默认连接选择（宏任务）→ Bot 目录读取；每个 act 边界只推进一个宏任务跳。
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="新任务"]')!.click();
    });
    const draft = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="任务内容"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(draft, "检查会议安排");
      draft.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="发送任务"]')!.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(send).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[placeholder*="发送消息"]')?.value,
    ).toBe("检查会议安排");
    view.unmount();
  });

  it("新任务先保留草稿，选 Bot 不创建 Chat，发送后才创建并发送一次", async () => {
    window.localStorage.setItem(LAST_CONNECTION_STORAGE_KEY, "conn-qoder");
    const host = makeHost();
    const create = vi.fn(host.chats.create);
    const subscribe = vi.fn(host.chats.subscribe);
    const send = vi.fn(host.chats.send);
    host.chats.create = create;
    host.chats.subscribe = subscribe;
    host.chats.send = send;
    const harness = mountWorkspace(host);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    act(() => {
      harness.result().openNewChat();
      harness.result().setTaskDraft("整理客户会议议程");
      harness.result().setTaskBot(QODER_BOT);
    });
    expect(harness.result().location).toEqual({ area: "chats", page: "new" });
    expect(create).not.toHaveBeenCalled();

    await act(async () => {
      harness.result().sendNewTask();
      harness.result().sendNewTask();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(create).toHaveBeenCalledExactlyOnceWith(QODER_BOT.ref);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledExactlyOnceWith(QODER_CHAT.ref, "整理客户会议议程", undefined);
    expect(harness.result().location.page).toBe("detail");
    harness.unmount();
  });

  it("从任务创建 Bot 后返回原草稿，取消创建也能返回", async () => {
    const harness = mountWorkspace(makeHost());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    act(() => {
      harness.result().openNewChat();
      harness.result().setTaskDraft("整理客户会议议程");
    });
    act(() => harness.result().openBotCreation());
    expect(harness.result().location).toEqual({ area: "bots", page: "list" });
    act(() => harness.result().cancelBotCreation());
    expect(harness.result().location).toEqual({ area: "chats", page: "new" });
    expect(harness.result().taskDraft).toBe("整理客户会议议程");

    act(() => harness.result().openBotCreation());
    act(() => harness.result().openCreatedBot(QODER_BOT));
    expect(harness.result().location).toEqual({ area: "chats", page: "new" });
    expect(harness.result().taskBot).toEqual(QODER_BOT);
    expect(harness.result().taskDraft).toBe("整理客户会议议程");
    harness.unmount();
  });

  it("有多个 Bot 时新任务不擅自选择最近使用的 Bot", async () => {
    const host = makeHost();
    const otherBot: BotView = {
      ref: { connectionId: "conn-qoder", agentId: "agent-other" },
      name: "其他助手",
      management: "managed",
    };
    host.bots.list = async () => [QODER_BOT, otherBot];
    const harness = mountWorkspace(host);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    act(() => harness.result().openNewChat());
    expect(harness.result().taskBot).toBeNull();
    harness.unmount();
  });

  it("创建 Chat 失败时保留新任务草稿", async () => {
    const host = makeHost();
    host.chats.create = () => Promise.reject({ code: "unavailable", message: "offline" });
    const send = vi.fn(host.chats.send);
    host.chats.send = send;
    const harness = mountWorkspace(host);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    act(() => {
      harness.result().openNewChat();
      harness.result().setTaskDraft("整理客户会议议程");
      harness.result().setTaskBot(QODER_BOT);
    });
    await act(async () => {
      harness.result().sendNewTask();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(harness.result().location).toEqual({ area: "chats", page: "new" });
    expect(harness.result().taskDraft).toBe("整理客户会议议程");
    expect(send).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("切换 Connection 时保留任务文字并清除旧 Bot 选择", async () => {
    const harness = mountWorkspace(makeHost());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    act(() => {
      harness.result().openNewChat();
      harness.result().setTaskDraft("继续准备客户会议");
      harness.result().setTaskBot(QODER_BOT);
    });
    act(() => harness.result().selectConnection("conn-bailian"));
    expect(harness.result().location).toEqual({ area: "chats", page: "new" });
    expect(harness.result().taskDraft).toBe("继续准备客户会议");
    expect(harness.result().taskBot).toBeNull();
    act(() => harness.result().openBotCreation());
    act(() => harness.result().selectConnection("conn-qoder"));
    expect(harness.result().location).toEqual({ area: "chats", page: "new" });
    expect(harness.result().taskDraft).toBe("继续准备客户会议");
    harness.unmount();
  });

  it("默认进入任务输入，Chat 返回后仍可直接开始新任务", async () => {
    const harness = mountWorkspace(makeHost());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(harness.result().location).toEqual({ area: "chats", page: "new" });
    act(() => harness.result().openBotChats(QODER_BOT));
    expect(harness.result().location).toEqual({ area: "bots", page: "detail", bot: QODER_BOT });
    act(() => harness.result().openChat(QODER_BOT, QODER_CHAT));
    expect(harness.result().location).toEqual({
      area: "chats",
      page: "detail",
      bot: QODER_BOT,
      chat: QODER_CHAT,
    });
    act(() => harness.result().closeChat());
    expect(harness.result().location).toEqual({ area: "chats", page: "new" });
    act(() => harness.result().openChatsOverview());
    expect(harness.result().location).toEqual({ area: "chats", page: "overview" });
    act(() => harness.result().openTaskHome());
    expect(harness.result().location).toEqual({ area: "chats", page: "new" });
    act(() => harness.result().openChatsOverview());
    act(() => harness.result().selectConnection("conn-bailian"));
    expect(harness.result().location).toEqual({ area: "chats", page: "new" });
    harness.unmount();
  });

  it("创建 Chat 成功后进入 Chats detail", async () => {
    const harness = mountWorkspace(makeHost());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      await harness.result().createChat(QODER_BOT);
    });
    expect(harness.result().location).toEqual({
      area: "chats",
      page: "detail",
      bot: QODER_BOT,
      chat: QODER_CHAT,
    });
    harness.unmount();
  });

  it("does not crash while a persisted Connection is waiting for the Connection list", () => {
    window.localStorage.setItem(LAST_CONNECTION_STORAGE_KEY, "conn-bailian");
    const host = makeHost();
    host.connections.list = () => new Promise(() => undefined);
    window.desktopHost = host;

    let view!: Mounted;
    expect(() => {
      view = mount(<App />);
    }).not.toThrow();

    view.unmount();
  });

  it("restores the last ready Connection after remounting", async () => {
    const first = mountWorkspace(makeHost());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    act(() => first.result().selectConnection("conn-bailian"));
    expect(window.localStorage.getItem(LAST_CONNECTION_STORAGE_KEY)).toBe("conn-bailian");
    first.unmount();

    const second = mountWorkspace(makeHost());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(second.result().selectedConnectionId).toBe("conn-bailian");
    expect(second.result().activeConnection?.provider).toBe("bailian");
    second.unmount();
  });

  it("falls back and replaces the preference when the stored Connection is unavailable", async () => {
    window.localStorage.setItem(LAST_CONNECTION_STORAGE_KEY, "conn-removed");
    const harness = mountWorkspace(makeHost());

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(harness.result().selectedConnectionId).toBe("conn-qoder");
    expect(window.localStorage.getItem(LAST_CONNECTION_STORAGE_KEY)).toBe("conn-qoder");
    harness.unmount();
  });

  it("clears the preference when no ready Connection remains", async () => {
    window.localStorage.setItem(LAST_CONNECTION_STORAGE_KEY, "conn-bailian");
    const host = makeHost();
    host.connections.list = () =>
      Promise.resolve(
        CONNECTIONS.map((connection) => ({ ...connection, environmentReady: false })),
      );
    const harness = mountWorkspace(host);

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(harness.result().selectedConnectionId).toBeNull();
    expect(window.localStorage.getItem(LAST_CONNECTION_STORAGE_KEY)).toBeNull();
    harness.unmount();
  });

  it("关闭 Bot 编辑后返回 Bots 列表，不残留 Chat 上下文", async () => {
    const harness = mountWorkspace(makeHost());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    act(() => harness.result().openBotChats(QODER_BOT));
    act(() => harness.result().openBotEditor(QODER_BOT.ref));

    expect(harness.result().editingBotRef).toEqual(QODER_BOT.ref);
    expect(harness.result().selectedBot).toBeNull();
    expect(harness.result().selectedChat).toBeNull();

    act(() => harness.result().closeBotEditor());
    expect(harness.result().editingBotRef).toBeNull();
    expect(harness.result().selectedBot).toBeNull();
    harness.unmount();
  });

  it("共享状态更新后详情使用最新的 Bot 列表数据", async () => {
    let shared = false;
    const host = makeHost();
    host.bots.list = (connectionId) =>
      Promise.resolve(connectionId === "conn-qoder" ? [{ ...QODER_BOT, shared }] : []);
    host.bots.setShared = (_ref, value) => {
      shared = value;
      return Promise.resolve({ ...QODER_BOT, shared: value });
    };
    const harness = mountWorkspace(host);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    act(() => harness.result().openBotChats(QODER_BOT));

    await act(async () => {
      await harness.result().bots.setShared(QODER_BOT.ref, true);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(harness.result().selectedBot?.shared).toBe(true);
    harness.unmount();
  });

  it("从会话列表更新共享状态后同步当前详情", async () => {
    const host = makeHost();
    const getChat = vi.fn(() =>
      Promise.resolve({
        chat: { ...QODER_CHAT, keyScope: "current" as const },
        messages: [],
        events: [],
      }),
    );
    host.chats.get = getChat;
    const setShared = vi.fn((ref, shared) =>
      Promise.resolve({ ...QODER_CHAT, ref, keyScope: "current" as const, shared }),
    );
    host.chats.setShared = setShared;
    const harness = mountWorkspace(host);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    act(() => harness.result().openChat(QODER_BOT, { ...QODER_CHAT, keyScope: "current" }));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const detailReadsBeforeShare = getChat.mock.calls.length;

    await act(async () => {
      expect(
        await harness
          .result()
          .setChatShared(QODER_BOT, { ...QODER_CHAT, keyScope: "current" }, true),
      ).toBeNull();
    });

    expect(setShared).toHaveBeenCalledWith(QODER_CHAT.ref, true);
    expect(harness.result().selectedChat?.shared).toBe(true);
    expect(harness.result().chatDetail.detail?.chat.shared).toBe(true);
    expect(getChat.mock.calls.length).toBe(detailReadsBeforeShare);
    harness.unmount();
  });

  it("协作模板入口进入独立页面，返回管理助手列表", async () => {
    const harness = mountWorkspace(makeHost());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    act(() => harness.result().openTeamTemplates());
    expect(harness.result().location).toEqual({ area: "bots", page: "templates" });
    act(() => harness.result().openBotList());
    expect(harness.result().location).toEqual({ area: "bots", page: "list" });
    harness.unmount();
  });

  it("更新当前连接凭据后按新范围重取 Bot 与会话详情", async () => {
    const host = makeHost();
    const listBots = vi.fn((connectionId: string) =>
      Promise.resolve(connectionId === "conn-qoder" ? [QODER_BOT] : []),
    );
    host.bots.list = listBots;
    const getChat = vi.fn(() => Promise.resolve({ chat: QODER_CHAT, messages: [], events: [] }));
    host.chats.get = getChat;
    host.connections.reconnect = (input) =>
      Promise.resolve({ ...CONNECTIONS.find((c) => c.id === input.connectionId)! });
    const harness = mountWorkspace(host);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    act(() => harness.result().openChat(QODER_BOT, QODER_CHAT));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const botReadsBefore = listBots.mock.calls.length;
    const detailReadsBefore = getChat.mock.calls.length;

    await act(async () => {
      await harness.result().connectionsApi.reconnect({
        connectionId: "conn-qoder",
        credential: " rotated-key ",
      });
    });

    expect(listBots.mock.calls.length).toBeGreaterThan(botReadsBefore);
    // 旧范围的会话详情不再重读，直接回到新任务页。
    expect(getChat.mock.calls.length).toBe(detailReadsBefore);
    expect(harness.result().location).toEqual({ area: "chats", page: "new" });
    expect(harness.result().selectedChat).toBeNull();
    harness.unmount();
  });

  it("更新非当前连接凭据不影响当前视图数据", async () => {
    const host = makeHost();
    const listBots = vi.fn((connectionId: string) =>
      Promise.resolve(connectionId === "conn-qoder" ? [QODER_BOT] : []),
    );
    host.bots.list = listBots;
    host.connections.reconnect = (input) =>
      Promise.resolve({ ...CONNECTIONS.find((c) => c.id === input.connectionId)! });
    const harness = mountWorkspace(host);
    // 挂载链含一次 setTimeout(0) 的默认连接选择：每个 act 边界只推进到下一个宏任务跳。
    // 第一次 act 承接列表加载的 Promise 落地并在收尾时排定默认选择，第二次 act 承接该
    // 宏任务与随后的 Bot 目录读取，确保断言前初始加载完全收敛。
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(harness.result().selectedConnectionId).toBe("conn-qoder");
    expect(harness.result().bots.loading).toBe(false);
    expect(harness.result().bots.bots).toEqual([QODER_BOT]);
    const botReadsBefore = listBots.mock.calls.length;

    await act(async () => {
      await harness.result().connectionsApi.reconnect({
        connectionId: "conn-bailian",
        credential: "rotated-key",
      });
    });

    expect(listBots.mock.calls.length).toBe(botReadsBefore);
    harness.unmount();
  });

  it("resets navigation and right-pane interaction state at the workspace boundary", async () => {
    const harness = mountWorkspace(makeHost());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    act(() => {
      harness.result().setSearchQuery("old provider");
      harness.result().openBotCreation();
      harness.result().openNewChat();
      harness.result().openBotEditor(QODER_BOT.ref);
      harness.result().openChat(QODER_BOT, QODER_CHAT);
    });
    act(() => harness.result().selectConnection("conn-bailian"));

    expect(harness.result().selectedConnectionId).toBe("conn-bailian");
    expect(harness.result().selectedBot).toBeNull();
    expect(harness.result().selectedChat).toBeNull();
    expect(harness.result().editingBotRef).toBeNull();
    expect(harness.result().taskBot).toBeNull();
    expect(harness.result().searchQuery).toBe("");
    expect(harness.result().createBotRequest).toBe(0);
    harness.unmount();
  });

  it("ignores a Chat created by the previous Connection after switching", async () => {
    let resolveCreate!: (chat: ChatView) => void;
    const create = vi.fn(
      () =>
        new Promise<ChatView>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const harness = mountWorkspace(makeHost(create));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    let pending!: Promise<void>;
    act(() => {
      pending = harness.result().createChat(QODER_BOT);
    });
    act(() => harness.result().selectConnection("conn-bailian"));
    await act(async () => {
      resolveCreate(QODER_CHAT);
      await pending;
    });

    expect(harness.result().selectedConnectionId).toBe("conn-bailian");
    expect(harness.result().selectedBot).toBeNull();
    expect(harness.result().selectedChat).toBeNull();
    expect(harness.result().creatingChat).toBe(false);
    harness.unmount();
  });
});

it("刷新保留草稿与选择并更新描述，取消共享不撤权，目录缺失才阻止发送", async () => {
  window.localStorage.setItem(LAST_CONNECTION_STORAGE_KEY, "conn-qoder");
  const create = vi.fn(() => Promise.resolve(QODER_CHAT));
  const host = makeHost(create);
  let directory: BotView[] = [
    { ...QODER_BOT, shared: true, keyScope: "current", description: "旧描述" },
  ];
  host.bots.list = () => Promise.resolve(directory);
  const harness = mountWorkspace(host);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  act(() => {
    harness.result().setTaskDraft("保留任务内容");
    harness.result().startTaskWithBot(directory[0]);
  });
  directory = [{ ...directory[0], description: "新描述", shared: false }];
  await act(async () => harness.result().bots.reload());
  expect(harness.result().taskDraft).toBe("保留任务内容");
  expect(harness.result().taskBot?.description).toBe("新描述");
  expect(harness.result().taskBotUnavailable).toBe(false);
  host.bots.list = () => Promise.reject({ code: "unavailable", message: "offline" });
  await act(async () => harness.result().bots.reload());
  expect(harness.result().taskBotUnavailable).toBe(false);
  expect(harness.result().taskBot?.name).toBe(QODER_BOT.name);
  act(() => harness.result().sendNewTask());
  expect(create).not.toHaveBeenCalled();
  host.bots.list = () => Promise.resolve([]);
  await act(async () => harness.result().bots.reload());
  expect(harness.result().taskBotUnavailable).toBe(true);
  expect(harness.result().taskDraft).toBe("保留任务内容");
  act(() => harness.result().sendNewTask());
  expect(create).not.toHaveBeenCalled();
  harness.unmount();
});

it("跨 Key 共享选择可用，取消共享后保留草稿但不能新建任务", async () => {
  window.localStorage.setItem(LAST_CONNECTION_STORAGE_KEY, "conn-qoder");
  const create = vi.fn(() => Promise.resolve(QODER_CHAT));
  const host = makeHost(create);
  let shared = true;
  const bot: BotView = { ...QODER_BOT, management: "remote-only", keyScope: "other", shared: true };
  host.bots.list = async () => [{ ...bot, shared }];
  const harness = mountWorkspace(host);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  act(() => {
    harness.result().setTaskDraft("接收方任务");
    harness.result().startTaskWithBot(bot);
  });
  expect(harness.result().taskBotUnavailable).toBe(false);
  shared = false;
  await act(async () => harness.result().bots.reload());
  expect(harness.result().taskBotUnavailable).toBe(true);
  expect(harness.result().taskDraft).toBe("接收方任务");
  act(() => harness.result().sendNewTask());
  expect(create).not.toHaveBeenCalled();
  harness.unmount();
});
