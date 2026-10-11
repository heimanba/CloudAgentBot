// @vitest-environment happy-dom

/**
 * ChatDetailPage 头部身份、任务管理菜单与输入框行为测试。保护的风险：
 * - 以 Chat 标题为主标题、Bot 归属身份可见、菜单提供 Session ID 复制与编辑入口；
 * - 其他 scope 的共享任务不出现归档/删除入口；
 * - Enter 发送 / Shift+Enter 不发送 / IME 不发送；失败保留输入，Provider 接受后才清空；
 * - 附件先显示草稿，发送时才上传；上传失败不发送且保留草稿。
 */

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ChatRef } from "@shared/models";
import { pressEnter, renderChatDetailPage, typeDraft } from "./chat-detail-page.test-helpers";

const chatRef: ChatRef = { connectionId: "c1", agentId: "a1", sessionId: "s1" };

describe("ChatDetailPage", () => {
  it("以 Chat 标题为主标题，并把 Bot 明确显示为归属身份", () => {
    const { container, unmount } = renderChatDetailPage({
      botName: "产品助手",
      detail: { chat: { ref: chatRef, title: "需求评审讨论" }, messages: [], events: [] },
    });

    const heading = container.querySelector("header strong");
    expect(heading?.textContent).toContain("需求评审讨论");
    expect(container.querySelector("header [data-session-id]")).toBeNull();
    expect(container.textContent).toContain("由「产品助手」处理");
    unmount();
  });

  it("Chat 管理菜单显示并可复制完整 Session ID", async () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "desktopHost", {
      configurable: true,
      value: { app: { copyText } },
    });
    const { container, unmount } = renderChatDetailPage({
      botName: "QA助手",
      detail: {
        chat: { ref: chatRef, title: "Session identity" },
        messages: [],
        events: [],
      },
    });

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="管理任务"]')!;
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
      );
    });

    expect(document.body.textContent).toContain("Session ID");
    expect(document.body.textContent).toContain(chatRef.sessionId);
    const copyButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="复制 Session ID"]',
    );
    expect(copyButton).not.toBeNull();

    await act(async () => copyButton!.click());
    expect(copyText).toHaveBeenCalledWith(chatRef.sessionId);

    unmount();
    delete (window as unknown as Record<string, unknown>).desktopHost;
  });

  it("Managed Bot 的 Chat 管理菜单直接提供编辑 Bot 配置入口", async () => {
    const onEditBot = vi.fn();
    const { container, unmount } = renderChatDetailPage({
      botName: "QA助手",
      botRef: { connectionId: "conn-b", agentId: "agent-qa" },
      onEditBot,
    });

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="管理任务"]')!;
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
      );
    });
    const editItem = Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem]")).find(
      (item) => item.textContent?.includes("编辑 Bot 配置"),
    );
    expect(editItem).toBeDefined();

    await act(async () => editItem!.click());
    expect(onEditBot).toHaveBeenCalledOnce();
    unmount();
  });

  it("其他范围的共享任务只显示共享状态，不提供归档或删除", async () => {
    const { container, unmount } = renderChatDetailPage({
      botName: "QA助手",
      provider: "bailian",
      detail: {
        chat: { ref: chatRef, title: "团队任务", keyScope: "other", shared: true },
        messages: [],
        events: [],
      },
    });

    expect(container.textContent).toContain("已共享");
    expect(container.querySelector('button[aria-label="管理共享"]')).toBeNull();
    const menuTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="管理任务"]',
    )!;
    await act(async () => {
      menuTrigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
      );
    });
    const menuText = Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem]"))
      .map((item) => item.textContent)
      .join(" ");
    expect(menuText).not.toContain("归档");
    expect(menuText).not.toContain("删除");

    unmount();
  });

  it("Enter 发送（非 Shift）", async () => {
    let sentText: string | null = null;
    const { container, unmount } = renderChatDetailPage({
      botName: "QA助手",
      onSend: (text) => {
        sentText = text;
      },
    });

    const textarea = container.querySelector("textarea")!;
    expect(textarea.placeholder).toBe("给 QA助手 发送消息…");
    expect(textarea.className).toContain("focus-visible:shadow-none");
    // 单层输入外观：输入本体透明，焦点边界由外层 composer 承担。
    expect(textarea.className).toContain("bg-transparent");
    expect(textarea.className).toContain("disabled:bg-transparent");
    const composer = textarea.parentElement!.parentElement!.parentElement!;
    expect(composer.className).toContain("border-border/80");
    expect(composer.className).toContain("focus-within:border-foreground/35");
    act(() => typeDraft(textarea, "hello"));

    await pressEnter(textarea);

    expect(sentText).toBe("hello");
    unmount();
  });

  it("发送请求失败保留草稿，Provider 接受后立即清空", async () => {
    let sentText = "";
    let accepted = false;
    const { container, unmount } = renderChatDetailPage({
      onSend: (text) => {
        sentText = text;
        return Promise.resolve(accepted);
      },
    });

    const textarea = container.querySelector("textarea")!;
    act(() => typeDraft(textarea, "请保留这段内容"));
    await pressEnter(textarea);
    expect(sentText).toBe("请保留这段内容");
    expect(textarea.value).toBe("请保留这段内容");
    expect(document.activeElement).toBe(textarea);

    accepted = true;
    await pressEnter(textarea);
    expect(textarea.value).toBe("");

    unmount();
  });

  it("选择附件时只显示草稿，发送时上传并在 Provider 接受后清空", async () => {
    const uploadFile = vi.fn().mockResolvedValue({
      fileId: "file-1",
      filename: "AGENTS.md",
      mimeType: "text/markdown",
    });
    Object.defineProperty(window, "desktopHost", {
      configurable: true,
      value: { chats: { uploadFile } },
    });
    const onSend = vi.fn().mockResolvedValue(true);
    const { container, unmount } = renderChatDetailPage({
      botRef: { connectionId: "c1", agentId: "a1" },
      provider: "qoder",
      onSend,
    });

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["rules"], "AGENTS.md", { type: "text/markdown" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[aria-label="附件"]')?.textContent).toContain("AGENTS.md");
    expect(container.querySelector('[aria-label="附件"]')?.textContent).not.toContain("上传中");
    expect(uploadFile).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')?.click();
      await Promise.resolve();
    });

    expect(uploadFile).toHaveBeenCalledOnce();
    expect(uploadFile.mock.invocationCallOrder[0]).toBeLessThan(onSend.mock.invocationCallOrder[0]);
    expect(onSend).toHaveBeenCalledWith("", [
      {
        fileId: "file-1",
        filename: "AGENTS.md",
        mimeType: "text/markdown",
      },
    ]);
    expect(container.querySelector('[aria-label="附件"]')).toBeNull();

    unmount();
    delete (window as unknown as Record<string, unknown>).desktopHost;
  });

  it("附件上传失败时不发送并保留草稿", async () => {
    const uploadFile = vi.fn().mockRejectedValue({
      code: "unavailable",
      message: "upload failed",
    });
    Object.defineProperty(window, "desktopHost", {
      configurable: true,
      value: { chats: { uploadFile } },
    });
    const onSend = vi.fn();
    const { container, unmount } = renderChatDetailPage({
      botRef: { connectionId: "c1", agentId: "a1" },
      provider: "qoder",
      onSend,
    });

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["rules"], "AGENTS.md", { type: "text/markdown" })],
    });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')?.click();
      await Promise.resolve();
    });

    expect(uploadFile).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="附件"]')?.textContent).toContain("AGENTS.md");
    expect(container.querySelector('[aria-label="附件"]')?.textContent).toContain("失败");

    unmount();
    delete (window as unknown as Record<string, unknown>).desktopHost;
  });

  it("Shift+Enter 不发送", async () => {
    let sentText: string | null = null;
    const { container, unmount } = renderChatDetailPage({
      onSend: (text) => {
        sentText = text;
      },
    });

    const textarea = container.querySelector("textarea")!;
    act(() => typeDraft(textarea, "hello"));

    await pressEnter(textarea, { shiftKey: true });

    expect(sentText).toBeNull();
    expect(textarea.value).toBe("hello");

    // 同一渲染的普通 Enter 正控，避免因发送路径本身失效而误通过。
    await pressEnter(textarea);
    expect(sentText).toBe("hello");
    unmount();
  });

  it("IME 输入中 Enter 不发送", async () => {
    let sentText: string | null = null;
    const { container, unmount } = renderChatDetailPage({
      onSend: (text) => {
        sentText = text;
      },
    });

    const textarea = container.querySelector("textarea")!;
    act(() => typeDraft(textarea, "hello"));

    // IME 组合中的确认 Enter：isComposing=true 必须被吞掉，不得发送半打的拼音。
    // pressEnter 已排空提交路径的微任务（理由见 chat-detail-page.test-helpers.tsx），
    // 守卫被删掉时发送会在断言前发生，这里会真实变红。
    await pressEnter(textarea, { isComposing: true });
    expect(sentText).toBeNull();

    // 结构自检：同一渲染里普通 Enter 必须能发送，证明上面确实测到了 keydown 路径
    await pressEnter(textarea);
    expect(sentText).toBe("hello");

    unmount();
  });
});
