/**
 * 被动观看正在运行的远程 Session（如定时任务触发的会话）。
 * 发送流程（useChatSend）只在用户发消息时建立订阅；本 Hook 在会话处于 running 且
 * 没有发送动作时建立只读订阅，把后续事件实时并入时间线，终态（done）后由调用方
 * 重读历史接管展示。取消订阅不影响远程运行。
 */
import { useEffect, useRef, useState } from "react";
import type { ChatDetailView, ChatRef, ChatTimelineItemView } from "@shared/models";
import { getDesktopHost } from "../../desktop-host";

/** 从已读历史中判断会话是否仍在运行：取最后一条 session 级状态。 */
export function isSessionRunning(detail: ChatDetailView | null): boolean {
  if (detail === null) return false;
  for (let index = detail.events.length - 1; index >= 0; index -= 1) {
    const item = detail.events[index];
    if (item?.kind === "status" && item.scope === "session") {
      return item.status === "running";
    }
  }
  return false;
}

export interface UseChatWatchResult {
  watching: boolean;
  streamingText: string;
  liveEvents: ChatTimelineItemView[];
}

export function useChatWatch(
  ref: ChatRef | null,
  detail: ChatDetailView | null,
  /** 发送流程持有订阅时（sending）为 true，被动观看让位。 */
  blocked: boolean,
  /** 到达终态或订阅出错时回调：调用方应重读远程历史与列表。 */
  onSettled: () => void,
): UseChatWatchResult {
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  const refKey = ref === null ? "" : `${ref.connectionId}/${ref.agentId}/${ref.sessionId}`;
  const active = ref !== null && !blocked && isSessionRunning(detail);
  const watchKey = active ? refKey : "";
  // 本轮已收口（done/error）的 key：订阅已取消但历史可能还没翻转，用它阻止误报 watching。
  // watchKey 变化（换会话/离开）时在渲染期复位，避免旧收口状态挡住新订阅。
  const [settled, setSettled] = useState<{ key: string } | null>(null);
  if (settled !== null && settled.key !== watchKey) setSettled(null);
  // 实时事件按 watchKey 归属；key 变化时旧值在渲染期视为空，不在 effect 里同步 setState。
  const [stream, setStream] = useState<{
    key: string;
    text: string;
    events: ChatTimelineItemView[];
  }>({ key: "", text: "", events: [] });

  useEffect(() => {
    if (ref === null || watchKey === "") return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    // 终态或出错都收口：保留已展示的实时事件，由历史重读接管。
    const settle = () => {
      if (cancelled) return;
      cancelled = true;
      unsubscribe?.();
      setSettled({ key: watchKey });
      onSettledRef.current();
    };

    getDesktopHost()
      .chats.subscribe(ref, (event) => {
        if (cancelled) return;
        if (event.type === "token") {
          setStream((previous) =>
            previous.key === watchKey
              ? { ...previous, text: previous.text + event.text }
              : { key: watchKey, text: event.text, events: [] },
          );
        } else if (event.type === "timeline") {
          setStream((previous) => {
            const base =
              previous.key === watchKey ? previous : { key: watchKey, text: "", events: [] };
            const index = base.events.findIndex((item) => item.id === event.item.id);
            // 完整的 assistant 消息到达后，流式文本已由时间线条目接管；
            // 不清空会让同一条回复以「消息 + 流式气泡」双重渲染（百炼会先发 delta 再发完整消息）。
            const text =
              event.item.kind === "message" && event.item.role === "assistant"
                ? ""
                : base.text;
            if (index < 0) return { ...base, text, events: [...base.events, event.item] };
            return {
              ...base,
              text,
              events: base.events.map((item, itemIndex) =>
                itemIndex === index ? event.item : item,
              ),
            };
          });
        } else {
          settle();
        }
      })
      .then((unsub) => {
        if (cancelled) {
          unsub();
          return;
        }
        unsubscribe = unsub;
      })
      .catch(() => settle());

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // watchKey 已包含 ref 身份与 running 判定；只在二者翻转时重建订阅。
  }, [ref, watchKey]);

  const live = watchKey !== "" && settled === null;
  const current = stream.key === watchKey ? stream : null;
  return {
    watching: live,
    streamingText: current?.text ?? "",
    liveEvents: current?.events ?? [],
  };
}
