// @vitest-environment happy-dom

/**
 * Chat 发送/流式行为测试。保护的风险：
 * - 时序：subscribe 必须先 resolve（SSE 握手成功）→ 再调用 send；
 * - 快速 token+done：正常路径收口、解除门禁、重读历史；
 * - 订阅失败：不调用 send、解除门禁、就地错误、重读历史；
 * - send 失败：取消订阅、解除门禁、就地错误、重读历史；
 * - SSE error：取消订阅、解除门禁、就地错误、重读历史；
 * - 超时：取消订阅、解除门禁、就地错误、重读历史；
 * - 切换 Chat：取消旧订阅、复位状态。
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import type { ChatEventView, ChatRef, HostError, MessageAttachment } from "@shared/models";
import { mount } from "../../test-support/mount";
import { useChatSend } from "./use-chats";
import type { DesktopHost } from "@shared/desktop-host-contract";

// ---------- Mock DesktopHost ----------

type EventListener = (event: ChatEventView) => void;

interface MockHost {
  subscribeCalls: { ref: ChatRef; listener: EventListener }[];
  sendCalls: { ref: ChatRef; text: string }[];
  subscribeError: HostError | null;
  sendError: HostError | null;
  /** 控制事件推送；测试通过 emit 手动推事件。 */
  emit(ref: ChatRef, event: ChatEventView): void;
  host: DesktopHost["chats"];
}

function createMockHost(): MockHost {
  const subscribeCalls: { ref: ChatRef; listener: EventListener }[] = [];
  const sendCalls: { ref: ChatRef; text: string }[] = [];
  const activeListeners = new Map<string, EventListener>();

  const host: MockHost = {
    subscribeCalls,
    sendCalls,
    subscribeError: null,
    sendError: null,

    emit(ref: ChatRef, event: ChatEventView) {
      const key = `${ref.connectionId}/${ref.sessionId}`;
      activeListeners.get(key)?.(event);
    },

    host: {
      list: () => Promise.resolve([]),
      uploadFile: () =>
        Promise.resolve({ fileId: "file-1", filename: "f", mimeType: "text/plain" }),
      create: () =>
        Promise.resolve({
          ref: { connectionId: "", agentId: "", sessionId: "" },
          title: "",
          remoteStatus: "",
        }),
      get: () =>
        Promise.resolve({
          chat: {
            ref: { connectionId: "", agentId: "", sessionId: "" },
            title: "",
            remoteStatus: "",
          },
          messages: [],
          events: [],
        }),
      send: (ref: ChatRef, text: string) => {
        sendCalls.push({ ref, text });
        if (host.sendError) return Promise.reject(host.sendError);
        return Promise.resolve({ ok: true });
      },
      setShared: (ref: ChatRef, shared: boolean) =>
        Promise.resolve({ ref, title: "Shared chat", keyScope: "current", shared }),
      archive: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      getArtifact: () => Promise.reject({ code: "not-found", message: "artifact not found" }),
      subscribe: (ref: ChatRef, listener: EventListener) => {
        subscribeCalls.push({ ref, listener });
        if (host.subscribeError) return Promise.reject(host.subscribeError);
        const key = `${ref.connectionId}/${ref.sessionId}`;
        activeListeners.set(key, listener);
        return Promise.resolve(() => {
          activeListeners.delete(key);
        });
      },
    },
  };
  return host;
}

// ---------- Test Harness ----------

interface HarnessProps {
  chatRef: ChatRef;
  onSettled: () => void;
  attachments?: MessageAttachment[];
}

function Harness({ chatRef, onSettled, attachments }: HarnessProps) {
  const send = useChatSend(chatRef, onSettled);
  return (
    <div>
      <span data-testid="sending">{String(send.sending)}</span>
      <span data-testid="streaming">{send.streamingText}</span>
      <span data-testid="events">{JSON.stringify(send.liveEvents)}</span>
      <span data-testid="error">{send.error ? send.error.message : "none"}</span>
      <button data-testid="send" onClick={() => void send.send("hello", attachments)}>
        Send
      </button>
    </div>
  );
}

function renderSend(props: HarnessProps) {
  return mount(<Harness {...props} />);
}

function getEl(container: HTMLElement, testId: string): HTMLElement {
  return container.querySelector(`[data-testid="${testId}"]`)!;
}

// ---------- Tests ----------

