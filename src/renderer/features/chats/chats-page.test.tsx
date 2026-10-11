// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "../../test-support/mount";
import { ChatsPage, type ChatsPageProps } from "./chats-page";

function renderChats(overrides: Partial<ChatsPageProps> = {}) {
  const props: ChatsPageProps = {
    botName: "Helper",
    chats: [],
    loading: false,
    error: null,
    creating: false,
    createError: null,
    archiving: false,
    archiveError: null,
    deleting: false,
    deleteError: null,
    onReload: vi.fn(),
    onOpenChat: vi.fn(),
    onCreateChat: vi.fn(),
    onArchiveChat: vi.fn(),
    onDeleteChat: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
  const view = mount(<ChatsPage {...props} />);
  return { container: view.container, unmount: view.unmount };
}

afterEach(() => {
  document.body.innerHTML = "";
  window.desktopHost = undefined as unknown as typeof window.desktopHost;
});

describe("ChatsPage 创建反馈", () => {
  it("Managed Bot 在 Bot 详情提供共享开关，Remote-only Bot 不提供", async () => {
    window.desktopHost = {
      bots: { getConfiguration: () => Promise.reject({ code: "not-found", message: "test" }) },
    } as unknown as typeof window.desktopHost;
    const onSetShared = vi.fn(() => Promise.resolve(null));
    const managed = {
      ref: { connectionId: "conn-1", agentId: "managed" },
      name: "管理 Bot",
      management: "managed" as const,
    };
    const view = renderChats({ bot: managed, onSetShared });
    const share = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="共享 管理 Bot"]',
    );
    expect(share).not.toBeNull();
    await act(async () => {
      share!.click();
    });
    expect(onSetShared).not.toHaveBeenCalled();
    const enable = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "开启共享",
    )!;
    await act(async () => enable.click());
    expect(onSetShared).toHaveBeenCalledWith(true);
    view.unmount();

    const remote = {
      ref: { connectionId: "conn-1", agentId: "remote" },
      name: "遠端 Bot",
      management: "remote-only" as const,
    };
    const remoteView = renderChats({ bot: remote, onSetShared });
    expect(remoteView.container.querySelector('button[aria-label="共享 遠端 Bot"]')).toBeNull();
    remoteView.unmount();
  });
  it("成员详情显示引用它的协调者并可进入其详情", () => {
    const member = {
      ref: { connectionId: "conn-1", agentId: "worker" },
      name: "客户经理",
      management: "remote-only" as const,
    };
    const coordinator = {
      ref: { connectionId: "conn-1", agentId: "chief" },
      name: "负责人",
      management: "remote-only" as const,
      collaboration: { memberAgentIds: ["worker"] },
    };
    const onOpenBot = vi.fn();
    const view = renderChats({
      botName: member.name,
      bot: member,
      bots: [member, coordinator],
      onOpenBot,
    });
    expect(view.container.textContent).toContain("参与的协作 · 1 个协调者");
    const link = [
      ...view.container.querySelectorAll<HTMLButtonElement>(
        'section[aria-label="参与的协作"] button',
      ),
    ][0];
    act(() => link.click());
    expect(onOpenBot).toHaveBeenCalledWith(coordinator);
    view.unmount();
  });
  it("把 Bot 当前成员与历史 Session 的协作标记分开展示", () => {
    const bot = {
      ref: { connectionId: "conn-1", agentId: "chief" },
      name: "负责人",
      management: "remote-only" as const,
      collaboration: { memberAgentIds: ["worker"] },
    };
    const worker = {
      ref: { connectionId: "conn-1", agentId: "worker" },
      name: "客户经理",
      management: "remote-only" as const,
    };
    const view = renderChats({
      bot,
      bots: [bot, worker],
      chats: [
        {
          ref: { connectionId: "conn-1", agentId: "chief", sessionId: "old" },
          title: "旧任务",
          collaboration: { memberAgentIds: [] },
        },
        {
          ref: { connectionId: "conn-1", agentId: "chief", sessionId: "new" },
          title: "新任务",
          collaboration: { memberAgentIds: ["worker"] },
        },
      ],
    });
    expect(view.container.textContent).toContain("当前远程协作成员 · 1 位");
    const rows = [...view.container.querySelectorAll("li")];
    expect(rows.find((row) => row.textContent?.includes("旧任务"))?.textContent).not.toContain(
      "协作任务",
    );
    expect(rows.find((row) => row.textContent?.includes("新任务"))?.textContent).toContain(
      "协作任务",
    );
    view.unmount();
  });

  it("刚创建的 Bot 提供开始对话和完善配置，查看页面本身不创建 Chat", () => {
    const onCreateChat = vi.fn();
    const onCompleteSetup = vi.fn();
    const view = renderChats({ justCreated: true, onCreateChat, onCompleteSetup });

    expect(view.container.textContent).toContain("Helper 已创建");
    expect(onCreateChat).not.toHaveBeenCalled();
    const buttons = [...view.container.querySelectorAll("button")];
    act(() => buttons.find((button) => button.textContent === "完善配置")!.click());
    expect(onCompleteSetup).toHaveBeenCalledOnce();
    act(() => buttons.find((button) => button.textContent === "开始任务")!.click());
    expect(onCreateChat).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("协作 Bot 的空态说明按需委派，并将成员详情默认折叠", () => {
    const bot = {
      ref: { connectionId: "conn-1", agentId: "chief" },
      name: "负责人",
      management: "remote-only" as const,
      collaboration: { memberAgentIds: ["worker"] },
    };
    const worker = {
      ref: { connectionId: "conn-1", agentId: "worker" },
      name: "客户经理",
      management: "remote-only" as const,
    };
    const view = renderChats({ botName: bot.name, bot, bots: [bot, worker] });

    expect(view.container.textContent).toContain("使用 负责人 开始任务");
    expect(view.container.textContent).toContain("任务由 负责人 处理，并可按需委派给协作成员。");
    const members = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("当前远程协作成员"),
    );
    expect(members?.getAttribute("aria-expanded")).toBe("false");
    expect(members?.textContent).toContain("客户经理");
    view.unmount();
  });

  it("Chat 行只在实际获得键盘焦点的动作上显示焦点环", () => {
    const view = renderChats({
      chats: [
        {
          ref: { connectionId: "conn-1", agentId: "agent-1", sessionId: "chat-1" },
          title: "你有哪些工具",
          remoteStatus: "idle",
        },
      ],
    });
    const openChat = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("你有哪些工具"),
    )!;
    const row = openChat.parentElement!;

    expect(row.className).not.toContain("focus-within:ring");
    expect(openChat.className).toContain("focus-visible:ring");
    view.unmount();
  });

  it("Managed Bot 的 Chat 列表提供编辑配置入口", () => {
    const onEditBot = vi.fn();
    const view = renderChats({ onEditBot });

    const editButton = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="编辑 Bot 配置"]',
    );
    expect(editButton).not.toBeNull();

    act(() => editButton!.click());
    expect(onEditBot).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("不可编辑的 Bot 不显示编辑配置入口", () => {
    const view = renderChats();

    expect(view.container.querySelector('button[aria-label="编辑 Bot 配置"]')).toBeNull();
    view.unmount();
  });

  it("在 Bot 头像右下角标示当前 Provider", () => {
    const view = renderChats({ provider: "bailian" });

    expect(view.container.querySelector('[data-provider-badge="bailian"]')).not.toBeNull();
    expect(view.container.textContent).toContain("Provider：百炼");
    view.unmount();
  });

  it("重试期间禁用重试动作并声明忙碌状态", () => {
    const view = renderChats({
      creating: true,
      createError: { code: "unavailable", message: "failed" },
    });
    const retry = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("重试"),
    )!;

    expect(retry.disabled).toBe(true);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    view.unmount();
  });

  it("环境冲突时显示连接设置提示", () => {
    const view = renderChats({
      creating: false,
      createError: { code: "conflict", message: "environment" },
    });

    expect(view.container.textContent).toContain(
      "此连接尚未设置运行环境，请到连接设置中完成配置。",
    );
    view.unmount();
  });
});
