/**
 * 定时任务调度模型：频率预设 ↔ cron 表达式双向转换、时区候选与到期判定。
 * 纯函数模块，不持有状态。合同见 ADR-0010。
 */

import type { DeploymentScheduleView } from "@shared/models";

export type SchedulePreset =
  | { kind: "manual" }
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; weekday: number }
  | { kind: "monthly"; time: string; day: number }
  | { kind: "custom"; expression: string };

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseTime(value: string): { hour: number; minute: number } | null {
  const match = TIME_PATTERN.exec(value);
  if (match === null) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** 预设编译为 5 段 cron；manual 返回 null（纯手动触发）。 */
export function compileSchedule(preset: SchedulePreset): string | null {
  switch (preset.kind) {
    case "manual":
      return null;
    case "hourly":
      return `${preset.minute} * * * *`;
    case "daily": {
      const time = parseTime(preset.time);
      return time === null ? null : `${time.minute} ${time.hour} * * *`;
    }
    case "weekly": {
      const time = parseTime(preset.time);
      return time === null ? null : `${time.minute} ${time.hour} * * ${preset.weekday}`;
    }
    case "monthly": {
      const time = parseTime(preset.time);
      return time === null ? null : `${time.minute} ${time.hour} ${preset.day} * *`;
    }
    case "custom":
      return preset.expression;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parseDailyParts(
  minute: string,
  hour: string,
): { kind: "daily"; time: string } | null {
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return null;
  const h = Number(hour);
  const m = Number(minute);
  if (h > 23 || m > 59) return null;
  return { kind: "daily", time: `${pad(h)}:${pad(m)}` };
}

/** cron 反解回预设；无法表达的表达式归为 custom（编辑时只读展示原文）。 */
export function parseScheduleExpression(expression: string): SchedulePreset {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return { kind: "custom", expression };
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (month !== "*") return { kind: "custom", expression };
  if (dayOfMonth === "*" && dayOfWeek === "*") {
    if (hour === "*") {
      if (!/^\d{1,2}$/.test(minute) || Number(minute) > 59) {
        return { kind: "custom", expression };
      }
      return { kind: "hourly", minute: Number(minute) };
    }
    const daily = parseDailyParts(minute, hour);
    return daily ?? { kind: "custom", expression };
  }
  if (dayOfMonth === "*" && /^\d$/.test(dayOfWeek) && Number(dayOfWeek) <= 6) {
    const daily = parseDailyParts(minute, hour);
    if (daily === null) return { kind: "custom", expression };
    return { kind: "weekly", time: daily.time, weekday: Number(dayOfWeek) };
  }
  if (/^\d{1,2}$/.test(dayOfMonth) && Number(dayOfMonth) >= 1 && Number(dayOfMonth) <= 31 && dayOfWeek === "*") {
    const daily = parseDailyParts(minute, hour);
    if (daily === null) return { kind: "custom", expression };
    return { kind: "monthly", time: daily.time, day: Number(dayOfMonth) };
  }
  return { kind: "custom", expression };
}

export const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 列表与详情的调度展示文案。 */
export function describeSchedule(schedule: DeploymentScheduleView): string {
  const preset = parseScheduleExpression(schedule.expression);
  switch (preset.kind) {
    case "manual":
      return "手动触发";
    case "hourly":
      return `每小时第 ${preset.minute} 分`;
    case "daily":
      return `每天 ${preset.time}`;
    case "weekly":
      return `每${WEEKDAY_LABELS[preset.weekday]} ${preset.time}`;
    case "monthly":
      return `每月 ${preset.day} 日 ${preset.time}`;
    case "custom":
      return `自定义 cron：${preset.expression}`;
  }
}

/** 首版只开放上海与 UTC 两个时区选项；Provider 侧仍接受任意 IANA 时区。 */
export function timezoneOptions(): string[] {
  return [DEFAULT_TIMEZONE, "UTC"];
}

export const DEFAULT_TIMEZONE = "Asia/Shanghai";

/** 到期判定：expiresAt 是日期（YYYY-MM-DD）或完整 ISO；当天 23:59:59 之后才视为到期。 */
export function isExpired(expiresAt: string | undefined, now: Date = new Date()): boolean {
  if (expiresAt === undefined) return false;
  const endOfDay = /^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ? `${expiresAt}T23:59:59` : expiresAt;
  const time = Date.parse(endOfDay);
  return !Number.isNaN(time) && now.getTime() > time;
}
