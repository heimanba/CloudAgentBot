// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotView, DeploymentView } from "@shared/models";
import { mount } from "../../test-support/mount";
import { DeploymentsPage } from "./deployments-page";

const BOT_A: BotView = {
  ref: { connectionId: "conn-1", agentId: "agent-a" },
  name: "Alpha",
  management: "managed",
};
const BOT_B: BotView = {
  ref: { connectionId: "conn-1", agentId: "agent-b" },
  name: "Beta",
  management: "managed",
};

function deployment(partial: Partial<DeploymentView>): DeploymentView {
  return {
    ref: { connectionId: "conn-1", agentId: "agent-a", deploymentId: "depl-1" },
    name: "每日汇总",
    status: "active",
    prompt: "汇总昨日数据",
    keyScope: "current",
    ...partial,
  };
}

interface MockHost {
  created: { connectionId: string; input: Record<string, unknown> }[];
  setSharedCalls: { deploymentId: string; shared: boolean }[];
  listCalls: number;
}

function installHost(deployments: DeploymentView[]): MockHost {
  const state: MockHost = { created: [], setSharedCalls: [], listCalls: 0 };
  window.desktopHost = {
    deployments: {
      list: () => {
        state.listCalls += 1;
        return Promise.resolve(deployments);
      },
      create: (connectionId: string, input: Record<string, unknown>) => {
        state.created.push({ connectionId, input });
        return Promise.resolve(deployment({ name: String(input.name) }));
      },
      update: () => Promise.resolve(deployment({})),
      setShared: (ref: { deploymentId: string }, shared: boolean) => {
        state.setSharedCalls.push({ deploymentId: ref.deploymentId, shared });
        return Promise.resolve(deployment({ shared }));
      },
      pause: () => Promise.resolve(deployment({ status: "paused" })),
      unpause: () => Promise.resolve(deployment({})),
      archive: () => Promise.resolve(),
      run: () =>
        Promise.resolve({
          id: "drun-1",
          deploymentId: "depl-1",
          trigger: "manual",
          status: "running",
          sessionId: "sess-new",
        }),
      listRuns: () => Promise.resolve([]),
    },
  } as unknown as typeof window.desktopHost;
  return state;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function setInput(selector: string, value: string, proto: "input" | "textarea") {
  const el = document.body.querySelector<HTMLInputElement>(selector)!;
  const setter = Object.getOwnPropertyDescriptor(
    proto === "input" ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = "";
  window.desktopHost = undefined as unknown as typeof window.desktopHost;
});

describe("DeploymentsPage", () => {
  it("渲染跨 Bot 列表并标注所属 Bot 名称", async () => {
    installHost([
      deployment({}),
      deployment({
        ref: { connectionId: "conn-1", agentId: "agent-b", deploymentId: "depl-2" },
        name: "周报",
        status: "paused",
      }),
    ]);
    const view = mount(
      <DeploymentsPage
        connectionId="conn-1"
        provider="bailian"
        bots={[BOT_A, BOT_B]}
        botsLoading={false}
        onOpenChat={vi.fn()}
      />,
    );
    await flush();
    expect(view.container.textContent).toContain("每日汇总");
    expect(view.container.textContent).toContain("Alpha");
    expect(view.container.textContent).toContain("周报");
    expect(view.container.textContent).toContain("Beta");
    expect(view.container.textContent).toContain("已暂停");
    view.unmount();
  });

  it("新建定时任务：表单提供执行 Bot 选择器，默认选中第一个 Bot 并随创建提交", async () => {
    const host = installHost([]);
    const view = mount(
      <DeploymentsPage
        connectionId="conn-1"
        provider="bailian"
        bots={[BOT_A, BOT_B]}
        botsLoading={false}
        onOpenChat={vi.fn()}
      />,
    );
    await flush();
    const createBtn = Array.from(view.container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("新建定时任务"),
    )!;
    await act(async () => createBtn.click());

    const botSelect = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="执行 Bot"]',
    );
    expect(botSelect).not.toBeNull();
    expect(botSelect!.textContent).toContain("Alpha");

    await act(async () => setInput("#deployment-name", "每日汇总", "input"));
    await act(async () => setInput("#deployment-prompt", "汇总昨日数据", "textarea"));
    const submit = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent === "创建",
    )!;
    await act(async () => submit.click());
    await flush();

    expect(host.created).toHaveLength(1);
    expect(host.created[0].connectionId).toBe("conn-1");
    expect(host.created[0].input).toMatchObject({
      agentId: "agent-a",
      name: "每日汇总",
      prompt: "汇总昨日数据",
    });
    view.unmount();
  });

  it("没有可创建的 Bot 时禁用新建按钮", async () => {
    installHost([]);
    const otherKeyBot: BotView = {
      ...BOT_A,
      keyScope: "other",
      shared: false,
    };
    const view = mount(
      <DeploymentsPage
        connectionId="conn-1"
        provider="bailian"
        bots={[otherKeyBot]}
        botsLoading={false}
        onOpenChat={vi.fn()}
      />,
    );
    await flush();
    const createBtn = Array.from(view.container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("新建定时任务"),
    )!;
    expect(createBtn.disabled).toBe(true);
    view.unmount();
  });

  it("立即运行：会话就绪后直接跳转，不打开详情弹窗", async () => {
    installHost([deployment({})]);
    const onOpenChat = vi.fn();
    const view = mount(
      <DeploymentsPage
        connectionId="conn-1"
        provider="bailian"
        bots={[BOT_A, BOT_B]}
        botsLoading={false}
        onOpenChat={onOpenChat}
      />,
    );
    await flush();
    const trigger = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="定时任务操作"]',
    )!;
    act(() =>
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
      ),
    );
    await act(async () => Promise.resolve());
    const runItem = Array.from(
      document.body.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ).find((el) => el.textContent === "立即运行")!;
    await act(async () => runItem.click());
    await flush();
    expect(onOpenChat).toHaveBeenCalledWith(BOT_A, {
      ref: { connectionId: "conn-1", agentId: "agent-a", sessionId: "sess-new" },
      title: "每日汇总",
    });
    expect(document.body.textContent).not.toContain("运行记录");
    view.unmount();
  });

  it("「运行记录」菜单项打开详情弹窗", async () => {
    installHost([deployment({})]);
    const view = mount(
      <DeploymentsPage
        connectionId="conn-1"
        provider="bailian"
        bots={[BOT_A, BOT_B]}
        botsLoading={false}
        onOpenChat={vi.fn()}
      />,
    );
    await flush();
    const trigger = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="定时任务操作"]',
    )!;
    act(() =>
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
      ),
    );
    await act(async () => Promise.resolve());
    const historyItem = Array.from(
      document.body.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ).find((el) => el.textContent === "运行记录")!;
    await act(async () => historyItem.click());
    await flush();
    expect(document.body.textContent).toContain("运行记录");
    expect(document.body.textContent).toContain("执行内容");
    view.unmount();
  });

  it("「共享」菜单项调用 setShared 并刷新列表", async () => {
    const host = installHost([deployment({})]);
    const view = mount(
      <DeploymentsPage
        connectionId="conn-1"
        provider="bailian"
        bots={[BOT_A, BOT_B]}
        botsLoading={false}
        onOpenChat={vi.fn()}
      />,
    );
    await flush();
    const trigger = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="定时任务操作"]',
    )!;
    act(() =>
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
      ),
    );
    await act(async () => Promise.resolve());
    const shareItem = Array.from(
      document.body.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ).find((el) => el.textContent === "共享")!;
    await act(async () => shareItem.click());
    await flush();
    expect(host.setSharedCalls).toEqual([{ deploymentId: "depl-1", shared: true }]);
    expect(host.listCalls).toBeGreaterThanOrEqual(2);
    view.unmount();
  });
});
