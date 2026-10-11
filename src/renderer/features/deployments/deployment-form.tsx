/**
 * 定时任务创建/编辑表单（Dialog）。
 * 字段对齐 ADR-0010：名称、固定 prompt、频率预设 + 时间 + IANA 时区、
 * 可选到期日期、任务输出（首版仅独立任务输出）。
 */

import { useMemo, useState, type FormEvent } from "react";
import type {
  BotView,
  CreateDeploymentInput,
  DeploymentView,
  HostError,
  UpdateDeploymentInput,
} from "@shared/models";
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
  RadioGroup,
  RadioGroupItem,
  Select,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../ui/design-system";
import { CircleHelp } from "lucide-react";
import {
  compileSchedule,
  DEFAULT_TIMEZONE,
  parseScheduleExpression,
  parseTime,
  timezoneOptions,
  WEEKDAY_LABELS,
  type SchedulePreset,
} from "./deployment-schedule";

type Frequency = "manual" | "hourly" | "daily" | "weekly" | "monthly" | "custom";

const FREQUENCY_OPTIONS = [
  { value: "manual", label: "手动触发" },
  { value: "hourly", label: "每小时" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
];

const HOUR_MINUTE_OPTIONS = [0, 15, 30, 45].map((minute) => ({
  value: String(minute),
  label: `第 ${minute} 分`,
}));

const MONTH_DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: `${i + 1} 日`,
}));

interface FormState {
  agentId: string;
  name: string;
  prompt: string;
  description: string;
  frequency: Frequency;
  time: string;
  minute: string;
  weekday: string;
  monthDay: string;
  timezone: string;
  expiryEnabled: boolean;
  expiryDate: string;
}

function initialState(existing: DeploymentView | undefined, defaultAgentId: string): FormState {
  if (existing === undefined) {
    return {
      agentId: defaultAgentId,
      name: "",
      prompt: "",
      description: "",
      frequency: "daily",
      time: "09:00",
      minute: "0",
      weekday: "1",
      monthDay: "1",
      timezone: DEFAULT_TIMEZONE,
      expiryEnabled: false,
      expiryDate: "",
    };
  }
  const preset: SchedulePreset = existing.schedule
    ? parseScheduleExpression(existing.schedule.expression)
    : { kind: "manual" };
  return {
    agentId: existing.ref.agentId,
    name: existing.name,
    prompt: existing.prompt,
    description: existing.description ?? "",
    frequency: preset.kind,
    time:
      preset.kind === "daily" || preset.kind === "weekly" || preset.kind === "monthly"
        ? preset.time
        : "09:00",
    minute: preset.kind === "hourly" ? String(preset.minute) : "0",
    weekday: preset.kind === "weekly" ? String(preset.weekday) : "1",
    monthDay: preset.kind === "monthly" ? String(preset.day) : "1",
    timezone: existing.schedule?.timezone ?? DEFAULT_TIMEZONE,
    expiryEnabled: existing.expiresAt !== undefined,
    expiryDate: existing.expiresAt?.slice(0, 10) ?? "",
  };
}

function buildPreset(state: FormState): SchedulePreset {
  switch (state.frequency) {
    case "hourly":
      return { kind: "hourly", minute: Number(state.minute) };
    case "daily":
      return { kind: "daily", time: state.time };
    case "weekly":
      return { kind: "weekly", time: state.time, weekday: Number(state.weekday) };
    case "monthly":
      return { kind: "monthly", time: state.time, day: Number(state.monthDay) };
    case "custom":
      // custom 只在编辑既有表达式时出现；表单不允许修改，保留原表达式。
      return { kind: "custom", expression: "" };
    default:
      return { kind: "manual" };
  }
}

export interface DeploymentFormProps {
  open: boolean;
  existing?: DeploymentView;
  /** 提供时显示执行 Bot 选择器（总览页场景）；缺省表示 Bot 已由入口锁定。 */
  bots?: BotView[];
  submitting: boolean;
  error: HostError | null;
  onClose(): void;
  onCreate(input: Omit<CreateDeploymentInput, "agentId"> & { agentId?: string }): void;
  onUpdate(input: UpdateDeploymentInput): void;
}

