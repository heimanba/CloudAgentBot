// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeploymentView } from "@shared/models";
import { mount } from "../../test-support/mount";
import { DeploymentSection } from "./deployment-section";

const botRef = { connectionId: "conn-1", agentId: "agent-1" };

function deployment(partial: Partial<DeploymentView>): DeploymentView {
  return {
    ref: { ...botRef, deploymentId: "depl-1" },
    name: "每日汇总",
    status: "active",
    prompt: "汇总昨日数据",
    keyScope: "current",
    ...partial,
  };
}

interface MockHost {
  created: { connectionId: string; input: Record<string, unknown> }[];
  archived: string[];
  listCalls: number;
}

function installHost(deployments: DeploymentView[]): MockHost {
  const state: MockHost = { created: [], archived: [], listCalls: 0 };
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
      setShared: () => Promise.resolve(deployment({})),
      pause: () => Promise.resolve(deployment({ status: "paused" })),
      unpause: () => Promise.resolve(deployment({})),
      archive: (ref: { deploymentId: string }) => {
        state.archived.push(ref.deploymentId);
        return Promise.resolve();
      },
      run: () =>
        Promise.resolve({
          id: "drun-1",
          deploymentId: "depl-1",
          trigger: "manual",
          status: "running",
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

async function openRowMenu(container: HTMLElement): Promise<HTMLElement[]> {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="定时任务操作"]',
  )!;
  act(() =>
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
    ),
  );
  await act(async () => Promise.resolve());
  return Array.from(document.body.querySelectorAll<HTMLElement>("[role=menuitem]"));
}

afterEach(() => {
  document.body.innerHTML = "";
  window.desktopHost = undefined as unknown as typeof window.desktopHost;
});

describe("DeploymentSection", () => {
  it("不支持定时任务的 Provider 不渲染区块", async () => {
    const host = installHost([deployment({})]);
    const view = mount(
      <DeploymentSection botRef={botRef} provider="unknown-provider" onOpenChat={vi.fn()} />,
    );
    await flush();
    expect(view.container.textContent).not.toContain("定时任务");
    expect(host.listCalls).toBe(0);
    view.unmount();
  });

  it("Qoder Provider 渲染区块并拉取列表", async () => {
    const host = installHost([deployment({})]);
    const view = mount(
      <DeploymentSection botRef={botRef} provider="qoder" onOpenChat={vi.fn()} />,
    );
    await flush();
    expect(view.container.textContent).toContain("定时任务");
    expect(host.listCalls).toBe(1);
    view.unmount();
  });

  it("渲染列表：名称、调度文案、下次执行与到期标记", async () => {
    installHost([
      deployment({
        schedule: { expression: "0 9 * * *", timezone: "Asia/Shanghai", nextRunAt: "2026-10-09T01:00:00Z" },
        expiresAt: "2026-01-01",
      }),
      deployment({
        ref: { ...botRef, deploymentId: "depl-2" },
        name: "手动任务",
        status: "paused",
      }),
    ]);
    const view = mount(
      <DeploymentSection botRef={botRef} provider="bailian" onOpenChat={vi.fn()} />,
    );
    await flush();
    expect(view.container.textContent).toContain("每日汇总");
    expect(view.container.textContent).toContain("每天 09:00");
    expect(view.container.textContent).toContain("已到期");
    expect(view.container.textContent).toContain("手动触发");
    expect(view.container.textContent).toContain("已暂停");
    view.unmount();
  });

  it("创建：默认每天 09:00 Asia/Shanghai 编译为 cron 提交，成功后重读列表", async () => {
    const host = installHost([]);
    const view = mount(
      <DeploymentSection botRef={botRef} provider="bailian" onOpenChat={vi.fn()} />,
    );
    await flush();
    const createBtn = Array.from(view.container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("新建定时任务"),
    )!;
    await act(async () => createBtn.click());

    const setInput = (selector: string, value: string, proto: "input" | "textarea") => {
      const el = document.body.querySelector<HTMLInputElement>(selector)!;
      const setter = Object.getOwnPropertyDescriptor(
        proto === "input" ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => setInput("#deployment-name", "每日汇总", "input"));
    await act(async () => setInput("#deployment-prompt", "汇总昨日数据", "textarea"));

    const submit = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent === "创建",
    )!;
    await act(async () => submit.click());
    await flush();

    expect(host.created).toHaveLength(1);
    expect(host.created[0].input).toMatchObject({
      agentId: "agent-1",
      name: "每日汇总",
      prompt: "汇总昨日数据",
      schedule: { expression: "0 9 * * *", timezone: "Asia/Shanghai" },
    });
    expect(host.listCalls).toBeGreaterThanOrEqual(2);
    view.unmount();
  });

  it("其他 Key 范围的共享 Bot：可查看与手动触发，不展示新建与管理操作", async () => {
    installHost([deployment({})]);
    const view = mount(
      <DeploymentSection
        botRef={botRef}
        provider="bailian"
        bot={{
          ref: botRef,
          name: "Bot",
          management: "remote-only",
          keyScope: "other",
          shared: true,
        }}
        onOpenChat={vi.fn()}
      />,
    );
    await flush();
    expect(view.container.textContent).not.toContain("新建定时任务");
    // 打开行操作菜单，只应有「立即运行」与「运行记录」。
    const menuItems = await openRowMenu(view.container);
    const items = menuItems.map((el) => el.textContent);
    expect(items).toEqual(["立即运行", "运行记录"]);
    view.unmount();
  });

  it("归档需 ConfirmDialog 二次确认后才调用 archive", async () => {
    const host = installHost([deployment({})]);
    const view = mount(
      <DeploymentSection botRef={botRef} provider="bailian" onOpenChat={vi.fn()} />,
    );
    await flush();
    const menuItems = await openRowMenu(view.container);
    const archiveItem = menuItems.find((el) => el.textContent === "归档")!;
    await act(async () => archiveItem.click());
    expect(host.archived).toHaveLength(0);
    const confirm = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent === "归档",
    )!;
    await act(async () => confirm.click());
    await flush();
    expect(host.archived).toEqual(["depl-1"]);
    view.unmount();
  });
});
