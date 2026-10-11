/**
 * Bot 详情页「定时任务」区块：列表、创建/编辑、暂停/恢复、手动触发、归档与运行记录。
 * 只服务支持定时任务的 Provider（见 supportsDeployments）；其他 Provider 不渲染。
 * 可见性：owner（current/ungrouped）可管理；共享查看者可浏览与手动触发。
 */

import { useState } from "react";
import type {
  BotRef,
  BotView,
  ChatView,
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
  History,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Pause,
  RotateCcw,
  Share2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useDeployments } from "./use-deployments";
import { supportsDeployments } from "./deployment-support";
import { DeploymentForm } from "./deployment-form";
import { DeploymentDetailDialog } from "./deployment-detail-dialog";
import { describeSchedule, isExpired } from "./deployment-schedule";

function formatDateTime(value?: string): string {
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

function deploymentStatusLabel(deployment: DeploymentView): {
  text: string;
  tone: "active" | "paused" | "expired";
} {
  if (deployment.status === "paused") return { text: "已暂停", tone: "paused" };
  if (isExpired(deployment.expiresAt)) return { text: "已到期", tone: "expired" };
  return { text: "进行中", tone: "active" };
}

export interface DeploymentSectionProps {
  botRef: BotRef;
  bot?: BotView;
  provider?: string;
  /** 凭据变更时自增，触发重读（旧 Key 范围的数据一律丢弃）。 */
  reloadEpoch?: number;
  onOpenChat(chat: ChatView): void;
}

export function DeploymentSection({
  botRef,
  bot,
  provider,
  reloadEpoch = 0,
  onOpenChat,
}: DeploymentSectionProps) {
  const api = useDeployments(botRef, provider, reloadEpoch);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DeploymentView | null>(null);
  const [detail, setDetail] = useState<DeploymentView | null>(null);
  const [pendingArchive, setPendingArchive] = useState<DeploymentView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<HostError | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);

  const owner = bot === undefined || bot.keyScope !== "other";

  if (!supportsDeployments(provider)) return null;

  const openDetail = (deployment: DeploymentView) => {
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

  const runAction = async (
    action: () => Promise<HostError | null>,
    fallback: string,
  ): Promise<void> => {
    setActionError(null);
    const error = await action();
    if (error !== null) {
      setActionError({ ...error, message: error.message || fallback });
    }
  };

  // 触发成功后直接打开详情：运行记录 5s 轮询，Session 创建完成即可点进会话。
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
    if (typeof sessionId === "string") {
      onOpenChat({
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

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h3 className={cn(typography.sectionTitle, "m-0")}>定时任务</h3>
        {owner ? (
          <Button size="sm" variant="outline" onClick={() => setFormOpen(true)}>
            <Plus className="size-[14px]" aria-hidden="true" />
            新建定时任务
          </Button>
        ) : null}
      </div>
      {api.error !== null ? <Alert variant="destructive">{api.error.message}</Alert> : null}
      {actionError !== null && !formOpen && editing === null ? (
        <Alert variant="destructive">{actionError.message}</Alert>
      ) : null}
      {api.loading && api.deployments.length === 0 ? (
        <p className="type-supporting text-muted-foreground">正在加载定时任务…</p>
      ) : api.deployments.length === 0 ? (
        <p className="type-supporting text-muted-foreground">
          还没有定时任务。创建一个，让助手按设定时间自动执行固定任务。
        </p>
      ) : (
        <ul className="grid gap-2">
          {api.deployments.map((deployment) => {
            const status = deploymentStatusLabel(deployment);
            return (
              <li
                key={deployment.ref.deploymentId}
                className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border px-3 py-2.5"
              >
                <button
                  type="button"
                  className="grid min-w-0 flex-1 gap-0.5 text-left"
                  onClick={() => openDetail(deployment)}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate type-control">{deployment.name}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 type-caption",
                        status.tone === "active" && "bg-muted text-foreground",
                        status.tone === "paused" && "bg-muted text-muted-foreground",
                        status.tone === "expired" && "bg-destructive/10 text-destructive",
                      )}
                    >
                      {status.text}
                    </span>
                    {deployment.shared === true ? (
                      <Share2 className="size-[13px] shrink-0 text-muted-foreground" aria-label="已共享" />
                    ) : null}
                  </span>
                  <span className="truncate type-caption text-muted-foreground">
                    {deployment.schedule
                      ? `${describeSchedule(deployment.schedule)}（${deployment.schedule.timezone}）`
                      : "手动触发"}
                    {deployment.schedule?.nextRunAt && status.tone === "active"
                      ? ` · 下次 ${formatDateTime(deployment.schedule.nextRunAt)}`
                      : ""}
                    {deployment.expiresAt ? ` · ${deployment.expiresAt.slice(0, 10)} 到期` : ""}
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
                    <DropdownMenuItem onSelect={() => openDetail(deployment)}>
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

      <DeploymentForm
        key={editing?.ref.deploymentId ?? "create"}
        open={formOpen || editing !== null}
        existing={editing ?? undefined}
        submitting={submitting}
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
        onOpenChat={onOpenChat}
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
