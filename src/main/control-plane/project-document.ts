/**
 * Project Document（agents.yaml）Module：Managed Bot 期望配置的唯一解释者。
 *
 * 边界：
 * - 构建产出的 YAML 不含凭据；provider 凭据由 BotControlPlane 在调用 SDK 时经
 *   `BackendRuntimeInput.providers` 注入，不落盘（validation.md 存储验收）。
 * - 结构固定：一个 Provider 占位块、一个外部引用 Connection 共享 Environment 的
 *   environments.default 块、一个 agent。创建 Chat 时优先从 OpenAgentPack state
 *   读取该 Environment 的 remote ID，否则回退到 Connection 绑定的默认环境。
 * - 只生成 YAML 文本；写盘由 ManagedBotStore 原子写完成。
 * - 读取/合并严格限定单 Agent 形状：多 agent 段、逻辑名成员、非字符串四字段等
 *   都表示该文件已离开本客户端支持的 Managed Bot 形状，一律 invalid-input。
 * - 协作成员只以外部 `{ agent_id }` 引用写入/读出，不进入 state，不写逻辑名称成员，
 *   也不直接写 Provider wire payload。
 *
 * 序列化：agents.yaml 结构小且固定，构建路径手工序列化并转义，避免为写盘引入
 * 生成式 YAML；读取/合并路径复用 `yaml` 包解析与重新序列化（保留未知键）。
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  BotMcpBinding,
  BotSkillRef,
  CreateBotInput,
  ManagedBotConfiguration,
  UpdateBotInput,
} from "@shared/models";
import { hostError } from "@shared/errors";
import { API_KEY_SCOPE_METADATA_KEY } from "../api-key-scope";
import { BOT_MEMBERS_MAX, parseMemberAgentIds } from "@shared/validation";
import {
  DEFAULT_BOT_INSTRUCTIONS,
  DEFAULT_COORDINATOR_INSTRUCTIONS,
} from "@shared/default-bot-instructions";

/** agents.yaml 中 agent 使用的逻辑资源名（同时是远程显示名的来源）。 */
export interface ProjectDocumentInput extends CreateBotInput {
  /** 稳定 projectName（manifest.projectName，等于 scope 创建时确定）。 */
  projectName: string;
  /** 目标 Provider；决定模型与 provider 占位块。 */
  provider: "qoder" | "bailian";
  /** Connection 共享 Environment 的远程 ID；agent 经 environments.default 引用它。 */
  environmentId: string;
}

/** readEditableAgentDocument 的返回形状：agent 逻辑资源名 + 可编辑配置。 */
export interface EditableAgentDocument {
  logicalName: string;
  configuration: ManagedBotConfiguration;
}

/** 缺省模型与固定系统提示：qoder 固定平台自动路由 auto；百炼缺省 qwen3.7-max，可由 CreateBotInput.model 覆盖。 */
const MANAGED_MODELS = { qoder: "auto", bailian: "qwen3.7-max" } as const;

/** YAML 双引号字符串转义（"，\，控制字符）。 */
function yamlDoubleQuoted(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/g,
      (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
    )}"`;
}

/**
 * 生成 managed Bot 的 agents.yaml 文本。
 * `logicalName` = 用户输入 name 原样（作为 agent 逻辑名与远程显示名来源）；
 * 环境统一使用 `environments.default` 外部引用 `environmentId`。
 */
