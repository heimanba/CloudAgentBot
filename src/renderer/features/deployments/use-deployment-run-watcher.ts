/**
 * 定时任务执行完成通知（ADR-0010：轮询感知，无 webhook）。
 * 每 60s 拉取当前连接全部可见 Deployment 的运行记录，检测 running → 终态的迁移，
 * 经系统 Notification 告知用户。首轮只建立基线不通知；状态只存在 Renderer 内存。
 */
import { useEffect, useRef } from "react";
import type { ConnectionId, DeploymentRunView } from "@shared/models";
import { getDesktopHost } from "../../desktop-host";
import { supportsDeployments } from "./deployment-support";

const POLL_INTERVAL_MS = 60_000;

function terminalText(run: DeploymentRunView): string | null {
  if (run.status === "succeeded") return "执行完成";
  if (run.status === "failed") return "执行失败";
  return null;
}

export function useDeploymentRunWatcher(
  connectionId: ConnectionId | null,
  provider: string | undefined,
  /** 运行记录出现新会话或进入终态时回调：调用方应刷新 Chat 列表。 */
  onActivity?: () => void,
): void {
  const onActivityRef = useRef(onActivity);
  useEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);

  useEffect(() => {
    if (connectionId === null || !supportsDeployments(provider)) return;
    if (typeof Notification === "undefined") return;
    let cancelled = false;
    // runId → 已知状态；首轮播种不通知。
    const known = new Map<string, DeploymentRunView["status"]>();
    let seeded = false;

    const notify = (deploymentName: string, run: DeploymentRunView) => {
      const text = terminalText(run);
      if (text === null) return;
      if (Notification.permission !== "granted") return;
      const notification = new Notification(`定时任务${text}`, {
        body: `${deploymentName} · ${text}`,
        tag: run.id,
      });
      notification.onclick = () => window.focus();
    };

    const poll = async () => {
      try {
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
        const deployments = await getDesktopHost().deployments.list(connectionId);
        let activity = false;
        for (const deployment of deployments) {
          if (cancelled) return;
          const runs = await getDesktopHost().deployments.listRuns(deployment.ref);
          for (const run of runs) {
            const previous = known.get(run.id);
            known.set(run.id, run.status);
            if (!seeded) continue;
            // 播种后出现的新 Run 关联了新会话；running → 终态意味着标题/时间线已定型。
            if (previous === undefined && run.sessionId !== undefined) activity = true;
            if (previous === "running" && (run.status === "succeeded" || run.status === "failed")) {
              activity = true;
              notify(deployment.name, run);
            }
          }
        }
        seeded = true;
        if (activity && !cancelled) onActivityRef.current?.();
      } catch {
        // 轮询失败静默跳过本轮；状态基线保留，下一轮继续。
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connectionId, provider]);
}
