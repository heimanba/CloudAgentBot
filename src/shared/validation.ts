/**
 * IPC 入参形状校验。Main 是 Renderer 输入的唯一信任边界（validation.md）；
 * 不合法输入一律稳定 invalid-input，不把 TypeError 收敛成 unavailable。
 */

import type {
  BotRef,
  BotSkillRef,
  BotMcpBinding,
  ChatRef,
  ConnectInput,
  CreateBotInput,
  CreateDeploymentInput,
  DeploymentRef,
  MessageAttachment,
  ReconnectInput,
  UpdateBotInput,
  UpdateDeploymentInput,
  UpdateConnectionInput,
  UploadFileInput,
} from "./models";
import { BAILIAN_BUILTIN_TOOLS, QODER_BUILTIN_TOOLS } from "./builtin-tools";

const KNOWN_BUILTIN_TOOLS = new Set<string>([...BAILIAN_BUILTIN_TOOLS, ...QODER_BUILTIN_TOOLS]);

function parseBuiltinTools(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > KNOWN_BUILTIN_TOOLS.size) return null;
  if (value.some((tool) => typeof tool !== "string" || !KNOWN_BUILTIN_TOOLS.has(tool))) return null;
  if (new Set(value).size !== value.length) return null;
  return value as string[];
}

const BAILIAN_WORKSPACE_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function parseConnectInput(value: unknown): ConnectInput | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.provider !== "string" || v.provider.length === 0) return null;
  if (typeof v.displayName !== "string" || v.displayName.length === 0) return null;
  if (typeof v.credential !== "string" || v.credential.length === 0) return null;
  if (
    v.workspaceId !== undefined &&
    (typeof v.workspaceId !== "string" || v.workspaceId.length === 0)
  )
    return null;
  if (
    v.provider === "bailian" &&
    (typeof v.workspaceId !== "string" || !BAILIAN_WORKSPACE_ID.test(v.workspaceId.trim()))
  )
    return null;
  return {
    provider: v.provider,
    displayName: v.displayName,
    credential: v.credential,
    ...(typeof v.workspaceId === "string" ? { workspaceId: v.workspaceId } : {}),
  };
}

export function parseConnectionId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * 可选 Environment ID：undefined 合法（走默认解析），非空字符串合法，其他一律 null。
 * 与 parseConnectionId 的区别在于允许 undefined，用于 setupEnvironment 的可选参数。
 */
export function parseOptionalEnvironmentId(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseReconnectInput(value: unknown): ReconnectInput | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.connectionId !== "string" || v.connectionId.length === 0) return null;
  if (typeof v.credential !== "string" || v.credential.length === 0) return null;
  return { connectionId: v.connectionId, credential: v.credential };
}

export function parseUpdateConnectionInput(value: unknown): UpdateConnectionInput | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.connectionId !== "string" || v.connectionId.length === 0) return null;
  if (typeof v.displayName !== "string" || v.displayName.trim().length === 0) return null;
  if (v.workspaceId !== undefined && typeof v.workspaceId !== "string") return null;
  if (v.credential !== undefined && typeof v.credential !== "string") return null;
  return {
    connectionId: v.connectionId,
    displayName: v.displayName,
    ...(typeof v.workspaceId === "string" ? { workspaceId: v.workspaceId } : {}),
    ...(typeof v.credential === "string" ? { credential: v.credential } : {}),
  };
}

export function parseBotRef(value: unknown): BotRef | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.connectionId !== "string" || v.connectionId.length === 0) return null;
  if (typeof v.agentId !== "string" || v.agentId.length === 0) return null;
  return { connectionId: v.connectionId, agentId: v.agentId };
}

export function parseChatRef(value: unknown): ChatRef | null {
  const bot = parseBotRef(value);
  if (bot === null) return null;
  const sessionId = (value as Record<string, unknown>).sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  return { ...bot, sessionId };
}

export function parseDeploymentRef(value: unknown): DeploymentRef | null {
  const bot = parseBotRef(value);
  if (bot === null) return null;
  const deploymentId = (value as Record<string, unknown>).deploymentId;
  if (typeof deploymentId !== "string" || deploymentId.length === 0) return null;
  return { ...bot, deploymentId };
}

const CRON_EXPRESSION = /^\S+( \S+){4}$/;

