// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotView } from "@shared/models";
import { mount } from "../../test-support/mount";
import { NewTaskPage, type NewTaskPageProps } from "./new-task-page";

const bot: BotView = {
  ref: { connectionId: "conn-1", agentId: "agent-1" },
  name: "产品助手",
  management: "managed",
  keyScope: "current",
  shared: true,
};

function renderTask(overrides: Partial<NewTaskPageProps> = {}) {
  const props: NewTaskPageProps = {
    bots: [bot],
    roster: [],
    loading: false,
    draft: "整理客户会议议程",
    selectedBot: null,
    connectionId: "conn-1",
    creating: false,
    error: null,
    onDraftChange: vi.fn(),
    onSelectBot: vi.fn(),
    onClearBot: vi.fn(),
    onCreateBot: vi.fn(),
    onSend: vi.fn(),
    ...overrides,
  };
  const view = mount(<NewTaskPage {...props} />);
  return { container: view.container, props, unmount: view.unmount };
}

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as unknown as Record<string, unknown>).desktopHost;
});

describe("NewTaskPage", () => {
  it("标题栏空白区域保留原生窗口拖动，不用点击区域覆盖", () => {
    const view = renderTask();
    const region = view.container.querySelector('[data-slot="window-drag-region"]');
    expect(region?.className).toContain("[-webkit-app-region:drag]");
    expect(region?.className).not.toContain("app-chat-topbar-action");
    view.unmount();
  });

  it("选择协作 Bot 时说明按需委派", () => {
    const coordinator: BotView = {
      ...bot,
      collaboration: { memberAgentIds: ["member-1", "member-2"] },
    };
    const view = renderTask({ selectedBot: coordinator });
    expect(view.container.textContent).toContain("它可按需委派给 2 位协作成员");
    view.unmount();
  });
  it("未选择 Bot 时不能发送，选择只改变执行者", () => {
    const view = renderTask();
    expect(
      view.container.querySelector<HTMLButtonElement>('button[aria-label="发送任务"]')?.disabled,
    ).toBe(true);
    act(() => view.container.querySelector<HTMLButtonElement>("button")?.click());
    const choice = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("产品助手"),
    );
    act(() => choice?.click());
    expect(view.props.onSelectBot).toHaveBeenCalledWith(bot);
    expect(view.props.onSend).not.toHaveBeenCalled();
    view.unmount();
  });

  it("创建助手是显式动作，任务草稿继续显示", () => {
    const view = renderTask({ bots: [] });
    const create = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("创建助手"),
    );
    act(() => create?.click());
    expect(view.props.onCreateBot).toHaveBeenCalledOnce();
    expect(view.props.onSend).not.toHaveBeenCalled();
    expect(
      view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="任务内容"]')?.value,
    ).toBe("整理客户会议议程");
    view.unmount();
  });

  it("新 Bot 尚未进入远程列表时仍可作为当前执行者发送", () => {
    const view = renderTask({ bots: [], selectedBot: bot });
    expect(view.container.textContent).toContain("产品助手");
    expect(
      view.container.querySelector('button[aria-label="更换执行助手，当前：产品助手"]'),
    ).not.toBeNull();
    expect(view.container.querySelector('button[aria-label="移除助手 产品助手"]')).not.toBeNull();
    expect(
      view.container.querySelector<HTMLButtonElement>('button[aria-label="发送任务"]')?.disabled,
    ).toBe(false);
    view.unmount();
  });

  it("清除助手只重置选择，不丢失草稿或发送任务", () => {
    const view = renderTask({ selectedBot: bot });
    expect(
      view.container.querySelector('[aria-label="已选择助手：产品助手"]')?.textContent,
    ).toContain("产品助手");
    expect(
      view.container.querySelector('[aria-label="已选择助手：产品助手"]')?.textContent,
    ).not.toContain("@产品助手");
    act(() =>
      view.container
        .querySelector<HTMLButtonElement>('button[aria-label="移除助手 产品助手"]')
        ?.click(),
    );
    expect(view.props.onClearBot).toHaveBeenCalledOnce();
    expect(view.props.onDraftChange).not.toHaveBeenCalled();
    expect(view.props.onSend).not.toHaveBeenCalled();
    expect(
      view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="任务内容"]')?.value,
    ).toBe("整理客户会议议程");
    view.unmount();
  });

  it("在草稿开头按退格可移除已选助手", () => {
    const view = renderTask({ selectedBot: bot });
    const textarea = view.container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="任务内容"]',
    )!;
    act(() => {
      textarea.focus();
      textarea.setSelectionRange(0, 0);
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    });
    expect(view.props.onClearBot).toHaveBeenCalledOnce();
    expect(view.props.onDraftChange).not.toHaveBeenCalled();
    view.unmount();
  });

  it("任务示例只填入草稿，不自动创建或发送", () => {
    const view = renderTask({ draft: "" });
    const example = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("整理一份会议纪要"),
    );
    act(() => example?.click());
    expect(view.props.onDraftChange).toHaveBeenCalledWith("整理一份会议纪要，并列出待办事项");
    expect(view.props.onSend).not.toHaveBeenCalled();
    view.unmount();
  });

  it("输入 @ 可选择执行助手，并清除触发选择的文本", () => {
    const view = renderTask({ draft: "整理资料 @" });
    const textarea = view.container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="任务内容"]',
    )!;
    act(() => {
      textarea.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "整理资料 @产",
      );
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const choice = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("产品助手"),
    );
    act(() => choice?.click());
    expect(view.props.onSelectBot).toHaveBeenCalledWith(bot);
    expect(view.props.onDraftChange).toHaveBeenCalledWith("整理资料 ");
    expect(view.props.onSend).not.toHaveBeenCalled();
    view.unmount();
  });

  it("用户显式切换到浏览 Provider 资源后可选择未共享远程助手", () => {
    const bots = [
      bot,
      ...Array.from({ length: 4 }, (_, index): BotView => ({
        ref: { connectionId: "conn-1", agentId: `agent-${index + 2}` },
        name: `备选助手${index + 1}`,
        management: "remote-only",
      })),
    ];
    const view = renderTask({ bots });
    act(() => {
      [...view.container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("选择助手"))
        ?.click();
    });
    act(() => {
      [...document.body.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("浏览 Provider 资源"))
        ?.click();
    });
    expect(
      document.body.querySelector('[aria-label="可选助手"]')?.querySelectorAll("button"),
    ).toHaveLength(5);
    expect(document.body.textContent).not.toContain("查看全部助手");
    view.unmount();
  });

  it("默认展示跨 Key 共享 Bot，未共享资源仅在显式范围展示", () => {
    const bots: BotView[] = [
      { ...bot, name: "团队助手", shared: true },
      { ...bot, ref: { ...bot.ref, agentId: "unshared" }, name: "未共享", shared: false },
      {
        ...bot,
        ref: { ...bot.ref, agentId: "legacy" },
        name: "旧助手",
        keyScope: "ungrouped",
        shared: false,
      },
      {
        ...bot,
        ref: { ...bot.ref, agentId: "foreign" },
        name: "其他 Key",
        keyScope: "other",
        shared: true,
      },
    ];
    const view = renderTask({ bots });
    act(() => {
      [...view.container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("选择助手"))
        ?.click();
    });
    const list = document.body.querySelector('[aria-label="可选助手"]')!;
    expect(list.textContent).toContain("团队助手");
    expect(list.textContent).not.toContain("未共享");
    expect(list.textContent).not.toContain("旧助手");
    expect(list.textContent).toContain("其他 Key");
    act(() => {
      [...document.body.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("浏览 Provider 资源"))
        ?.click();
    });
    expect(list.textContent).toContain("旧助手");
    expect(list.textContent).toContain("未分组");
    expect(list.textContent).toContain("其他 Key");
    view.unmount();
  });

  it("发送不可用时说明需要补充的内容", () => {
    const view = renderTask({ draft: "", selectedBot: bot });
    expect(view.container.textContent).toContain("描述任务后即可发送。");
    view.unmount();
    const unselected = renderTask();
    expect(unselected.container.textContent).toContain("选择助手后即可发送任务。");
    unselected.unmount();
    const empty = renderTask({ bots: [] });
    expect(empty.container.textContent).toContain("创建助手后即可发送任务。");
    empty.unmount();
  });

  it("选择附件时不上传，发送任务时才上传", async () => {
    const uploadFile = vi.fn().mockResolvedValue({
      fileId: "file-1",
      filename: "AGENTS.md",
      mimeType: "text/markdown",
    });
    Object.defineProperty(window, "desktopHost", {
      configurable: true,
      value: { chats: { uploadFile } },
    });
    const onSend = vi.fn();
    const view = renderTask({ selectedBot: bot, provider: "qoder", onSend });
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["rules"], "AGENTS.md", { type: "text/markdown" })],
    });

    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(view.container.querySelector('[aria-label="附件"]')?.textContent).toContain("AGENTS.md");
    expect(view.container.querySelector('[aria-label="附件"]')?.textContent).not.toContain(
      "上传中",
    );
    expect(uploadFile).not.toHaveBeenCalled();

    await act(async () => {
      view.container.querySelector<HTMLButtonElement>('button[aria-label="发送任务"]')?.click();
      await Promise.resolve();
    });

    expect(uploadFile).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith([
      { fileId: "file-1", filename: "AGENTS.md", mimeType: "text/markdown" },
    ]);
    view.unmount();
  });

  it("附件展示对应类型图标和扩展名", async () => {
    const view = renderTask({ provider: "qoder" });
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["image"], "launch-poster.webp", { type: "image/webp" })],
    });

    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const attachment = view.container.querySelector('[aria-label="附件"]');
    expect(attachment?.textContent).toContain("launch-poster.webp");
    expect(attachment?.textContent).toContain("WEBP");
    expect(attachment?.querySelector('[data-file-icon="image"]')).not.toBeNull();
    view.unmount();
  });

  it("Bailian 与 Qoder 使用相同的文件类型白名单", () => {
    const qoder = renderTask({ provider: "qoder" });
    const qoderAccept =
      qoder.container.querySelector<HTMLInputElement>('input[type="file"]')?.accept;
    expect(qoderAccept).toContain(".tsx");
    expect(qoderAccept).toContain(".png");
    expect(qoderAccept).toContain(".webp");
    expect(qoderAccept).toContain(".heic");
    expect(qoderAccept).not.toContain(".mjs");
    qoder.unmount();

    const bailian = renderTask({ provider: "bailian" });
    const bailianAccept =
      bailian.container.querySelector<HTMLInputElement>('input[type="file"]')?.accept;
    expect(bailianAccept).toBe(qoderAccept);
    bailian.unmount();
  });
});

