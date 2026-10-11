// @vitest-environment happy-dom

/**
 * Bot 配置编辑用户行为测试。保护的风险：
 * - 打开配置经 getConfiguration 初始化四字段与模型候选；
 * - 未变更时仍可重新同步；
 * - 保存失败保留输入并显示稳定错误，不离开表单；
 * - 保存成功返回列表并触发重载；
 * - 取消返回列表；
 * - hasPendingChanges 展示固定提示。
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act } from "react";
import type { BotConfigurationView, BotRef, BotView, HostError } from "@shared/models";
import { mount } from "../../test-support/mount";
import { BotsPage } from "./bots-page";
import type { DesktopHost } from "@shared/desktop-host-contract";

const MANAGED_BOT: BotView = {
  ref: { connectionId: "conn-1", agentId: "agent-1" },
  name: "Helper",
  description: "old desc",
  management: "managed",
};

function makeConfig(overrides: Partial<BotConfigurationView> = {}): BotConfigurationView {
  return {
    ref: MANAGED_BOT.ref,
    provider: "qoder",
    name: "Helper",
    description: "old desc",
    instructions: "Be helpful.",
    model: "ultimate",
    skills: [],
    memberAgentIds: [],
    models: [
      { value: "ultimate", label: "ultimate" },
      { value: "efficient", label: "efficient" },
    ],
    hasPendingChanges: false,
    ...overrides,
  };
}

interface SaveCall {
  ref: BotRef;
  input: unknown;
}

function mountPage({
  config,
  configError = null,
  saveResult = Promise.resolve<HostError | null>(null),
}: {
  config: BotConfigurationView;
  configError?: HostError | null;
  saveResult?: Promise<HostError | null>;
}) {
  const saveCalls: SaveCall[] = [];
  const syncCalls: BotRef[] = [];
  const host: DesktopHost["bots"] = {
    list: () => Promise.resolve([MANAGED_BOT]),
    listSkills: () => Promise.resolve([]),
    listSkillCatalog: () =>
      Promise.resolve([{ catalogId: "official_1", name: "深入研究", installCount: 10 }]),
    addSkillFromCatalog: () =>
      Promise.resolve({ type: "custom", skillId: "skill_1", name: "深入研究" }),
    get: () => Promise.resolve(MANAGED_BOT),
    getConfiguration: (ref: BotRef) =>
      configError ? Promise.reject(configError) : Promise.resolve({ ...config, ref }),
    create: () => Promise.reject({ code: "unavailable", message: "n/a" }),
    update: (ref, input) => {
      saveCalls.push({ ref, input });
      return saveResult.then((err) => {
        if (err !== null) throw err;
        return MANAGED_BOT;
      });
    },
    sync: (ref) => {
      syncCalls.push(ref);
      return Promise.resolve(MANAGED_BOT);
    },
    archive: () => Promise.resolve(),
    setShared: () => Promise.resolve({} as BotView),
  };
  (window as unknown as Record<string, unknown>).desktopHost = { bots: host };

  let reloadCount = 0;
  const view = mount(
    <BotsPage
      connectionId="conn-1"
      bots={[MANAGED_BOT]}
      loading={false}
      error={null}
      provider="qoder"
      onReload={() => {
        reloadCount += 1;
      }}
      onSave={(ref, input) =>
        typeof input === "string"
          ? host
              .sync(ref)
              .then(() => null)
              .catch((e) => e as HostError)
          : host
              .update(ref, input)
              .then(() => null)
              .catch((e) => e as HostError)
      }
      onCreate={() => Promise.resolve({ bot: null, error: null })}
      onArchive={() => Promise.resolve(null)}
      onCreated={() => {}}
      onOpenChats={() => {}}
    />,
  );
  return {
    container: view.container,
    saveCalls,
    syncCalls,
    getReloadCount: () => reloadCount,
    unmount: () => {
      view.unmount();
      delete (window as unknown as Record<string, unknown>).desktopHost;
    },
  };
}

/** 让出一个事件循环，等待 React 状态与 effect 落地。 */
function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function openEditForm(container: HTMLElement) {
  // 打开行内菜单。
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="管理 Helper"]')!;
  await act(async () => {
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
    );
  });
  const editItem = Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem]")).find(
    (item) => item.textContent?.includes("编辑配置"),
  )!;
  await act(async () => {
    editItem.click();
    await flush();
  });
}