export function buildProjectDocument(input: ProjectDocumentInput): string {
  const agentName = input.name;
  const description = input.description ?? "";
  const provider = input.provider;
  // qoder 创建合同固定 auto（透传 input.model 会创建平台拒绝的 Bot）；
  // 百炼 model 白名单由 BotControlPlane.create 前置 fail-closed，这里直接透传。
  const model =
    provider === "bailian" ? (input.model ?? MANAGED_MODELS.bailian) : MANAGED_MODELS[provider];
  const skillLines =
    (input.skills ?? []).length === 0
      ? ["    skills: []"]
      : [
          "    skills:",
          ...(input.skills ?? []).flatMap((skill) => [
            `      - type: ${skill.type}`,
            `        skill_id: ${yamlDoubleQuoted(skill.skillId)}`,
            ...(skill.version === undefined
              ? []
              : [`        version: ${yamlDoubleQuoted(skill.version)}`]),
          ]),
        ];
  const mcpServers = input.mcpServers ?? [];
  const memberAgentIds = input.memberAgentIds ?? [];
  // 用户填写时优先采用其工作指令；省略时保留旧调用方的默认行为。
  const instructions =
    input.instructions?.trim() ||
    (memberAgentIds.length === 0 ? DEFAULT_BOT_INSTRUCTIONS : DEFAULT_COORDINATOR_INSTRUCTIONS);
  const memberLines =
    memberAgentIds.length === 0
      ? []
      : [
          "    multiagent:",
          "      type: coordinator",
          "      agents:",
          ...memberAgentIds.map((agentId) => `        - agent_id: ${yamlDoubleQuoted(agentId)}`),
        ];
  const mcpServerLines =
    mcpServers.length === 0
      ? ["    mcp_servers: []"]
      : [
          "    mcp_servers:",
          ...mcpServers.flatMap((server) => [
            `      - name: ${yamlDoubleQuoted(server.serverCode)}`,
            "        type: official",
            `        display_name: ${yamlDoubleQuoted(server.serverName)}`,
          ]),
        ];
  const toolLines =
    mcpServers.length === 0 && input.builtinTools === undefined
      ? []
      : [
          "    tools:",
          "      builtin:",
          ...(input.builtinTools ?? ["bash", "read", "write", "edit", "glob", "grep"]).map(
            (tool) => `        - ${tool}`,
          ),
          ...(mcpServers.length === 0
            ? []
            : [
                "      mcp:",
                ...mcpServers.flatMap((server) => [
                  "        - type: mcp_toolkit",
                  `          mcp_server_name: ${yamlDoubleQuoted(server.serverCode)}`,
                  "          default_config:",
                  "            enabled: false",
                  "          configs:",
                  ...server.tools
                    .map((tool) => [
                      `            - name: ${yamlDoubleQuoted(tool.name)}`,
                      `              enabled: ${tool.enabled ? "true" : "false"}`,
                    ])
                    .flat(),
                ]),
              ]),
        ];

  const lines: string[] = [
    'version: "1"',
    "",
    "# provider 凭据不落盘；Sync 时由 BotControlPlane 经 SDK providers 覆盖注入。",
    "providers:",
    `  ${provider}: {}`,
    "",
    "defaults:",
    `  provider: ${provider}`,
    "",
    "environments:",
    "  default:",
    `    environment_id: ${yamlDoubleQuoted(input.environmentId)}`,
    "    config:",
    "      type: cloud",
    "",
    "agents:",
    `  ${yamlDoubleQuoted(agentName)}:`,
    `    name: ${yamlDoubleQuoted(agentName)}`,
    `    description: ${yamlDoubleQuoted(description)}`,
    `    model: ${model}`,
    `    instructions: ${yamlDoubleQuoted(instructions)}`,
    ...(input.metadata && Object.keys(input.metadata).length > 0
      ? [
          "    metadata:",
          ...Object.entries(input.metadata).map(
            ([key, value]) => `      ${key}: ${yamlDoubleQuoted(value)}`,
          ),
        ]
      : []),
    "    environment: default",
    ...memberLines,
    ...toolLines,
    ...mcpServerLines,
    ...skillLines,
    "",
  ];
  return lines.join("\n");
}

/** 解析 agents.yaml；损坏时不进入任何 Provider 调用。 */
export function parseProjectYaml(projectYaml: string, scope: string): unknown {
  try {
    return parseYaml(projectYaml);
  } catch {
    throw hostError("invalid-input", `managed scope ${scope} has an unparseable agents.yaml`);
  }
}

/** 从 agents.yaml 中取出唯一 agent 条目（逻辑名 + 可变副本）；形状不符报 invalid-input。 */
function extractSingleAgent(
  existingYaml: string,
  scope: string,
): { raw: Record<string, unknown>; logicalName: string; agent: Record<string, unknown> } {
  const raw = parseProjectYaml(existingYaml, scope);
  if (typeof raw !== "object" || raw === null) {
    throw hostError("invalid-input", `managed scope ${scope} has an invalid agents.yaml`);
  }
  const rawRecord = raw as Record<string, unknown>;
  const agents = rawRecord.agents;
  if (typeof agents !== "object" || agents === null) {
    throw hostError("invalid-input", `managed scope ${scope} agents.yaml has no agents section`);
  }
  const entries = Object.entries(agents as Record<string, unknown>);
  if (entries.length !== 1) {
    throw hostError(
      "invalid-input",
      `managed scope ${scope} agents.yaml must contain exactly one agent`,
    );
  }
  const [logicalName, agentRaw] = entries[0]!;
  if (typeof agentRaw !== "object" || agentRaw === null) {
    throw hostError("invalid-input", `managed scope ${scope} agents.yaml agent entry is invalid`);
  }
  return { raw: rawRecord, logicalName, agent: { ...(agentRaw as Record<string, unknown>) } };
}

