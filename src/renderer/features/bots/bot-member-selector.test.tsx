// @vitest-environment happy-dom

/**
 * 协作成员选择器用户行为测试。保护的风险：
 * - 弹窗内暂存选择，取消不修改表单，确认后才提交；
 * - 按名称或 Agent ID 搜索，显式选择/取消并保持选择顺序；
 * - 达到 20 项上限后禁用未选项并给出说明；
 * - 编辑时排除当前 Bot 自身；
 * - 已配置但当前列表不可见的成员显示“当前列表不可见”并默认保留，只有显式移除才删除；
 * - 候选列表加载失败就地报错与重试，已选 ID 不被静默删除；
 * - 创建与编辑表单完整提交 memberAgentIds；保存失败保留 roster 输入。
 */

import { useState } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BotConfigurationView,
  BotRef,
  BotView,
  CreateBotInput,
  HostError,
  UpdateBotInput,
} from "@shared/models";
import type { DesktopHost } from "@shared/desktop-host-contract";
import { mount } from "../../test-support/mount";
import { BotMemberSelector } from "./bot-member-selector";
import { BotsPage } from "./bots-page";

const SELF: BotView = {
  ref: { connectionId: "conn-1", agentId: "agent-1" },
  name: "Helper",
  description: "主 Bot",
  management: "managed",
};

const FRONTEND: BotView = {
  ref: { connectionId: "conn-1", agentId: "agent_frontend_7f2" },
  name: "前端工程师",
  description: "实现界面与交互",
  management: "managed",
};

const TESTER: BotView = {
  ref: { connectionId: "conn-1", agentId: "agent_test_91a" },
  name: "测试工程师",
  description: "设计测试并验证结果",
  management: "managed",
};

const RESEARCHER: BotView = {
  ref: { connectionId: "conn-1", agentId: "agent_research_b31" },
  name: "研究员",
  management: "remote-only",
};

const CANDIDATES: BotView[] = [SELF, FRONTEND, TESTER, RESEARCHER];

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as unknown as Record<string, unknown>).desktopHost;
});

// ---------- 选择器单元测试 ----------

