// @vitest-environment happy-dom

/**
 * ChatDetailPage 时间线渲染与复制测试。保护的风险：
 * - 复制消息、代码、思考与工具载荷只含内容本体，不泄漏事件 metadata；
 * - 流式回复复用完成态 assistant Markdown 样式，且不带操作按钮；
 * - assistant Markdown 渲染、工作记录渐进披露与头像/轨道视觉契约；
 * - 工具调用、产物、状态正常渲染；未知 envelope 隐藏，产物不出现旧页签。
 */

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ChatRef } from "@shared/models";
import { renderChatDetailPage } from "./chat-detail-page.test-helpers";

const chatRef: ChatRef = { connectionId: "c1", agentId: "a1", sessionId: "s1" };

describe("ChatDetailPage event timeline", () => {
  it("copies message Markdown, fenced code, thinking and tool payloads without event metadata", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "desktopHost", {
      configurable: true,
      value: { app: { copyText: writeText } },
    });
    const { container, unmount } = renderChatDetailPage({
      detail: {
        chat: { ref: chatRef, title: "Copy timeline" },
        messages: [],
        events: [
          {
            id: "u1",
            rawType: "user.message",
            kind: "message",
            role: "user",
            content: "用户原文",
            threadId: "thread-private",
          },
          {
            id: "a1",
            rawType: "agent.message",
            kind: "message",
            role: "assistant",
            content: "**答案**\n\n```ts\nconst answer = 42;\n```",
          },
          {
            id: "t1",
            rawType: "agent.thinking",
            kind: "thinking",
            content: "工作思路",
          },
          {
            id: "c1",
            rawType: "agent.tool_use",
            kind: "tool-call",
            name: "Bash",
            input: { command: "pnpm test" },
          },
          {
            id: "r1",
            rawType: "agent.tool_result",
            kind: "tool-result",
            toolUseId: "c1",
            content: "42 tests passed",
            isError: false,
          },
        ],
      },
    });

    const messageButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label="复制消息"]'),
    );
    expect(messageButtons).toHaveLength(2);
    await act(async () => messageButtons[0].click());
    await act(async () => messageButtons[1].click());
    const workGroup = container.querySelector<HTMLButtonElement>("[data-work-group] > button");
    expect(workGroup).not.toBeNull();
    act(() => workGroup?.click());
    for (const trigger of container.querySelectorAll<HTMLButtonElement>(
      '[data-timeline-track="work"] > button',
    )) {
      act(() => trigger.click());
    }

    const copy = async (label: string) => {
      const button = Array.from(
        container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`),
      )[0];
      expect(button).toBeDefined();
      await act(async () => button.click());
    };
    await copy("复制代码");
    await copy("复制思考内容");
    await copy("复制工具输入");
    await copy("复制工具输出");

    expect(writeText.mock.calls.map(([value]) => value)).toEqual([
      "用户原文",
      "**答案**\n\n```ts\nconst answer = 42;\n```",
      "const answer = 42;",
      "工作思路",
      '{\n  "command": "pnpm test"\n}',
      "42 tests passed",
    ]);
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining("thread-private"));

    unmount();
  });

  it("流式回复复用完成态的 assistant Markdown 样式", () => {
    const { container, unmount } = renderChatDetailPage({
      sending: true,
      streamingText: "**流式答案**",
    });

    const streamingReply = container.querySelector('[data-testid="streaming-reply"]');
    expect(streamingReply?.querySelector('[data-message-role="assistant"]')).not.toBeNull();
    expect(streamingReply?.querySelector("strong")?.textContent).toBe("流式答案");
    expect(streamingReply?.querySelector("img")?.getAttribute("src")).toContain("app.png");
    expect(streamingReply?.querySelector("[data-streaming-cursor]")).not.toBeNull();
    expect(streamingReply?.querySelector("[data-message-actions]")).toBeNull();
    expect(streamingReply?.textContent).not.toContain("**");

    unmount();
  });

  it("renders assistant Markdown and keeps operational details progressively disclosed", () => {
    const { container, unmount } = renderChatDetailPage({
      detail: {
        chat: { ref: chatRef, title: "Rich timeline" },
        messages: [],
        events: [
          {
            id: "m1",
            rawType: "agent.message",
            kind: "message",
            role: "assistant",
            content: "## Result\n\n- first\n- second\n\n`pnpm test`",
          },
          {
            id: "t1",
            rawType: "agent.thinking",
            kind: "thinking",
            content: "private reasoning",
          },
          {
            id: "c1",
            rawType: "agent.tool_use",
            kind: "tool-call",
            name: "Bash",
            serverName: "local",
            input: { command: "pnpm test" },
          },
          {
            id: "r1",
            rawType: "agent.tool_result",
            kind: "tool-result",
            toolUseId: "c1",
            content: "42 tests passed",
            isError: false,
          },
        ],
      },
    });

    expect(container.querySelector("h2")?.textContent).toBe("Result");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("code")?.textContent).toBe("pnpm test");
    expect(container.querySelectorAll("[data-work-group]")).toHaveLength(1);
    expect(container.textContent).toContain("调用工具 1 次 · 工作记录 3 条");
    act(() => container.querySelector<HTMLButtonElement>("[data-work-group] > button")?.click());
    expect(container.textContent).toContain("已思考");
    expect(container.textContent).toContain("调用 local / Bash");
    expect(container.textContent).toContain("已完成");
    expect(container.querySelectorAll('[data-timeline-track="work"]')).toHaveLength(3);
    expect(container.querySelector('[data-message-role="assistant"]')?.className).toContain(
      "items-start",
    );
    const assistantAvatar = container.querySelector<HTMLImageElement>(
      '[data-message-role="assistant"] img',
    );
    expect(assistantAvatar).not.toBeNull();
    expect(assistantAvatar?.getAttribute("src")).toContain("app.png");
    expect(assistantAvatar?.getAttribute("alt")).toBe("");
    for (const track of container.querySelectorAll('[data-timeline-track="work"]')) {
      expect(track.className).not.toContain("border-l");
    }

    unmount();
  });

  it("renders tool/artifact/status and keeps unknown envelopes hidden", () => {
    const { container, unmount } = renderChatDetailPage({
      detail: {
        chat: { ref: chatRef, title: "Timeline" },
        messages: [],
        events: [
          {
            id: "e1",
            rawType: "agent.tool_use",
            kind: "tool-call",
            name: "Bash",
            input: { command: "ls" },
          },
          {
            id: "e2",
            rawType: "agent.artifact_delivered",
            kind: "artifact",
            fileId: "f1",
            filename: "report.html",
            size: 1024,
          },
          {
            id: "e5",
            rawType: "agent.artifact_delivered",
            kind: "artifact",
            fileId: "f2",
            filename: "diagram.png",
            contentType: "image/png",
            size: 3,
          },
          {
            id: "e6",
            rawType: "agent.artifact_delivered",
            kind: "artifact",
            fileId: "f3",
            filename: "diagram.svg",
            contentType: "image/svg+xml",
          },
          {
            id: "e7",
            rawType: "agent.artifact_delivered",
            kind: "artifact",
            fileId: "f4",
            filename: "report.md",
            contentType: "text/markdown",
          },
          {
            id: "e3",
            rawType: "session.status_idle",
            kind: "status",
            scope: "session",
            status: "idle",
            stopReason: "end_turn",
          },
          { id: "e4", rawType: "span.model_request_start", kind: "unknown" },
        ],
      },
    });

    expect(container.textContent).toContain("Bash");
    const artifactName = Array.from(container.querySelectorAll("strong")).find(
      (element) => element.textContent === "report.html",
    );
    expect(artifactName?.getAttribute("title")).toBe("report.html");
    expect(container.textContent).toContain("report.html");
    expect(
      Array.from(container.querySelectorAll("button")).filter(
        (button) => button.textContent === "预览",
      ),
    ).toHaveLength(4);
    expect(container.textContent).toContain("Session idle");
    expect(container.textContent).not.toContain("未知公开事件");
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    unmount();
  });
});