describe("BotsPage 配置编辑", () => {
  it("编辑内置工具时提交完整工具集合", async () => {
    const { container, saveCalls, unmount } = mountPage({
      config: makeConfig({ builtinTools: ["read", "grep"] }),
    });
    await openEditForm(container);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="选择内置工具"]')!.click(),
    );
    const bash = document.querySelector<HTMLButtonElement>('[role="checkbox"][aria-label="Bash"]')!;
    await act(async () => bash.click());
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent === "确认选择（3）")!
        .click();
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "保存并同步")!
        .click();
      await flush();
    });
    expect(saveCalls[0]?.input).toMatchObject({ builtinTools: ["bash", "read", "grep"] });
    unmount();
  });

  it("编辑描述时保留当前版本未开放的已有工具声明", async () => {
    const { container, saveCalls, unmount } = mountPage({
      config: makeConfig({ builtinTools: ["read", "future_tool"] }),
    });
    await openEditForm(container);
    expect(container.textContent).toContain("future_tool");
    const description = container.querySelector<HTMLTextAreaElement>("#bot-config-description")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(description, "updated");
      description.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "保存并同步")!
        .click();
      await flush();
    });
    expect(saveCalls[0]?.input).not.toHaveProperty("builtinTools");
    unmount();
  });
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).desktopHost;
  });

  it("打开后经 getConfiguration 初始化四字段，未变更时可重新同步", async () => {
    const { container, saveCalls, syncCalls, unmount } = mountPage({ config: makeConfig() });
    await openEditForm(container);

    const nameInput = container.querySelector<HTMLInputElement>("#bot-config-name")!;
    expect(nameInput.value).toBe("Helper");
    // 保留经过视觉验收的扁平表单结构，避免重新叠加内层卡片和标题间距。
    const form = container.querySelector("#bot-config-title")!.closest("form")!;
    const surface = form.parentElement!;
    const header = form.children[0]!;
    const fields = form.children[1]!;
    expect(surface.className).not.toContain("border");
    expect(surface.className).not.toContain("bg-card");
    expect(surface.className).not.toContain("shadow");
    expect(form.className).toContain("gap-5");
    expect(header.contains(container.querySelector("#bot-config-title"))).toBe(true);
    expect(header.className).toContain("pb-5");
    expect(header.className).not.toContain("mb-1");
    expect(header.className).not.toContain("border-b");
    expect(fields.className).toContain("gap-5");
    expect(fields.querySelector("input")).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>("#bot-config-description")!.value).toBe(
      "old desc",
    );
    expect(container.querySelector<HTMLTextAreaElement>("#bot-config-instructions")!.value).toBe(
      "Be helpful.",
    );

    const submit = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "保存并同步",
    )!;
    expect(submit.disabled).toBe(false);
    await act(async () => {
      submit.click();
      await flush();
    });
    expect(syncCalls).toEqual([MANAGED_BOT.ref]);
    expect(saveCalls).toHaveLength(0);
    unmount();
  });

  it("保存成功返回列表，不重复触发 onSave 已负责的重载", async () => {
    const { container, saveCalls, getReloadCount, unmount } = mountPage({ config: makeConfig() });
    await openEditForm(container);

    // 修改描述使保存可用。
    const desc = container.querySelector<HTMLTextAreaElement>("#bot-config-description")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(desc, "new desc");
      desc.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "保存并同步",
    )!;
    await act(async () => {
      submit.click();
      await flush();
    });

    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0].input).toEqual({
      name: "Helper",
      description: "new desc",
      instructions: "Be helpful.",
      model: "ultimate",
      skills: [],
      memberAgentIds: [],
    });
    // 返回列表：表单卸载，出现列表标题。
    expect(container.querySelector("#bot-config-name")).toBeNull();
    expect(getReloadCount()).toBe(0);
    unmount();
  });

  it("保存失败保留输入并显示稳定错误，不离开表单", async () => {
    const { container, unmount } = mountPage({
      config: makeConfig(),
      saveResult: Promise.resolve({ code: "invalid-input", message: "bad" }),
    });
    await openEditForm(container);

    const desc = container.querySelector<HTMLTextAreaElement>("#bot-config-description")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(desc, "bad input");
      desc.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "保存并同步",
    )!;
    await act(async () => {
      submit.click();
      await flush();
    });

    // 保留输入 + 错误 + 仍在表单。
    expect(container.querySelector<HTMLTextAreaElement>("#bot-config-description")!.value).toBe(
      "bad input",
    );
    expect(container.textContent).toContain("保存失败");
    expect(container.textContent).toContain("Provider 未接受该配置");
    expect(container.querySelector("#bot-config-name")).not.toBeNull();
    unmount();
  });

  it("取消返回列表，不触发保存", async () => {
    const { container, saveCalls, unmount } = mountPage({ config: makeConfig() });
    await openEditForm(container);

    const cancel = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "取消",
    )!;
    await act(async () => {
      cancel.click();
    });

    expect(saveCalls).toHaveLength(0);
    expect(container.querySelector("#bot-config-name")).toBeNull();
    unmount();
  });

  it("hasPendingChanges 展示固定提示并允许按原配置重新同步", async () => {
    const { container, saveCalls, syncCalls, unmount } = mountPage({
      config: makeConfig({ hasPendingChanges: true }),
    });
    await openEditForm(container);

    expect(container.textContent).toContain("本地配置尚未同步到 Provider");
    expect(container.textContent).toContain("保存并同步将再次应用当前配置");
    const submit = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "保存并同步",
    )!;
    expect(submit.disabled).toBe(false);
    await act(async () => {
      submit.click();
      await flush();
    });
    expect(syncCalls).toEqual([MANAGED_BOT.ref]);
    expect(saveCalls).toHaveLength(0);
    unmount();
  });

  it("展示新配置只用于新建 Chat 的固定说明", async () => {
    const { container, unmount } = mountPage({ config: makeConfig() });
    await openEditForm(container);

    expect(container.textContent).toContain(
      "新配置用于新建 Chat，已有 Chat 继续使用创建时的配置。",
    );
    unmount();
  });

  it("已有 Bot 的 Skills 选择器可打开技能广场", async () => {
    const { container, unmount } = mountPage({ config: makeConfig() });
    await openEditForm(container);

    const skillLabel = Array.from(container.querySelectorAll("label")).find((label) =>
      label.textContent?.includes("Skills"),
    )!;
    const chooseSkills = container.querySelector<HTMLButtonElement>(
      `button[id="${skillLabel.htmlFor}"]`,
    )!;
    await act(async () => chooseSkills.click());
    const marketplaceTab = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "技能广场",
    )!;
    expect(marketplaceTab).toBeDefined();
    await act(async () => {
      marketplaceTab.click();
      await flush();
    });
    expect(document.body.textContent).toContain("深入研究");
    unmount();
  });

  it("加载失败显示稳定错误并提供返回", async () => {
    const { container, unmount } = mountPage({
      config: makeConfig(),
      configError: { code: "managed-state-missing", message: "x" },
    });
    await openEditForm(container);

    await act(async () => {
      await flush();
    });
    expect(container.textContent).toContain("无法加载配置");
    expect(container.textContent).toContain("本地 state 缺失或损坏");

    const back = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "返回",
    )!;
    await act(async () => {
      back.click();
    });
    expect(container.querySelector("#bot-config-name")).toBeNull();
    unmount();
  });
});
