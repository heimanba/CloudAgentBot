/**
 * Bot 详情页「定时任务」区块的数据 hook。
 * 与 use-bots 同模式：写入成功后 reload 重读 Provider 事实，不做乐观更新；
 * 写入错误由调用方展示，读回错误进入区块 error。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BotRef,
  ConnectionId,
  CreateDeploymentInput,
  DeploymentRef,
  DeploymentRunView,
  DeploymentView,
  HostError,
  UpdateDeploymentInput,
} from "@shared/models";
import { isHostError } from "@shared/errors";
import { getDesktopHost } from "../../desktop-host";
import { supportsDeployments } from "./deployment-support";

export interface UseDeploymentsResult {
  deployments: DeploymentView[];
  loading: boolean;
  error: HostError | null;
  reload(): void;
  create(
    input: Omit<CreateDeploymentInput, "agentId"> & { agentId?: string },
  ): Promise<HostError | null>;
  update(ref: DeploymentRef, input: UpdateDeploymentInput): Promise<HostError | null>;
  setShared(ref: DeploymentRef, shared: boolean): Promise<HostError | null>;
  pause(ref: DeploymentRef): Promise<HostError | null>;
  unpause(ref: DeploymentRef): Promise<HostError | null>;
  archive(ref: DeploymentRef): Promise<HostError | null>;
  run(
    ref: DeploymentRef,
  ): Promise<{ run: DeploymentRunView | null; error: HostError | null }>;
  listRuns(ref: DeploymentRef): Promise<{ runs: DeploymentRunView[]; error: HostError | null }>;
  /** 触发后轮询运行记录，等 Run 关联的 Session 异步创建完成；超时或终态仍无会话返回 null。 */
  waitRunSession(
    ref: DeploymentRef,
    runId: string,
    options?: { intervalMs?: number; attempts?: number },
  ): Promise<string | null>;
}

function toError(error: unknown, message: string): HostError {
  return isHostError(error) ? error : { code: "unavailable", message };
}

async function pollForRunSession(
  fetchRuns: (
    ref: DeploymentRef,
  ) => Promise<{ runs: DeploymentRunView[]; error: HostError | null }>,
  ref: DeploymentRef,
  runId: string,
  options?: { intervalMs?: number; attempts?: number },
): Promise<string | null> {
  const intervalMs = options?.intervalMs ?? 1000;
  const attempts = options?.attempts ?? 15;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    const { runs, error } = await fetchRuns(ref);
    if (error !== null) continue;
    const match = runs.find((run) => run.id === runId);
    if (match?.sessionId !== undefined) return match.sessionId;
    if (match !== undefined && match.status !== "running") return null;
  }
  return null;
}

