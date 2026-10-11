// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "../../test-support/mount";
import { EnvironmentSetupPanel } from "./environment-setup-panel";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("EnvironmentSetupPanel", () => {
  it("存在 Agents/base 时默认选中该环境", async () => {
    const onSelect = vi.fn();
    const view = mount(
      <EnvironmentSetupPanel
        candidates={[
          { environmentId: "env-other", name: "Other" },
          { environmentId: "env-base", name: "Agents/base" },
        ]}
        onSelect={onSelect}
        pending={false}
      />,
    );
    const { container } = view;

    expect(
      container.querySelector('[role="radio"][value="env-base"]')?.getAttribute("aria-checked"),
    ).toBe("true");
    const submit = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("使用选定环境"),
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    expect(onSelect).toHaveBeenCalledWith("env-base");

    view.unmount();
  });

  it("没有 Agents/base 时不默认选择其他环境", () => {
    const view = mount(
      <EnvironmentSetupPanel
        candidates={[{ environmentId: "env-other", name: "Other" }]}
        onSelect={vi.fn()}
        pending={false}
      />,
    );
    const { container } = view;

    const submit = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("使用选定环境"),
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    view.unmount();
  });

  it("大量候选环境放在可聚焦的滚动区域，并可隐藏重复标题", () => {
    const candidates = Array.from({ length: 20 }, (_, index) => ({
      environmentId: `env-${index}`,
      name: `环境 ${index + 1}`,
    }));
    const view = mount(
      <EnvironmentSetupPanel
        candidates={candidates}
        onSelect={vi.fn()}
        pending={false}
        showHeader={false}
      />,
    );
    const { container } = view;

    const list = container.querySelector('[aria-label="可选运行环境"]');
    expect(list).not.toBeNull();
    expect(list?.getAttribute("tabindex")).toBe("0");
    expect(container.textContent).not.toContain("选择运行环境");
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(20);
    expect(container.textContent).toContain("env-0");

    view.unmount();
  });
});
