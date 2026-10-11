import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BotView, ChatRef, ChatView, HostError } from "@shared/models";
import { isHostError } from "@shared/errors";
import { getDesktopHost } from "../../desktop-host";

export interface ChatRosterItem {
  bot: BotView;
  chat: ChatView;
}

/** 单个 Bot 的 chats.list 读取状态。 */
export type ChatRosterBotStatus = "loading" | "loaded" | "error";

export interface UseChatRosterResult {
  items: ChatRosterItem[];
  /**
   * 每个当前 Bot 的读取状态，key 为 `${connectionId}/${agentId}`。
   * 只有 `loaded` 且零 Chat 的 Bot 才能被分类为「尚无 Chat」；loading/error 不可误判为空。
   */
  botStatusByKey: ReadonlyMap<string, ChatRosterBotStatus>;
  /** 首次加载（无任何缓存可显示）时为 true；后台刷新见 refreshing。 */
  loading: boolean;
  /** 已有列表内容时的后台刷新中；列表保持可见。 */
  refreshing: boolean;
  /** 当前一轮跨 Bot 聚合的可见进度；失败 Bot 也计入 completedBots。 */
  progress: {
    completedBots: number;
    totalBots: number;
    failedBots: number;
  };
  error: HostError | null;
  reload(): void;
  /** 身份边界变化（如更换凭据）后使用：丢弃乐观条目与缓存并重新读取。 */
  reset(): void;
  /** Session 创建成功后立即进入左侧列表；远程 list 最终一致后自动去重。 */
  upsert(bot: BotView, chat: ChatView): void;
  /** 归档/删除成功后乐观移除条目并同步失效缓存，避免 reload 间隙显示已删除的 Chat。 */
  remove(ref: ChatRef): void;
}

/** 单个 Bot 的 list 超时上限；超时按该 Bot 失败处理，不阻塞其他 Bot。 */
const PER_BOT_TIMEOUT_MS = 8_000;

/**
 * 跨 Connection 切换时保留的内存缓存：切回已加载过的 Bot 集合时先展示缓存，
 * 后台静默刷新。只存 Renderer 内存，符合 Renderer 状态可丢弃的约定。
 */
const rosterCache = new Map<string, ChatRosterItem[]>();

function botListKey(bots: BotView[]): string {
  return bots.map((bot) => botIdentityKey(bot.ref)).join("|");
}

function botIdentityKey(ref: { connectionId: string; agentId: string }): string {
  return `${ref.connectionId}/${ref.agentId}`;
}

function chatIdentityKey(ref: ChatRef): string {
  return `${botIdentityKey(ref)}/${ref.sessionId}`;
}

