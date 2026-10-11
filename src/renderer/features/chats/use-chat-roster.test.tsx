// @vitest-environment happy-dom

/**
 * Session roster 测试保护：
 * - 左侧条目是 Chat，并保留所属 Bot；
 * - 按远程更新时间排序；
 * - 一个 Bot 读取失败不会隐藏其他 Bot 的 Chat；
 * - 手动刷新重新读取远程事实。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotView, ChatView } from "@shared/models";
import { mount } from "../../test-support/mount";

let useChatRoster: typeof import("./use-chat-roster").useChatRoster;

const bots: BotView[] = [
  {
    ref: { connectionId: "conn-1", agentId: "agent-a" },
    name: "Sales Bot",
    management: "managed",
  },
  {
    ref: { connectionId: "conn-1", agentId: "agent-b" },
    name: "Inbox Bot",
    management: "remote-only",
  },
];

function chat(agentId: string, sessionId: string, title: string, updatedAt: string): ChatView {
  return {
    ref: { connectionId: "conn-1", agentId, sessionId },
    title,
    updatedAt,
  };
}

function Harness({ sourceBots = bots }: { sourceBots?: BotView[] }) {
  const roster = useChatRoster(sourceBots);
  return (
    <div>
      <span data-testid="loading">{String(roster.loading)}</span>
      <span data-testid="error">{roster.error?.code ?? ""}</span>
      <span data-testid="progress">
        {`${roster.progress.completedBots}/${roster.progress.totalBots}/${roster.progress.failedBots}`}
      </span>
      <span data-testid="statuses">
        {sourceBots
          .map(
            (bot) =>
              `${bot.ref.agentId}:${roster.botStatusByKey.get(`${bot.ref.connectionId}/${bot.ref.agentId}`) ?? "absent"}`,
          )
          .join(",")}
      </span>
      <button data-testid="reload" onClick={roster.reload}>
        reload
      </button>
      <button data-testid="reset" onClick={roster.reset}>
        reset
      </button>
      <button
        data-testid="upsert"
        onClick={() =>
          roster.upsert(
            sourceBots[0]!,
            chat("agent-a", "created", "刚创建的对话", "2026-09-18T08:00:00Z"),
          )
        }
      >
        upsert
      </button>
      <button
        data-testid="remove-doomed"
        onClick={() =>
          roster.remove({ connectionId: "conn-1", agentId: "agent-a", sessionId: "doomed" })
        }
      >
        remove
      </button>
      {roster.items.map(({ bot, chat: item }) => (
        <p key={item.ref.sessionId}>{`${item.title}|${bot.name}`}</p>
      ))}
    </div>
  );
}

function renderRoster() {
  const view = mount(<Harness />);
  return { container: view.container, unmount: view.unmount };
}

describe("useChatRoster", () => {
  const list = vi.fn();

  beforeEach(async () => {
    list.mockReset();
    // 每个用例隔离缓存；同一用例内的重挂载仍使用同一个模块实例。
    vi.resetModules();
    ({ useChatRoster } = await import("./use-chat-roster"));
    (window as unknown as Record<string, unknown>).desktopHost = { chats: { list } };
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).desktopHost;
    document.body.innerHTML = "";
  });

  it("聚合 Chat 与所属 Bot，并按更新时间倒序", async () => {
    list.mockImplementation(({ agentId }: { agentId: string }) =>
      Promise.resolve(
        agentId === "agent-a"
          ? [chat(agentId, "old", "旧对话", "2026-09-15T08:00:00Z")]
          : [chat(agentId, "new", "新对话", "2026-09-17T08:00:00Z")],
      ),
    );
    const view = renderRoster();

    await act(async () => Promise.resolve());

    const rows = [...view.container.querySelectorAll("p")].map((node) => node.textContent);
    expect(rows).toEqual(["新对话|Inbox Bot", "旧对话|Sales Bot"]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(view.container.querySelector('[data-testid="progress"]')?.textContent).toBe("2/2/0");
    view.unmount();
  });

  it("部分失败时保留成功读取的 Chat 并暴露错误", async () => {
    list.mockImplementation(({ agentId }: { agentId: string }) =>
      agentId === "agent-a"
        ? Promise.reject({ code: "unavailable", message: "offline" })
        : Promise.resolve([chat(agentId, "inbox", "收件箱", "2026-09-17T08:00:00Z")]),
    );
    const view = renderRoster();

    await act(async () => Promise.resolve());

    expect(view.container.textContent).toContain("收件箱|Inbox Bot");
    expect(view.container.querySelector('[data-testid="error"]')?.textContent).toBe("unavailable");
    expect(view.container.querySelector('[data-testid="progress"]')?.textContent).toBe("2/2/1");
    view.unmount();
  });

  it("reload 重新读取所有 Bot", async () => {
    list.mockResolvedValue([]);
    const view = renderRoster();
    await act(async () => Promise.resolve());

    act(() => view.container.querySelector<HTMLButtonElement>('[data-testid="reload"]')!.click());
    await act(async () => Promise.resolve());

    expect(list).toHaveBeenCalledTimes(4);
    view.unmount();
  });

  it("reload 保留未最终一致的乐观条目", async () => {
    list.mockResolvedValue([]);
    const view = renderRoster();
    await act(async () => Promise.resolve());

    act(() => view.container.querySelector<HTMLButtonElement>('[data-testid="upsert"]')!.click());
    expect(view.container.textContent).toContain("刚创建的对话|Sales Bot");

    act(() => view.container.querySelector<HTMLButtonElement>('[data-testid="reload"]')!.click());
    await act(async () => Promise.resolve());

    expect(view.container.textContent).toContain("刚创建的对话|Sales Bot");
    view.unmount();
  });

  it("reset 丢弃未最终一致的乐观条目（更换凭据场景）", async () => {
    list.mockResolvedValue([]);
    const view = renderRoster();
    await act(async () => Promise.resolve());

    act(() => view.container.querySelector<HTMLButtonElement>('[data-testid="upsert"]')!.click());
    expect(view.container.textContent).toContain("刚创建的对话|Sales Bot");

    // 更换凭据后远程列表在新范围读不回该 Session。
    act(() => view.container.querySelector<HTMLButtonElement>('[data-testid="reset"]')!.click());
    await act(async () => Promise.resolve());

    expect(view.container.textContent).not.toContain("刚创建的对话|Sales Bot");
    view.unmount();
  });

  it("慢 Bot 不阻塞快 Bot 的增量渲染", async () => {
    let resolveSlow: ((chats: ChatView[]) => void) | null = null;
    list.mockImplementation(({ agentId }: { agentId: string }) =>
      agentId === "agent-a"
        ? new Promise<ChatView[]>((resolve) => {
            resolveSlow = resolve;
          })
        : Promise.resolve([chat(agentId, "inbox", "收件箱", "2026-09-17T08:00:00Z")]),
    );
    const view = renderRoster();

    await act(async () => Promise.resolve());
    expect(view.container.textContent).toContain("收件箱|Inbox Bot");
    expect(view.container.querySelector('[data-testid="loading"]')?.textContent).toBe("false");

    await act(async () => {
      resolveSlow?.([chat("agent-a", "slow", "慢对话", "2026-09-16T08:00:00Z")]);
      await Promise.resolve();
    });
    expect(view.container.textContent).toContain("慢对话|Sales Bot");
    view.unmount();
  });

  it("重新挂载时先展示内存缓存并后台刷新", async () => {
    list.mockResolvedValue([chat("agent-a", "cached", "缓存对话", "2026-09-17T08:00:00Z")]);
    const first = renderRoster();
    await act(async () => Promise.resolve());
    first.unmount();

    list.mockImplementation(() => new Promise<ChatView[]>(() => {}));
    const second = renderRoster();

    expect(second.container.textContent).toContain("缓存对话|Sales Bot");
    expect(second.container.querySelector('[data-testid="loading"]')?.textContent).toBe("false");
    second.unmount();
  });

  it("remove 立即移除条目并失效缓存，reload 间隙不回闪", async () => {
    list.mockResolvedValue([chat("agent-a", "doomed", "待删除", "2026-09-17T08:00:00Z")]);
    const view = renderRoster();
    await act(async () => Promise.resolve());
    expect(view.container.textContent).toContain("待删除|Sales Bot");

    // 模拟删除成功：先 remove（同步失效缓存），再 reload（key 迁移期间读缓存）。
    act(() =>
      view.container.querySelector<HTMLButtonElement>('[data-testid="remove-doomed"]')!.click(),
    );
    expect(view.container.textContent).not.toContain("待删除|Sales Bot");

    list.mockResolvedValue([]);
    act(() => view.container.querySelector<HTMLButtonElement>('[data-testid="reload"]')!.click());
    // key 迁移间隙读缓存，缓存已被 remove 失效，不应回闪。
    expect(view.container.textContent).not.toContain("待删除|Sales Bot");
    await act(async () => Promise.resolve());
    expect(view.container.textContent).not.toContain("待删除|Sales Bot");
    view.unmount();
  });

  it("每个 Bot 从 loading 正确进入 loaded；成功空数组也算 loaded", async () => {
    list.mockImplementation(({ agentId }: { agentId: string }) =>
      Promise.resolve(
        agentId === "agent-a" ? [chat("agent-a", "s1", "对话", "2026-09-17T08:00:00Z")] : [],
      ),
    );
    const view = renderRoster();
    // 初始全部为 loading。
    expect(view.container.querySelector('[data-testid="statuses"]')?.textContent).toBe(
      "agent-a:loading,agent-b:loading",
    );
    await act(async () => Promise.resolve());
    expect(view.container.querySelector('[data-testid="statuses"]')?.textContent).toBe(
      "agent-a:loaded,agent-b:loaded",
    );
    view.unmount();
  });

  it("成功空数组与失败得到不同状态；失败不算空", async () => {
    list.mockImplementation(({ agentId }: { agentId: string }) =>
      agentId === "agent-a"
        ? Promise.resolve([])
        : Promise.reject({ code: "unavailable", message: "offline" }),
    );
    const view = renderRoster();
    await act(async () => Promise.resolve());
    expect(view.container.querySelector('[data-testid="statuses"]')?.textContent).toBe(
      "agent-a:loaded,agent-b:error",
    );
    view.unmount();
  });

  it("reload 将当前 Bot 重置为 loading，但仍保留可用缓存", async () => {
    list.mockResolvedValue([chat("agent-a", "s1", "对话", "2026-09-17T08:00:00Z")]);
    const view = renderRoster();
    await act(async () => Promise.resolve());
    expect(view.container.querySelector('[data-testid="statuses"]')?.textContent).toContain(
      "loaded",
    );

    list.mockImplementation(() => new Promise<ChatView[]>(() => {}));
    act(() => view.container.querySelector<HTMLButtonElement>('[data-testid="reload"]')!.click());
    // reload 后回到 loading，且缓存内容仍展示。
    expect(view.container.querySelector('[data-testid="statuses"]')?.textContent).toBe(
      "agent-a:loading,agent-b:loading",
    );
    expect(view.container.textContent).toContain("对话|Sales Bot");
    view.unmount();
  });

  it("upsert 将对应 Bot 标记为 loaded 并立即提供 Chat", async () => {
    // agent-a 持续 pending（无缓存）；upsert 不等远程列表即把该 Bot 标记 loaded。
    list.mockImplementation(() => new Promise<ChatView[]>(() => {}));
    const view = renderRoster();
    await act(async () => Promise.resolve());
    expect(view.container.querySelector('[data-testid="statuses"]')?.textContent).toBe(
      "agent-a:loading,agent-b:loading",
    );

    act(() => view.container.querySelector<HTMLButtonElement>('[data-testid="upsert"]')!.click());
    expect(view.container.textContent).toContain("刚创建的对话|Sales Bot");
    expect(view.container.querySelector('[data-testid="statuses"]')?.textContent).toBe(
      "agent-a:loaded,agent-b:loading",
    );
    view.unmount();
  });

  it("切换到复用相同 Agent ID 的 Connection 时不显示旧 Connection Chat", async () => {
    const oldSharedBot: BotView = {
      ref: { connectionId: "conn-old", agentId: "shared-agent" },
      name: "旧连接 Bot",
      management: "remote-only",
    };
    const oldOtherBot: BotView = {
      ref: { connectionId: "conn-old", agentId: "old-other" },
      name: "旧连接其他 Bot",
      management: "remote-only",
    };
    const newSharedBot: BotView = {
      ref: { connectionId: "conn-new", agentId: "shared-agent" },
      name: "新连接 Bot",
      management: "remote-only",
    };
    const newFastBot: BotView = {
      ref: { connectionId: "conn-new", agentId: "new-fast" },
      name: "新连接快速 Bot",
      management: "remote-only",
    };
    let resolveNewShared: ((value: ChatView[]) => void) | null = null;
    list.mockImplementation(
      ({ connectionId, agentId }: { connectionId: string; agentId: string }) => {
        if (connectionId === "conn-old") {
          return Promise.resolve(
            agentId === "shared-agent"
              ? [chat(agentId, "old-shared", "旧连接对话", "2026-09-17T08:00:00Z")]
              : [chat(agentId, "old-other", "旧连接其他对话", "2026-09-16T08:00:00Z")],
          );
        }
        if (agentId === "new-fast") return Promise.resolve([]);
        return new Promise<ChatView[]>((resolve) => {
          resolveNewShared = resolve;
        });
      },
    );

    const view = mount(<Harness sourceBots={[oldSharedBot, oldOtherBot]} />);
    await act(async () => Promise.resolve());
    expect(view.container.textContent).toContain("旧连接对话");

    act(() => view.root.render(<Harness sourceBots={[newSharedBot, newFastBot]} />));
    await act(async () => Promise.resolve());
    expect(view.container.textContent).not.toContain("旧连接对话");

    await act(async () => resolveNewShared?.([]));
    view.unmount();
  });
});