function parseScheduleInput(
  value: unknown,
): { expression: string; timezone: string } | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.expression !== "string" || !CRON_EXPRESSION.test(v.expression)) return undefined;
  if (typeof v.timezone !== "string" || v.timezone.length === 0 || v.timezone.length > 64) {
    return undefined;
  }
  return { expression: v.expression, timezone: v.timezone };
}

function parseIsoDateTime(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return undefined;
  return value;
}

function parseOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return undefined;
  return trimmed;
}

export function parseCreateDeploymentInput(value: unknown): CreateDeploymentInput | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.agentId !== "string" || v.agentId.length === 0) return null;
  const name = parseOptionalText(v.name, 256);
  const prompt = parseOptionalText(v.prompt, 8192);
  if (name === undefined || prompt === undefined) return null;
  const schedule = parseScheduleInput(v.schedule);
  if (v.schedule !== undefined && schedule === undefined) return null;
  const expiresAt = parseIsoDateTime(v.expiresAt);
  if (v.expiresAt !== undefined && (expiresAt === undefined || expiresAt === null)) return null;
  const input: CreateDeploymentInput = { agentId: v.agentId, name, prompt };
  const description = parseOptionalText(v.description, 1024);
  if (description !== undefined) input.description = description;
  if (schedule) input.schedule = schedule;
  if (expiresAt) input.expiresAt = expiresAt;
  if (v.shared === true) input.shared = true;
  return input;
}

export function parseUpdateDeploymentInput(value: unknown): UpdateDeploymentInput | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const input: UpdateDeploymentInput = {};
  if (v.name !== undefined) {
    const name = parseOptionalText(v.name, 256);
    if (name === undefined) return null;
    input.name = name;
  }
  if (v.prompt !== undefined) {
    const prompt = parseOptionalText(v.prompt, 8192);
    if (prompt === undefined) return null;
    input.prompt = prompt;
  }
  if (v.description !== undefined) {
    if (v.description === null) {
      input.description = "";
    } else {
      const description = parseOptionalText(v.description, 1024);
      if (description === undefined) return null;
      input.description = description;
    }
  }
  if (v.schedule !== undefined) {
    const schedule = parseScheduleInput(v.schedule);
    if (schedule === undefined) return null;
    input.schedule = schedule;
  }
  if (v.expiresAt !== undefined) {
    const expiresAt = parseIsoDateTime(v.expiresAt);
    if (expiresAt === undefined) return null;
    input.expiresAt = expiresAt;
  }
  if (Object.keys(input).length === 0) return null;
  return input;
}

/** 消息文本：允许空串（携带附件时可无文本）；undefined/null 归一为空串；非字符串拒绝。 */
export function parseSendMessageText(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  return value;
}

/** 单条消息附件数量上限（产品保护，非 Provider 上限）。 */
export const MESSAGE_ATTACHMENTS_MAX = 10;
/** 单文件字节上限：与百炼 multipart 直传一致（50 MB）。 */
export const UPLOAD_FILE_MAX_BYTES = 50 * 1024 * 1024;
/** 文件名长度上限。 */
export const UPLOAD_FILENAME_MAX = 255;

/**
 * 消息附件 roster：undefined 归一为空数组；数组 ≤ 上限；
 * 每项 fileId/filename trim 后非空、fileId 互不重复，mimeType 可选。
 */
export function parseMessageAttachments(value: unknown): MessageAttachment[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MESSAGE_ATTACHMENTS_MAX) return null;
  const seen = new Set<string>();
  const result: MessageAttachment[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const raw = item as Record<string, unknown>;
    if (typeof raw.fileId !== "string" || raw.fileId.trim().length === 0) return null;
    if (typeof raw.filename !== "string" || raw.filename.trim().length === 0) return null;
    if (raw.mimeType !== undefined && typeof raw.mimeType !== "string") return null;
    const fileId = raw.fileId.trim();
    if (seen.has(fileId)) return null;
    seen.add(fileId);
    result.push({
      fileId,
      filename: raw.filename.trim(),
      ...(typeof raw.mimeType === "string" && raw.mimeType.length > 0
        ? { mimeType: raw.mimeType }
        : {}),
    });
  }
  return result;
}

