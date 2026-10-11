import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BotRef,
  ChatDetailView,
  ChatRef,
  ChatTimelineItemView,
  ChatView,
  HostError,
  MessageAttachment,
} from "@shared/models";
import { isHostError } from "@shared/errors";
import { getDesktopHost } from "../../desktop-host";

export interface UseChatsResult {
  chats: ChatView[];
  loading: boolean;
  error: HostError | null;
  reload(): void;
}

interface ListState {
  key: string;
  chats: ChatView[];
  loading: boolean;
  error: HostError | null;
}

function botKey(bot: BotRef | null): string {
  return bot === null ? "" : `${bot.connectionId}/${bot.agentId}`;
}

/** 列出指定 Bot 下的远程 Session；bot 变化时重新查询。 */
export function useChats(bot: BotRef | null): UseChatsResult {
  const [generation, setGeneration] = useState(0);
  const key = `${botKey(bot)}:${generation}`;
  const [state, setState] = useState<ListState>({
    key,
    chats: [],
    loading: bot !== null,
    error: null,
  });

  useEffect(() => {
    if (bot === null) return;
    let cancelled = false;
    getDesktopHost()
      .chats.list(bot)
      .then((chats) => {
        if (!cancelled) setState({ key, chats, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState((previous) => ({
            key,
            chats: previous.key.split(":")[0] === botKey(bot) ? previous.chats : [],
            loading: false,
            error: isHostError(e) ? e : { code: "unavailable", message: "list chats failed" },
          }));
        }
      });
    return () => {
      cancelled = true;
    };
    // bot 为 ref 对象；key 已捕获其身份，避免父组件内联对象导致重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  if (state.key !== key) {
    const sameBot = state.key.split(":")[0] === botKey(bot);
    return {
      chats: sameBot ? state.chats : [],
      loading: bot !== null,
      error: null,
      reload,
    };
  }
  return { chats: state.chats, loading: state.loading, error: state.error, reload };
}

export interface UseChatDetailResult {
  detail: ChatDetailView | null;
  loading: boolean;
  error: HostError | null;
  reload(): void;
  /** 用最新 ChatView 就地更新详情，不触发远程重读。 */
  updateChat(chat: ChatView): void;
}

interface DetailState {
  key: string;
  detail: ChatDetailView | null;
  loading: boolean;
  error: HostError | null;
}

/** 读取一个 Chat 的完整远程历史；chat 身份变化时重新查询。 */
export function useChatDetail(
  connectionId: string | null,
  agentId: string | null,
  sessionId: string | null,
): UseChatDetailResult {
  const [generation, setGeneration] = useState(0);
  const chatKey =
    connectionId === null || agentId === null || sessionId === null
      ? ""
      : `${connectionId}/${agentId}/${sessionId}`;
  const key = `${chatKey}:${generation}`;
  const [state, setState] = useState<DetailState>({
    key,
    detail: null,
    loading: chatKey !== "",
    error: null,
  });

  useEffect(() => {
    if (connectionId === null || agentId === null || sessionId === null) return;
    let cancelled = false;
    getDesktopHost()
      .chats.get({ connectionId, agentId, sessionId })
      .then((detail) => {
        if (!cancelled) setState({ key, detail, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState((previous) => ({
            key,
            detail: previous.key.split(":")[0] === chatKey ? previous.detail : null,
            loading: false,
            error: isHostError(e) ? e : { code: "unavailable", message: "get chat failed" },
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, agentId, sessionId, chatKey, key]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  const updateChat = useCallback((chat: ChatView) => {
    setState((previous) => {
      if (previous.detail === null) return previous;
      const current = previous.detail.chat.ref;
      if (
        current.connectionId !== chat.ref.connectionId ||
        current.agentId !== chat.ref.agentId ||
        current.sessionId !== chat.ref.sessionId
      ) {
        return previous;
      }
      return { ...previous, detail: { ...previous.detail, chat } };
    });
  }, []);

  if (state.key !== key) {
    const sameChat = state.key.split(":")[0] === chatKey;
    return {
      detail: sameChat ? state.detail : null,
      loading: chatKey !== "",
      error: null,
      reload,
      updateChat,
    };
  }
  return { detail: state.detail, loading: state.loading, error: state.error, reload, updateChat };
}

export interface UseChatSendResult {
  /** 是否正在发送/等待本轮回复结束（同一 Chat 同时只允许一个发送动作）。 */
  sending: boolean;
  /** SSE 累积的临时增量文本；仅展示用，最终内容以重读的远程历史为准。 */
  streamingText: string;
  /** 当前发送轮次中尚未由历史校准的实时事件。 */
  liveEvents: ChatTimelineItemView[];
  error: HostError | null;
  /** Provider 接受消息后返回 true；订阅或发送失败时返回 false。 */
  send(text: string, attachments?: MessageAttachment[]): Promise<boolean>;
}

/** 发送超时上限：超过后判定本轮失败，取消订阅并重读历史。 */
const SEND_TIMEOUT_MS = 120_000;

function attachmentKind(attachment: MessageAttachment): "image" | "video" | "file" {
  const mimeType = attachment.mimeType ?? "";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

/**
 * 单 Chat 发送 + 流式展示。
 * 核心时序：等待订阅建立 → 调用 send 一次 → 消费事件 → 收口。
 * 门禁：sending 为 true 时忽略后续 send。
 * 所有分支（send 失败、SSE error、done、流自然结束、超时、切换 Chat）都取消订阅、
 * 解除发送门禁并重读远程历史；成功结果保留到远程历史接管展示。不自动重发。
 */
export function useChatSend(ref: ChatRef | null, onSettled: () => void): UseChatSendResult {
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [liveEvents, setLiveEvents] = useState<ChatTimelineItemView[]>([]);
  const [error, setError] = useState<HostError | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingTextRef = useRef("");
  const pendingAssistantEventIdRef = useRef("");
  const turnSettledRef = useRef(true);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  const refKey = ref === null ? "" : `${ref.connectionId}/${ref.agentId}/${ref.sessionId}`;

  // 清理当前轮次：取消订阅 + 清除超时 + 复位状态。
  const cleanup = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // ref 切换（换 Chat/卸载）时取消悬挂订阅并复位。
  useEffect(() => {
    return () => {
      cleanup();
      setSending(false);
      streamingTextRef.current = "";
      pendingAssistantEventIdRef.current = "";
      turnSettledRef.current = true;
      setStreamingText("");
      setLiveEvents([]);
      setError(null);
    };
  }, [refKey, cleanup]);

  /** 本轮结束：成功时保留实时结果到远程历史重读完成，失败时撤销乐观事件。 */
  const settle = useCallback(
    (outcome: "done" | "error", err?: HostError) => {
      if (turnSettledRef.current) return;
      turnSettledRef.current = true;
      cleanup();
      setSending(false);
      const completedText = streamingTextRef.current;
      streamingTextRef.current = "";
      setStreamingText("");
      if (outcome === "done") {
        if (completedText.length > 0) {
          const assistantId = pendingAssistantEventIdRef.current;
          setLiveEvents((previous) => {
            if (
              previous.some(
                (item) => item.kind === "message" && item.role === "assistant",
              )
            ) {
              return previous;
            }
            return [
              ...previous,
              {
                id: assistantId,
                rawType: "agent.message",
                kind: "message",
                role: "assistant",
                content: completedText,
              },
            ];
          });
        }
      } else {
        setLiveEvents([]);
      }
      pendingAssistantEventIdRef.current = "";
      if (outcome === "error" && err !== undefined) {
        setError(err);
      }
      onSettledRef.current();
    },
    [cleanup],
  );

  const send = useCallback(
    async (text: string, attachments?: MessageAttachment[]): Promise<boolean> => {
      if (ref === null || sending) return false;
      setSending(true);
      setError(null);
      turnSettledRef.current = false;
      streamingTextRef.current = "";
      setStreamingText("");
      const pendingUserEventId = `pending-user:${Date.now()}`;
      pendingAssistantEventIdRef.current = `pending-assistant:${pendingUserEventId}`;
      const pendingAttachments = (attachments ?? []).map((attachment) => ({
        fileId: attachment.fileId,
        filename: attachment.filename,
        kind: attachmentKind(attachment),
      }));
      setLiveEvents([
        {
          id: pendingUserEventId,
          rawType: "user.message",
          kind: "message",
          role: "user",
          content: text,
          ...(pendingAttachments.length > 0 ? { attachments: pendingAttachments } : {}),
        },
      ]);

      // 步骤 1：等待订阅建立（SSE 握手）。失败则直接收口。
      let unsubscribe: () => void;
      try {
        unsubscribe = await getDesktopHost().chats.subscribe(ref, (event) => {
          if (event.type === "token") {
            streamingTextRef.current += event.text;
            setStreamingText(streamingTextRef.current);
          } else if (event.type === "timeline") {
            setLiveEvents((previous) => {
              if (
                event.item.kind === "message" &&
                event.item.role === "user" &&
                event.item.content === text
              ) {
                const pendingIndex = previous.findIndex((item) => item.id === pendingUserEventId);
                if (pendingIndex >= 0) {
                  const pending = previous[pendingIndex];
                  const replacement = pending?.kind === "message" && pending.attachments
                    ? { ...event.item, attachments: pending.attachments }
                    : event.item;
                  return previous.map((item, index) => index === pendingIndex ? replacement : item);
                }
              }
              const index = previous.findIndex((item) => item.id === event.item.id);
              if (index < 0) return [...previous, event.item];
              return previous.map((item, itemIndex) => itemIndex === index ? event.item : item);
            });
          } else if (event.type === "done") {
            settle("done");
          } else {
            settle("error", event.error ?? { code: "unavailable", message: "stream error" });
          }
        });
      } catch (e) {
        turnSettledRef.current = true;
        pendingAssistantEventIdRef.current = "";
        setSending(false);
        setLiveEvents([]);
        setError(isHostError(e) ? e : { code: "unavailable", message: "subscribe failed" });
        onSettledRef.current();
        return false;
      }
      unsubRef.current = unsubscribe;

      // 步骤 2：订阅已建立，调用 send 一次。失败也必须取消订阅。
      try {
        await getDesktopHost().chats.send(ref, text, attachments);
      } catch (e) {
        if (turnSettledRef.current) return true;
        settle("error", isHostError(e) ? e : { code: "unavailable", message: "send failed" });
        return false;
      }

      // 步骤 3：启动超时保护。超时后取消订阅、解除门禁、重读历史。
      if (!turnSettledRef.current) {
        timeoutRef.current = setTimeout(() => {
          settle("error", { code: "unavailable", message: "send timed out" });
        }, SEND_TIMEOUT_MS);
      }
      return true;
    },
    [ref, sending, settle],
  );

  return { sending, streamingText, liveEvents, error, send };
}

export interface UseChatArchiveResult {
  archiving: boolean;
  error: HostError | null;
  archive(ref: ChatRef): Promise<void>;
}

/** 归档远程 Chat；由 UI 在成功后 reload 列表或跳转。 */
export function useChatArchive(): UseChatArchiveResult {
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<HostError | null>(null);

  const archive = useCallback(async (ref: ChatRef): Promise<void> => {
    setArchiving(true);
    setError(null);
    try {
      await getDesktopHost().chats.archive(ref);
    } catch (e) {
      const normalized = isHostError(e)
        ? e
        : ({ code: "unavailable", message: "archive chat failed" } satisfies HostError);
      setError(normalized);
      throw normalized;
    } finally {
      setArchiving(false);
    }
  }, []);

  return { archiving, error, archive };
}

export interface UseChatSharingResult {
  sharing: boolean;
  error: HostError | null;
  setShared(ref: ChatRef, shared: boolean): Promise<ChatView>;
}

export function useChatSharing(): UseChatSharingResult {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<HostError | null>(null);

  const setShared = useCallback(async (ref: ChatRef, shared: boolean): Promise<ChatView> => {
    setSharing(true);
    setError(null);
    try {
      return await getDesktopHost().chats.setShared(ref, shared);
    } catch (cause) {
      const normalized = isHostError(cause)
        ? cause
        : ({ code: "unavailable", message: "share chat failed" } satisfies HostError);
      setError(normalized);
      throw normalized;
    } finally {
      setSharing(false);
    }
  }, []);

  return { sharing, error, setShared };
}

export interface UseChatDeleteResult {
  deleting: boolean;
  error: HostError | null;
  deleteChat(ref: ChatRef): Promise<void>;
}

/** 删除远程 Chat；不可逆，UI 必须二次确认。 */
export function useChatDelete(): UseChatDeleteResult {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<HostError | null>(null);

  const deleteChat = useCallback(async (ref: ChatRef): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      await getDesktopHost().chats.delete(ref);
    } catch (e) {
      const normalized = isHostError(e)
        ? e
        : ({ code: "unavailable", message: "delete chat failed" } satisfies HostError);
      setError(normalized);
      throw normalized;
    } finally {
      setDeleting(false);
    }
  }, []);

  return { deleting, error, deleteChat };
}

