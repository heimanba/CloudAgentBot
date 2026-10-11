// @vitest-environment happy-dom

/**
 * BotsPage 归档用户行为测试。保护的风险：
 * - 归档入口只对 managed Bot 可见（remote-only/state-missing 不可见）；
 * - 点击入口只打开确认弹窗，不触发归档；
 * - 确认只传该 Bot 的完整 BotRef；
 * - pending 时禁止重复确认与取消；
 * - 成功关闭弹窗；失败弹窗保持并展示映射错误、可重试；
 * - 取消/失败不触发归档调用；
 * - 归档一个 Bot 不影响其他行；其余入口仍可用。
 */

import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import type { BotRef, BotView, HostError } from "@shared/models";
import { mount } from "../../test-support/mount";
import { BotsPage } from "./bots-page";

const MANAGED_A: BotView = {
  ref: { connectionId: "conn-1", agentId: "agent-a" },
  name: "Alpha",
  description: "first",
  management: "managed",
};
const MANAGED_B: BotView = {
  ref: { connectionId: "conn-1", agentId: "agent-b" },
  name: "Beta",
  description: "second",
  management: "managed",
};
const REMOTE_ONLY: BotView = {
  ref: { connectionId: "conn-1", agentId: "agent-remote" },
  name: "Remote",
  management: "remote-only",
};
const STATE_MISSING: BotView = {
  ref: { connectionId: "conn-1", agentId: "agent-sm" },
  name: "Broken",
  management: "state-missing",
};

interface Mounted {
  container: HTMLElement;
  archiveCalls: BotRef[];
  openedBots: BotView[];
  setArchiveError(error: HostError | null): void;
  setArchiveGate(gate: Promise<void>): void;
  unmount(): void;
}

function mountPage(
  bots: BotView[],
  onSetShared?: (ref: BotRef, shared: boolean) => Promise<HostError | null>,
): Mounted {
  const archiveCalls: BotRef[] = [];
  const openedBots: BotView[] = [];
  let archiveError: HostError | null = null;
  let archiveGate: Promise<void> | null = null;

  const view = mount(
    <BotsPage
      connectionId="conn-1"
      bots={bots}
      loading={false}
      error={null}
      onSetShared={onSetShared}
      onReload={() => {}}
      onOpenChats={(bot) => openedBots.push(bot)}
      onSave={() => Promise.resolve(null)}
      onCreate={() => Promise.resolve({ bot: null, error: null })}
      onArchive={(ref) => {
        archiveCalls.push(ref);
        return (archiveGate ?? Promise.resolve()).then(() => archiveError);
      }}
      onCreated={() => {}}
    />,
  );

  return {
    container: view.container,
    archiveCalls,
    openedBots,
    setArchiveError: (e) => {
      archiveError = e;
    },
    setArchiveGate: (g) => {
      archiveGate = g;
    },
    unmount: view.unmount,
  };
}

/** 打开指定 Bot 的管理菜单并返回菜单项文本列表。 */
async function openMenu(container: HTMLElement, botName: string): Promise<HTMLElement[]> {
  const trigger = container.querySelector<HTMLButtonElement>(
    `button[aria-label="管理 ${botName}"]`,
  );
  expect(trigger).not.toBeNull();
  act(() =>
    trigger!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
    ),
  );
  await act(async () => Promise.resolve());
  return Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem]"));
}

/** 点击菜单中“归档 Bot…”项。 */
async function clickArchiveItem(container: HTMLElement, botName: string): Promise<void> {
  const items = await openMenu(container, botName);
  const archiveItem = items.find((i) => i.textContent?.includes("归档 Bot"));
  expect(archiveItem).not.toBeUndefined();
  await act(async () => {
    archiveItem!.click();
    await Promise.resolve();
  });
}