function mountSelector(options: {
  value: string[];
  candidates?: BotView[];
  currentAgentId?: string;
  candidatesLoading?: boolean;
  candidatesError?: HostError | null;
  disabled?: boolean;
  onRetry?: () => void;
}) {
  const changes: string[][] = [];

  function Harness() {
    const [value, setValue] = useState<string[]>(options.value);
    return (
      <BotMemberSelector
        value={value}
        candidates={options.candidates ?? CANDIDATES}
        currentAgentId={options.currentAgentId}
        candidatesLoading={options.candidatesLoading ?? false}
        candidatesError={options.candidatesError ?? null}
        disabled={options.disabled ?? false}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
        onRetry={options.onRetry ?? (() => {})}
      />
    );
  }

  const view = mount(<Harness />);
  return {
    container: view.container,
    changes,
    unmount: view.unmount,
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent?.includes(text) === true || item.getAttribute("aria-label") === text,
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

function checkboxByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const box = document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  if (!box) throw new Error(`checkbox not found: ${label}`);
  return box;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("BotMemberSelector", () => {
  it("点击添加协作成员后在弹窗中选择候选", () => {
    const { container, unmount } = mountSelector({ value: [] });

    expect(container.textContent).toContain("协作成员");
    expect(container.textContent).toContain("添加协作成员");
    expect(container.textContent).toContain("添加成员后，当前 Bot 将作为协调者工作");
    expect(container.textContent).toContain("成员不会被复制或归当前 Bot 管理。");
    expect(container.textContent).toContain(
      "在消息中点名成员会影响协调者的选择，但不保证精确路由。",
    );
    expect(document.querySelector('[data-layout="member-candidates"]')).toBeNull();

    const toggle = buttonByText(container, "添加协作成员");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle.click());

    const panel = document.querySelector('[data-layout="member-candidates"]');
    expect(panel).not.toBeNull();
    expect(document.body.textContent).toContain("来自当前 Connection");
    expect(checkboxByLabel(container, "选择成员 前端工程师")).toBeDefined();
    // 候选列表在弹窗中展示。
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
    expect(document.querySelector('[data-layout="member-candidates"]')).not.toBeNull();

    act(() => buttonByText(container, "取消").click());
    expect(document.querySelector('[data-layout="member-candidates"]')).toBeNull();
    unmount();
  });

  it("按名称或 Agent ID 搜索候选", () => {
    const { container, unmount } = mountSelector({ value: [] });
    act(() => buttonByText(container, "添加协作成员").click());

    const search = document.querySelector<HTMLInputElement>('[aria-label="搜索 Bot"]')!;
    act(() => setInputValue(search, "测试"));

    expect(checkboxByLabel(container, "选择成员 测试工程师")).toBeDefined();
    expect(document.querySelector('[aria-label="选择成员 前端工程师"]')).toBeNull();
    expect(document.querySelector('[aria-label="选择成员 研究员"]')).toBeNull();

    act(() => setInputValue(search, "research"));
    expect(checkboxByLabel(container, "选择成员 研究员")).toBeDefined();
    expect(document.querySelector('[aria-label="选择成员 测试工程师"]')).toBeNull();

    act(() => setInputValue(search, "不存在"));
    expect(document.body.textContent).toContain("没有匹配“不存在”的成员。");
    unmount();
  });

  it("显式选择与取消保持选择顺序", () => {
    const { container, changes, unmount } = mountSelector({ value: [] });
    act(() => buttonByText(container, "添加协作成员").click());

    act(() => checkboxByLabel(container, "选择成员 前端工程师").click());
    act(() => checkboxByLabel(container, "选择成员 研究员").click());
    expect(changes).toHaveLength(0);

    act(() => checkboxByLabel(container, "选择成员 前端工程师").click());
    act(() => buttonByText(container, "确认选择").click());
    expect(changes[0]).toEqual(["agent_research_b31"]);
    expect(container.textContent).toContain("研究员");
    expect(container.textContent).toContain("已选择 1/20");
    unmount();
  });

  it("取消弹窗丢弃本次选择", () => {
    const { container, changes, unmount } = mountSelector({ value: [] });
    act(() => buttonByText(container, "添加协作成员").click());
    act(() => checkboxByLabel(container, "选择成员 前端工程师").click());
    act(() => buttonByText(container, "取消").click());

    expect(changes).toHaveLength(0);
    expect(container.textContent).toContain("添加协作成员");
    unmount();
  });

  it("编辑时排除当前 Bot 自身", () => {
    const { container, unmount } = mountSelector({ value: [], currentAgentId: "agent-1" });
    act(() => buttonByText(container, "添加协作成员").click());

    expect(document.querySelector('[aria-label="选择成员 Helper"]')).toBeNull();
    expect(checkboxByLabel(container, "选择成员 前端工程师")).toBeDefined();
    unmount();
  });

  it("达到 20 项上限后禁用未选项并给出说明", () => {
    const many: BotView[] = Array.from({ length: 21 }, (_, index) => ({
      ref: { connectionId: "conn-1", agentId: `agent_member_${index}` },
      name: `成员 ${index}`,
      management: "managed",
    }));
    const { container, unmount } = mountSelector({
      value: many.slice(0, 20).map((bot) => bot.ref.agentId),
      candidates: many,
    });
    act(() => buttonByText(container, "添加协作成员").click());

    expect(container.textContent).toContain("已选择 20/20");
    const overLimit = checkboxByLabel(container, "选择成员 成员 20");
    expect(overLimit.disabled).toBe(true);
    expect(document.body.textContent).toContain("最多选择 20 个成员");
    expect(checkboxByLabel(container, "选择成员 成员 0").disabled).toBe(false);
    unmount();
  });

  it("当前列表不可见的成员默认保留，只有显式移除才删除", () => {
    const { container, changes, unmount } = mountSelector({ value: ["agent_ghost"] });

    expect(container.textContent).toContain("agent_ghost");
    expect(container.textContent).toContain("当前列表不可见");
    act(() => buttonByText(container, "添加协作成员").click());
    expect(document.querySelector('[aria-label="选择成员 agent_ghost"]')).toBeNull();

    act(() => checkboxByLabel(container, "选择成员 前端工程师").click());
    act(() => buttonByText(container, "确认选择").click());
    expect(changes[0]).toEqual(["agent_ghost", "agent_frontend_7f2"]);

    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="移除成员 agent_ghost"]')!.click(),
    );
    expect(changes[1]).toEqual(["agent_frontend_7f2"]);
    unmount();
  });

  it("候选列表加载失败就地报错并保留已选 ID，重试可用", () => {
    const onRetry = vi.fn();
    const { container, unmount } = mountSelector({
      value: ["agent_frontend_7f2"],
      candidatesError: { code: "unavailable", message: "down" },
      onRetry,
    });
    act(() => buttonByText(container, "添加协作成员").click());

    expect(document.body.textContent).toContain("无法加载 Bot 列表");
    expect(container.textContent).toContain("前端工程师");
    expect(container.textContent).toContain("当前列表不可见");
    act(() => buttonByText(container, "重试").click());
    expect(onRetry).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("候选列表加载中给出状态且不推断单个成员状态", () => {
    const { container, unmount } = mountSelector({
      value: ["agent_frontend_7f2"],
      candidatesLoading: true,
      candidates: [],
    });
    act(() => buttonByText(container, "添加协作成员").click());

    expect(document.body.textContent).toContain("正在加载 Bot 列表…");
    expect(container.textContent).toContain("当前列表不可见");
    unmount();
  });

  it("显式清空全部成员后回到空状态", () => {
    const { container, changes, unmount } = mountSelector({
      value: ["agent_frontend_7f2", "agent_test_91a"],
    });

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="移除成员 agent_frontend_7f2"]')!
        .click(),
    );
    expect(changes[0]).toEqual(["agent_test_91a"]);
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="移除成员 agent_test_91a"]')!.click(),
    );

    expect(changes[1]).toEqual([]);
    expect(container.textContent).toContain("添加协作成员");
    expect(container.textContent).toContain("从当前 Connection 的 Bot 中选择");
    unmount();
  });
});

