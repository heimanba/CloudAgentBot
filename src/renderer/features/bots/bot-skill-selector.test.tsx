// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotSkillOption } from "@shared/models";
import { mount } from "../../test-support/mount";
import { BotSkillSelector } from "./bot-skill-selector";

afterEach(() => {
  document.body.innerHTML = "";
});

const OPTIONS: BotSkillOption[] = [
  {
    type: "custom" as const,
    skillId: "skill_pdf",
    version: "1.2",
    latestVersion: "1.2",
    name: "PDF Reader",
    description: "读取和分析 PDF 文件",
    updatedAt: "2026-09-18T00:00:00Z",
  },
  {
    type: "official" as const,
    skillId: "skill_web",
    latestVersion: "2.0",
    name: "Web Research",
    description: "搜索互联网资料",
    updatedAt: "2026-09-16T00:00:00Z",
  },
];

const EMPTY_CATALOG: React.ComponentProps<typeof BotSkillSelector>["marketplace"] = {
  loaded: true,
  loading: false,
  options: [],
  error: null,
  installingId: null,
  search: () => Promise.resolve(),
  install: () => Promise.resolve(null),
};

function renderSelector(
  onChange = vi.fn(),
  marketplace: React.ComponentProps<typeof BotSkillSelector>["marketplace"] = EMPTY_CATALOG,
  options: BotSkillOption[] = OPTIONS,
  value: React.ComponentProps<typeof BotSkillSelector>["value"] = [],
) {
  return {
    ...mount(
      <BotSkillSelector
        value={value}
        options={options}
        loading={false}
        error={null}
        disabled={false}
        onChange={onChange}
        onRetry={() => undefined}
        marketplace={marketplace}
      />,
    ),
    onChange,
  };
}