/** 读取 Project Document 中由 CloudAgentBot 管理的精确共享标记。 */
export function readAgentShared(yaml: string, scope: string): boolean {
  const { agent } = extractSingleAgent(yaml, scope);
  const metadata = agent.metadata;
  if (metadata === undefined) return false;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw hostError("invalid-input", `managed scope ${scope} has invalid metadata`);
  }
  return (metadata as Record<string, unknown>).openagentbot_shared === "true";
}

/** 写入 CloudAgentBot API Key 分组标记，保留 Agent 其余 metadata。 */
export function mergeAgentKeyScope(yaml: string, keyScopeId: string, scope: string): string {
  const { raw, logicalName, agent } = extractSingleAgent(yaml, scope);
  const current = agent.metadata;
  if (current !== undefined && (typeof current !== "object" || current === null || Array.isArray(current))) {
    throw hostError("invalid-input", `managed scope ${scope} has invalid metadata`);
  }
  const metadata = { ...((current ?? {}) as Record<string, unknown>) };
  if (metadata[API_KEY_SCOPE_METADATA_KEY] === keyScopeId) return yaml;
  metadata[API_KEY_SCOPE_METADATA_KEY] = keyScopeId;
  agent.metadata = metadata;
  return stringifyYaml({ ...raw, agents: { [logicalName]: agent } });
}

/** 只修改共享保留键，保留其余 metadata 与 Project Document 字段。 */
export function mergeAgentShared(
  yaml: string,
  shared: boolean,
  provider: "qoder" | "bailian",
  scope: string,
): string {
  const { raw, logicalName, agent } = extractSingleAgent(yaml, scope);
  const current = agent.metadata;
  if (current !== undefined && (typeof current !== "object" || current === null || Array.isArray(current))) {
    throw hostError("invalid-input", `managed scope ${scope} has invalid metadata`);
  }
  const metadata = { ...((current ?? {}) as Record<string, unknown>) };
  if (shared) metadata.openagentbot_shared = "true";
  // Qoder updates retain omitted metadata keys, and the public SDK accepts only
  // string metadata. An empty value is its clear marker; Bailian replaces metadata.
  else if (provider === "qoder") metadata.openagentbot_shared = "";
  else delete metadata.openagentbot_shared;
  if (Object.keys(metadata).length > 0) agent.metadata = metadata;
  else delete agent.metadata;
  return stringifyYaml({ ...raw, agents: { [logicalName]: agent } });
}

/**
 * 读取 agent.multiagent 为外部 Agent ID roster（缺键 = 空数组）。
 *
 * 严格读取是产品所有权门禁：一个 scope 只拥有一个 Agent，因此逻辑名成员、
 * 混合成员、未知 type 或其他形状都表示该文件已离开本客户端支持的 Managed Bot
 * 形状，一律 invalid-input，不猜测也不自动接管。
 */
function readMemberAgentIds(agent: Record<string, unknown>, scope: string): string[] {
  const declaration = agent.multiagent;
  if (declaration === undefined) return [];
  if (typeof declaration !== "object" || declaration === null || Array.isArray(declaration)) {
    throw hostError("invalid-input", `managed scope ${scope} agents.yaml has invalid multiagent`);
  }
  const decl = declaration as Record<string, unknown>;
  if (decl.type !== "coordinator") {
    throw hostError(
      "invalid-input",
      `managed scope ${scope} agents.yaml multiagent type must be coordinator`,
    );
  }
  const members = decl.agents;
  if (!Array.isArray(members) || members.length === 0 || members.length > BOT_MEMBERS_MAX) {
    throw hostError(
      "invalid-input",
      `managed scope ${scope} agents.yaml multiagent must declare 1-${BOT_MEMBERS_MAX} members`,
    );
  }
  const agentIds = members.map((member) => {
    if (typeof member !== "object" || member === null) {
      throw hostError(
        "invalid-input",
        `managed scope ${scope} agents.yaml multiagent members must be external agent_id references`,
      );
    }
    return (member as Record<string, unknown>).agent_id;
  });
  const parsed = parseMemberAgentIds(agentIds);
  if (parsed === null) {
    throw hostError(
      "invalid-input",
      `managed scope ${scope} agents.yaml multiagent member agent ids are invalid`,
    );
  }
  return parsed;
}

