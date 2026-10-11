/**
 * parseUpdateBotInput 合同测试。保护的风险：
 * - 配置编辑提交完整四字段，partial patch 在信任边界被拒绝；
 * - 产品保护上限（名称 80、描述 500、Instructions 20,000）在 Main 强制执行；
 * - description/instructions 空串清除被允许；
 * - 多余属性与凭据形状不进入解析结果。
 */

import { describe, expect, it } from "vitest";
import {
  BOT_DESCRIPTION_MAX,
  BOT_INSTRUCTIONS_MAX,
  BOT_MEMBERS_MAX,
  BOT_NAME_MAX,
  parseBotRef,
  parseCreateBotInput,
  parseCreateDeploymentInput,
  parseDeploymentRef,
  parseMemberAgentIds,
  parseUpdateBotInput,
  parseUpdateDeploymentInput,
} from "./validation";

/** 合法上限数量的外部 Agent ID。 */
const MEMBER_IDS_MAX = Array.from({ length: BOT_MEMBERS_MAX }, (_, index) => `agent_${index}`);

const VALID = {
  name: "Demo",
  description: "d",
  instructions: "Be helpful.",
  model: "ultimate",
  skills: [],
  memberAgentIds: [],
};

describe("parseCreateBotInput", () => {
  it("保留用户工作指令并限制长度", () => {
    expect(
      parseCreateBotInput({ name: "Demo", skills: [], instructions: "请用中文回答。" })
        ?.instructions,
    ).toBe("请用中文回答。");
    expect(
      parseCreateBotInput({
        name: "Demo",
        skills: [],
        instructions: "x".repeat(BOT_INSTRUCTIONS_MAX + 1),
      }),
    ).toBeNull();
  });
});

