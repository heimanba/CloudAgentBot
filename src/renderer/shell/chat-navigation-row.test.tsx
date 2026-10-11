// @vitest-environment happy-dom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BotView, ChatView } from "@shared/models";
import { mount } from "../test-support/mount";
import { ChatNavigationRow } from "./chat-navigation-row";

const bot: BotView = {
  ref: { connectionId: "conn-1", agentId: "agent-1" },
  name: "QA 助手",
  management: "managed",
};
const chat: ChatView = {
  ref: { connectionId: "conn-1", agentId: "agent-1", sessionId: "session-1" },
  title: "发布检查",
  keyScope: "current",
};

function renderRow(
  provider: string,
  value: ChatView,
  onSetChatShared = vi.fn().mockResolvedValue(null),
  rowBot = bot,
) {
  const onOpen = vi.fn();
  const view = mount(
    <ChatNavigationRow
      bot={rowBot}
      provider={provider}
      chat={value}
      selected={false}
      busy={false}
      showAvatar
      onOpen={onOpen}
      onEditBot={() => {}}
      onSetChatShared={onSetChatShared}
      onArchiveChat={() => {}}
      onDeleteChat={() => {}}
    />,
  );
  return { container: view.container, unmount: view.unmount, onOpen, onSetChatShared };
}

describe("ChatNavigationRow sharing", () => {
  it.each(["bailian", "qoder"])(
    "在 %s 当前范围会话项中显示共享入口并开启共享",
    async (provider) => {
      const view = renderRow(provider, chat);
      const trigger = view.container.querySelector<HTMLButtonElement>(
        'button[aria-label="共享任务"]',
      )!;
      expect(trigger).not.toBeNull();

      await act(async () => trigger.click());
      const enable = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.includes("开启共享"),
      );
      expect(enable).toBeDefined();
      expect(document.body.textContent).toContain("尚未共享");
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      expect(view.onSetChatShared).not.toHaveBeenCalled();
      await act(async () => enable!.click());

      expect(view.onSetChatShared).toHaveBeenCalledWith(bot, chat, true);
      expect(view.onOpen).not.toHaveBeenCalled();
      view.unmount();
    },
  );

  it("已共享任务显示状态，管理面板取消共享且不打开任务", async () => {
    const value = { ...chat, shared: true };
    const view = renderRow("qoder", value);
    try {
      expect(view.container.textContent).toContain("已共享");
      const trigger = view.container.querySelector<HTMLButtonElement>(
        'button[aria-label="管理共享"]',
      )!;
      await act(async () => trigger.focus());
      await act(async () => trigger.click());
      expect(document.body.textContent).toContain("已共享给团队");
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      expect(view.onSetChatShared).not.toHaveBeenCalled();
      const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent === "取消共享",
      )!;
      await act(async () => cancel.click());
      expect(view.onSetChatShared).toHaveBeenCalledWith(bot, value, false);
      expect(view.onOpen).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it("共享失败时展示 Provider 状态而不是通用提示", async () => {
    const view = renderRow(
      "qoder",
      chat,
      vi.fn().mockResolvedValue({
        code: "invalid-input",
        message: "qoder update session sharing rejected with status 400",
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="共享任务"]',
    )!;

    await act(async () => trigger.click());
    const enable = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("开启共享"),
    );
    await act(async () => enable!.click());

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("status 400");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("invalid-input");
    view.unmount();
  });

  it("不支持的 Provider 或其他范围会话项不显示共享入口", () => {
    const unsupported = renderRow("unsupported", chat);
    expect(unsupported.container.querySelector('button[aria-label="共享任务"]')).toBeNull();
    unsupported.unmount();

    const foreign = renderRow("qoder", { ...chat, keyScope: "other", shared: true });
    expect(foreign.container.textContent).toContain("已共享");
    expect(foreign.container.querySelector('button[aria-label="管理共享"]')).toBeNull();
    foreign.unmount();
  });
});

describe("ChatNavigationRow context menu", () => {
  it.each([
    { management: "remote-only", keyScope: "current", labels: ["归档", "删除"] },
    { management: "managed", keyScope: "other", labels: ["编辑 Bot 配置"] },
  ] as const)(
    "保留 $management Bot 的 $keyScope 任务可用操作",
    async ({ management, keyScope, labels }) => {
      const view = renderRow("qoder", { ...chat, keyScope }, undefined, { ...bot, management });
      try {
        await act(async () => {
          view.container
            .querySelector("[data-chat-navigation-row]")!
            .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }));
        });
        expect(
          Array.from(document.querySelectorAll('[role="menuitem"]'), (item) => item.textContent),
        ).toEqual(labels);
      } finally {
        view.unmount();
      }
    },
  );

  it.each(["other", "ungrouped"] as const)(
    "无可用操作的 %s 任务右键不弹出空菜单",
    async (keyScope) => {
      const view = renderRow("qoder", { ...chat, keyScope, shared: true }, undefined, {
        ...bot,
        management: "remote-only",
      });
      try {
        await act(async () => {
          view.container
            .querySelector("[data-chat-navigation-row]")!
            .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }));
        });
        expect(document.querySelector('[role="menu"]')).toBeNull();
      } finally {
        view.unmount();
      }
    },
  );
});