describe("BotSkillSelector", () => {
  it("使用整行选择控件展示空状态和已选摘要", () => {
    const empty = renderSelector();
    const emptyTrigger = document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
    expect(emptyTrigger.textContent).toContain("添加 Skills");
    expect(emptyTrigger.textContent).toContain("从我的 Skills 或技能广场添加");
    empty.unmount();

    const selected = renderSelector(vi.fn(), undefined, OPTIONS, [OPTIONS[0], OPTIONS[1]]);
    const selectedTrigger = document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
    expect(selectedTrigger.textContent).toContain("PDF Reader、Web Research");
    expect(selectedTrigger.textContent).toContain("已选择 2/20");
    selected.unmount();
  });

  it("两个 Provider 共用我的 Skills 与技能广场选择结构", async () => {
    const view = renderSelector(vi.fn(), {
      loaded: true,
      loading: false,
      options: [],
      error: null,
      installingId: null,
      search: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(null),
    });
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());

    expect(document.body.textContent).toContain("从我的 Skills 选择，或从技能广场添加。");
    // 三段沿用统一 gutter，避免仅一段引入额外横向 padding。
    const dialog = document.querySelector('[role="dialog"]')!;
    const header = dialog.querySelector('[role="tablist"]')!.parentElement!;
    const body = header.nextElementSibling!;
    const confirm = [...dialog.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("确认选择"),
    )!;
    const footer = confirm.parentElement!;
    expect(body.nextElementSibling).toBe(footer);
    for (const region of [header, body, footer]) {
      expect(region.parentElement).toBe(dialog);
      expect(region.className).toContain("px-6");
    }
    expect(document.body.textContent).toContain("我的 Skills");
    expect(document.body.textContent).toContain("技能广场");
    view.unmount();
  });

  it("在 Dialog 中搜索并显示版本和更新时间", async () => {
    const view = renderSelector();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(document.body.textContent).toContain("最新 2.0");
    expect(document.body.textContent).toContain("2026/09/16 更新");

    const search = document.querySelector<HTMLInputElement>('[aria-label="搜索 Skills"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "pdf");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("PDF Reader");
    expect(document.body.textContent).not.toContain("Web Research");
    view.unmount();
  });

  it("取消丢弃草稿，确认才写回表单", async () => {
    const view = renderSelector();
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="PDF Reader"]')!.click(),
    );
    const cancel = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "取消",
    )!;
    await act(async () => cancel.click());
    expect(view.onChange).not.toHaveBeenCalled();

    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="PDF Reader"]')!.click(),
    );
    const confirm = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "确认选择（1）",
    )!;
    await act(async () => confirm.click());
    expect(view.onChange).toHaveBeenCalledWith([
      expect.objectContaining({ type: "custom", skillId: "skill_pdf", version: "1.2" }),
    ]);
    view.unmount();
  });

  it("从技能广场添加后自动加入选择草稿", async () => {
    const install = vi.fn().mockResolvedValue({
      type: "custom",
      skillId: "skill_new",
      name: "数据分析",
    });
    const search = vi.fn().mockResolvedValue(undefined);
    const view = renderSelector(vi.fn(), {
      loaded: true,
      loading: false,
      options: [{ catalogId: "official_new", name: "数据分析", installCount: 10 }],
      error: null,
      installingId: null,
      search,
      install,
    });
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    const marketplaceTab = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "技能广场",
    )!;
    await act(async () => marketplaceTab.click());
    const installButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "安装并选择",
    )!;
    expect(document.body.textContent).toContain("取消本次选择不会卸载");
    await act(async () => installButton.click());
    expect(install).toHaveBeenCalledWith("official_new");
    expect(document.body.textContent).toContain("数据分析");
    expect(document.body.textContent).not.toContain("skill_new");
    const confirm = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "确认选择（1）",
    )!;
    await act(async () => confirm.click());
    expect(view.onChange).toHaveBeenCalledWith([
      expect.objectContaining({ type: "custom", skillId: "skill_new" }),
    ]);
    view.unmount();
  });

  it("技能广场识别已添加项并直接选择，不重复添加", async () => {
    const install = vi.fn();
    const onChange = vi.fn();
    const installed = {
      type: "custom" as const,
      skillId: "skill_existing",
      name: "deep-research",
      marketplaceSkillId: "official_existing",
    };
    const view = renderSelector(
      onChange,
      {
        loaded: true,
        loading: false,
        options: [
          {
            catalogId: "official_existing",
            name: "深入研究",
            sourceName: "deep-research",
            installCount: 100,
          },
        ],
        error: null,
        installingId: null,
        search: vi.fn().mockResolvedValue(undefined),
        install,
      },
      [installed],
    );
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "技能广场")!
        .click(),
    );
    expect(document.body.textContent).toContain("已添加");
    const selectExisting = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "选择已有",
    )!;
    await act(async () => selectExisting.click());
    expect(install).not.toHaveBeenCalled();
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "确认选择（1）")!
        .click(),
    );
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ skillId: "skill_existing" })]);
    view.unmount();
  });

  it("已绑定的 Bailian official Skill 从技能广场恢复名称与版本且保持可用", async () => {
    const selected = { type: "official" as const, skillId: "skill_official", version: "2.0" };
    const view = renderSelector(
      vi.fn(),
      {
        loaded: true,
        loading: false,
        options: [
          {
            catalogId: "skill_official",
            name: "文档解析",
            description: "解析办公文档",
            version: "2.1",
            addedRef: { type: "official", skillId: "skill_official", version: "2.1" },
          },
        ],
        error: null,
        installingId: null,
        search: vi.fn().mockResolvedValue(undefined),
        install: vi.fn().mockResolvedValue(null),
      },
      [],
      [selected],
    );

    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    expect(document.body.textContent).toContain("文档解析");
    expect(document.body.textContent).toContain("已绑定 2.0 · 最新 2.1");
    expect(document.body.textContent).not.toContain("当前不可用");
    view.unmount();
  });

  it("配置页挂载时主动加载技能广场以恢复已有引用名称", async () => {
    const search = vi.fn().mockResolvedValue(undefined);
    const view = renderSelector(
      vi.fn(),
      {
        loaded: false,
        loading: false,
        options: [],
        error: null,
        installingId: null,
        search,
        install: vi.fn().mockResolvedValue(null),
      },
      [],
      [{ type: "official", skillId: "skill_official", version: "2.0" }],
    );

    expect(search).toHaveBeenCalledWith();
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    expect(document.body.textContent).toContain("正在验证可用性");
    expect(document.body.textContent).not.toContain("当前不可用");
    view.unmount();
  });

  it("目录读取失败时不把已有引用误报为当前不可用", async () => {
    const view = renderSelector(
      vi.fn(),
      {
        loaded: true,
        loading: false,
        options: [],
        error: { code: "unavailable", message: "catalog failed" },
        installingId: null,
        search: vi.fn().mockResolvedValue(undefined),
        install: vi.fn().mockResolvedValue(null),
      },
      [],
      [{ type: "official", skillId: "skill_official", version: "2.0" }],
    );

    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    expect(document.body.textContent).toContain("暂时无法验证");
    expect(document.body.textContent).not.toContain("当前不可用");
    view.unmount();
  });

  it("两个目录均成功且引用不存在时才标记当前不可用", async () => {
    const view = renderSelector(
      vi.fn(),
      EMPTY_CATALOG,
      [],
      [{ type: "official", skillId: "skill_removed", version: "1.0" }],
    );

    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    expect(document.body.textContent).toContain("当前不可用");
    view.unmount();
  });

  it("技能广场搜索后重新打开会恢复完整目录再判断可用性", async () => {
    const search = vi.fn().mockResolvedValue(undefined);
    const view = renderSelector(vi.fn(), {
      ...EMPTY_CATALOG,
      search,
    });
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "技能广场")!
        .click(),
    );
    const input = document.querySelector<HTMLInputElement>('[aria-label="搜索 Skills"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "pdf");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "搜索市场")!
        .click(),
    );
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "取消")!
        .click(),
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click(),
    );

    expect(search).toHaveBeenNthCalledWith(1, "pdf");
    expect(search).toHaveBeenNthCalledWith(2);
    view.unmount();
  });
});
