/**
 * 协作成员选择器。
 * - 只负责展示与显式选择，不调用 DesktopHost，不推断单个成员的远程状态；
 * - 已配置但当前候选列表不可见的 ID 显示为“当前列表不可见”并默认保留，只有显式移除才删除；
 * - 选择顺序即序列化顺序，不代表优先级或执行顺序。
 */

import { useId, useState } from "react";
import { ChevronRight, Plus, Search, X } from "lucide-react";
import type { BotView, HostError } from "@shared/models";
import { BOT_MEMBERS_MAX } from "@shared/validation";
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
} from "../../ui/design-system";
import { BotAvatar } from "../../ui/bot-avatar/bot-avatar";
import { cn } from "../../lib/utils";

const MANAGEMENT_LABEL: Record<BotView["management"], string> = {
  managed: "受管理",
  "remote-only": "仅远程",
  "state-missing": "管理资料缺失",
};

export interface BotMemberSelectorProps {
  /** 协作成员的外部 Agent ID，顺序用于稳定回显。 */
  value: string[];
  /** 当前 Connection 的完整 Bot 列表；不在此列表中的已选 ID 不会被移除。 */
  candidates: BotView[];
  /** 编辑当前 Bot 时排除自身；创建时无远程 ID，无需传入。 */
  currentAgentId?: string;
  candidatesLoading: boolean;
  candidatesError: HostError | null;
  disabled: boolean;
  onChange(value: string[]): void;
  onRetry(): void;
}