/** 从 agents.yaml 读出可编辑字段与成员 roster（getConfiguration 与 update 共用同一理解）。 */
export function readEditableAgentDocument(yaml: string, scope: string): EditableAgentDocument {
  const { logicalName, agent } = extractSingleAgent(yaml, scope);
  const mcpServers = readMcpBindings(agent, scope);
  const builtinTools = readBuiltinTools(agent, scope);
  // instructions 与字符串 model 必须存在；缺失/非字符串说明形状不是本客户端支持的单 Agent。
  if (typeof agent.instructions !== "string") {
    throw hostError(
      "invalid-input",
      `managed scope ${scope} agents.yaml agent is missing string instructions`,
    );
  }
  if (typeof agent.model !== "string") {
    throw hostError(
      "invalid-input",
      `managed scope ${scope} agents.yaml agent is missing string model`,
    );
  }
  return {
    logicalName,
    configuration: {
      // name 缺失时沿用逻辑 key 作为显示名；description 缺失映射为空字符串。
      name: typeof agent.name === "string" ? agent.name : logicalName,
      description: typeof agent.description === "string" ? agent.description : "",
      instructions: agent.instructions,
      model: agent.model,
      ...(builtinTools === undefined ? {} : { builtinTools }),
      skills: readSkillRefs(agent.skills, scope),
      ...(mcpServers.length > 0 ? { mcpServers } : {}),
      memberAgentIds: readMemberAgentIds(agent, scope),
    },
  };
}

/**
 * 把 UpdateBotInput（四字段 + 完整成员 roster）合并进现有 agents.yaml，产出完整新版文本。
 * - 只替换 agent.name/description/instructions/model 与 agent.multiagent；逻辑资源 key 不变；
 * - 未提交 builtinTools 时保留 tools.builtin；显式提交时只替换该集合并保留 MCP；
 * - environment、files、memory、metadata、未知键以及顶层结构继续保留；
 * - description/instructions 空串即清除；成员空数组删除 multiagent 键（完整输入，不接受 partial）。
 */
export function mergeEditableAgentDocument(
  yaml: string,
  input: UpdateBotInput,
  scope: string,
): { yaml: string; configuration: ManagedBotConfiguration } {
  const { raw, logicalName, agent } = extractSingleAgent(yaml, scope);
  agent.name = input.name;
  agent.description = input.description;
  agent.instructions = input.instructions;
  agent.model = input.model;
  const skills = input.skills ?? readSkillRefs(agent.skills, scope);
  agent.skills = skills.map((skill) => ({
    type: skill.type,
    skill_id: skill.skillId,
    ...(skill.version === undefined ? {} : { version: skill.version }),
  }));
  const mcpServers = input.mcpServers ?? readMcpBindings(agent, scope);
  if (input.mcpServers !== undefined) writeMcpBindings(agent, mcpServers);
  if (input.builtinTools !== undefined) {
    const existingTools = agent.tools as Record<string, unknown> | undefined;
    const enabled = new Set(
      input.builtinTools.map((tool) => tool.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()),
    );
    const permissions = existingTools?.permissions as Record<string, unknown> | undefined;
    agent.tools = {
      ...existingTools,
      builtin: input.builtinTools,
      ...(permissions === undefined
        ? {}
        : {
            permissions: Object.fromEntries(
              Object.entries(permissions).filter(([name]) =>
                enabled.has(name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()),
              ),
            ),
          }),
    };
  }
  // 现有 roster 必须能按其自身形状读取：损坏或逻辑名成员形状不静默改写（所有权门禁同读取）。
  readMemberAgentIds(agent, scope);
  if (input.memberAgentIds.length > 0) {
    agent.multiagent = {
      type: "coordinator",
      agents: input.memberAgentIds.map((agentId) => ({ agent_id: agentId })),
    };
  } else {
    delete agent.multiagent;
  }
  return {
    yaml: stringifyYaml({ ...raw, agents: { [logicalName]: agent } }),
    configuration: {
      name: input.name,
      description: input.description,
      instructions: input.instructions,
      model: input.model,
      ...(input.builtinTools === undefined ? {} : { builtinTools: input.builtinTools }),
      skills,
      ...(mcpServers.length > 0 ? { mcpServers } : {}),
      memberAgentIds: input.memberAgentIds,
    },
  };
}