it("团队共享为空时不自动展示 Provider 资源，选择后重新打开回到团队共享", () => {
  const legacy: BotView = {
    ...bot,
    name: "历史资源",
    keyScope: "ungrouped",
    management: "remote-only",
    shared: false,
  };
  const view = renderTask({ bots: [legacy] });
  const trigger = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="选择执行助手"]',
  )!;
  act(() => trigger.click());
  expect(document.body.textContent).toContain("还没有团队共享助手");
  const list = () => document.body.querySelector('[aria-label="可选助手"]')!;
  expect(list().textContent).not.toContain("历史资源");
  const browse = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("浏览 Provider 资源"),
  )!;
  expect(browse.closest('[aria-label="助手范围"]')).toBeNull();
  act(() => browse.click());
  expect(document.body.textContent).toContain("不会接管配置或开启共享");
  act(() => list().querySelector<HTMLButtonElement>("button")!.click());
  expect(view.props.onSelectBot).toHaveBeenCalledWith(legacy);
  expect(view.props.onSend).not.toHaveBeenCalled();
  expect(view.props.onDraftChange).not.toHaveBeenCalled();
  act(() => trigger.click());
  expect(list().textContent).not.toContain("历史资源");
  expect(document.body.textContent).toContain("还没有团队共享助手");
  view.unmount();
});

