// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { mount } from "../../test-support/mount";
import { BotBuiltinTools } from "./bot-builtin-tools";

afterEach(() => {
  document.body.innerHTML = "";
});

it("取消工具选择不改动表单，确认后才写回", async () => {
  const onChange = vi.fn();
  const view = mount(
    <BotBuiltinTools provider="bailian" value={undefined} disabled={false} onChange={onChange} />,
  );

  const open = async () =>
    act(async () => {
      view.container.querySelector<HTMLButtonElement>('[aria-label="选择内置工具"]')!.click();
    });
  await open();
  const search = () =>
    document.querySelector<HTMLButtonElement>('[role="checkbox"][aria-label="web_search"]')!;
  expect(document.querySelectorAll('[role="checkbox"][aria-checked="true"]')).toHaveLength(0);
  expect(search().getAttribute("aria-checked")).toBe("false");
  await act(async () => search().click());
  await act(async () => {
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "取消")!
      .click();
  });
  expect(onChange).not.toHaveBeenCalled();

  await open();
  expect(search().getAttribute("aria-checked")).toBe("false");
  await act(async () => {
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "确认选择（0）")!
      .click();
  });
  expect(onChange).toHaveBeenCalledWith([]);

  await open();
  await act(async () => search().click());
  await act(async () => {
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "确认选择（1）")!
      .click();
  });
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(onChange.mock.calls[1]?.[0]).toEqual(["web_search"]);
  await act(async () => {
    view.root.render(
      <BotBuiltinTools
        provider="bailian"
        value={onChange.mock.calls[1]![0] as string[]}
        disabled={false}
        onChange={onChange}
      />,
    );
  });
  await open();
  expect(document.querySelectorAll('[role="checkbox"][aria-checked="true"]')).toHaveLength(1);
  expect(search().getAttribute("aria-checked")).toBe("true");
  await act(async () => view.root.unmount());
  view.container.remove();
});
