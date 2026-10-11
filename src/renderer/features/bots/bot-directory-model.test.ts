import { describe, expect, it } from "vitest";
import type { BotView } from "@shared/models";
import { buildBotDirectory, filterBotDirectory } from "./bot-directory-model";

const bot = (id: string, name: string, memberAgentIds?: string[]): BotView => ({
  ref: { connectionId: "conn-1", agentId: id },
  name,
  management: "managed",
  collaboration: memberAgentIds ? { memberAgentIds } : undefined,
});

describe("Bot 目录关系", () => {
  it("搜索协调者、成员和描述，并将查询与筛选叠加", () => {
    const coordinator = bot("ada", "EngineeringAda", ["pixel"]);
    const member = { ...bot("pixel", "EngineeringPixel", []), description: "Frontend Engineer" };
    const unrelated = bot("other", "旅行助手", []);
    const directory = buildBotDirectory([coordinator, member, unrelated]);

    expect(directory.coordinatorCount).toBe(1);
    expect(directory.otherCount).toBe(2);
    expect(filterBotDirectory(directory.rows, "all", "pixel").map((row) => row.bot.name)).toEqual(["EngineeringAda", "EngineeringPixel"]);
    expect(filterBotDirectory(directory.rows, "coordinator", "pixel").map((row) => row.bot.name)).toEqual(["EngineeringAda"]);
    expect(filterBotDirectory(directory.rows, "other", "ada").map((row) => row.bot.name)).toEqual(["EngineeringPixel"]);
    expect(filterBotDirectory(directory.rows, "other", "frontend").map((row) => row.bot.name)).toEqual(["EngineeringPixel"]);
  });

  it("未知 roster 进入其他列表，但不凭名称猜测成员", () => {
    const coordinator = bot("ada", "EngineeringAda", ["missing"]);
    const unknown = bot("unrelated", "missing", undefined);
    const directory = buildBotDirectory([coordinator, unknown]);
    expect(directory.otherCount).toBe(1);
    expect(directory.rows[0].members).toEqual([]);
    expect(directory.rows[0].missingMemberIds).toEqual(["missing"]);
  });

  it("按管理状态筛选并支持远程 ID 搜索", () => {
    const managed = bot("agent-managed-123", "同名助手");
    const remote = { ...bot("agent-remote-456", "同名助手"), keyScope: "current" as const, management: "remote-only" as const };
    const directory = buildBotDirectory([managed, remote]);
    expect(directory.managedCount).toBe(1);
    expect(directory.remoteOnlyCount).toBe(1);
    expect(filterBotDirectory(directory.rows, "managed", "同名").map((row) => row.bot.ref.agentId)).toEqual([managed.ref.agentId]);
    expect(filterBotDirectory(directory.rows, "remote-only", "remote-456").map((row) => row.bot.ref.agentId)).toEqual([remote.ref.agentId]);
  });

  it("显示跨 Key 共享 Bot，同时保留 Managed Bot 供重新同步", () => {
    const current = {
      ...bot("current", "Current"),
      management: "remote-only" as const,
      keyScope: "current" as const,
      shared: true,
    };
    const foreign = {
      ...bot("foreign", "Foreign"),
      management: "remote-only" as const,
      keyScope: "other" as const,
      shared: true,
    };
    const managedForeign = {
      ...bot("managed-foreign", "Managed foreign"),
      keyScope: "other" as const,
    };
    const directory = buildBotDirectory([current, foreign, managedForeign]);
    expect(filterBotDirectory(directory.rows, "all", "").map((row) => row.bot.ref.agentId)).toEqual([
      "current",
      "foreign",
      "managed-foreign",
    ]);
    expect(filterBotDirectory(directory.rows, "shared", "").map((row) => row.bot.ref.agentId)).toEqual([
      "current",
      "foreign",
    ]);
  });
});

it("工作区不计入未分组资源，显式浏览仍保留目录和协作解析", () => {
  const legacy: BotView = { ...bot("legacy", "历史资源"), management: "remote-only", keyScope: "ungrouped" };
  const foreign: BotView = { ...legacy, ref: { ...legacy.ref, agentId: "foreign" }, keyScope: "other" };
  const coordinator = bot("coordinator", "负责人", ["legacy"]);
  const recovery: BotView = { ...bot("recovery", "需恢复"), management: "state-missing" };
  const directory = buildBotDirectory([coordinator, legacy, foreign, recovery]);
  expect(directory.workspaceCount).toBe(2);
  expect(directory.remoteOnlyCount).toBe(0);
  expect(directory.rows[0].members).toEqual([legacy]);
  expect(filterBotDirectory(directory.rows, "all", "").map((row) => row.bot.name)).toEqual(["负责人", "需恢复"]);
  expect(filterBotDirectory(directory.rows, "all", "历史资源").map((row) => row.bot.name)).toEqual(["负责人"]);
  expect(filterBotDirectory(directory.rows, "provider", "历史资源").map((row) => row.bot.name)).toEqual(["负责人", "历史资源"]);
});

// 创建者与接收者看到同一个团队目录，避免开启共享后仍显示零项。
it("团队共享包含自己共享和接收的 Bot，计数与筛选一致", () => {
  const own: BotView = { ...bot("own", "我共享的"), keyScope: "current", shared: true };
  const received: BotView = { ...bot("received", "同事共享的"), management: "remote-only", keyScope: "other", shared: true };
  const privateBot: BotView = { ...bot("private", "未共享"), keyScope: "current" };
  const directory = buildBotDirectory([own, received, privateBot]);
  expect(directory.sharedCount).toBe(2);
  expect(filterBotDirectory(directory.rows, "shared", "").map(({ bot }) => bot.ref.agentId)).toEqual(["own", "received"]);
  expect(buildBotDirectory([{ ...own, shared: false }, received]).sharedCount).toBe(1);
});
