// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotView, ChatView, ConnectionView } from "@shared/models";
import { mount } from "../test-support/mount";
import { AppSidebar, type AppSidebarProps } from "./app-sidebar";

const bot: BotView = {
  ref: { connectionId: "conn-b", agentId: "agent-qa" },
  name: "QA助手",
  management: "managed",
};
const chat: ChatView = {
  ref: { ...bot.ref, sessionId: "sesn-1" },
  title: "客户问题",
  updatedAt: "2026-09-20T08:00:00Z",
};
const connection: ConnectionView = {
  id: "conn-b",
  provider: "bailian",
  displayName: "百炼生产",
  credentialStored: true,
  environmentReady: true,
  managedBotDataCount: 1,
};

function props(overrides: Partial<AppSidebarProps> = {}): AppSidebarProps {
  return {
    connectedConnections: [connection],
    incompleteConnectionCount: 0,
    selectedConnectionId: "conn-b",
    area: "chats",
    selectedBot: null,
    selectedChat: chat,
    allChatsSelected: false,
    activeConnection: connection,
    activeProviderName: "百炼",
    bots: [bot],
    botsLoading: false,
    chatRoster: {
      items: [{ bot, chat }],
      botStatusByKey: new Map([["conn-b/agent-qa", "loaded"]]),
      loading: false,
      refreshing: false,
      progress: { completedBots: 1, totalBots: 1, failedBots: 0 },
      error: null,
      reload: vi.fn(),
      reset: vi.fn(),
      upsert: vi.fn(),
      remove: vi.fn(),
    },
    searchQuery: "",
    archiving: false,
    deleting: false,
    onSearchQueryChange: vi.fn(),
    onAreaChange: vi.fn(),
    onSelectConnection: vi.fn(),
    onOpenChat: vi.fn(),
    onOpenBot: vi.fn(),
    onEditBot: vi.fn(),
    onArchiveChat: vi.fn(),
    onDeleteChat: vi.fn(),
    onCreateChat: vi.fn(),
    onOpenBotList: vi.fn(),
    onOpenTeamTemplates: vi.fn(),
    onOpenNewChat: vi.fn(),
    onOpenAllChats: vi.fn(),
    onCreateBot: vi.fn(),
    onOpenConnections: vi.fn(),
    ...overrides,
  };
}