/** 上传文件入参：filename 非空 ≤255；mimeType 字符串；bytes 为 1..50MB 的 ArrayBuffer。 */
export function parseUploadFileInput(value: unknown): UploadFileInput | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.filename !== "string") return null;
  const filename = v.filename.trim();
  if (filename.length === 0 || filename.length > UPLOAD_FILENAME_MAX) return null;
  if (typeof v.mimeType !== "string") return null;
  if (!(v.bytes instanceof ArrayBuffer)) return null;
  if (v.bytes.byteLength === 0 || v.bytes.byteLength > UPLOAD_FILE_MAX_BYTES) return null;
  return { filename, mimeType: v.mimeType, bytes: v.bytes };
}

/** 协作成员 roster 的产品保护上限（非 Provider 上限）。 */
export const BOT_MEMBERS_MAX = 20;

/**
 * 协作成员 roster 的信任边界：每项是 trim 后非空、互不重复的外部 Agent ID。
 * - `undefined` 仅供 create 使用，固定归一化为空数组；
 * - update 由调用方先用 `Object.hasOwn` 区分“缺字段”与“显式空数组”；
 * - 返回 trim 后、保持原顺序的新数组；任何其他形状或重复返回 null。
 */
export function parseMemberAgentIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > BOT_MEMBERS_MAX) return null;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const agentId = item.trim();
    if (agentId.length === 0 || seen.has(agentId)) return null;
    seen.add(agentId);
    result.push(agentId);
  }
  return result;
}

/** 创建 Bot 输入：name 必填非空，description/instructions/model 可选。 */
export function parseCreateBotInput(value: unknown): CreateBotInput | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || v.name.trim().length === 0) return null;
  if (v.description !== undefined && typeof v.description !== "string") return null;
  if (
    v.instructions !== undefined &&
    (typeof v.instructions !== "string" || v.instructions.length > BOT_INSTRUCTIONS_MAX)
  )
    return null;
  if (v.model !== undefined && typeof v.model !== "string") return null;
  const skills = parseBotSkillRefs(v.skills);
  if (skills === null) return null;
  const mcpServers = parseBotMcpBindings(v.mcpServers);
  if (mcpServers === null) return null;
  const builtinTools = v.builtinTools === undefined ? undefined : parseBuiltinTools(v.builtinTools);
  if (builtinTools === null) return null;
  const memberAgentIds = parseMemberAgentIds(v.memberAgentIds);
  if (memberAgentIds === null) return null;
  if (
    v.metadata !== undefined &&
    (typeof v.metadata !== "object" || v.metadata === null || Array.isArray(v.metadata))
  )
    return null;
  const metadata = v.metadata as Record<string, unknown> | undefined;
  if (
    metadata &&
    (Object.keys(metadata).length > 8 ||
      Object.entries(metadata).some(
        ([key, item]) =>
          !/^[a-z][a-z0-9_]{0,63}$/.test(key) || typeof item !== "string" || item.length > 256,
      ))
  )
    return null;
  const model =
    typeof v.model === "string" && v.model.trim().length > 0 ? v.model.trim() : undefined;
  return {
    name: v.name,
    description: v.description,
    ...(typeof v.instructions === "string" ? { instructions: v.instructions } : {}),
    ...(model ? { model } : {}),
    skills,
    ...(builtinTools === undefined ? {} : { builtinTools }),
    ...(v.mcpServers === undefined ? {} : { mcpServers }),
    memberAgentIds,
    ...(metadata ? { metadata: metadata as Record<string, string> } : {}),
  };
}

export const BOT_SKILLS_MAX = 20;
export const BOT_MCP_SERVERS_MAX = 20;
export const BOT_MCP_TOOLS_MAX = 128;

