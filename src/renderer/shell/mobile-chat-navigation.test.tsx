// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotView, ChatView, ConnectionView } from "@shared/models";
import { mount } from "../test-support/mount";
import { Sheet } from "../ui/design-system";
import { MobileChatNavigation, type MobileChatNavigationProps } from "./mobile-chat-navigation";

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

function props(overrides: Partial<MobileChatNavigationProps> = {}): MobileChatNavigationProps {
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
    onClose: vi.fn(),
    onSearchQueryChange: vi.fn(),
    onAreaChange: vi.fn(),
    onSelectConnection: vi.fn(),
    onOpenChat: vi.fn(),
    onOpenBot: vi.fn(),
    onEditBot: vi.fn(),
    onArchiveChat: vi.fn(),
    onDeleteChat: vi.fn(),
    onCreateChat: vi.fn(),
    onOpenAllChats: vi.fn(),
    onCreateBot: vi.fn(),
    onOpenTeamTemplates: vi.fn(),
    onOpenConnections: vi.fn(),
    ...overrides,
  };
}

function render(properties = props()) {
  const view = mount(
    <Sheet open onOpenChange={vi.fn()}>
      <MobileChatNavigation {...properties} />
    </Sheet>,
  );
  return { unmount: view.unmount };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MobileChatNavigation", () => {
  it("与桌面共享任务主导航和助手管理入口", () => {
    const view = render();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("最近任务");
    expect(dialog.textContent).toContain("管理助手");
    expect(dialog.querySelector('[aria-label="最近任务"]')).not.toBeNull();
    view.unmount();
  });

  it("进入助手管理不关闭 Sheet", async () => {
    const properties = props();
    const view = render(properties);
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
      item.textContent?.includes("管理助手"),
    )!;
    await act(async () => button.click());
    expect(properties.onAreaChange).toHaveBeenCalledWith("bots");
    expect(properties.onClose).not.toHaveBeenCalled();
    view.unmount();
  });

  it("打开协作模板后关闭 Sheet", async () => {
    const properties = props();
    const view = render(properties);
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.trim() === "协作模板",
    )!;
    await act(async () => button.click());
    expect(properties.onOpenTeamTemplates).toHaveBeenCalledOnce();
    expect(properties.onClose).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("打开 Chat 后关闭 Sheet", async () => {
    const properties = props();
    const view = render(properties);
    await act(async () =>
      document.querySelector<HTMLButtonElement>('button[aria-label="QA助手 · 客户问题"]')!.click(),
    );
    expect(properties.onOpenChat).toHaveBeenCalledWith(bot, chat);
    expect(properties.onClose).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("Bots 模式打开完整列表后关闭 Sheet", async () => {
    const properties = props({ area: "bots", selectedBot: bot, selectedChat: null });
    const view = render(properties);
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
      item.textContent?.includes("管理助手"),
    )!;
    await act(async () => button.click());
    expect(properties.onAreaChange).toHaveBeenCalledWith("bots");
    expect(properties.onClose).toHaveBeenCalledOnce();
    view.unmount();
  });
});