/** 当前打开的确认弹窗按钮。 */
function dialogButtons(): { confirm: HTMLButtonElement; cancel: HTMLButtonElement } {
  const dialog = document.querySelector("[role=alertdialog]");
  expect(dialog).not.toBeNull();
  const buttons = Array.from(dialog!.querySelectorAll("button"));
  const confirm = buttons.find((b) => b.textContent?.includes("归档 Bot"))!;
  const cancel = buttons.find((b) => b.textContent?.includes("取消"))!;
  return { confirm, cancel };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("BotsPage 归档", () => {
  it("打开管理助手时默认只显示我的 Bot", () => {
    const mounted = mountPage([MANAGED_A, MANAGED_B, REMOTE_ONLY]);
    const managedFilter = [...mounted.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("我的助手"),
    );
    expect(managedFilter?.getAttribute("aria-selected")).toBe("true");
    expect(
      mounted.container.querySelector('button[aria-label="打开 Alpha 的 Chat"]'),
    ).not.toBeNull();
    expect(
      mounted.container.querySelector('button[aria-label="打开 Beta 的 Chat"]'),
    ).not.toBeNull();
    expect(mounted.container.querySelector('button[aria-label="打开 Remote 的 Chat"]')).toBeNull();
    mounted.unmount();
  });

  it("协作列表显示当前成员并支持类型筛选与搜索", async () => {
    const coordinator: BotView = {
      ...MANAGED_A,
      collaboration: { memberAgentIds: [MANAGED_B.ref.agentId] },
    };
    const mounted = mountPage([coordinator, MANAGED_B, REMOTE_ONLY]);
    expect(mounted.container.textContent).toContain("协作成员 1 位 · Beta");
    expect(mounted.container.textContent).toContain("参与 Alpha 的协作");
    expect(mounted.container.textContent).toContain("我的助手 2");
    expect(mounted.container.textContent).toContain("全部 2");
    const relation = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="查看 Beta 参与的协作"]',
    )!;
    act(() => relation.click());
    expect(mounted.openedBots).toEqual([coordinator]);
    const roleFilter = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="筛选助手角色"]',
    )!;
    act(() =>
      roleFilter.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
      ),
    );
    await act(async () => Promise.resolve());
    const coordinatorFilter = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "仅协调者",
    )!;
    act(() => coordinatorFilter.click());
    expect(
      mounted.container.querySelector('button[aria-label="打开 Alpha 的 Chat"]'),
    ).not.toBeNull();
    expect(mounted.container.querySelector('button[aria-label="打开 Beta 的 Chat"]')).toBeNull();
    expect(mounted.container.querySelector('input[aria-label="搜索助手"]')).not.toBeNull();
    mounted.unmount();
  });
  it("managed 行显示“归档 Bot…”，remote-only/state-missing 行不显示", async () => {
    const mounted = mountPage([MANAGED_A, { ...REMOTE_ONLY, keyScope: "current" }, STATE_MISSING]);
    const allFilter = [...mounted.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.startsWith("全部 "),
    );
    expect(allFilter).toBeDefined();
    act(() =>
      allFilter!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(allFilter!.getAttribute("aria-selected")).toBe("true");
    expect(
      mounted.container.querySelector('button[aria-label="打开 Remote 的 Chat"]'),
    ).not.toBeNull();
    expect(
      mounted.container.querySelector('button[aria-label="打开 Broken 的 Chat"]'),
    ).not.toBeNull();
    // 行确实可见时，remote-only 与 state-missing 仍无管理菜单触发器。
    expect(mounted.container.querySelector('button[aria-label="管理 Remote"]')).toBeNull();
    expect(mounted.container.querySelector('button[aria-label="管理 Broken"]')).toBeNull();

    const items = await openMenu(mounted.container, "Alpha");
    const texts = items.map((i) => i.textContent ?? "");
    expect(texts.some((t) => t.includes("归档 Bot"))).toBe(true);
    expect(texts.some((t) => t.includes("编辑配置"))).toBe(true);
    expect(texts.some((t) => t.includes("重新同步"))).toBe(true);
    mounted.unmount();
  });

  it("取消不调用 archive 且关闭弹窗", async () => {
    const mounted = mountPage([MANAGED_A]);
    await clickArchiveItem(mounted.container, "Alpha");
    const dialog = document.querySelector("[role=alertdialog]");
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("归档“Alpha”？");
    expect(dialog!.textContent).toContain("该 Bot 将被标记为归档，不会再出现在 Bot 列表中。");
    expect(dialog!.textContent).toContain("历史 Chat 与记录不受影响。");
    expect(mounted.archiveCalls).toEqual([]);
    const { cancel } = dialogButtons();
    await act(async () => {
      cancel.click();
      await Promise.resolve();
    });
    expect(mounted.archiveCalls).toEqual([]);
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
    mounted.unmount();
  });

  it("确认只传入该 Bot 的完整 BotRef，成功后弹窗关闭", async () => {
    const mounted = mountPage([MANAGED_A, MANAGED_B]);
    await clickArchiveItem(mounted.container, "Beta");
    const { confirm } = dialogButtons();
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    expect(mounted.archiveCalls).toEqual([{ connectionId: "conn-1", agentId: "agent-b" }]);
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
    mounted.unmount();
  });

  it("pending 时无法重复确认或取消", async () => {
    const mounted = mountPage([MANAGED_A]);
    const gate = Promise.withResolvers<void>();
    mounted.setArchiveGate(gate.promise);
    await clickArchiveItem(mounted.container, "Alpha");

    const { confirm, cancel } = dialogButtons();
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    // pending：确认按钮显示处理中且禁用，取消也禁用。
    expect(confirm.textContent).toContain("处理中");
    expect(confirm.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    // 重复点击不产生第二次调用。
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    expect(mounted.archiveCalls).toHaveLength(1);

    gate.resolve();
    await act(async () => Promise.resolve());
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
    mounted.unmount();
  });

  it("失败后弹窗保持打开、显示映射错误并允许重试", async () => {
    const mounted = mountPage([MANAGED_A]);
    mounted.setArchiveError({ code: "unavailable", message: "x" });
    await clickArchiveItem(mounted.container, "Alpha");

    const { confirm } = dialogButtons();
    await act(async () => {
      confirm.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    // 弹窗仍打开，显示错误文案。
    expect(document.querySelector("[role=alertdialog]")).not.toBeNull();
    expect(document.querySelector("[role=alertdialog]")!.textContent).toContain("归档失败");
    expect(document.querySelector("[role=alertdialog]")!.textContent).toContain(
      "服务暂时不可用，请稍后重试。",
    );

    // 重试成功：弹窗关闭，共两次调用。
    mounted.setArchiveError(null);
    await act(async () => {
      dialogButtons().confirm.click();
      await Promise.resolve();
    });
    expect(mounted.archiveCalls).toHaveLength(2);
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
    mounted.unmount();
  });

  it("归档一个 Bot 不影响其他行", async () => {
    const mounted = mountPage([MANAGED_A, MANAGED_B]);
    await clickArchiveItem(mounted.container, "Alpha");
    await act(async () => {
      dialogButtons().confirm.click();
      await Promise.resolve();
    });
    expect(mounted.archiveCalls).toEqual([{ connectionId: "conn-1", agentId: "agent-a" }]);
    // Beta 行的管理菜单仍可打开。
    const items = await openMenu(mounted.container, "Beta");
    expect(items.some((i) => i.textContent?.includes("归档 Bot"))).toBe(true);
    mounted.unmount();
  });
});

it("只有未分组资源时管理空态不引导清除筛选扩大范围", () => {
  const mounted = mountPage([{ ...REMOTE_ONLY, keyScope: "ungrouped" }]);
  expect(mounted.container.textContent).toContain("全部 0");
  expect(mounted.container.textContent).toContain("还没有团队共享助手");
  expect(mounted.container.textContent).not.toContain("清除筛选");
  const all = [...mounted.container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("全部"),
  )!;
  act(() => all.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  expect(mounted.container.querySelector('button[aria-label="打开 Remote 的 Chat"]')).toBeNull();
  mounted.unmount();
});

// 保护共享面板先说明范围、再明确提交，以及失败后可重试。
it("在列表直接共享指定 Bot，失败保留未共享状态并允许重试", async () => {
  const calls: { ref: BotRef; shared: boolean }[] = [];
  const view = mountPage([MANAGED_A], async (ref, shared) => {
    calls.push({ ref, shared });
    return { code: "unavailable", message: "unavailable" };
  });
  try {
    const share = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="共享 Alpha"]',
    );
    expect(share?.textContent).toContain("共享");
    await act(async () => {
      share!.click();
    });
    expect(calls).toEqual([]);
    const enable = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "开启共享",
    )!;
    await act(async () => enable.click());
    expect(calls).toEqual([{ ref: MANAGED_A.ref, shared: true }]);
    expect(view.openedBots).toEqual([]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("共享设置未同步成功");
    expect(share!.disabled).toBe(false);
    expect(share!.textContent).toContain("共享");
  } finally {
    view.unmount();
  }
});

it("无本机管理资料的接收方默认看到团队共享，不能操作共享开关", () => {
  const view = mountPage([{ ...REMOTE_ONLY, keyScope: "current", shared: true }], async () => null);
  try {
    expect(view.container.querySelector('button[aria-selected="true"]')?.textContent).toContain(
      "团队共享",
    );
    expect(view.container.querySelector('button[aria-label="打开 Remote 的 Chat"]')).not.toBeNull();
    expect(view.container.querySelector('button[aria-label="共享 Remote"]')).toBeNull();
    expect(view.container.querySelector('button[aria-label="取消共享 Remote"]')).toBeNull();
  } finally {
    view.unmount();
  }
});

it("查看已共享状态不会取消共享，取消操作位于面板内", async () => {
  const calls: boolean[] = [];
  const view = mountPage(
    [{ ...MANAGED_A, keyScope: "current", shared: true }],
    async (_ref, shared) => {
      calls.push(shared);
      return null;
    },
  );
  try {
    expect(view.container.textContent).not.toContain("API Key");
    expect(view.container.textContent).not.toContain("ID 尾号");
    const trigger = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="共享 Alpha"]',
    )!;
    expect(trigger.textContent).toContain("已共享");
    await act(async () => trigger.click());
    expect(calls).toEqual([]);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("API Key");
    const cancelShare = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "取消共享",
    )!;
    await act(async () => cancelShare.click());
    expect(calls).toEqual([false]);
  } finally {
    view.unmount();
  }
});

