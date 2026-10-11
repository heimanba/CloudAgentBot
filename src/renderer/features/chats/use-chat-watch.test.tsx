// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatDetailView, ChatEventView, ChatRef } from "@shared/models";
import { mount } from "../../test-support/mount";
import { isSessionRunning, useChatWatch } from "./use-chat-watch";

const ref: ChatRef = { connectionId: "conn-1", agentId: "agent-1", sessionId: "sess-1" };

function detailWithStatus(status: string): ChatDetailView {
  return {
    chat: { ref, name: "任务", management: "managed" } as unknown as ChatDetailView["chat"],
    messages: [],
    events: [
      { id: "e1", rawType: "session_status", kind: "status", scope: "session", status },
    ],
  };
}

type Listener = (event: ChatEventView) => void;

interface MockHost {
  subscribeCalls: ChatRef[];
  emit(event: ChatEventView): void;
  unsubscribed: number;
}

function installHost(): MockHost {
  let listener: Listener | null = null;
  const host: MockHost = {
    subscribeCalls: [],
    unsubscribed: 0,
    emit(event) {
      listener?.(event);
    },
  };
  window.desktopHost = {
    chats: {
      subscribe: (chatRef: ChatRef, cb: Listener) => {
        host.subscribeCalls.push(chatRef);
        listener = cb;
        return Promise.resolve(() => {
          host.unsubscribed += 1;
        });
      },
    },
  } as unknown as typeof window.desktopHost;
  return host;
}

function Probe({
  detail,
  blocked,
  onSettled,
}: {
  detail: ChatDetailView | null;
  blocked: boolean;
  onSettled: () => void;
}) {
  const watch = useChatWatch(ref, detail, blocked, onSettled);
  return (
    <div>
      <span data-testid="watching">{String(watch.watching)}</span>
      <span data-testid="stream">{watch.streamingText}</span>
      <span data-testid="events">{watch.liveEvents.map((item) => item.id).join(",")}</span>
    </div>
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  window.desktopHost = undefined as unknown as typeof window.desktopHost;
});

describe("isSessionRunning", () => {
  it("取最后一条 session 级状态判定", () => {
    expect(isSessionRunning(null)).toBe(false);
    expect(isSessionRunning(detailWithStatus("running"))).toBe(true);
    expect(isSessionRunning(detailWithStatus("idle"))).toBe(false);
    const detail = detailWithStatus("idle");
    detail.events = [
      { id: "e1", rawType: "session_status", kind: "status", scope: "session", status: "idle" },
      { id: "e2", rawType: "session_status", kind: "status", scope: "session", status: "running" },
    ];
    expect(isSessionRunning(detail)).toBe(true);
  });
});

describe("useChatWatch", () => {
  it("会话运行中建立订阅，token 与 timeline 事件实时并入", async () => {
    const host = installHost();
    const view = mount(
      <Probe detail={detailWithStatus("running")} blocked={false} onSettled={vi.fn()} />,
    );
    await act(async () => Promise.resolve());
    expect(host.subscribeCalls).toEqual([ref]);
    expect(view.container.querySelector("[data-testid=watching]")!.textContent).toBe("true");

    act(() => host.emit({ type: "token", text: "你好" }));
    expect(view.container.querySelector("[data-testid=stream]")!.textContent).toBe("你好");
    act(() =>
      host.emit({
        type: "timeline",
        item: { id: "e2", rawType: "message", kind: "message", role: "assistant", content: "你好" },
      }),
    );
    // 完整 assistant 消息到达后清空流式文本，避免同一条回复双重渲染。
    expect(view.container.querySelector("[data-testid=stream]")!.textContent).toBe("");
    expect(view.container.querySelector("[data-testid=events]")!.textContent).toBe("e2");
    view.unmount();
    expect(host.unsubscribed).toBe(1);
  });

  it("非 assistant 消息的时间线条目不清空流式文本", async () => {
    const host = installHost();
    const view = mount(
      <Probe detail={detailWithStatus("running")} blocked={false} onSettled={vi.fn()} />,
    );
    await act(async () => Promise.resolve());
    act(() => host.emit({ type: "token", text: "部分" }));
    act(() =>
      host.emit({
        type: "timeline",
        item: { id: "e3", rawType: "tool_use", kind: "tool-call", name: "WebSearch" },
      }),
    );
    expect(view.container.querySelector("[data-testid=stream]")!.textContent).toBe("部分");
    expect(view.container.querySelector("[data-testid=events]")!.textContent).toBe("e3");
    view.unmount();
  });

  it("终态 done 后收口并回调 onSettled", async () => {
    const host = installHost();
    const onSettled = vi.fn();
    const view = mount(
      <Probe detail={detailWithStatus("running")} blocked={false} onSettled={onSettled} />,
    );
    await act(async () => Promise.resolve());
    act(() => host.emit({ type: "done" }));
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector("[data-testid=watching]")!.textContent).toBe("false");
    view.unmount();
  });

  it("会话不在运行或发送流程占用订阅时不订阅", async () => {
    const host = installHost();
    const idle = mount(
      <Probe detail={detailWithStatus("idle")} blocked={false} onSettled={vi.fn()} />,
    );
    await act(async () => Promise.resolve());
    expect(host.subscribeCalls).toEqual([]);
    idle.unmount();

    const blocked = mount(
      <Probe detail={detailWithStatus("running")} blocked={true} onSettled={vi.fn()} />,
    );
    await act(async () => Promise.resolve());
    expect(host.subscribeCalls).toEqual([]);
    blocked.unmount();
  });
});