function updatedAtValue(chat: ChatView): number {
  if (!chat.updatedAt) return 0;
  const parsed = Date.parse(chat.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortRoster(items: ChatRosterItem[]): ChatRosterItem[] {
  return items.sort((left, right) => updatedAtValue(right.chat) - updatedAtValue(left.chat));
}

function toHostError(reason: unknown): HostError {
  return isHostError(reason) ? reason : { code: "unavailable", message: "list chats failed" };
}

async function listBotChats(bot: BotView): Promise<{ bot: BotView; chats: ChatView[] }> {
  const chats = await getDesktopHost().chats.list(bot.ref);
  return { bot, chats };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject({ code: "unavailable", message: "list chats timed out" } satisfies HostError);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason: unknown) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

/** 跨当前 Connection 的 Bot 聚合远程 Session；结果只存在 Renderer 内存。 */
export function useChatRoster(bots: BotView[]): UseChatRosterResult {
  const [generation, setGeneration] = useState(0);
  const optimisticItems = useRef(new Map<string, ChatRosterItem>());
  const botsKey = botListKey(bots);
  const key = `${botsKey}:${generation}`;
  const [state, setState] = useState<{
    key: string;
    items: ChatRosterItem[];
    pending: number;
    error: HostError | null;
    botStatusByKey: ReadonlyMap<string, ChatRosterBotStatus>;
  }>(() => {
    const cached = bots.length > 0 ? rosterCache.get(botsKey) : undefined;
    return {
      key,
      items: cached !== undefined ? sortRoster([...cached]) : [],
      pending: new Set(bots.map((bot) => botIdentityKey(bot.ref))).size,
      error: null,
      botStatusByKey: new Map(bots.map((bot) => [botIdentityKey(bot.ref), "loading" as const])),
    };
  });

  useEffect(() => {
    if (bots.length === 0) {
      rosterCache.delete(botsKey);
      const timer = window.setTimeout(() => {
        setState({ key, items: [], pending: 0, error: null, botStatusByKey: new Map() });
      }, 0);
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;
    // 每个 Bot 一返回就合并进列表：慢 Bot 不阻塞快 Bot 的渲染。
    const pendingAgents = new Set(bots.map((bot) => botIdentityKey(bot.ref)));
    for (const bot of bots) {
      const identity = botIdentityKey(bot.ref);
      const task = withTimeout(listBotChats(bot), PER_BOT_TIMEOUT_MS).then(
        ({ chats }) => {
          if (cancelled) return;
          const currentBotKeys = new Set(bots.map((entry) => botIdentityKey(entry.ref)));
          setState((previous) => {
            // key 迁移：旧列表作为 stale 基底保留，新数据逐个 Bot 覆盖。
            const base =
              previous.key === key
                ? previous
                : {
                    key,
                    items: previous.items.filter((item) =>
                      currentBotKeys.has(botIdentityKey(item.bot.ref)),
                    ),
                    pending: pendingAgents.size,
                    error: null,
                    // key 迁移（含 reload/Connection 切换）后，未完成的 Bot 统一回到 loading。
                    botStatusByKey: new Map(
                      bots.map((entry) => [botIdentityKey(entry.ref), "loading" as const]),
                    ),
                  };
            // 该 Bot 的乐观项：远程已出现则去重删除；尚未出现则保留在列表中。
            const keptOptimistic: ChatRosterItem[] = [];
            for (const [chatKey, item] of optimisticItems.current) {
              if (!currentBotKeys.has(botIdentityKey(item.bot.ref))) {
                optimisticItems.current.delete(chatKey);
              } else if (botIdentityKey(item.bot.ref) === identity) {
                if (chats.some((chat) => chatIdentityKey(chat.ref) === chatKey)) {
                  optimisticItems.current.delete(chatKey);
                } else {
                  keptOptimistic.push(item);
                }
              }
            }
            const next = sortRoster([
              ...base.items.filter((item) => botIdentityKey(item.bot.ref) !== identity),
              ...chats.map((chat) => ({ bot, chat })),
              ...keptOptimistic,
            ]);
            rosterCache.set(botsKey, next);
            const botStatusByKey = new Map(base.botStatusByKey);
            botStatusByKey.set(identity, "loaded");
            return { ...base, items: next, botStatusByKey };
          });
        },
        (reason: unknown) => {
          if (cancelled) return;
          const error = toHostError(reason);
          const currentBotKeys = new Set(bots.map((entry) => botIdentityKey(entry.ref)));
          setState((previous) => {
            const base =
              previous.key === key
                ? { ...previous, error: previous.error ?? error }
                : {
                    key,
                    items: previous.items.filter((item) =>
                      currentBotKeys.has(botIdentityKey(item.bot.ref)),
                    ),
                    pending: pendingAgents.size,
                    error,
                    botStatusByKey: new Map(
                      bots.map((entry) => [botIdentityKey(entry.ref), "loading" as const]),
                    ),
                  };
            const botStatusByKey = new Map(base.botStatusByKey);
            botStatusByKey.set(identity, "error");
            return { ...base, botStatusByKey };
          });
        },
      );
      task
        .catch(() => undefined)
        .then(() => {
          pendingAgents.delete(identity);
          if (cancelled) return;
          setState((previous) =>
            previous.key === key ? { ...previous, pending: pendingAgents.size } : previous,
          );
        });
    }

    return () => {
      cancelled = true;
    };
    // botsKey captures remote identities without depending on unstable array/object references.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => {
    // reload 把当前 Bot 全部重置为 loading：加载中状态不可被分类为空 Bot，但保留缓存展示。
    setState((previous) => ({
      ...previous,
      botStatusByKey: new Map(bots.map((bot) => [botIdentityKey(bot.ref), "loading" as const])),
    }));
    setGeneration((value) => value + 1);
    // bots 引用变化时由 effect 重建 key；此处只需触发新一代。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botsKey]);
  const reset = useCallback(() => {
    // 凭据等身份边界变化：旧范围的乐观条目在新范围永远读不回，必须丢弃，
    // 否则按「尚未出现则保留」规则永久残留。
    optimisticItems.current.clear();
    rosterCache.delete(botsKey);
    setState((previous) => ({
      ...previous,
      botStatusByKey: new Map(bots.map((bot) => [botIdentityKey(bot.ref), "loading" as const])),
    }));
    setGeneration((value) => value + 1);
    // 与 reload 相同：bots 引用变化由 effect 重建 key，此处只触发新一代。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botsKey]);
  const upsert = useCallback(
    (bot: BotView, chat: ChatView) => {
      const item = { bot, chat };
      setState((previous) => {
        // key 迁移期间不写乐观 ref，避免污染其他 Connection 的合并逻辑。
        if (previous.key !== key) return previous;
        const chatKey = chatIdentityKey(chat.ref);
        optimisticItems.current.set(chatKey, item);
        const next = sortRoster([
          item,
          ...previous.items.filter((existing) => chatIdentityKey(existing.chat.ref) !== chatKey),
        ]);
        rosterCache.set(botsKey, next);
        // upsert 成功后该 Bot 立即视为 loaded：新建后从空 Bot 分组移入主树，不等远程列表最终一致。
        const botStatusByKey = new Map(previous.botStatusByKey);
        botStatusByKey.set(botIdentityKey(bot.ref), "loaded");
        return { ...previous, items: next, botStatusByKey };
      });
    },
    [key, botsKey],
  );
  const remove = useCallback(
    (ref: ChatRef) => {
      const chatKey = chatIdentityKey(ref);
      optimisticItems.current.delete(chatKey);
      setState((previous) => {
        if (previous.key !== key) return previous;
        const next = previous.items.filter((item) => chatIdentityKey(item.chat.ref) !== chatKey);
        rosterCache.set(botsKey, next);
        // 删除最后一个已知 Chat 后：仅当该 Bot 已是 loaded 才立即进入空 Bot 分组，
        // 否则等待下一次成功列表结果（不在这里改状态，由下一次 loaded/error 决定）。
        return { ...previous, items: next };
      });
    },
    [key, botsKey],
  );
  const current = state.key === key;

  return useMemo(() => {
    // key 迁移间隙（state 尚未追上当前 key）时显示缓存，避免切换 Connection 闪烁空白。
    const items = current ? state.items : (rosterCache.get(botsKey) ?? []);
    const pending = current
      ? state.pending
      : new Set(bots.map((bot) => botIdentityKey(bot.ref))).size;
    // key 迁移间隙：新 Bot 集合尚未产生状态，统一视为 loading（不可分类为空 Bot）。
    const botStatusByKey = current
      ? state.botStatusByKey
      : new Map(bots.map((bot) => [botIdentityKey(bot.ref), "loading" as const]));
    const totalBots = new Set(bots.map((bot) => botIdentityKey(bot.ref))).size;
    const failedBots = [...botStatusByKey.values()].filter((status) => status === "error").length;
    return {
      items,
      botStatusByKey,
      loading: pending > 0 && items.length === 0,
      refreshing: pending > 0 && items.length > 0,
      progress: {
        completedBots: Math.max(0, totalBots - pending),
        totalBots,
        failedBots,
      },
      error: current ? state.error : null,
      reload,
      reset,
      upsert,
      remove,
    };
  }, [
    bots,
    botsKey,
    current,
    reload,
    reset,
    remove,
    state.botStatusByKey,
    state.error,
    state.items,
    state.pending,
    upsert,
  ]);
}