export function useDeployments(
  botRef: BotRef | null,
  provider: string | undefined,
  reloadEpoch = 0,
): UseDeploymentsResult {
  const supported = supportsDeployments(provider);
  const [state, setState] = useState<{
    key: string | null;
    deployments: DeploymentView[];
    loading: boolean;
    error: HostError | null;
  }>({ key: null, deployments: [], loading: false, error: null });
  const requestId = useRef(0);
  const botKey = botRef === null ? null : `${botRef.connectionId}/${botRef.agentId}`;

  const refresh = useCallback(async () => {
    if (botRef === null || !supported) return;
    const request = ++requestId.current;
    setState((previous) => ({
      key: botKey,
      deployments: previous.key === botKey ? previous.deployments : [],
      loading: true,
      error: null,
    }));
    try {
      const deployments = await getDesktopHost().deployments.list(
        botRef.connectionId,
        botRef.agentId,
      );
      if (requestId.current === request) {
        setState({ key: botKey, deployments, loading: false, error: null });
      }
    } catch (error) {
      if (requestId.current === request) {
        setState((previous) => ({
          ...previous,
          loading: false,
          error: toError(error, "未能加载定时任务列表，请重试。"),
        }));
      }
    }
  }, [botRef, botKey, supported]);

  useEffect(() => {
    void refresh();
  }, [refresh, reloadEpoch]);

  /** 写入统一收尾：成功后 reload 重读 Provider 事实。 */
  const mutate = useCallback(
    async (action: () => Promise<unknown>, message: string): Promise<HostError | null> => {
      try {
        await action();
        await refresh();
        return null;
      } catch (error) {
        return toError(error, message);
      }
    },
    [refresh],
  );

  const create = useCallback(
    async (
      input: Omit<CreateDeploymentInput, "agentId"> & { agentId?: string },
    ): Promise<HostError | null> => {
      if (botRef === null) return { code: "invalid-input", message: "未选择 Bot。" };
      return mutate(
        () =>
          getDesktopHost().deployments.create(botRef.connectionId, {
            agentId: botRef.agentId,
            ...input,
          }),
        "create deployment failed",
      );
    },
    [botRef, mutate],
  );

  const update = useCallback(
    (ref: DeploymentRef, input: UpdateDeploymentInput) =>
      mutate(() => getDesktopHost().deployments.update(ref, input), "update deployment failed"),
    [mutate],
  );
  const setShared = useCallback(
    (ref: DeploymentRef, shared: boolean) =>
      mutate(() => getDesktopHost().deployments.setShared(ref, shared), "share deployment failed"),
    [mutate],
  );
  const pause = useCallback(
    (ref: DeploymentRef) =>
      mutate(() => getDesktopHost().deployments.pause(ref), "pause deployment failed"),
    [mutate],
  );
  const unpause = useCallback(
    (ref: DeploymentRef) =>
      mutate(() => getDesktopHost().deployments.unpause(ref), "unpause deployment failed"),
    [mutate],
  );
  const archive = useCallback(
    (ref: DeploymentRef) =>
      mutate(() => getDesktopHost().deployments.archive(ref), "archive deployment failed"),
    [mutate],
  );
  const run = useCallback(
    async (
      ref: DeploymentRef,
    ): Promise<{ run: DeploymentRunView | null; error: HostError | null }> => {
      try {
        return { run: await getDesktopHost().deployments.run(ref), error: null };
      } catch (error) {
        return { run: null, error: toError(error, "run deployment failed") };
      }
    },
    [],
  );
  const listRuns = useCallback(
    async (
      ref: DeploymentRef,
    ): Promise<{ runs: DeploymentRunView[]; error: HostError | null }> => {
      try {
        return { runs: await getDesktopHost().deployments.listRuns(ref), error: null };
      } catch (error) {
        return { runs: [], error: toError(error, "list deployment runs failed") };
      }
    },
    [],
  );
  const waitRunSession = useCallback(
    (ref: DeploymentRef, runId: string, options?: { intervalMs?: number; attempts?: number }) =>
      pollForRunSession(listRuns, ref, runId, options),
    [listRuns],
  );

  const idle = state.key !== botKey;
  return {
    deployments: idle ? [] : state.deployments,
    loading: idle ? botRef !== null && supported : state.loading,
    error: idle ? null : state.error,
    reload: refresh,
    create,
    update,
    setShared,
    pause,
    unpause,
    archive,
    run,
    listRuns,
    waitRunSession,
  };
}

/**
 * 连接级定时任务总览（侧栏「定时任务」入口页）：跨 Bot 列出全部可见 Deployment。
 * 与 useDeployments 同模式；创建输入由表单携带 agentId（Bot 选择器）。
 */
