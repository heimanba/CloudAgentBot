/**
 * 定时任务详情 Dialog：执行内容 + 运行记录（running 时 5s 轮询），Run 可跳转关联会话。
 * Bot 详情区块与定时任务总览页共用。
 */

import { useCallback, useEffect, useState } from "react";
import type {
  ChatView,
  DeploymentRef,
  DeploymentRunView,
  DeploymentView,
  HostError,
} from "@shared/models";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  typography,
} from "../../ui/design-system";
import { CalendarClock } from "lucide-react";
import { cn } from "../../lib/utils";
import { describeSchedule } from "./deployment-schedule";

export function formatRunDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function runStatusText(run: DeploymentRunView): string {
  switch (run.status) {
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    default:
      return "运行中";
  }
}

export interface DeploymentDetailDialogProps {
  deployment: DeploymentView | null;
  onClose(): void;
  listRuns(
    ref: DeploymentRef,
  ): Promise<{ runs: DeploymentRunView[]; error: HostError | null }>;
  /** 点击 Run 跳转关联会话；缺省（如 Bot 不可见）时不显示跳转按钮。 */
  onOpenChat?(chat: ChatView): void;
}

export function DeploymentDetailDialog({
  deployment,
  onClose,
  listRuns,
  onOpenChat,
}: DeploymentDetailDialogProps) {
  const [runs, setRuns] = useState<DeploymentRunView[] | null>(null);
  const [runsError, setRunsError] = useState<HostError | null>(null);

  const loadRuns = useCallback(async () => {
    if (deployment === null) return null;
    const result = await listRuns(deployment.ref);
    setRuns(result.error === null ? result.runs : null);
    setRunsError(result.error);
    return result.runs;
  }, [deployment, listRuns]);

  // 打开期间轮询运行记录：有运行中的 Run 时 5s 一轮，否则停止。
  useEffect(() => {
    if (deployment === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const latest = await loadRuns();
      if (cancelled || latest === null) return;
      if (latest.some((run) => run.status === "running")) {
        timer = setTimeout(tick, 5000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [deployment, loadRuns]);

  return (
    <Dialog open={deployment !== null} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[min(720px,calc(100vh-76px))]">
        {deployment !== null ? (
          <>
            <div className="border-b border-border px-5 py-4">
              <DialogTitle>{deployment.name}</DialogTitle>
              <DialogDescription className="mt-1 type-supporting text-muted-foreground">
                {deployment.schedule
                  ? `${describeSchedule(deployment.schedule)}（${deployment.schedule.timezone}）`
                  : "手动触发"}
                {deployment.schedule?.lastRunAt
                  ? ` · 上次执行 ${formatRunDateTime(deployment.schedule.lastRunAt)}`
                  : ""}
              </DialogDescription>
            </div>
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
              <div>
                <p className={cn(typography.caption, "mb-1 text-muted-foreground")}>执行内容</p>
                <p className="type-supporting whitespace-pre-wrap">{deployment.prompt}</p>
              </div>
              <div>
                <p className={cn(typography.caption, "mb-1 text-muted-foreground")}>运行记录</p>
                {runsError !== null ? (
                  <Alert variant="destructive">运行记录加载失败，请稍后重试。</Alert>
                ) : runs === null ? (
                  <p className="type-supporting text-muted-foreground">正在加载…</p>
                ) : runs.length === 0 ? (
                  <p className="type-supporting text-muted-foreground">还没有运行记录。</p>
                ) : (
                  <ul className="grid gap-1.5">
                    {runs.map((run) => (
                      <li
                        key={run.id}
                        className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border px-3 py-2"
                      >
                        <CalendarClock
                          className="size-[14px] shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="type-supporting">
                          {formatRunDateTime(run.startedAt)}
                        </span>
                        <span className="type-caption text-muted-foreground">
                          {run.trigger === "schedule" ? "定时" : "手动"}
                        </span>
                        <span
                          className={cn(
                            "type-caption",
                            run.status === "failed" ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {runStatusText(run)}
                        </span>
                        {run.sessionId !== undefined && onOpenChat !== undefined ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto"
                            onClick={() => {
                              onOpenChat({
                                ref: {
                                  connectionId: deployment.ref.connectionId,
                                  agentId: deployment.ref.agentId,
                                  sessionId: run.sessionId ?? "",
                                },
                                title: deployment.name,
                              });
                              onClose();
                            }}
                          >
                            查看会话
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