it("共享提交中禁止重复操作，完成后以远程返回状态为准", async () => {
  const gate = Promise.withResolvers<HostError | null>();
  let calls = 0;
  const view = mountPage([MANAGED_A], () => {
    calls++;
    return gate.promise;
  });
  try {
    const trigger = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="共享 Alpha"]',
    )!;
    await act(async () => trigger.click());
    const submit = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "开启共享",
    )!;
    act(() => submit.click());
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("true");
    act(() => submit.click());
    expect(calls).toBe(1);
    await act(async () => gate.resolve(null));
    expect(submit.disabled).toBe(false);
    expect(trigger.textContent).not.toContain("已共享");
  } finally {
    view.unmount();
  }
});

it("接收方可按需查看共享范围说明且没有权限写操作", async () => {
  const view = mountPage([{ ...REMOTE_ONLY, shared: true }]);
  try {
    expect(document.body.textContent).not.toContain("共享不改变 Provider 权限");
    const help = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="团队共享说明"]',
    )!;
    await act(async () => {
      help.click();
    });
    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel.textContent).toContain("不要求相同 API Key");
    expect(panel.textContent).toContain("任务历史可跨设备查看");
    expect(panel.textContent).toContain("共享不改变 Provider 权限");
    expect(panel.querySelector("button")).toBeNull();
  } finally {
    view.unmount();
  }
});
