import { describe, expect, it } from "vitest";
import {
  compileSchedule,
  describeSchedule,
  isExpired,
  parseScheduleExpression,
  parseTime,
} from "./deployment-schedule";

describe("schedule preset ↔ cron", () => {
  it("compiles presets to cron expressions", () => {
    expect(compileSchedule({ kind: "manual" })).toBeNull();
    expect(compileSchedule({ kind: "hourly", minute: 30 })).toBe("30 * * * *");
    expect(compileSchedule({ kind: "daily", time: "09:00" })).toBe("0 9 * * *");
    expect(compileSchedule({ kind: "weekly", time: "08:30", weekday: 1 })).toBe("30 8 * * 1");
    expect(compileSchedule({ kind: "monthly", time: "23:05", day: 15 })).toBe("5 23 15 * *");
  });

  it("parses cron back to presets (roundtrip)", () => {
    for (const preset of [
      { kind: "hourly", minute: 30 },
      { kind: "daily", time: "09:00" },
      { kind: "weekly", time: "08:30", weekday: 5 },
      { kind: "monthly", time: "23:05", day: 15 },
    ] as const) {
      const expression = compileSchedule(preset);
      expect(expression).not.toBeNull();
      expect(parseScheduleExpression(expression ?? "")).toEqual(preset);
    }
  });

  it("falls back to custom for expressions the presets cannot express", () => {
    expect(parseScheduleExpression("0 9 * * 1-5")).toEqual({
      kind: "custom",
      expression: "0 9 * * 1-5",
    });
    expect(parseScheduleExpression("*/10 * * * *")).toEqual({
      kind: "custom",
      expression: "*/10 * * * *",
    });
    expect(parseScheduleExpression("bad")).toEqual({ kind: "custom", expression: "bad" });
  });

  it("describes schedules in Chinese", () => {
    expect(
      describeSchedule({ expression: "0 9 * * *", timezone: "Asia/Shanghai" }),
    ).toBe("每天 09:00");
    expect(
      describeSchedule({ expression: "30 8 * * 1", timezone: "UTC" }),
    ).toBe("每周一 08:30");
  });

  it("validates HH:mm strictly", () => {
    expect(parseTime("09:00")).toEqual({ hour: 9, minute: 0 });
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("9:60")).toBeNull();
    expect(parseTime("abc")).toBeNull();
  });
});

describe("expiry", () => {
  it("treats date-only expiry as end of day", () => {
    expect(isExpired("2026-10-08", new Date("2026-10-08T12:00:00"))).toBe(false);
    expect(isExpired("2026-10-08", new Date("2026-10-09T00:00:01"))).toBe(true);
  });

  it("never expires without expiresAt and ignores invalid values", () => {
    expect(isExpired(undefined)).toBe(false);
    expect(isExpired("not-a-date")).toBe(false);
  });
});