function render(properties: AppSidebarProps) {
  const view = mount(<AppSidebar {...properties} />);
  return { container: view.container, unmount: view.unmount };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AppSidebar 任务优先导航", () => {
  it("默认只展示最近任务，Bot 管理留在次级入口", () => {
    const view = render(props());
    expect(view.container.querySelector('[aria-label="最近任务"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Bots"]')).toBeNull();
    expect(view.container.querySelectorAll('button[aria-label="QA助手 · 客户问题"]')).toHaveLength(
      1,
    );
    expect(view.container.querySelector('[aria-label="查看全部任务"]')).not.toBeNull();
    view.unmount();
  });

  it("总览入口保留当前位置语义，并可打开完整任务列表", async () => {
    const onOpenAllChats = vi.fn();
    const view = render(props({ selectedChat: null, allChatsSelected: true, onOpenAllChats }));
    const link = view.container.querySelector<HTMLButtonElement>('button[aria-current="page"]')!;
    expect(link.textContent).toContain("查看全部");
    await act(async () => link.click());
    expect(onOpenAllChats).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("管理助手从次级入口进入", async () => {
    const onAreaChange = vi.fn();
    const view = render(props({ onAreaChange }));
    const button = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
      item.textContent?.includes("管理助手"),
    )!;
    await act(async () => button.click());
    expect(onAreaChange).toHaveBeenCalledWith("bots");
    view.unmount();
  });

  it("协作模板与管理助手并列，直接打开模板创建", async () => {
    const onOpenTeamTemplates = vi.fn();
    const view = render(props({ onOpenTeamTemplates }));
    const buttons = [...view.container.querySelectorAll<HTMLButtonElement>("button")];
    const manage = buttons.find((item) => item.textContent?.trim() === "管理助手")!;
    const templates = buttons.find((item) => item.textContent?.trim() === "协作模板")!;
    expect(manage.parentElement).toBe(templates.parentElement);
    await act(async () => templates.click());
    expect(onOpenTeamTemplates).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("Bots 模式只显示目录入口和数量，点击返回完整列表", async () => {
    const onOpenBotList = vi.fn();
    const view = render(
      props({ area: "bots", selectedBot: bot, selectedChat: null, onOpenBotList }),
    );
    expect(view.container.querySelector('[aria-label="Bots 导航"]')).not.toBeNull();
    expect(view.container.textContent).toContain("管理助手");
    expect(view.container.textContent!.indexOf("独立助手")).toBeLessThan(
      view.container.textContent!.indexOf("管理助手"),
    );
    expect(view.container.querySelector('button[aria-label="打开 Bot：QA助手"]')).toBeNull();
    const row = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
      item.textContent?.includes("管理助手"),
    )!;
    expect(row.closest("nav")).toBeNull();
    await act(async () => row.click());
    expect(onOpenBotList).toHaveBeenCalledOnce();
    expect(view.container.querySelector('[aria-label="最近任务"]')).toBeNull();
    view.unmount();
  });

  it("单个协作组默认展开，成员名称进入配置", async () => {
    const member: BotView = { ...bot, ref: { ...bot.ref, agentId: "agent-member" }, name: "成员" };
    const coordinator: BotView = {
      ...bot,
      ref: { ...bot.ref, agentId: "agent-coordinator" },
      name: "协调者",
      collaboration: { memberAgentIds: [member.ref.agentId] },
    };
    const onEditBot = vi.fn();
    const view = render(props({ area: "bots", bots: [coordinator, member], onEditBot }));
    const toggle = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="收起 协调者 的协作成员"]',
    )!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(view.container.querySelector('button[aria-label="编辑 成员"]')).not.toBeNull();
    await act(async () =>
      view.container.querySelector<HTMLButtonElement>('button[aria-label="编辑 成员"]')!.click(),
    );
    expect(onEditBot).toHaveBeenCalledWith(member);
    expect(view.container.querySelector('button[aria-label="打开 成员 的任务"]')).toBeNull();
    await act(async () => toggle.click());
    expect(view.container.querySelector('button[aria-label="编辑 成员"]')).toBeNull();
    view.unmount();
  });

  it("Chat 标题保持正常字重并允许两行阅读", () => {
    const view = render(props());
    const row = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="QA助手 · 客户问题"]',
    )!;
    expect(row.querySelector("strong")?.className).toContain("line-clamp-2");
    expect(row.querySelector("strong")?.className).toContain("type-control");
    expect(row.querySelector("strong")?.className).toContain("font-normal");
    view.unmount();
  });

  it("任务搜索保留在侧栏，Bot 搜索移至管理页", () => {
    const chats = render(props({ searchQuery: "不存在" }));
    expect(chats.container.textContent).toContain("没有匹配的任务");
    chats.unmount();
    const bots = render(props({ area: "bots", selectedChat: null, searchQuery: "不存在" }));
    expect(bots.container.querySelector('input[aria-label="搜索 Bot"]')).toBeNull();
    bots.unmount();
  });
});

it("连接不把 Provider 目录数量展示为工作区助手数量", () => {
  const view = render(
    props({
      bots: Array.from({ length: 58 }, (_, index) => ({
        ...bot,
        ref: { ...bot.ref, agentId: String(index) },
        management: "remote-only",
        keyScope: "ungrouped",
      })),
    }),
  );
  const connection = view.container.querySelector('button[aria-label^="切换 Connection"]')!;
  expect(connection.textContent).toContain("百炼");
  expect(connection.textContent).not.toContain("58");
  expect(connection.textContent).not.toContain("位助手");
  view.unmount();
});