export function DeploymentForm({
  open,
  existing,
  bots,
  submitting,
  error,
  onClose,
  onCreate,
  onUpdate,
}: DeploymentFormProps) {
  const editing = existing !== undefined;
  const [state, setState] = useState<FormState>(() =>
    initialState(existing, bots?.[0]?.ref.agentId ?? ""),
  );
  const [validation, setValidation] = useState<string | null>(null);
  const zones = useMemo(
    () => timezoneOptions().map((zone) => ({ value: zone, label: zone })),
    [],
  );

  const patch = (partial: Partial<FormState>) => {
    setState((previous) => ({ ...previous, ...partial }));
    setValidation(null);
  };

  const customExpression =
    editing && existing.schedule !== undefined && state.frequency === "custom"
      ? existing.schedule.expression
      : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!editing && bots !== undefined && state.agentId.length === 0) {
      return setValidation("请选择执行 Bot。");
    }
    const name = state.name.trim();
    const prompt = state.prompt.trim();
    if (name.length === 0) return setValidation("请填写任务名称。");
    if (prompt.length === 0) return setValidation("请填写执行内容。");
    let schedule: { expression: string; timezone: string } | null | undefined;
    if (customExpression !== null) {
      schedule = undefined; // 自定义表达式不改动
    } else if (state.frequency === "manual") {
      schedule = null;
    } else {
      if (state.frequency !== "hourly" && parseTime(state.time) === null) {
        return setValidation("请选择有效的执行时间。");
      }
      const expression = compileSchedule(buildPreset(state));
      if (expression === null) return setValidation("调度配置无效。");
      schedule = { expression, timezone: state.timezone };
    }
    if (state.expiryEnabled && state.expiryDate.length === 0) {
      return setValidation("请选择到期日期。");
    }
    const expiresAt = state.expiryEnabled ? state.expiryDate : undefined;
    const description = state.description.trim();
    if (editing) {
      const input: UpdateDeploymentInput = {};
      if (name !== existing.name) input.name = name;
      if (prompt !== existing.prompt) input.prompt = prompt;
      if (description !== (existing.description ?? "")) input.description = description;
      if (schedule !== undefined) input.schedule = schedule;
      const existingExpiry = existing.expiresAt?.slice(0, 10);
      if (state.expiryEnabled && expiresAt !== existingExpiry) input.expiresAt = expiresAt;
      if (!state.expiryEnabled && existing.expiresAt !== undefined) input.expiresAt = null;
      if (Object.keys(input).length === 0) {
        onClose();
        return;
      }
      onUpdate(input);
      return;
    }
    onCreate({
      ...(bots !== undefined ? { agentId: state.agentId } : {}),
      name,
      prompt,
      ...(description.length > 0 ? { description } : {}),
      ...(schedule ? { schedule } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[min(720px,calc(100vh-76px))]">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle>{editing ? "编辑定时任务" : "新建定时任务"}</DialogTitle>
          <DialogDescription className="mt-1 type-supporting text-muted-foreground">
            按设定的时间自动让该助手执行固定任务，每次执行创建一个新会话。
          </DialogDescription>
        </div>
        <form onSubmit={handleSubmit} className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
          {!editing && bots !== undefined ? (
            <Field>
              <FieldLabel>执行 Bot</FieldLabel>
              <Select
                aria-label="执行 Bot"
                value={state.agentId}
                onValueChange={(agentId) => patch({ agentId })}
                options={bots.map((bot) => ({
                  value: bot.ref.agentId,
                  label: bot.name,
                }))}
              />
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="deployment-name">任务名称</FieldLabel>
            <Input
              id="deployment-name"
              value={state.name}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder="例如：每日订单汇总"
              maxLength={256}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="deployment-prompt">执行内容</FieldLabel>
            <Textarea
              id="deployment-prompt"
              value={state.prompt}
              onChange={(event) => patch({ prompt: event.target.value })}
              placeholder="每次触发时发送给助手的固定指令"
              rows={3}
            />
          </Field>
          <Field>
            <FieldLabel>计划时间</FieldLabel>
            {customExpression !== null ? (
              <FieldDescription>
                当前为自定义 cron 表达式 <code>{customExpression}</code>
                ，本界面不支持编辑；如需修改请先归档后重建。
              </FieldDescription>
            ) : (
              <div className="grid gap-2">
                <div className="flex gap-2">
                  <Select
                    aria-label="频率"
                    className="flex-1"
                    value={state.frequency}
                    onValueChange={(value) => patch({ frequency: value as Frequency })}
                    options={FREQUENCY_OPTIONS}
                  />
                  {state.frequency === "hourly" ? (
                    <Select
                      aria-label="分钟"
                      className="flex-1"
                      value={state.minute}
                      onValueChange={(minute) => patch({ minute })}
                      options={HOUR_MINUTE_OPTIONS}
                    />
                  ) : null}
                  {state.frequency === "weekly" ? (
                    <Select
                      aria-label="星期"
                      className="flex-1"
                      value={state.weekday}
                      onValueChange={(weekday) => patch({ weekday })}
                      options={WEEKDAY_LABELS.map((label, index) => ({
                        value: String(index),
                        label,
                      }))}
                    />
                  ) : null}
                  {state.frequency === "monthly" ? (
                    <Select
                      aria-label="日期"
                      className="flex-1"
                      value={state.monthDay}
                      onValueChange={(monthDay) => patch({ monthDay })}
                      options={MONTH_DAY_OPTIONS}
                    />
                  ) : null}
                  {state.frequency === "daily" ||
                  state.frequency === "weekly" ||
                  state.frequency === "monthly" ? (
                    <Input
                      aria-label="时间"
                      className="flex-1"
                      type="time"
                      value={state.time}
                      onChange={(event) => patch({ time: event.target.value })}
                    />
                  ) : null}
                </div>
                {state.frequency !== "manual" ? (
                  <Select
                    aria-label="时区"
                    value={state.timezone}
                    onValueChange={(timezone) => patch({ timezone })}
                    options={zones}
                  />
                ) : null}
              </div>
            )}
          </Field>
          <Field>
            <label className="flex items-center gap-2 type-control cursor-pointer">
              <Checkbox
                checked={state.expiryEnabled}
                onCheckedChange={(checked) => patch({ expiryEnabled: checked === true })}
              />
              设置到期日期
            </label>
            <FieldDescription>到期后请手动暂停；暂停前仍会按计划触发。</FieldDescription>
            {state.expiryEnabled ? (
              <Input
                aria-label="到期日期"
                type="date"
                value={state.expiryDate}
                onChange={(event) => patch({ expiryDate: event.target.value })}
              />
            ) : null}
          </Field>
          {!editing ? (
            <Field>
              <FieldLabel>
                任务输出
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-1 inline-flex align-middle text-muted-foreground">
                      <CircleHelp className="size-[14px]" aria-hidden="true" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    独立任务输出：每次执行创建一个新会话。合并任务输出由 Provider 公开 API
                    暂不支持，开放后恢复该选项。
                  </TooltipContent>
                </Tooltip>
              </FieldLabel>
              <RadioGroup value="independent">
                <label className="flex items-center gap-2 type-control cursor-pointer">
                  <RadioGroupItem value="independent" />
                  独立任务输出
                </label>
                <label className="flex items-center gap-2 type-control text-muted-foreground">
                  <RadioGroupItem value="merged" disabled />
                  合并任务输出（暂不支持）
                </label>
              </RadioGroup>
            </Field>
          ) : null}
          {validation !== null ? <Alert variant="destructive">{validation}</Alert> : null}
          {error !== null ? (
            <Alert variant="destructive">{error.message}</Alert>
          ) : null}
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "提交中…" : editing ? "保存" : "创建"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
