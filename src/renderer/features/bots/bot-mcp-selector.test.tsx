// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "../../test-support/mount";
import { BotMcpSelector } from "./bot-mcp-selector";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("BotMcpSelector", () => {
  it("逐个添加工具并在取消时不写回暂存选择", async () => {
    const onChange = vi.fn();
    window.desktopHost = {
      bots: {
        listMcpCatalog: vi.fn().mockResolvedValue([
          {
            serverCode: "paid-service",
            serverName: "付费服务",
            description: "用于检索业务资料",
            hasFee: true,
            hasFreePlan: true,
          },
        ]),
        listMcpTools: vi.fn().mockResolvedValue([
          { name: "search", description: "检索指定关键词" },
          { name: "read", description: "读取资料" },
        ]),
      },
    } as unknown as typeof window.desktopHost;
    const view = mount(<BotMcpSelector value={[]} disabled={false} onChange={onChange} />);
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click();
    });
    await vi.waitFor(async () => {
      await act(async () => Promise.resolve());
      expect(document.body.textContent).toContain("含免费额度 · 超出后可能收费");
    });
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("付费服务"))!
        .click();
    });
    expect(document.body.textContent).toContain("检索指定关键词");
    expect(document.body.textContent).toContain("已选择 0/20 个服务 · 0 个工具");
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "添加")!
        .click();
    });
    expect(document.body.textContent).toContain("已选择 1/20 个服务 · 1 个工具");
    expect(document.body.textContent).toContain("确认选择（1 个服务 · 1 个工具）");
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "取消")!
        .click();
    });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => view.root.unmount());
    view.container.remove();
  });

  it("添加全部、移除工具并确认回填，重新打开时保留选择", async () => {
    let value: Parameters<typeof BotMcpSelector>[0]["value"] = [];
    const onChange = vi.fn((next: typeof value) => {
      value = next;
    });
    window.desktopHost = {
      bots: {
        listMcpCatalog: vi
          .fn()
          .mockResolvedValue([
            { serverCode: "service", serverName: "测试服务", hasFee: false, hasFreePlan: false },
          ]),
        listMcpTools: vi.fn().mockResolvedValue([{ name: "first" }, { name: "second" }]),
      },
    } as unknown as typeof window.desktopHost;
    const view = mount(<BotMcpSelector value={value} disabled={false} onChange={onChange} />);
    const rerender = async () =>
      act(async () => {
        view.root.render(<BotMcpSelector value={value} disabled={false} onChange={onChange} />);
      });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click();
    });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")]
        .find(
          (button) =>
            button.textContent?.includes("测试服务") && !button.hasAttribute("aria-haspopup"),
        )!
        .click();
    });
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "添加全部")!
        .click();
    });
    expect(document.body.textContent).toContain("已选择 1/20 个服务 · 2 个工具");
    expect(document.body.textContent).toContain("已选择 2 个工具：first、second");
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "移除")!
        .click();
    });
    expect(document.body.textContent).toContain("已选择 1/20 个服务 · 1 个工具");
    expect(document.body.textContent).toContain("已选择 1 个工具：second");
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "确认选择（1 个服务 · 1 个工具）")!
        .click();
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(value[0].tools.filter((tool) => tool.enabled).map((tool) => tool.name)).toEqual([
      "second",
    ]);
    await rerender();
    expect(document.body.textContent).toContain("测试服务");
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click();
    });
    expect(document.body.textContent).toContain("已选择 1/20 个服务 · 1 个工具");
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")]
        .find(
          (button) =>
            button.textContent?.includes("测试服务") && !button.hasAttribute("aria-haspopup"),
        )!
        .click();
    });
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "移除")!
        .click();
    });
    expect(document.body.textContent).toContain("已选择 0/20 个服务 · 0 个工具");
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "取消")!
        .click();
    });
    expect(onChange).toHaveBeenCalledOnce();
    await act(async () => view.root.unmount());
    view.container.remove();
  });
});
