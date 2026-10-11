import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BotRef,
  BotView,
  ConnectionId,
  CreateBotInput,
  HostError,
  UpdateBotInput,
} from "@shared/models";
import { isHostError } from "@shared/errors";
import { getDesktopHost } from "../../desktop-host";

export interface UseBotsResult {
  bots: BotView[];
  loading: boolean;
  error: HostError | null;
  reload(): void;
  /**
   * 更新或重新同步 managed Bot。update 有字段时走 bots.update，否则走 bots.sync。
   * 写入成功后等待读回。写入错误由调用方展示；读回错误进入目录 error，不诱导重复写入。
   */
  save(ref: BotRef, input: UpdateBotInput | "sync"): Promise<HostError | null>;
  /**
   * 归档 Managed Bot：成功返回 null 并触发 reload（重读 Provider 事实，不做乐观删除）；
   * HostError 原样返回，未知错误收敛为 unavailable。请求互斥由页面 pending 状态保证。
   */
  archive(ref: BotRef): Promise<HostError | null>;
  setShared(ref: BotRef, shared: boolean): Promise<HostError | null>;
  /**
   * 创建 Bot：同一 Connection 同时只允许一个创建请求。
   * 成功后触发 reload 并返回新 BotView；失败时返回错误并保留输入。
   */
  create(input: CreateBotInput): Promise<{ bot: BotView | null; error: HostError | null }>;
}

interface ListState {
  connectionId: ConnectionId | null;
  bots: BotView[];
  loading: boolean;
  error: HostError | null;
}

/** 目录刷新可等待；连接切换或更新的请求使旧读回失效。 */
export function useBots(connectionId: ConnectionId | null): UseBotsResult {
  const [state, setState] = useState<ListState>({ connectionId, bots: [], loading: connectionId !== null, error: null });
  const activeConnection = useRef<{ id: ConnectionId } | null>(null);
  const requestId = useRef(0);
  const creatingRef = useRef(false);

  const refresh = useCallback(async (afterSync = false) => {
    const active = activeConnection.current;
    if (!active || active.id !== connectionId) return;
    const request = ++requestId.current;
    setState((previous) => ({
      connectionId, bots: previous.connectionId === connectionId ? previous.bots : [], loading: true, error: null,
    }));
    try {
      const bots = await getDesktopHost().bots.list(active.id);
      if (activeConnection.current === active && requestId.current === request) {
        setState({ connectionId, bots, loading: false, error: null });
      }
    } catch (error) {
      if (activeConnection.current === active && requestId.current === request) {
        setState((previous) => ({
          ...previous, loading: false,
          error: {
            code: isHostError(error) ? error.code : "unavailable",
            message: afterSync
              ? "配置已同步，助手列表未更新。请刷新列表确认最新状态，无需重复同步。"
              : previous.bots.length > 0
                ? "助手列表未更新。当前显示上次加载的结果，请重试刷新。"
                : "未能加载助手列表，请重试刷新。",
          },
        }));
      }
    }
  }, [connectionId]);
  const reload = useCallback(() => refresh(), [refresh]);

  useEffect(() => {
    activeConnection.current = connectionId === null ? null : { id: connectionId };
    void reload();
    return () => { activeConnection.current = null; requestId.current += 1; };
  }, [connectionId, reload]);

  const save = useCallback(
    async (ref: BotRef, input: UpdateBotInput | "sync"): Promise<HostError | null> => {
      const active = activeConnection.current;
      try {
        if (input === "sync") {
          await getDesktopHost().bots.sync(ref);
        } else {
          await getDesktopHost().bots.update(ref, input);
        }
        if (activeConnection.current === active) await refresh(true);
        return null;
      } catch (e: unknown) {
        return isHostError(e) ? e : { code: "unavailable", message: "save bot failed" };
      }
    },
    [refresh],
  );

  const setShared = useCallback(
    async (ref: BotRef, shared: boolean): Promise<HostError | null> => {
      const active = activeConnection.current;
      try {
        await getDesktopHost().bots.setShared(ref, shared);
        if (activeConnection.current === active) await refresh(true);
        return null;
      } catch (e: unknown) {
        return isHostError(e) ? e : { code: "unavailable", message: "share bot failed" };
      }
    },
    [refresh],
  );

  const create = useCallback(
    async (input: CreateBotInput): Promise<{ bot: BotView | null; error: HostError | null }> => {
      if (connectionId === null) {
        return { bot: null, error: { code: "not-connected", message: "未选择 Connection。" } };
      }
      if (creatingRef.current) {
        return { bot: null, error: { code: "conflict", message: "创建请求进行中，请稍候。" } };
      }
      creatingRef.current = true;
      try {
        const bot = await getDesktopHost().bots.create(connectionId, input);
        reload();
        return { bot, error: null };
      } catch (e: unknown) {
        return {
          bot: null,
          error: isHostError(e) ? e : { code: "unavailable", message: "create bot failed" },
        };
      } finally {
        creatingRef.current = false;
      }
    },
    [connectionId, reload],
  );

  const archive = useCallback(
    async (ref: BotRef): Promise<HostError | null> => {
      try {
        await getDesktopHost().bots.archive(ref);
        reload();
        return null;
      } catch (e: unknown) {
        return isHostError(e) ? e : { code: "unavailable", message: "archive bot failed" };
      }
    },
    [reload],
  );

  if (state.connectionId !== connectionId) {
    return { bots: [], loading: connectionId !== null, error: null, reload, save, create, archive, setShared };
  }
  return { bots: state.bots, loading: state.loading, error: state.error, reload, save, create, archive, setShared };
}
