// @vitest-environment happy-dom

/**
 * Bot 创建用户行为测试。保护的风险：
 * - 空名称不触发 Host 调用；
 * - 双击/重复提交只产生一次 create；
 * - 创建成功后重读远程列表并进入新 Bot；
 * - Provider 失败时保留输入并显示稳定错误；
 * - 取消创建返回列表；
 * - 空状态提供"新建助手"主动作。
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import type { BotView, CreateBotInput, HostError } from "@shared/models";
import { mount } from "../../test-support/mount";
import { useBots } from "./use-bots";
import { BotsPage } from "./bots-page";
import type { DesktopHost } from "@shared/desktop-host-contract";

// ---------- Mock DesktopHost ----------

interface MockBotsHost {
  listCalls: string[];
  createCalls: { connectionId: string; input: CreateBotInput }[];
  createError: HostError | null;
  createDelayMs: number;
  host: DesktopHost["bots"];
}

function createMockBotsHost(): MockBotsHost {
  const listCalls: string[] = [];
  const createCalls: { connectionId: string; input: CreateBotInput }[] = [];

  const mock: MockBotsHost = {
    listCalls,
    createCalls,
    createError: null,
    createDelayMs: 0,

    host: {
      list: (connectionId: string) => {
        listCalls.push(connectionId);
        return Promise.resolve([]);
      },
      listSkills: () => Promise.resolve([]),
      listSkillCatalog: () => Promise.resolve([]),
      addSkillFromCatalog: () => Promise.reject({ code: "unavailable", message: "unused" }),
      get: () => Promise.reject({ code: "not-found", message: "not found" }),
      create: (connectionId: string, input: CreateBotInput) => {
        createCalls.push({ connectionId, input });
        if (mock.createError) return Promise.reject(mock.createError);
        const bot: BotView = {
          ref: { connectionId, agentId: `agent-${createCalls.length}` },
          name: input.name,
          description: input.description,
          management: "managed",
        };
        if (mock.createDelayMs > 0) {
          const { promise, resolve } = Promise.withResolvers<BotView>();
          setTimeout(() => resolve(bot), mock.createDelayMs);
          return promise;
        }
        return Promise.resolve(bot);
      },
      getConfiguration: () => Promise.reject({ code: "not-found", message: "not found" }),
      update: () => Promise.resolve({} as BotView),
      sync: () => Promise.resolve({} as BotView),
      archive: () => Promise.resolve(),
      setShared: () => Promise.resolve({} as BotView),
    },
  };
  return mock;
}

// ---------- useBots harness ----------

function UseBotsHarness({
  connectionId,
  onCreated,
}: {
  connectionId: string | null;
  onCreated: (bot: BotView) => void;
}) {
  const bots = useBots(connectionId);
  return (
    <div>
      <span data-testid="loading">{String(bots.loading)}</span>
      <span data-testid="count">{bots.bots.length}</span>
      <button
        data-testid="create"
        onClick={() =>
          void bots.create({ name: "TestBot" }).then(({ bot, error }) => {
            if (bot) onCreated(bot);
            if (error) console.error(error);
          })
        }
      >
        Create
      </button>
    </div>
  );
}

function mountUseBots(connectionId: string | null, onCreated: (bot: BotView) => void) {
  return mount(<UseBotsHarness connectionId={connectionId} onCreated={onCreated} />);
}

// ---------- BotsPage harness ----------

function BotsPageHarness({
  connectionId,
  onCreated,
  onOpenChats,
  createRequestKey = 0,
  provider,
}: {
  connectionId: string;
  onCreated: (bot: BotView) => void;
  onOpenChats: (bot: BotView) => void;
  createRequestKey?: number;
  provider?: string;
}) {
  const bots = useBots(connectionId);
  return (
    <BotsPage
      connectionId={connectionId}
      bots={bots.bots}
      loading={bots.loading}
      error={bots.error}
      provider={provider}
      onReload={bots.reload}
      onSave={() => Promise.resolve(null)}
      onCreate={bots.create}
      onArchive={() => Promise.resolve(null)}
      onCreated={onCreated}
      onOpenChats={onOpenChats}
      createRequestKey={createRequestKey}
    />
  );
}

function mountBotsPage(
  connectionId: string,
  onCreated: (bot: BotView) => void,
  onOpenChats: (bot: BotView) => void,
  createRequestKey = 0,
  provider?: string,
) {
  return mount(
    <BotsPageHarness
      connectionId={connectionId}
      onCreated={onCreated}
      onOpenChats={onOpenChats}
      createRequestKey={createRequestKey}
      provider={provider}
    />,
  );
}

function getEl(container: HTMLElement, testId: string): HTMLElement {
  return container.querySelector(`[data-testid="${testId}"]`)!;
}

// ---------- Tests ----------

describe("useBots create", () => {
  let mockHost: MockBotsHost;

  beforeEach(() => {
    mockHost = createMockBotsHost();
    (window as unknown as Record<string, unknown>).desktopHost = { bots: mockHost.host };
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).desktopHost;
  });

  it("双击提交只产生一次 create", async () => {
    mockHost.createDelayMs = 50;
    const { container, unmount } = mountUseBots("conn-1", () => {});

    // 等待初始加载完成
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 快速双击
    await act(async () => {
      getEl(container, "create").click();
      getEl(container, "create").click();
    });

    expect(mockHost.createCalls).toHaveLength(1);
    unmount();
  });

  it("创建成功后返回新 Bot 并触发 reload", async () => {
    const created: BotView[] = [];
    const { container, unmount } = mountUseBots("conn-1", (bot) => created.push(bot));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await act(async () => {
      getEl(container, "create").click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(created).toHaveLength(1);
    expect(created[0].name).toBe("TestBot");
    expect(created[0].management).toBe("managed");
    // list 被调用两次：初始加载 + create 后 reload
    expect(mockHost.listCalls).toHaveLength(2);
    unmount();
  });
});

describe("BotsPage creation UI", () => {
  let mockHost: MockBotsHost;

  beforeEach(() => {
    mockHost = createMockBotsHost();
    (window as unknown as Record<string, unknown>).desktopHost = { bots: mockHost.host };
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).desktopHost;
  });

  it("空状态显示创建主动作", async () => {
    const { container, unmount } = mountBotsPage(
      "conn-1",
      () => {},
      () => {},
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 空状态文案与主动作按钮
    expect(container.textContent).toContain("还没有助手");
    // 空状态的唯一创建入口必须可操作，避免页头重复主动作。
    expect(
      [...container.querySelectorAll("button")].filter(
        (button) => button.textContent === "新建助手",
      ),
    ).toHaveLength(1);

    unmount();
  });

  it("点击创建主动作进入创建表单", async () => {
    const { container, unmount } = mountBotsPage(
      "conn-1",
      () => {},
      () => {},
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 点击"新建助手"
    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "新建助手",
    )!;
    await act(async () => {
      createBtn.click();
    });

    expect(container.textContent).toContain("创建 Bot");
    expect(container.querySelector("#create-bot-name")).not.toBeNull();
    expect(container.textContent).not.toContain("更多配置");
    expect(container.querySelector("#create-bot-description")).not.toBeNull();
    // 保留经过视觉验收的扁平表单结构，避免重新叠加内层卡片和标题间距。
    const form = container.querySelector("#create-bot-title")!.closest("form")!;
    const surface = form.parentElement!;
    const header = form.children[0]!;
    const fields = form.children[1]!;
    expect(surface.className).not.toContain("border");
    expect(surface.className).not.toContain("bg-card");
    expect(surface.className).not.toContain("shadow");
    expect(form.className).toContain("gap-5");
    expect(header.contains(container.querySelector("#create-bot-title"))).toBe(true);
    expect(header.className).toContain("pb-5");
    expect(header.className).not.toContain("mb-1");
    expect(header.className).not.toContain("border-b");
    expect(fields.className).toContain("gap-5");
    expect(fields.querySelector("input")).not.toBeNull();
    expect(
      container.querySelector<HTMLTextAreaElement>("#create-bot-description")?.placeholder,
    ).toBe("例如：帮助整理会议纪要");
    expect(container.querySelector("#create-bot-instructions")).not.toBeNull();
    unmount();
  });

  it("外部新建入口直接进入创建表单", async () => {
    const { container, unmount } = mountBotsPage(
      "conn-1",
      () => {},
      () => {},
      1,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector("#create-bot-name")).not.toBeNull();
    expect(container.textContent).toContain("创建 Bot");
    unmount();
  });

  it("取消创建返回列表", async () => {
    const { container, unmount } = mountBotsPage(
      "conn-1",
      () => {},
      () => {},
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 进入创建表单
    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "新建助手",
    )!;
    await act(async () => {
      createBtn.click();
    });

    // 点击取消
    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "取消",
    )!;
    await act(async () => {
      cancelBtn.click();
    });

    expect(container.textContent).toContain("还没有助手");
    expect(container.querySelector("#create-bot-name")).toBeNull();
    unmount();
  });

  it("创建成功后进入新 Bot", async () => {
    const created: BotView[] = [];
    const opened: BotView[] = [];
    const { container, unmount } = mountBotsPage(
      "conn-1",
      (bot) => created.push(bot),
      (bot) => opened.push(bot),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 进入创建表单
    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "新建助手",
    )!;
    await act(async () => {
      createBtn.click();
    });

    // 填写名称
    const nameInput = container.querySelector<HTMLInputElement>("#create-bot-name")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(nameInput, "MyBot");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const instructionsInput = container.querySelector<HTMLTextAreaElement>(
      "#create-bot-instructions",
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(instructionsInput, "请用中文回答，并先核实事实。");
      instructionsInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // 提交
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "创建 Bot",
    )!;
    await act(async () => {
      submitBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(created).toHaveLength(1);
    expect(created[0].name).toBe("MyBot");
    expect(mockHost.createCalls[0]?.input.instructions).toBe("请用中文回答，并先核实事实。");
    // onCreated 被调用，由调用方（App）决定是否进入 Chats
    unmount();
  });

  it("百炼创建表单默认提交缺省模型 qwen3.7-max", async () => {
    const { container, unmount } = mountBotsPage(
      "conn-1",
      () => {},
      () => {},
      0,
      "bailian",
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "新建助手",
    )!;
    await act(async () => {
      createBtn.click();
    });

    // 百炼允许选择模型，默认显示缺省模型。
    const modelSelect = container.querySelector("#create-bot-model");
    expect(modelSelect).not.toBeNull();
    expect(modelSelect!.textContent).toContain("qwen3.7-max");

    const nameInput = container.querySelector<HTMLInputElement>("#create-bot-name")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(nameInput, "MyBot");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "创建 Bot",
    )!;
    await act(async () => {
      submitBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockHost.createCalls).toHaveLength(1);
    expect(mockHost.createCalls[0]!.input.model).toBe("qwen3.7-max");
    unmount();
  });

  it("Qoder 创建表单展示固定模型但不提交 model", async () => {
    const { container, unmount } = mountBotsPage(
      "conn-1",
      () => {},
      () => {},
      0,
      "qoder",
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "新建助手",
    )!;
    await act(async () => {
      createBtn.click();
    });

    const model = container.querySelector<HTMLInputElement>("#create-bot-model")!;
    expect(model.value).toBe("auto");
    expect(model.readOnly).toBe(true);
    expect(container.textContent).toContain("Qoder 创建时自动选择模型");

    const nameInput = container.querySelector<HTMLInputElement>("#create-bot-name")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(nameInput, "MyBot");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "创建 Bot",
    )!;
    await act(async () => {
      submitBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockHost.createCalls).toHaveLength(1);
    expect(mockHost.createCalls[0]!.input.model).toBeUndefined();
    unmount();
  });

  it("Qoder 创建时可选择内置工具并提交完整集合", async () => {
    const { container, unmount } = mountBotsPage(
      "conn-1",
      () => {},
      () => {},
      0,
      "qoder",
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "新建助手")!
        .click();
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="选择内置工具"]')!.click(),
    );
    const webSearch = document.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="WebSearch"]',
    )!;
    expect(webSearch.getAttribute("aria-checked")).toBe("false");
    await act(async () => webSearch.click());
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent === "确认选择（1）")!
        .click();
    });
    const name = container.querySelector<HTMLInputElement>("#create-bot-name")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(name, "Tools Bot");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "创建 Bot")!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockHost.createCalls[0]?.input.builtinTools).toEqual(["web_search"]);
    unmount();
  });

  it("百炼未显式配置时勾选网页工具并提交单项集合", async () => {
    const { container, unmount } = mountBotsPage(
      "conn-1",
      () => {},
      () => {},
      0,
      "bailian",
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "新建助手")!
        .click();
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="选择内置工具"]')!.click(),
    );
    const search = document.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="web_search"]',
    )!;
    const fetch = document.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="web_fetch"]',
    )!;
    const artifacts = document.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="mark_artifacts"]',
    )!;
    expect(search.getAttribute("aria-checked")).toBe("false");
    expect(fetch.getAttribute("aria-checked")).toBe("false");
    expect(artifacts.getAttribute("aria-checked")).toBe("false");
    expect(search.disabled).toBe(false);
    await act(async () => search.click());
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent === "确认选择（1）")!
        .click();
    });
    const name = container.querySelector<HTMLInputElement>("#create-bot-name")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(name, "Web Bot");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "创建 Bot")!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockHost.createCalls[0]?.input.builtinTools).toContain("web_search");
    expect(mockHost.createCalls[0]?.input.builtinTools).not.toContain("web_fetch");
    unmount();
  });

  it("Provider 失败时保留输入并显示错误", async () => {
    mockHost.createError = { code: "unavailable", message: "provider down" };
    const { container, unmount } = mountBotsPage(
      "conn-1",
      () => {},
      () => {},
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 进入创建表单
    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "新建助手",
    )!;
    await act(async () => {
      createBtn.click();
    });

    // 填写名称和描述
    const nameInput = container.querySelector<HTMLInputElement>("#create-bot-name")!;
    const descInput = container.querySelector<HTMLTextAreaElement>("#create-bot-description")!;
    await act(async () => {
      const nameSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      nameSetter.call(nameInput, "MyBot");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));

      const descSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      descSetter.call(descInput, "My description");
      descInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // 提交
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "创建 Bot",
    )!;
    await act(async () => {
      submitBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    // 错误显示
    expect(container.textContent).toContain("创建失败");
    expect(container.textContent).toContain("服务暂时不可用");
    // 输入保留
    expect(nameInput.value).toBe("MyBot");
    expect(descInput.value).toBe("My description");
    // 仍在创建表单
    expect(container.querySelector("#create-bot-name")).not.toBeNull();
    unmount();
  });

  it("空名称禁用提交且不调用 Host", async () => {
    const { container, unmount } = mountBotsPage(
      "conn-1",
      () => {},
      () => {},
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 进入创建表单，名称保持为空
    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "新建助手",
    )!;
    await act(async () => {
      createBtn.click();
    });

    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "创建 Bot",
    )!;
    expect(submitBtn.disabled).toBe(true);
    await act(async () => {
      submitBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mockHost.createCalls).toHaveLength(0);
    unmount();
  });

  it("创建中禁用提交按钮", async () => {
    mockHost.createDelayMs = 100;
    const { container, unmount } = mountBotsPage(
      "conn-1",
      () => {},
      () => {},
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 进入创建表单
    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "新建助手",
    )!;
    await act(async () => {
      createBtn.click();
    });

    // 填写名称
    const nameInput = container.querySelector<HTMLInputElement>("#create-bot-name")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(nameInput, "MyBot");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // 提交后立即检查按钮状态
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "创建 Bot",
    )!;
    await act(async () => {
      submitBtn.click();
    });

    // 创建中按钮应为禁用状态
    const creatingBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "创建中…",
    );
    expect(creatingBtn).toBeDefined();
    expect(creatingBtn!.disabled).toBe(true);

    // 等待完成
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    unmount();
  });
});

describe("BotsPage menu actions", () => {
  it("重新同步期间在菜单关闭后仍通过触发器反馈 pending", async () => {
    const pending = Promise.withResolvers<HostError | null>();
    const bot: BotView = {
      ref: { connectionId: "conn-1", agentId: "agent-1" },
      name: "Helper",
      management: "managed",
    };
    const view = mount(
      <BotsPage
        connectionId="conn-1"
        bots={[bot]}
        loading={false}
        error={null}
        onReload={() => {}}
        onSave={() => pending.promise}
        onCreate={() => Promise.resolve({ bot: null, error: null })}
        onArchive={() => Promise.resolve(null)}
        onCreated={() => {}}
        onOpenChats={() => {}}
      />,
    );

    const trigger = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="管理 Helper"]',
    )!;
    act(() =>
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
      ),
    );
    const syncItem = Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem]")).find(
      (item) => item.textContent?.includes("重新同步"),
    )!;

    await act(async () => {
      syncItem.click();
      await Promise.resolve();
    });

    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute("aria-busy")).toBe("true");
    expect(trigger.getAttribute("aria-label")).toBe("正在重新同步 Helper");
    expect(document.querySelector("[role=menu]")).toBeNull();

    await act(async () => {
      pending.resolve(null);
      await pending.promise;
    });
    expect(trigger.disabled).toBe(false);

    view.unmount();
  });

  it("列表刷新期间更多操作触发器提供持续反馈", () => {
    const bot: BotView = {
      ref: { connectionId: "conn-1", agentId: "agent-1" },
      name: "Helper",
      management: "remote-only",
    };
    const onReload = vi.fn();
    const view = mount(
      <BotsPage
        connectionId="conn-1"
        bots={[bot]}
        loading
        error={null}
        onReload={onReload}
        onSave={() => Promise.resolve(null)}
        onCreate={() => Promise.resolve({ bot: null, error: null })}
        onArchive={() => Promise.resolve(null)}
        onCreated={() => {}}
        onOpenChats={() => {}}
      />,
    );

    const trigger = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="正在刷新 Bot 列表"]',
    )!;
    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute("aria-busy")).toBe("true");

    view.unmount();
  });
});