// ---------- 创建/编辑表单集成 ----------

function makeConfig(overrides: Partial<BotConfigurationView> = {}): BotConfigurationView {
  return {
    ref: SELF.ref,
    provider: "qoder",
    name: "Helper",
    description: "主 Bot",
    instructions: "Be helpful.",
    model: "ultimate",
    skills: [],
    memberAgentIds: [],
    models: [{ value: "ultimate", label: "ultimate" }],
    hasPendingChanges: false,
    ...overrides,
  };
}

function mountHost(options: {
  config: BotConfigurationView;
  bots: BotView[];
  loading?: boolean;
  error?: HostError | null;
  saveResult?: HostError | null;
  createRequestKey?: number;
}) {
  const createCalls: CreateBotInput[] = [];
  const updateCalls: { ref: BotRef; input: UpdateBotInput }[] = [];
  const syncCalls: BotRef[] = [];
  let reloadCount = 0;
  const host: DesktopHost["bots"] = {
    list: () => Promise.resolve(options.bots),
    listSkills: () => Promise.resolve([]),
    listSkillCatalog: () => Promise.resolve([]),
    addSkillFromCatalog: () => Promise.reject({ code: "unavailable", message: "unused" }),
    get: () => Promise.resolve(SELF),
    getConfiguration: (ref: BotRef) => Promise.resolve({ ...options.config, ref }),
    create: (connectionId: string, input: CreateBotInput) => {
      createCalls.push(input);
      return Promise.resolve({
        ref: { connectionId, agentId: "agent-created" },
        name: input.name,
        management: "managed" as const,
      });
    },
    update: (ref, input) => {
      updateCalls.push({ ref, input });
      return options.saveResult
        ? Promise.reject(options.saveResult)
        : Promise.resolve({ ...SELF, ref });
    },
    sync: (ref) => {
      syncCalls.push(ref);
      return Promise.resolve(SELF);
    },
    archive: () => Promise.resolve(),
    setShared: () => Promise.resolve({} as BotView),
  };
  (window as unknown as Record<string, unknown>).desktopHost = { bots: host };

  const view = mount(
    <BotsPage
      connectionId="conn-1"
      bots={options.bots}
      loading={options.loading ?? false}
      error={options.error ?? null}
      provider="qoder"
      onReload={() => {
        reloadCount += 1;
      }}
      onSave={(ref, input) =>
        typeof input === "string"
          ? host.sync(ref).then(() => null)
          : host
              .update(ref, input)
              .then(() => null)
              .catch((error: HostError) => error)
      }
      onCreate={(input) => {
        void host.create("conn-1", input);
        return Promise.resolve({ bot: null, error: null });
      }}
      onArchive={() => Promise.resolve(null)}
      onCreated={() => {}}
      onOpenChats={() => {}}
      createRequestKey={options.createRequestKey ?? 0}
    />,
  );
  return {
    container: view.container,
    createCalls,
    updateCalls,
    syncCalls,
    getReloadCount: () => reloadCount,
    unmount: view.unmount,
  };
}

function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function openEditForm(container: HTMLElement) {
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

function submitButton(container: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === label,
  )!;
}

