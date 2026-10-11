/**
 * 定时任务总览页（侧栏一级入口）：跨 Bot 列出当前连接全部可见 Deployment，
 * 支持创建（表单内选择执行 Bot）、编辑、暂停/恢复、手动触发、归档与运行记录跳转。
 * 仅支持定时任务的 Provider 渲染（见 supportsDeployments）；其他 Provider 由调用方隐藏入口。
 */

import { useState } from "react";
import type {
  BotView,
  ChatView,
  ConnectionId,
  DeploymentView,
  HostError,
} from "@shared/models";
import {
  Alert,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  typography,
} from "../../ui/design-system";
import {
  Archive,
  CalendarClock,
  History,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Share2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { BotAvatar } from "../../ui/bot-avatar/bot-avatar";
import { useAllDeployments } from "./use-deployments";
import { DeploymentForm } from "./deployment-form";
import { DeploymentDetailDialog, formatRunDateTime } from "./deployment-detail-dialog";
import { describeSchedule, isExpired } from "./deployment-schedule";

export interface DeploymentsPageProps {
  connectionId: ConnectionId;
  provider?: string;
  bots: BotView[];
  botsLoading: boolean;
  reloadEpoch?: number;
  onOpenChat(bot: BotView, chat: ChatView): void;
}

export function DeploymentsPage({
  connectionId,
  provider,
  bots,
  botsLoading,
  reloadEpoch = 0,
  onOpenChat,
}: DeploymentsPageProps) {
  const api = useAllDeployments(connectionId, provider, reloadEpoch);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DeploymentView | null>(null);
  const [detail, setDetail] = useState<DeploymentView | null>(null);
  const [pendingArchive, setPendingArchive] = useState<DeploymentView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<HostError | null>(null);

  // 创建表单的 Bot 候选：排除其他 Key 范围且未共享的 Bot（与 Main 创建校验一致）。
  const creatableBots = bots.filter(
    (bot) => bot.keyScope !== "other" || bot.shared === true,
  );
  const botByAgentId = (agentId: string) =>
    bots.find((bot) => bot.ref.agentId === agentId);

  const runAction = async (
    action: () => Promise<HostError | null>,
    fallback: string,
  ): Promise<void> => {
    setActionError(null);
    const error = await action();
    if (error !== null) setActionError({ ...error, message: error.message || fallback });
  };

  const [launching, setLaunching] = useState<string | null>(null);

  // 触发后轮询等新会话创建完成，直接跳进会话；会话未及时就绪时回落到运行记录弹窗。
  const handleRun = async (deployment: DeploymentView) => {
    if (launching !== null) return;
    setActionError(null);
    setLaunching(deployment.ref.deploymentId);
    const { run, error } = await api.run(deployment.ref);
    if (error !== null || run === null) {
      setLaunching(null);
      setActionError({
        code: error?.code ?? "unavailable",
        message: error?.message || "触发失败，请稍后重试。",
      });
      return;
    }
    const sessionId = run.sessionId ?? (await api.waitRunSession(deployment.ref, run.id));
    setLaunching(null);
    const bot = botByAgentId(deployment.ref.agentId);
    if (typeof sessionId === "string" && bot !== undefined) {
      onOpenChat(bot, {
        ref: {
          connectionId: deployment.ref.connectionId,
          agentId: deployment.ref.agentId,
          sessionId,
        },
        title: deployment.name,
      });
      return;
    }
    setDetail(deployment);
  };

  const submitCreate = async (input: Parameters<typeof api.create>[0]) => {
    setSubmitting(true);
    setActionError(null);
    const error = await api.create(input);
    setSubmitting(false);
    if (error !== null) return setActionError(error);
    setFormOpen(false);
  };

  const submitUpdate = async (input: Parameters<typeof api.update>[1]) => {
    if (editing === null) return;
    setSubmitting(true);
    setActionError(null);
    const error = await api.update(editing.ref, input);
    setSubmitting(false);
    if (error !== null) return setActionError(error);
    setEditing(null);
  };

  return (
    <section className="h-full overflow-y-auto bg-background px-5 py-7 sm:px-8">
      <div className="mx-auto mb-6 flex max-w-[704px] flex-wrap items-center justify-between gap-3 motion-safe:animate-[surface-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]">
        <div className="min-w-0">
          <h2 className={cn(typography.pageTitle, "m-0")}>定时任务</h2>
          <p className="mt-0.5 mb-0 type-supporting text-muted-foreground">
            让助手按设定时间自动执行固定任务，每次执行创建一个新会话
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} disabled={creatableBots.length === 0}>
          <Plus className="size-[14px]" aria-hidden="true" />
          新建定时任务
        </Button>
      </div>

      <div className="mx-auto max-w-[704px]">
        {actionError !== null && !formOpen && editing === null ? (
          <Alert variant="destructive" className="mb-3">
            {actionError.message}
          </Alert>
        ) : null}
        {api.error !== null ? (
          <Alert variant="destructive">{api.error.message}</Alert>
        ) : null}
        {api.loading && api.deployments.length === 0 ? (
          <p className="type-supporting text-muted-foreground" role="status">
            正在加载定时任务…
          </p>
        ) : api.deployments.length === 0 ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center py-12 text-center">
            <CalendarClock className="size-[28px] text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 type-body text-muted-foreground">
              还没有定时任务。创建一个，让助手按设定时间自动执行。
            </p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {api.deployments.map((deployment) => {
              const bot = botByAgentId(deployment.ref.agentId);
              const expired = isExpired(deployment.expiresAt);
              const owner = deployment.keyScope !== "other";
              return (
                <li
                  key={deployment.ref.deploymentId}
                  className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-border px-3 py-2.5"
                >
                  <BotAvatar
                    name={bot?.name ?? deployment.ref.agentId}
                    botRef={deployment.ref}
                    size="compact"
                    decorative
                  />
                  <button
                    type="button"
                    className="grid min-w-0 flex-1 gap-0.5 text-left"
                    onClick={() => setDetail(deployment)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate type-control">{deployment.name}</span>
                      {deployment.status === "paused" ? (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 type-caption text-muted-foreground">
                          已暂停
                        </span>
                      ) : expired ? (
                        <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 type-caption text-destructive">
                          已到期
                        </span>
                      ) : null}
                      {deployment.shared === true ? (
                        <Share2
                          className="size-[13px] shrink-0 text-muted-foreground"
                          aria-label="已共享"
                        />
                      ) : null}
                    </span>
                    <span className="truncate type-caption text-muted-foreground">
                      {bot?.name ?? "未知 Bot"} ·{" "}
                      {deployment.schedule
                        ? `${describeSchedule(deployment.schedule)}（${deployment.schedule.timezone}）`
                        : "手动触发"}
                      {deployment.schedule?.nextRunAt &&
                      deployment.status === "active" &&
                      !expired
                        ? ` · 下次 ${formatRunDateTime(deployment.schedule.nextRunAt)}`
                        : ""}
                      {deployment.expiresAt
                        ? ` · ${deployment.expiresAt.slice(0, 10)} 到期`
                        : ""}
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="定时任务操作"
                        disabled={launching === deployment.ref.deploymentId}
                      >
                        {launching === deployment.ref.deploymentId ? (
                          <Loader2 className="size-[16px] animate-spin" aria-hidden="true" />
                        ) : (
                          <MoreHorizontal className="size-[16px]" aria-hidden="true" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        onSelect={() => void handleRun(deployment)}
                      >
                        <Play className="size-[14px]" aria-hidden="true" />
                        立即运行
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setDetail(deployment)}>
                        <History className="size-[14px]" aria-hidden="true" />
                        运行记录
                      </DropdownMenuItem>
                      {owner ? (
                        <>
                          <DropdownMenuItem onSelect={() => setEditing(deployment)}>
                            <Pencil className="size-[14px]" aria-hidden="true" />
                            编辑
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              void runAction(
                                () => api.setShared(deployment.ref, deployment.shared !== true),
                                "共享设置失败，请稍后重试。",
                              )
                            }
                          >
                            <Share2 className="size-[14px]" aria-hidden="true" />
                            {deployment.shared === true ? "取消共享" : "共享"}
                          </DropdownMenuItem>
                          {deployment.status === "paused" ? (
                            <DropdownMenuItem
                              onSelect={() =>
                                void runAction(
                                  () => api.unpause(deployment.ref),
                                  "恢复失败，请稍后重试。",
                                )
                              }
                            >
                              <RotateCcw className="size-[14px]" aria-hidden="true" />
                              恢复
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() =>
                                void runAction(
                                  () => api.pause(deployment.ref),
                                  "暂停失败，请稍后重试。",
                                )
                              }
                            >
                              <Pause className="size-[14px]" aria-hidden="true" />
                              暂停
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => setPendingArchive(deployment)}>
                            <Archive className="size-[14px]" aria-hidden="true" />
                            归档
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <DeploymentForm
        key={editing?.ref.deploymentId ?? "create"}
        open={formOpen || editing !== null}
        existing={editing ?? undefined}
        bots={editing === null ? creatableBots : undefined}
        submitting={submitting || botsLoading}
        error={actionError}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
          setActionError(null);
        }}
        onCreate={(input) => void submitCreate(input)}
        onUpdate={(input) => void submitUpdate(input)}
      />

      <DeploymentDetailDialog
        deployment={detail}
        onClose={() => setDetail(null)}
        listRuns={api.listRuns}
        onOpenChat={
          detail !== null && botByAgentId(detail.ref.agentId) !== undefined
            ? (chat) => onOpenChat(botByAgentId(detail.ref.agentId)!, chat)
            : undefined
        }
      />

      <ConfirmDialog
        open={pendingArchive !== null}
        title={`归档「${pendingArchive?.name ?? ""}」？`}
        description="归档后不再触发执行，且不可恢复。已有的运行记录与会话保留。"
        confirmLabel="归档"
        confirmVariant="destructive"
        onConfirm={(event) => {
          if (pendingArchive === null) return;
          event?.preventDefault();
          void runAction(async () => {
            const error = await api.archive(pendingArchive.ref);
            if (error === null) setPendingArchive(null);
            return error;
          }, "归档失败，请稍后重试。");
        }}
        onCancel={() => setPendingArchive(null)}
      />
    </section>
  );
}