export function BotMemberSelector({
  value,
  candidates,
  currentAgentId,
  candidatesLoading,
  candidatesError,
  disabled,
  onChange,
  onRetry,
}: BotMemberSelectorProps) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [query, setQuery] = useState("");

  const candidateById = new Map(candidates.map((bot) => [bot.ref.agentId, bot] as const));
  // 列表加载中或失败时不能断言任何成员仍在当前列表中，此时只做整体说明，不推断单个成员状态。
  const listUnavailable = candidatesLoading || candidatesError !== null;
  const atLimit = draft.length >= BOT_MEMBERS_MAX;
  const selectable = candidates.filter((bot) => bot.ref.agentId !== currentAgentId);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = selectable.filter(
    (bot) =>
      normalizedQuery === "" ||
      bot.name.toLocaleLowerCase().includes(normalizedQuery) ||
      bot.ref.agentId.toLocaleLowerCase().includes(normalizedQuery),
  );
  const selectedNames = value.map((agentId) => candidateById.get(agentId)?.name ?? agentId);
  const selectionSummary =
    selectedNames.length === 0
      ? "添加协作成员"
      : selectedNames.length <= 2
        ? selectedNames.join("、")
        : `${selectedNames.slice(0, 2).join("、")} 等 ${selectedNames.length} 个`;

  const toggleMember = (agentId: string) => {
    if (draft.includes(agentId)) {
      setDraft(draft.filter((item) => item !== agentId));
      return;
    }
    if (atLimit) return;
    setDraft([...draft, agentId]);
  };

  const openDialog = () => {
    setDraft(value);
    setQuery("");
    setOpen(true);
  };

  return (
    <Field role="group" aria-labelledby={labelId} data-layout="bot-members">
      <FieldLabel id={labelId}>协作成员（可选）</FieldLabel>

      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-[var(--control-lg)] w-full justify-between px-3 py-2.5 text-left"
        disabled={disabled}
        aria-label="添加协作成员"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openDialog}
      >
        <span className="min-w-0">
          <span className="block truncate type-control">{selectionSummary}</span>
          <span className="block type-caption text-muted-foreground">
            {value.length === 0
              ? "从当前 Connection 的 Bot 中选择"
              : `已选择 ${value.length}/${BOT_MEMBERS_MAX}`}
          </span>
        </span>
        {value.length === 0 ? (
          <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </Button>
      <FieldDescription>
        添加成员后，当前 Bot 将作为协调者工作；成员不会被复制或归当前 Bot 管理。
      </FieldDescription>

      {value.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" data-layout="member-chips">
          {value.map((agentId) => {
            const member = candidateById.get(agentId);
            const invisible = member === undefined || listUnavailable;
            return (
              <li
                key={agentId}
                className={cn(
                  "flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pr-1 pl-1",
                  invisible ? "border-dashed border-border bg-card" : "border-border bg-card",
                )}
              >
                <BotAvatar
                  name={member?.name ?? agentId}
                  botRef={member?.ref}
                  size="compact"
                  decorative
                />
                <span className="min-w-0 max-w-[168px] truncate type-supporting text-foreground">
                  {member?.name ?? agentId}
                </span>
                {invisible ? (
                  <span className="shrink-0 type-caption text-muted-foreground">
                    当前列表不可见
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={`移除成员 ${agentId}`}
                  disabled={disabled}
                  onClick={() => onChange(value.filter((item) => item !== agentId))}
                  className="grid size-[18px] shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="size-[12px]" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[min(680px,calc(100vh-48px))] max-w-[min(640px,calc(100vw-28px))]">
          <div className="border-b border-border px-6 py-5">
            <DialogTitle className="type-section-title">选择协作成员</DialogTitle>
            <DialogDescription className="mt-1 type-supporting text-muted-foreground">
              从当前 Connection 的 Bot 中选择。成员由当前 Bot 协调。
            </DialogDescription>
            <p className="mt-2 type-caption text-muted-foreground">
              已选择 {draft.length}/{BOT_MEMBERS_MAX}
            </p>
          </div>
          <div
            data-layout="member-candidates"
            className="flex max-h-[440px] flex-col gap-2 overflow-y-auto px-6 py-5"
          >
            <div className="flex items-center justify-between gap-3 px-1">
              <span className="type-control text-foreground/85">添加成员</span>
              <span className="type-caption text-muted-foreground">来自当前 Connection</span>
            </div>

            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                aria-label="搜索 Bot"
                placeholder="搜索 Bot"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
              />
            </div>

            <div className="max-h-[215px] overflow-y-auto" data-layout="member-candidate-list">
              {candidatesError !== null ? (
                <Alert variant="warning" title="无法加载 Bot 列表">
                  <div className="flex items-center justify-between gap-3">
                    <span>已选成员保持原样，不会被自动移除。</span>
                    <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                      重试
                    </Button>
                  </div>
                </Alert>
              ) : candidatesLoading ? (
                <p className="m-0 px-1 py-2 type-supporting text-muted-foreground" role="status">
                  正在加载 Bot 列表…
                </p>
              ) : filtered.length === 0 ? (
                <p className="m-0 px-1 py-2 type-supporting text-muted-foreground">
                  {normalizedQuery === ""
                    ? "该 Connection 下没有可添加的 Bot。"
                    : `没有匹配“${query.trim()}”的成员。`}
                </p>
              ) : (
                filtered.map((bot) => {
                  const checked = draft.includes(bot.ref.agentId);
                  const limitReached = atLimit && !checked;
                  return (
                    <label
                      key={bot.ref.agentId}
                      className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] px-2 py-2 hover:bg-surface-hover"
                    >
                      <Checkbox
                        aria-label={`选择成员 ${bot.name}`}
                        checked={checked}
                        disabled={disabled || limitReached}
                        onCheckedChange={() => toggleMember(bot.ref.agentId)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="truncate type-control">{bot.name}</span>
                          <span className="shrink-0 type-caption text-muted-foreground">
                            {MANAGEMENT_LABEL[bot.management]}
                          </span>
                        </span>
                        {bot.description ? (
                          <span className="mt-0.5 line-clamp-1 block type-supporting text-muted-foreground">
                            {bot.description}
                          </span>
                        ) : null}
                        <span className="mt-0.5 block truncate type-caption text-muted-foreground">
                          {bot.ref.agentId}
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>

            {atLimit ? (
              <p className="m-0 px-1 type-caption text-muted-foreground">
                最多选择 {BOT_MEMBERS_MAX} 个成员
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              确认选择（{draft.length}）
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div
        className="rounded-[var(--radius-md)] bg-muted/55 px-3 py-2.5 type-caption text-muted-foreground"
        data-layout="member-notice"
      >
        在消息中点名成员会影响协调者的选择，但不保证精确路由。
      </div>
    </Field>
  );
}