export function useAllDeployments(
  connectionId: ConnectionId | null,
  provider: string | undefined,
  reloadEpoch = 0,
): UseDeploymentsResult {
  const supported = supportsDeployments(provider);
  const [state, setState] = useState<{
    key: string | null;
    deployments: DeploymentView[];
    loading: boolean;
    error: HostError | null;
  }>({ key: null, deployments: [], loading: false, error: null });
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    if (connectionId === null || !supported) return;
    const request = ++requestId.current;
    setState((previous) => ({
      key: connectionId,
      deployments: previous.key === connectionId ? previous.deployments : [],
      loading: true,
      error: null,
    }));
    try {
      const deployments = await getDesktopHost().deployments.list(connectionId);
      if (requestId.current === request) {
        setState({ key: connectionId, deployments, loading: false, error: null });
      }
    } catch (error) {
      if (requestId.current === request) {
        setState((previous) => ({
          ...previous,
          loading: false,
          error: toError(error, "未能加载定时任务列表，请重试。"),
        }));
      }
    }
  }, [connectionId, supported]);

  useEffect(() => {
    void refresh();
  }, [refresh, reloadEpoch]);

  const mutate = useCallback(
    async (action: () => Promise<unknown>, message: string): Promise<HostError | null> => {
      try {
        await action();
        await refresh();
        return null;
      } catch (error) {
        return toError(error, message);
      }
    },
    [refresh],
  );

  const create = useCallback(
    async (
      input: Omit<CreateDeploymentInput, "agentId"> & { agentId?: string },
    ): Promise<HostError | null> => {
      if (connectionId === null) return { code: "not-connected", message: "未选择连接。" };
      if (input.agentId === undefined || input.agentId.length === 0) {
        return { code: "invalid-input", message: "请选择执行 Bot。" };
      }
      return mutate(
        () =>
          getDesktopHost().deployments.create(connectionId, {
            ...input,
            agentId: input.agentId ?? "",
          }),
        "create deployment failed",
      );
    },
    [connectionId, mutate],
  );

  const update = useCallback(
    (ref: DeploymentRef, input: UpdateDeploymentInput) =>
      mutate(() => getDesktopHost().deployments.update(ref, input), "update deployment failed"),
    [mutate],
  );
  const setShared = useCallback(
    (ref: DeploymentRef, shared: boolean) =>
      mutate(() => getDesktopHost().deployments.setShared(ref, shared), "share deployment failed"),
    [mutate],
  );
  const pause = useCallback(
    (ref: DeploymentRef) =>
      mutate(() => getDesktopHost().deployments.pause(ref), "pause deployment failed"),
    [mutate],
  );
  const unpause = useCallback(
    (ref: DeploymentRef) =>
      mutate(() => getDesktopHost().deployments.unpause(ref), "unpause deployment failed"),
    [mutate],
  );
  const archive = useCallback(
    (ref: DeploymentRef) =>
      mutate(() => getDesktopHost().deployments.archive(ref), "archive deployment failed"),
    [mutate],
  );
  const run = useCallback(
    async (
      ref: DeploymentRef,
    ): Promise<{ run: DeploymentRunView | null; error: HostError | null }> => {
      try {
        return { run: await getDesktopHost().deployments.run(ref), error: null };
      } catch (error) {
        return { run: null, error: toError(error, "run deployment failed") };
      }
    },
    [],
  );
  const listRuns = useCallback(
    async (
      ref: DeploymentRef,
    ): Promise<{ runs: DeploymentRunView[]; error: HostError | null }> => {
      try {
        return { runs: await getDesktopHost().deployments.listRuns(ref), error: null };
      } catch (error) {
        return { runs: [], error: toError(error, "list deployment runs failed") };
      }
    },
    [],
  );
  const waitRunSession = useCallback(
    (ref: DeploymentRef, runId: string, options?: { intervalMs?: number; attempts?: number }) =>
      pollForRunSession(listRuns, ref, runId, options),
    [listRuns],
  );

  const idle = state.key !== connectionId;
  return {
    deployments: idle ? [] : state.deployments,
    loading: idle ? connectionId !== null && supported : state.loading,
    error: idle ? null : state.error,
    reload: refresh,
    create,
    update,
    setShared,
    pause,
    unpause,
    archive,
    run,
    listRuns,
    waitRunSession,
  };
}