function readBuiltinTools(agent: Record<string, unknown>, scope: string): string[] | undefined {
  if (agent.tools === undefined) return undefined;
  if (typeof agent.tools !== "object" || agent.tools === null || Array.isArray(agent.tools)) {
    throw hostError("invalid-input", `managed scope ${scope} has invalid tools`);
  }
  const builtin = (agent.tools as Record<string, unknown>).builtin;
  if (builtin === undefined) return undefined;
  if (!Array.isArray(builtin) || builtin.some((tool) => typeof tool !== "string")) {
    throw hostError("invalid-input", `managed scope ${scope} has invalid builtin tools`);
  }
  return builtin;
}

function readMcpBindings(agent: Record<string, unknown>, scope: string): BotMcpBinding[] {
  const servers = agent.mcp_servers;
  if (servers === undefined) return [];
  if (!Array.isArray(servers) || servers.length > 20) {
    throw hostError("invalid-input", `managed scope ${scope} agents.yaml has invalid MCP servers`);
  }
  const tools = agent.tools as { mcp?: unknown } | undefined;
  const toolkits = Array.isArray(tools?.mcp) ? tools.mcp : [];
  return servers.flatMap((item) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const raw = item as Record<string, unknown>;
    if (raw.type !== "official" || typeof raw.name !== "string" || raw.name.length === 0) {
      return [];
    }
    const toolkit = toolkits.find(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        (value as Record<string, unknown>).mcp_server_name === raw.name,
    ) as Record<string, unknown> | undefined;
    if (!toolkit || !Array.isArray(toolkit.configs) || toolkit.configs.length === 0) {
      return [];
    }
    const configs = toolkit.configs.map((value) => {
      if (typeof value !== "object" || value === null) {
        throw hostError("invalid-input", `managed scope ${scope} MCP ${raw.name} has invalid tool`);
      }
      const config = value as Record<string, unknown>;
      if (typeof config.name !== "string" || typeof config.enabled !== "boolean") {
        throw hostError("invalid-input", `managed scope ${scope} MCP ${raw.name} has invalid tool`);
      }
      return { name: config.name, enabled: config.enabled };
    });
    const defaultPermission = toolkit.default_permission;
    return [
      {
        type: "official" as const,
        serverCode: raw.name,
        serverName: typeof raw.display_name === "string" ? raw.display_name : raw.name,
        tools: configs,
        permissionPolicy: defaultPermission === "ask" ? "always_ask" : "always_allow",
      },
    ];
  });
}

function writeMcpBindings(agent: Record<string, unknown>, bindings: BotMcpBinding[]): void {
  agent.mcp_servers = bindings.map((binding) => ({
    type: "official",
    name: binding.serverCode,
    display_name: binding.serverName,
  }));
  const currentTools =
    typeof agent.tools === "object" && agent.tools !== null
      ? (agent.tools as Record<string, unknown>)
      : { builtin: ["bash", "read", "write", "edit", "glob", "grep"] };
  currentTools.mcp = bindings.map((binding) => ({
    type: "mcp_toolkit",
    mcp_server_name: binding.serverCode,
    default_config: { enabled: false },
    configs: binding.tools,
  }));
  agent.tools = currentTools;
}

function readSkillRefs(value: unknown, scope: string): BotSkillRef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw hostError("invalid-input", `managed scope ${scope} agents.yaml has invalid skills`);
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw hostError(
        "invalid-input",
        `managed scope ${scope} uses unsupported logical skill references`,
      );
    }
    const raw = item as Record<string, unknown>;
    if (raw.type !== "custom" && raw.type !== "official") {
      throw hostError("invalid-input", `managed scope ${scope} has invalid skill type`);
    }
    if (typeof raw.skill_id !== "string" || raw.skill_id.length === 0) {
      throw hostError("invalid-input", `managed scope ${scope} has invalid skill id`);
    }
    if (
      raw.version !== undefined &&
      (typeof raw.version !== "string" || raw.version.length === 0)
    ) {
      throw hostError("invalid-input", `managed scope ${scope} has invalid skill version`);
    }
    const key = `${raw.type}:${raw.skill_id}`;
    if (seen.has(key))
      throw hostError("invalid-input", `managed scope ${scope} has duplicate skills`);
    seen.add(key);
    return {
      type: raw.type,
      skillId: raw.skill_id,
      ...(typeof raw.version === "string" ? { version: raw.version } : {}),
    };
  });
}