const chatRef: ChatRef = { connectionId: "c1", agentId: "a1", sessionId: "s1" };

describe("useChatSend", () => {
  let mockHost: MockHost;
  let settledCount: number;

  beforeEach(() => {
    mockHost = createMockHost();
    settledCount = 0;
    // Mock window.desktopHost
    (window as unknown as Record<string, unknown>).desktopHost = { chats: mockHost.host };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>).desktopHost;
  });

  it("快速 token+done：正常路径收口", async () => {
    const { container, unmount } = renderSend({ chatRef, onSettled: () => settledCount++ });

    // 点击发送
    await act(async () => {
      getEl(container, "send").click();
    });

    // 订阅已建立（subscribe 先于 send）
    expect(mockHost.subscribeCalls).toHaveLength(1);
    expect(mockHost.sendCalls).toHaveLength(1);
    expect(getEl(container, "sending").textContent).toBe("true");
    expect(getEl(container, "events").textContent).toContain("hello");

    // 推 token + done
    await act(async () => {
      mockHost.emit(chatRef, { type: "token", text: "Hello" });
      mockHost.emit(chatRef, { type: "done" });
    });

    expect(getEl(container, "sending").textContent).toBe("false");
    expect(getEl(container, "streaming").textContent).toBe("");
    expect(getEl(container, "events").textContent).toContain("hello");
    expect(getEl(container, "events").textContent).toContain("Hello");
    expect(getEl(container, "error").textContent).toBe("none");
    expect(settledCount).toBe(1);
    unmount();
  });

  it("token、完整 assistant timeline 和 done 只保留一条回复", async () => {
    const { container, unmount } = renderSend({ chatRef, onSettled: () => settledCount++ });

    await act(async () => {
      getEl(container, "send").click();
    });
    await act(async () => {
      mockHost.emit(chatRef, { type: "token", text: "Hello" });
      mockHost.emit(chatRef, {
        type: "timeline",
        item: {
          id: "assistant-1",
          rawType: "message",
          kind: "message",
          role: "assistant",
          content: "Hello",
        },
      });
      mockHost.emit(chatRef, {
        type: "timeline",
        item: {
          id: "status-1",
          rawType: "session_status",
          kind: "status",
          scope: "session",
          status: "idle",
          stopReason: "end_turn",
        },
      });
      mockHost.emit(chatRef, { type: "done" });
    });

    const events = JSON.parse(getEl(container, "events").textContent ?? "[]") as Array<{
      kind: string;
      role?: string;
      id: string;
    }>;
    expect(events.filter((item) => item.kind === "message" && item.role === "assistant")).toEqual([
      expect.objectContaining({ id: "assistant-1" }),
    ]);
    expect(getEl(container, "streaming").textContent).toBe("");
    expect(settledCount).toBe(1);
    unmount();
  });

  it("附件消息发送后立即显示并在远程 user event 到达时保留", async () => {
    const { container, unmount } = renderSend({
      chatRef,
      onSettled: () => settledCount++,
      attachments: [
        { fileId: "file-1", filename: "stylelint.config.mjs", mimeType: "text/javascript" },
      ],
    });

    await act(async () => {
      getEl(container, "send").click();
    });
    expect(getEl(container, "events").textContent).toContain("stylelint.config.mjs");

    await act(async () => {
      mockHost.emit(chatRef, {
        type: "timeline",
        item: {
          id: "event-1",
          rawType: "user.message",
          kind: "message",
          role: "user",
          content: "hello",
        },
      });
    });
    expect(getEl(container, "events").textContent).toContain("event-1");
    expect(getEl(container, "events").textContent).toContain("stylelint.config.mjs");

    await act(async () => {
      mockHost.emit(chatRef, { type: "done" });
    });
    expect(getEl(container, "events").textContent).toContain("stylelint.config.mjs");
    unmount();
  });

  it("下一次发送不会继续携带上一轮实时消息", async () => {
    const { container, unmount } = renderSend({
      chatRef,
      onSettled: () => settledCount++,
      attachments: [
        { fileId: "file-1", filename: "stylelint.config.mjs", mimeType: "text/javascript" },
      ],
    });

    await act(async () => {
      getEl(container, "send").click();
    });
    await act(async () => {
      mockHost.emit(chatRef, { type: "token", text: "answer" });
      mockHost.emit(chatRef, { type: "done" });
    });
    expect(JSON.parse(getEl(container, "events").textContent ?? "[]")).toHaveLength(2);

    await act(async () => {
      getEl(container, "send").click();
    });
    const nextTurn = JSON.parse(getEl(container, "events").textContent ?? "[]") as Array<{
      role: string;
      attachments?: Array<{ fileId: string }>;
    }>;
    expect(nextTurn).toHaveLength(1);
    expect(nextTurn[0]).toMatchObject({
      role: "user",
      attachments: [{ fileId: "file-1" }],
    });
    unmount();
  });

  it("历史 user event 不会替换当前乐观消息", async () => {
    const { container, unmount } = renderSend({
      chatRef,
      onSettled: () => settledCount++,
      attachments: [
        { fileId: "file-1", filename: "stylelint.config.mjs", mimeType: "text/javascript" },
      ],
    });

    await act(async () => {
      getEl(container, "send").click();
    });
    await act(async () => {
      mockHost.emit(chatRef, {
        type: "timeline",
        item: {
          id: "old-event",
          rawType: "user.message",
          kind: "message",
          role: "user",
          content: "older",
        },
      });
    });

    const events = getEl(container, "events").textContent ?? "";
    expect(events).toContain("hello");
    expect(events).toContain("stylelint.config.mjs");
    expect(events).toContain("older");
    unmount();
  });

  it("订阅失败：不调用 send、解除门禁、就地错误", async () => {
    mockHost.subscribeError = { code: "unavailable", message: "subscribe failed" };
    const { container, unmount } = renderSend({ chatRef, onSettled: () => settledCount++ });

    await act(async () => {
      getEl(container, "send").click();
    });

    expect(mockHost.subscribeCalls).toHaveLength(1);
    expect(mockHost.sendCalls).toHaveLength(0); // send 未被调用
    expect(getEl(container, "sending").textContent).toBe("false");
    expect(getEl(container, "error").textContent).toBe("subscribe failed");
    expect(settledCount).toBe(1);
    unmount();
  });

  it("send 失败：取消订阅、解除门禁、就地错误", async () => {
    mockHost.sendError = { code: "unavailable", message: "send failed" };
    const { container, unmount } = renderSend({ chatRef, onSettled: () => settledCount++ });

    await act(async () => {
      getEl(container, "send").click();
    });

    expect(mockHost.sendCalls).toHaveLength(1);
    expect(getEl(container, "sending").textContent).toBe("false");
    expect(getEl(container, "error").textContent).toBe("send failed");
    expect(settledCount).toBe(1);
    unmount();
  });

  it("SSE error：取消订阅、解除门禁、就地错误", async () => {
    const { container, unmount } = renderSend({ chatRef, onSettled: () => settledCount++ });

    await act(async () => {
      getEl(container, "send").click();
    });

    await act(async () => {
      mockHost.emit(chatRef, {
        type: "error",
        error: { code: "unavailable", message: "stream error" },
      });
    });

    expect(getEl(container, "sending").textContent).toBe("false");
    expect(getEl(container, "error").textContent).toBe("stream error");
    expect(settledCount).toBe(1);
    unmount();
  });

  it("超时：取消订阅、解除门禁、就地错误", async () => {
    const { container, unmount } = renderSend({ chatRef, onSettled: () => settledCount++ });

    await act(async () => {
      getEl(container, "send").click();
    });

    // 快进 120 秒触发超时
    await act(async () => {
      vi.advanceTimersByTime(120_001);
    });

    expect(getEl(container, "sending").textContent).toBe("false");
    expect(getEl(container, "error").textContent).toBe("send timed out");
    expect(settledCount).toBe(1);
    unmount();
  });

  it("切换 Chat：取消旧订阅、复位状态", async () => {
    const { container, unmount, root } = renderSend({ chatRef, onSettled: () => settledCount++ });

    await act(async () => {
      getEl(container, "send").click();
    });
    expect(getEl(container, "sending").textContent).toBe("true");

    // 切换到新 Chat
    const newRef: ChatRef = { connectionId: "c1", agentId: "a1", sessionId: "s2" };
    await act(async () => {
      root.render(<Harness chatRef={newRef} onSettled={() => settledCount++} />);
    });

    expect(getEl(container, "sending").textContent).toBe("false");
    expect(getEl(container, "streaming").textContent).toBe("");
    unmount();
  });
});