export function parseBotMcpBindings(value: unknown): BotMcpBinding[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > BOT_MCP_SERVERS_MAX) return null;
  const serverCodes = new Set<string>();
  const result: BotMcpBinding[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const raw = item as Record<string, unknown>;
    if (raw.type !== "official") return null;
    if (typeof raw.serverCode !== "string" || raw.serverCode.trim().length === 0) return null;
    if (typeof raw.serverName !== "string" || raw.serverName.trim().length === 0) return null;
    if (raw.permissionPolicy !== "always_allow" && raw.permissionPolicy !== "always_ask") {
      return null;
    }
    if (
      !Array.isArray(raw.tools) ||
      raw.tools.length === 0 ||
      raw.tools.length > BOT_MCP_TOOLS_MAX
    ) {
      return null;
    }
    const serverCode = raw.serverCode.trim();
    if (serverCodes.has(serverCode)) return null;
    serverCodes.add(serverCode);
    const toolNames = new Set<string>();
    const tools = raw.tools.map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const tool = item as Record<string, unknown>;
      if (typeof tool.name !== "string" || tool.name.trim().length === 0) return null;
      if (typeof tool.enabled !== "boolean") return null;
      const name = tool.name.trim();
      if (toolNames.has(name)) return null;
      toolNames.add(name);
      return { name, enabled: tool.enabled };
    });
    if (tools.some((tool) => tool === null) || !tools.some((tool) => tool?.enabled)) return null;
    result.push({
      type: "official",
      serverCode,
      serverName: raw.serverName.trim(),
      permissionPolicy: raw.permissionPolicy,
      tools: tools as BotMcpBinding["tools"],
    });
  }
  return result;
}

/** Skill 引用是完整替换集合；按 type + skillId 唯一，版本可选（百炼在控制面进一步要求）。 */
export function parseBotSkillRefs(value: unknown): BotSkillRef[] | null {
  if (!Array.isArray(value) || value.length > BOT_SKILLS_MAX) return null;
  const seen = new Set<string>();
  const result: BotSkillRef[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const raw = item as Record<string, unknown>;
    if (raw.type !== "custom" && raw.type !== "official") return null;
    if (typeof raw.skillId !== "string" || raw.skillId.trim().length === 0) return null;
    if (
      raw.version !== undefined &&
      (typeof raw.version !== "string" || raw.version.trim().length === 0)
    ) {
      return null;
    }
    const skillId = raw.skillId.trim();
    const key = `${raw.type}:${skillId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    result.push({
      type: raw.type,
      skillId,
      ...(typeof raw.version === "string" ? { version: raw.version.trim() } : {}),
    });
  }
  return result;
}

/** Managed Bot Configuration 的产品保护上限（非 Provider 上限，见 bot-edit-provider-evidence.md §9）。 */
export const BOT_NAME_MAX = 80;
export const BOT_DESCRIPTION_MAX = 500;
export const BOT_INSTRUCTIONS_MAX = 20_000;

/**
 * 更新 Bot 输入：完整四字段（name/description/instructions/model）加完整成员 roster，
 * 不接受 partial patch。
 * - name：trim 后 1–80 字符；
 * - description：允许空串清除，最多 500 字符；
 * - instructions：允许空串清除，最多 20,000 字符（产品保护上限，不宣称为 Provider 上限）；
 * - model：非空字符串，最终有效性由 Provider 在 Sync 时确认；
 * - memberAgentIds：必须是显式数组（空数组 = 清除全部成员）；缺字段即 partial patch。
 * 多余属性不进入解析结果。
 */
export function parseUpdateBotInput(value: unknown): UpdateBotInput | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string") return null;
  if (typeof v.description !== "string") return null;
  if (typeof v.instructions !== "string") return null;
  if (typeof v.model !== "string") return null;
  // 成员 roster 与四字段同属完整提交：字段缺失无法与“未修改”区分，直接拒绝。
  if (!Object.hasOwn(v, "memberAgentIds")) return null;
  const skills = parseBotSkillRefs(v.skills);
  if (skills === null) return null;
  const mcpServers = parseBotMcpBindings(v.mcpServers);
  if (mcpServers === null) return null;
  const builtinTools = v.builtinTools === undefined ? undefined : parseBuiltinTools(v.builtinTools);
  if (builtinTools === null) return null;
  const memberAgentIds = parseMemberAgentIds(v.memberAgentIds);
  if (memberAgentIds === null) return null;
  const name = v.name.trim();
  if (name.length === 0 || name.length > BOT_NAME_MAX) return null;
  if (v.description.length > BOT_DESCRIPTION_MAX) return null;
  if (v.instructions.length > BOT_INSTRUCTIONS_MAX) return null;
  if (v.model.trim().length === 0) return null;
  return {
    name,
    description: v.description,
    instructions: v.instructions,
    model: v.model,
    skills,
    ...(builtinTools === undefined ? {} : { builtinTools }),
    ...(v.mcpServers === undefined ? {} : { mcpServers }),
    memberAgentIds,
  };
}

/** 订阅 id 是非空字符串（Renderer 生成，Main 用于事件路由）。 */
export function parseSubscriptionId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