describe("协作成员表单集成", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("创建表单提交所选成员 roster", async () => {
    const { container, createCalls, unmount } = mountHost({
      config: makeConfig(),
      bots: CANDIDATES,
      createRequestKey: 1,
    });

    const nameInput = container.querySelector<HTMLInputElement>("#create-bot-name")!;
    await act(async () => setInputValue(nameInput, "Lead"));

    await act(async () => buttonByText(container, "添加协作成员").click());
    await act(async () => checkboxByLabel(container, "选择成员 测试工程师").click());
    await act(async () => checkboxByLabel(container, "选择成员 研究员").click());
    await act(async () => buttonByText(container, "确认选择").click());

    await act(async () => submitButton(container, "创建 Bot").click());
    await act(async () => {
      await flush();
    });

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].memberAgentIds).toEqual(["agent_test_91a", "agent_research_b31"]);
    unmount();
  });

  it("编辑表单以 config.memberAgentIds 初始化，不可见成员默认保留且可显式移除", async () => {
    const { container, updateCalls, unmount } = mountHost({
      config: makeConfig({ memberAgentIds: ["agent_test_91a", "agent_ghost"] }),
      bots: CANDIDATES,
    });
    await openEditForm(container);

    expect(container.textContent).toContain("测试工程师");
    expect(container.textContent).toContain("agent_ghost");
    expect(container.textContent).toContain("当前列表不可见");
    // 未变更（含 roster）时仍可同步；不可见成员没有被自动删除。
    expect(submitButton(container, "保存并同步").disabled).toBe(false);

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="移除成员 agent_ghost"]')!.click(),
    );
    const submit = submitButton(container, "保存并同步");
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    await act(async () => {
      await flush();
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].input.memberAgentIds).toEqual(["agent_test_91a"]);
    unmount();
  });

  it("编辑表单候选加载失败不静默删除 roster，pending 下按原值重试可提交", async () => {
    const { container, updateCalls, syncCalls, getReloadCount, unmount } = mountHost({
      config: makeConfig({ memberAgentIds: ["agent_test_91a"], hasPendingChanges: true }),
      bots: [SELF],
      error: { code: "unavailable", message: "down" },
    });
    await openEditForm(container);

    // 候选列表只含当前 Bot 自身，roster 中的外部成员无法解析名称，只能以 agent ID 呈现。
    expect(container.textContent).toContain("agent_test_91a");
    expect(container.textContent).toContain("当前列表不可见");
    await act(async () => buttonByText(container, "添加协作成员").click());
    expect(document.body.textContent).toContain("无法加载 Bot 列表");
    await act(async () => buttonByText(container, "重试").click());
    expect(getReloadCount()).toBe(1);
    await act(async () => {
      const dialog = document
        .querySelector<HTMLElement>('[data-layout="member-candidates"]')!
        .closest('[role="dialog"]')!;
      Array.from(dialog.querySelectorAll("button"))
        .find((button) => button.textContent === "取消")!
        .click();
    });

    const submit = submitButton(container, "保存并同步");
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    await act(async () => {
      await flush();
    });

    expect(syncCalls).toEqual([SELF.ref]);
    expect(updateCalls).toHaveLength(0);
    unmount();
  });

  it("编辑表单保存失败保留 roster 输入", async () => {
    const { container, unmount } = mountHost({
      config: makeConfig(),
      bots: CANDIDATES,
      saveResult: { code: "invalid-input", message: "roster rejected" },
    });
    await openEditForm(container);

    await act(async () => buttonByText(container, "添加协作成员").click());
    await act(async () => checkboxByLabel(container, "选择成员 前端工程师").click());
    await act(async () => buttonByText(container, "确认选择").click());
    await act(async () => submitButton(container, "保存并同步").click());
    await act(async () => {
      await flush();
    });

    expect(container.textContent).toContain("保存失败");
    expect(container.textContent).toContain("Provider 未接受该配置");
    expect(container.textContent).toContain("前端工程师");
    expect(container.textContent).toContain("已选择 1/20");
    expect(submitButton(container, "保存并同步").disabled).toBe(false);
    unmount();
  });

  it("编辑表单显式清空成员后完整提交空数组", async () => {
    const { container, updateCalls, unmount } = mountHost({
      config: makeConfig({ memberAgentIds: ["agent_test_91a"] }),
      bots: CANDIDATES,
    });
    await openEditForm(container);

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="移除成员 agent_test_91a"]')!.click(),
    );
    expect(container.textContent).toContain("添加协作成员");

    const submit = submitButton(container, "保存并同步");
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    await act(async () => {
      await flush();
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].input.memberAgentIds).toEqual([]);
    unmount();
  });

  it("编辑表单不会把当前 Bot 自身列为候选", async () => {
    const { container, unmount } = mountHost({ config: makeConfig(), bots: CANDIDATES });
    await openEditForm(container);

    await act(async () => buttonByText(container, "添加协作成员").click());
    expect(document.querySelector('[aria-label="选择成员 Helper"]')).toBeNull();
    expect(checkboxByLabel(container, "选择成员 前端工程师")).toBeDefined();
    unmount();
  });
});
