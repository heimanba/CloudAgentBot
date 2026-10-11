// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotView, ChatView } from "@shared/models";
import { mount } from "../../test-support/mount";
import { ChatsOverviewPage } from "./chats-overview-page";

const product: BotView = {
  ref: { connectionId: "conn", agentId: "product" },
  name: "产品助手",
  management: "managed",
};
const ops: BotView = {
  ref: { connectionId: "conn", agentId: "ops" },
  name: "运维助手",
  management: "remote-only",
};
const chats: Array<{ bot: BotView; chat: ChatView }> = [
  {
    bot: product,
    chat: {
      ref: { ...product.ref, sessionId: "s1" },
      title: "需求评审",
      updatedAt: "2026-09-20T08:00:00Z",
    },
  },
  {
    bot: ops,
    chat: {
      ref: { ...ops.ref, sessionId: "s2" },
      title: "API 故障",
      updatedAt: "2026-09-19T08:00:00Z",
    },
  },
];

function render(
  rosterOverrides: Partial<Parameters<typeof ChatsOverviewPage>[0]["roster"]> = {},
  bots: BotView[] = [],
) {
  const onOpenChat = vi.fn();
  const view = mount(
    <ChatsOverviewPage
      bots={bots}
      roster={{
        items: chats,
        botStatusByKey: new Map(),
        loading: false,
        refreshing: false,
        progress: { completedBots: 2, totalBots: 2, failedBots: 0 },
        error: null,
        reload: vi.fn(),
        reset: vi.fn(),
        upsert: vi.fn(),
        remove: vi.fn(),
        ...rosterOverrides,
      }}
      archiving={false}
      deleting={false}
      archiveError={null}
      deleteError={null}
      onOpenNewChat={vi.fn()}
      onOpenChat={onOpenChat}
      onEditBot={vi.fn()}
      onArchiveChat={vi.fn()}
      onDeleteChat={vi.fn()}
    />,
  );
  return { container: view.container, onOpenChat, unmount: view.unmount };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ChatsOverviewPage", () => {
  it("uses each Session snapshot for its collaboration label and accessible row name", () => {
    const worker: BotView = {
      ref: { connectionId: "conn", agentId: "worker" },
      name: "设计助手",
      management: "remote-only",
    };
    const view = render(
      {
        items: [
          {
            bot: product,
            chat: {
              ref: { ...product.ref, sessionId: "old" },
              title: "旧任务",
              collaboration: { memberAgentIds: ["worker"] },
            },
          },
          {
            bot: product,
            chat: {
              ref: { ...product.ref, sessionId: "new" },
              title: "新任务",
              collaboration: { memberAgentIds: [] },
            },
          },
        ],
      },
      [product, worker],
    );
    const rows = [
      ...view.container.querySelectorAll<HTMLButtonElement>('[data-chat-navigation-row="true"]'),
    ];
    const oldRow = rows.find((row) => row.textContent?.includes("旧任务"));
    const newRow = rows.find((row) => row.textContent?.includes("新任务"));
    expect(oldRow?.getAttribute("aria-label")).toContain("协作任务，创建时 1 位成员");
    expect(oldRow?.textContent).toContain("协作任务");
    expect(newRow?.getAttribute("aria-label")).not.toContain("协作任务");
    expect(newRow?.textContent).not.toContain("协作任务");
    view.unmount();
  });

  it("完整列出跨 Bot Chat，并持续显示所属 Bot", () => {
    const view = render();
    expect(view.container.querySelectorAll('[data-chat-navigation-row="true"]')).toHaveLength(2);
    expect(view.container.textContent).toContain("需求评审");
    expect(view.container.textContent).toContain("产品助手");
    expect(view.container.textContent).toContain("API 故障");
    expect(view.container.textContent).toContain("运维助手");
    expect(view.container.textContent).toContain("全部任务");
    expect(view.container.textContent).toContain("2 个");
    expect(view.container.textContent).toContain("最近任务");
    view.unmount();
  });

  it("总览滚动容器与列表保留横向收缩约束", () => {
    const view = render({
      items: chats.map((item) => ({
        ...item,
        chat: { ...item.chat, title: "LongSessionTitle".repeat(20) },
      })),
    });
    const scrollRegion = view.container.querySelector(
      '[data-testid="chats-overview-scroll-region"]',
    );
    const list = view.container.querySelector('[aria-label="全部 Chats"]');
    // happy-dom 不计算布局；这里只保护容器约束，不宣称证明真实视口无溢出。
    expect(scrollRegion?.className).toContain("overflow-x-hidden");
    expect(scrollRegion?.className).toContain("min-w-0");
    expect(list?.className).toContain("min-w-0");
    expect(list?.className).toContain("w-full");
    view.unmount();
  });

  it("总览显示页面标题与排序说明", () => {
    const view = render();
    expect(view.container.querySelector("h1")?.textContent).toBe("全部任务");
    expect(view.container.textContent).toContain("按最近活动排序");
    view.unmount();
  });

  it("打开 Chat 时携带所属 Bot 身份", async () => {
    const view = render();
    const row = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="运维助手 · API 故障"]',
    )!;
    await act(async () => row.click());
    expect(view.onOpenChat).toHaveBeenCalledWith(ops, chats[1]!.chat);
    view.unmount();
  });

  it("聚合进行中展示 Bot 读取进度和已发现 Chat 数量", () => {
    const view = mount(
      <ChatsOverviewPage
        roster={{
          items: chats,
          botStatusByKey: new Map(),
          loading: false,
          refreshing: true,
          progress: { completedBots: 1, totalBots: 2, failedBots: 0 },
          error: null,
          reload: vi.fn(),
          reset: vi.fn(),
          upsert: vi.fn(),
          remove: vi.fn(),
        }}
        archiving={false}
        deleting={false}
        archiveError={null}
        deleteError={null}
        onOpenNewChat={vi.fn()}
        onOpenChat={vi.fn()}
        onEditBot={vi.fn()}
        onArchiveChat={vi.fn()}
        onDeleteChat={vi.fn()}
      />,
    );
    expect(view.container.textContent).toContain("正在加载任务：1 / 2");
    expect(view.container.textContent).toContain("已发现 2 个任务");
    view.unmount();
  });

  it("大列表先渲染 50 条，并在接近底部时自动续载", async () => {
    const manyChats = Array.from({ length: 52 }, (_, index) => ({
      bot: product,
      chat: {
        ref: { ...product.ref, sessionId: `session-${index}` },
        title: `Chat ${index}`,
        updatedAt: new Date(Date.UTC(2026, 8, 20, 8, index)).toISOString(),
      },
    }));
    const view = render({ items: manyChats });
    expect(view.container.querySelectorAll('[data-chat-navigation-row="true"]')).toHaveLength(50);
    expect(view.container.textContent).toContain("已显示 50 / 52");
    expect(view.container.textContent).not.toContain("加载更多");

    const scrollRegion = view.container.querySelector<HTMLElement>(
      '[data-testid="chats-overview-scroll-region"]',
    )!;
    Object.defineProperties(scrollRegion, {
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 480 },
    });
    await act(async () => scrollRegion.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(view.container.querySelectorAll('[data-chat-navigation-row="true"]')).toHaveLength(52);
    expect(view.container.textContent).toContain("已显示全部 52 个任务");
    view.unmount();
  });
});