it("目录错误可从新任务刷新，保留草稿与描述且不发送", () => {
  const onReloadBots = vi.fn();
  const view = renderTask({
    selectedBot: { ...bot, description: "回答产品使用问题" },
    botsError: { code: "unavailable", message: "助手列表未更新，请重试刷新。" },
    onReloadBots,
  });
  expect(view.container.textContent).toContain("回答产品使用问题");
  expect(
    view.container.querySelector<HTMLButtonElement>('button[aria-label="发送任务"]')?.disabled,
  ).toBe(true);
  act(() =>
    view.container.querySelector<HTMLButtonElement>('button[aria-label="刷新助手列表"]')!.click(),
  );
  expect(onReloadBots).toHaveBeenCalledOnce();
  expect(view.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
    view.props.draft,
  );
  expect(view.props.onSend).not.toHaveBeenCalled();
  view.unmount();
});

it("失效的已选助手明确提示重新选择并禁止发送", () => {
  const view = renderTask({ selectedBot: bot, selectedBotUnavailable: true });
  expect(view.container.textContent).toContain("请重新选择助手。任务内容已保留");
  expect(
    view.container.querySelector<HTMLButtonElement>('button[aria-label="发送任务"]')?.disabled,
  ).toBe(true);
  view.unmount();
});