describe("parseUpdateBotInput", () => {
  it("内置工具只接受完整、去重的已知名称集合", () => {
    expect(
      parseUpdateBotInput({ ...VALID, builtinTools: ["read", "web_search", "mark_artifacts"] })
        ?.builtinTools,
    ).toEqual(["read", "web_search", "mark_artifacts"]);
    expect(parseUpdateBotInput({ ...VALID, builtinTools: [] })?.builtinTools).toEqual([]);
    expect(parseUpdateBotInput({ ...VALID, builtinTools: ["read", "read"] })).toBeNull();
    expect(parseUpdateBotInput({ ...VALID, builtinTools: ["unknown"] })).toBeNull();
  });
  it("完整五字段输入通过，name 被 trim", () => {
    expect(parseUpdateBotInput({ ...VALID, name: "  Demo  " })).toEqual({
      name: "Demo",
      description: "d",
      instructions: "Be helpful.",
      model: "ultimate",
      skills: [],
      memberAgentIds: [],
    });
  });

  it("description 与 instructions 空字符串通过（清除语义）", () => {
    expect(parseUpdateBotInput({ ...VALID, description: "", instructions: "" })).toEqual({
      name: "Demo",
      description: "",
      instructions: "",
      model: "ultimate",
      skills: [],
      memberAgentIds: [],
    });
  });

  function withoutKey(key: keyof typeof VALID) {
    const copy: Record<string, unknown> = { ...VALID };
    delete copy[key];
    return copy;
  }

  it.each([
    ["缺 name", withoutKey("name")],
    ["缺 description", withoutKey("description")],
    ["缺 instructions", withoutKey("instructions")],
    ["缺 model", withoutKey("model")],
    ["缺 skills", withoutKey("skills")],
    ["缺 memberAgentIds", withoutKey("memberAgentIds")],
  ])("%s 失败", (_label, input) => {
    expect(parseUpdateBotInput(input)).toBeNull();
  });

  it.each([
    ["空 name", { ...VALID, name: "" }],
    ["纯空白 name", { ...VALID, name: "   " }],
    ["空 model", { ...VALID, model: "" }],
    ["纯空白 model", { ...VALID, model: "  " }],
    ["name 超限", { ...VALID, name: "x".repeat(BOT_NAME_MAX + 1) }],
    ["description 超限", { ...VALID, description: "x".repeat(BOT_DESCRIPTION_MAX + 1) }],
    ["instructions 超限", { ...VALID, instructions: "x".repeat(BOT_INSTRUCTIONS_MAX + 1) }],
  ])("%s 失败", (_label, input) => {
    expect(parseUpdateBotInput(input)).toBeNull();
  });

  it("边界长度恰好等于上限时通过", () => {
    expect(
      parseUpdateBotInput({
        name: "x".repeat(BOT_NAME_MAX),
        description: "x".repeat(BOT_DESCRIPTION_MAX),
        instructions: "x".repeat(BOT_INSTRUCTIONS_MAX),
        model: "m",
        skills: [],
        memberAgentIds: [],
      }),
    ).not.toBeNull();
  });

  it.each([
    ["非对象", "not-an-object"],
    ["null", null],
    ["name 非字符串", { ...VALID, name: 42 }],
    ["description 非字符串", { ...VALID, description: null }],
    ["instructions 非字符串", { ...VALID, instructions: ["a"] }],
    ["model 非字符串", { ...VALID, model: { id: "ultimate" } }],
  ])("%s 失败", (_label, input) => {
    expect(parseUpdateBotInput(input)).toBeNull();
  });

  it("多余属性不进入解析结果", () => {
    const parsed = parseUpdateBotInput({
      ...VALID,
      credential: "SECRET",
      remoteStatus: "running",
      management: "managed",
    });
    expect(parsed).toEqual(VALID);
    expect(Object.keys(parsed!)).toEqual([
      "name",
      "description",
      "instructions",
      "model",
      "skills",
      "memberAgentIds",
    ]);
  });

  it("规范化 Skill 引用并拒绝重复、超量和非法版本", () => {
    expect(
      parseUpdateBotInput({
        ...VALID,
        skills: [{ type: "custom", skillId: " skill_1 ", version: " 1.2 " }],
      })?.skills,
    ).toEqual([{ type: "custom", skillId: "skill_1", version: "1.2" }]);
    expect(
      parseUpdateBotInput({
        ...VALID,
        skills: [
          { type: "official", skillId: "same" },
          { type: "official", skillId: "same" },
        ],
      }),
    ).toBeNull();
    expect(
      parseUpdateBotInput({ ...VALID, skills: [{ type: "custom", skillId: "x", version: "" }] }),
    ).toBeNull();
  });

  it("规范化 MCP 引用并要求至少一个启用工具", () => {
    expect(
      parseUpdateBotInput({
        ...VALID,
        mcpServers: [
          {
            type: "official",
            serverCode: " EnhancedSearch ",
            serverName: " 联网搜索增强版 ",
            permissionPolicy: "always_allow",
            tools: [{ name: " search ", enabled: true }],
          },
        ],
      })?.mcpServers,
    ).toEqual([
      {
        type: "official",
        serverCode: "EnhancedSearch",
        serverName: "联网搜索增强版",
        permissionPolicy: "always_allow",
        tools: [{ name: "search", enabled: true }],
      },
    ]);
    expect(
      parseUpdateBotInput({
        ...VALID,
        mcpServers: [
          {
            type: "official",
            serverCode: "EnhancedSearch",
            serverName: "联网搜索增强版",
            permissionPolicy: "always_allow",
            tools: [{ name: "search", enabled: false }],
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("parseDeploymentRef 与 Deployment 输入（deployments:* IPC 信任边界）", () => {
  it("接受完整 ref，拒绝缺失字段", () => {
    expect(
      parseDeploymentRef({ connectionId: "c", agentId: "a", deploymentId: "d" }),
    ).toEqual({ connectionId: "c", agentId: "a", deploymentId: "d" });
    expect(parseDeploymentRef({ connectionId: "c", agentId: "a" })).toBeNull();
    expect(parseDeploymentRef(null)).toBeNull();
  });

  it("创建输入：必填 name/prompt，调度与时区合法，到期需为可解析时间", () => {
    const valid = parseCreateDeploymentInput({
      agentId: "a",
      name: "每日汇总",
      prompt: "汇总",
      schedule: { expression: "0 9 * * *", timezone: "Asia/Shanghai" },
      expiresAt: "2026-12-31",
      shared: true,
    });
    expect(valid).toMatchObject({
      agentId: "a",
      schedule: { expression: "0 9 * * *", timezone: "Asia/Shanghai" },
      expiresAt: "2026-12-31",
      shared: true,
    });
    expect(parseCreateDeploymentInput({ agentId: "a", name: "", prompt: "p" })).toBeNull();
    expect(
      parseCreateDeploymentInput({
        agentId: "a",
        name: "n",
        prompt: "p",
        schedule: { expression: "not cron", timezone: "Asia/Shanghai" },
      }),
    ).toBeNull();
    expect(
      parseCreateDeploymentInput({ agentId: "a", name: "n", prompt: "p", expiresAt: "garbage" }),
    ).toBeNull();
  });

  it("更新输入：支持 schedule/expiresAt 置 null 清除，拒绝空更新", () => {
    expect(parseUpdateDeploymentInput({ schedule: null, expiresAt: null })).toEqual({
      schedule: null,
      expiresAt: null,
    });
    expect(parseUpdateDeploymentInput({})).toBeNull();
    expect(parseUpdateDeploymentInput({ name: "  " })).toBeNull();
  });
});

describe("parseBotRef（bots:archive 等 IPC 信任边界）", () => {
  it("合法 {connectionId, agentId} 通过", () => {
    expect(parseBotRef({ connectionId: "conn_1", agentId: "agent-1" })).toEqual({
      connectionId: "conn_1",
      agentId: "agent-1",
    });
  });

  it.each([
    ["非对象", "not-an-object"],
    ["null", null],
    ["数组", []],
    ["空 connectionId", { connectionId: "", agentId: "a" }],
    ["空 agentId", { connectionId: "c", agentId: "" }],
    ["connectionId 非字符串", { connectionId: 1, agentId: "a" }],
    ["agentId 非字符串", { connectionId: "c", agentId: null }],
    ["缺 connectionId", { agentId: "a" }],
    ["缺 agentId", { connectionId: "c" }],
  ])("%s 失败", (_label, input) => {
    expect(parseBotRef(input)).toBeNull();
  });

  it("多余属性不进入解析结果", () => {
    const parsed = parseBotRef({
      connectionId: "c",
      agentId: "a",
      credential: "SECRET",
      provider: "qoder",
    });
    expect(parsed).toEqual({ connectionId: "c", agentId: "a" });
    expect(Object.keys(parsed!)).toEqual(["connectionId", "agentId"]);
  });
});

describe("parseMemberAgentIds（协作成员 roster 的信任边界）", () => {
  it("undefined 归一化为空数组（create 向后兼容）", () => {
    expect(parseMemberAgentIds(undefined)).toEqual([]);
  });

  it("空数组通过；trim 后按原顺序返回新数组", () => {
    expect(parseMemberAgentIds([])).toEqual([]);
    expect(parseMemberAgentIds([" agent_b ", "agent_a"])).toEqual(["agent_b", "agent_a"]);
  });

  it("合法 20 项通过，21 项失败", () => {
    expect(BOT_MEMBERS_MAX).toBe(20);
    expect(parseMemberAgentIds(MEMBER_IDS_MAX)).toEqual(MEMBER_IDS_MAX);
    expect(parseMemberAgentIds([...MEMBER_IDS_MAX, "agent_extra"])).toBeNull();
  });

  it("trim 后重复失败（同一 ID 的空白变体也算重复）", () => {
    expect(parseMemberAgentIds(["agent_a", " agent_a "])).toBeNull();
  });

  it.each([
    ["非数组字符串", "agent_a"],
    ["null", null],
    ["映射", { agent_id: "agent_a" }],
    ["空字符串项", [""]],
    ["纯空白项", ["   "]],
    ["非字符串项", [42]],
    ["对象成员项", [{ agent_id: "agent_a" }]],
    ["嵌套数组项", [["agent_a"]]],
  ])("%s 失败", (_label, input) => {
    expect(parseMemberAgentIds(input)).toBeNull();
  });
});

describe("parseUpdateBotInput memberAgentIds（完整提交语义）", () => {
  it("合法 20 项通过并保持顺序，21 项失败", () => {
    expect(
      parseUpdateBotInput({ ...VALID, memberAgentIds: MEMBER_IDS_MAX })?.memberAgentIds,
    ).toEqual(MEMBER_IDS_MAX);
    expect(
      parseUpdateBotInput({ ...VALID, memberAgentIds: [...MEMBER_IDS_MAX, "agent_extra"] }),
    ).toBeNull();
  });

  it("非法成员数组整体失败", () => {
    expect(parseUpdateBotInput({ ...VALID, memberAgentIds: "agent_a" })).toBeNull();
    expect(parseUpdateBotInput({ ...VALID, memberAgentIds: [""] })).toBeNull();
    expect(parseUpdateBotInput({ ...VALID, memberAgentIds: ["agent_a", " agent_a "] })).toBeNull();
  });
});
