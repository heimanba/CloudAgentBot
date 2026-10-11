/**
 * 共享契约：跨 Preload 的类型与错误。
 * 不包含 Node、Electron、OpenAgentPack 或 Provider wire 类型。
 */

export type ConnectionId = string;

export interface BotRef {
  connectionId: ConnectionId;
  agentId: string;
}

export interface ChatRef {
  connectionId: ConnectionId;
  agentId: string;
  sessionId: string;
}

export type HostErrorCode =
  | "not-connected"
  | "authentication"
  | "permission"
  | "not-found"
  | "conflict"
  | "rate-limited"
  | "unavailable"
  | "invalid-input"
  | "managed-state-missing"
  | "sync-incomplete";

export interface HostError {
  code: HostErrorCode;
  message: string;
}

export interface BotView {
  ref: BotRef;
  name: string;
  description?: string;
  model?: string;
  remoteStatus?: string;
  management: "managed" | "remote-only" | "state-missing";
  /** Provider 当前 metadata 中精确的 CloudAgentBot 共享标记；不代表访问授权。 */
  shared?: boolean;
  /** CloudAgentBot 内的 API Key 分组状态；不表示 Provider 访问权限。 */
  keyScope?: "current" | "other" | "ungrouped";
  /** Provider 当前远程 roster；缺失表示无法判断，空数组表示普通 Bot。 */
  collaboration?: CollaborationRosterView;
}

export interface CollaborationRosterView {
  memberAgentIds: string[];
}

export interface ChatView {
  ref: ChatRef;
  title: string;
  remoteStatus?: string;
  updatedAt?: string;
  /** Provider 当前 metadata 中精确的 CloudAgentBot 共享标记；不代表访问授权。 */
  shared?: boolean;
  /** CloudAgentBot 内的 API Key 分组状态；不表示 Provider 访问权限。 */
  keyScope?: "current" | "other" | "ungrouped";
  /** 此 Session 创建时的 Agent roster 快照，不随 Bot 当前配置变化。 */
  collaboration?: CollaborationRosterView;
}

/** 消息内嵌的文件附件（展示用）：由消息内容块解析而来。 */
export interface MessageFileAttachmentView {
  fileId: string;
  kind: "image" | "video" | "file";
  filename?: string;
}

export interface MessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: MessageFileAttachmentView[];
  createdAt?: string;
}

export interface ChatTimelineItemBase {
  id: string;
  rawType: string;
  occurredAt?: string;
  threadId?: string;
}

export type ChatTimelineItemView =
  | (ChatTimelineItemBase & {
      kind: "message";
      role: "user" | "assistant";
      content: string;
      attachments?: MessageFileAttachmentView[];
    })
  | (ChatTimelineItemBase & {
      kind: "delegation";
      action: "created" | "sent" | "received";
      /** Provider 事件中的名称，不等价于已验证的远程 Agent ID。 */
      agentName?: string;
      content?: string;
    })
  | (ChatTimelineItemBase & { kind: "thinking"; content: string })
  | (ChatTimelineItemBase & {
      kind: "tool-call";
      name: string;
      serverName?: string;
      input?: unknown;
      permission?: unknown;
    })
  | (ChatTimelineItemBase & {
      kind: "tool-result";
      toolUseId?: string;
      content: string;
      isError: boolean;
    })
  | (ChatTimelineItemBase & {
      kind: "artifact";
      fileId: string;
      filename: string;
      size?: number;
      contentType?: string;
    })
  | (ChatTimelineItemBase & {
      kind: "status";
      scope: "session" | "thread";
      status: string;
      stopReason?: string;
    })
  | (ChatTimelineItemBase & { kind: "usage"; credits?: number; isError: boolean })
  | (ChatTimelineItemBase & { kind: "error"; message: string })
  | (ChatTimelineItemBase & { kind: "unknown" });

export interface ChatArtifactView {
  ref: ChatRef;
  fileId: string;
  filename: string;
  contentType?: string;
  size?: number;
  /** Provider 返回的短效下载地址；仅在用户动作触发时解析。 */
  downloadUrl: string;
  /** HTML 安全预览需要的内容；由 Main 获取，Renderer 不直接访问 Provider。 */
  content?: string;
  /** 图片预览用的二进制内容；由 Main 获取，Renderer 不直接访问 Provider。 */
  previewData?: { contentType: string; bytes: ArrayBuffer };
}

/** Deployment（定时任务）引用。身份是 Connection + remoteAgentId + deploymentId。 */
export interface DeploymentRef {
  connectionId: ConnectionId;
  agentId: string;
  deploymentId: string;
}

export interface DeploymentScheduleView {
  /** 标准 5 段 cron 表达式。 */
  expression: string;
  /** IANA 时区。 */
  timezone: string;
  /** Provider 计算的下一次触发时间（ISO 8601）。 */
  nextRunAt?: string;
  lastRunAt?: string;
}

export interface DeploymentView {
  ref: DeploymentRef;
  name: string;
  description?: string;
  status: "active" | "paused" | "archived";
  /** 每次触发发送给 Agent 的固定 prompt。 */
  prompt: string;
  /** 缺省表示纯手动触发。 */
  schedule?: DeploymentScheduleView;
  /**
   * 到期日期（ISO 8601，可选）。公开 API 无到期字段，该值经 metadata 保存；
   * 到期后 UI 标记「已到期」并引导手动暂停，不做本地定时暂停。
   */
  expiresAt?: string;
  /** Provider 当前 metadata 中精确的 CloudAgentBot 共享标记；不代表访问授权。 */
  shared?: boolean;
  /** CloudAgentBot 内的 API Key 分组状态；不表示 Provider 访问权限。 */
  keyScope?: "current" | "other" | "ungrouped";
  createdAt?: string;
  updatedAt?: string;
}

export interface DeploymentRunView {
  id: string;
  deploymentId: string;
  /** 异步 Session 创建完成前为空。 */
  sessionId?: string;
  trigger: "manual" | "schedule";
  status: "running" | "succeeded" | "failed";
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface DeploymentScheduleInput {
  expression: string;
  timezone: string;
}

export interface CreateDeploymentInput {
  agentId: string;
  name: string;
  prompt: string;
  description?: string;
  /** 缺省创建纯手动触发的 Deployment。 */
  schedule?: DeploymentScheduleInput;
  /** 到期日期（ISO 8601）；经 metadata 保存，到期后 UI 引导手动暂停。 */
  expiresAt?: string;
  /** 创建时直接标记共享。 */
  shared?: boolean;
}

export interface UpdateDeploymentInput {
  name?: string;
  prompt?: string;
  description?: string;
  /** 传 null 清除定时触发，变为纯手动。 */
  schedule?: DeploymentScheduleInput | null;
  /** 传 null 清除到期日期。 */
  expiresAt?: string | null;
}

export interface ChatDetailView {
  chat: ChatView;
  messages: MessageView[];
  events: ChatTimelineItemView[];
}

export interface ConnectionView {
  id: ConnectionId;
  provider: string;
  displayName: string;
  credentialStored: boolean;
  /** 此 Connection 下持久化的 Managed Bot 本地管理资料数量。 */
  managedBotDataCount: number;
  workspaceId?: string;
  /**
   * 该 Connection 的运行环境是否已设置完成（defaultEnvironmentId 已绑定）。
   * Renderer 只看此布尔值决定是否允许创建 Bot/Chat；不接收 Environment ID 或名称。
   */
  environmentReady: boolean;
}

export interface RemoveConnectionOptions {
  /** 明确授权同时永久删除 Managed Bot 的本地 IaC 资料；不影响 Provider 远程资源。 */
  removeManagedBotData: boolean;
}

/**
 * setupEnvironment 的结果：环境就绪，或返回候选列表要求用户显式选择。
 * selection-required 不产生任何本地写入；Renderer 重新提交 environmentId 完成设置。
 * ready 分支携带 environmentId 仅供 Main 内部持久化，不跨 IPC 到 Renderer。
 */
export type EnvironmentSetupResult =
  | { status: "ready"; environmentId: string }
  | { status: "selection-required"; candidates: EnvironmentCandidate[] };

/**
 * 跨 IPC 到 Renderer 的 setupEnvironment 结果：ready 分支不携带 environmentId。
 * Renderer 只需知道设置成功，无需远程 ID（§17：Renderer 不持有默认远程 ID）。
 */
export type EnvironmentSetupViewResult =
  { status: "ready" } | { status: "selection-required"; candidates: EnvironmentCandidate[] };

export interface ConnectInput {
  provider: string;
  displayName: string;
  credential: string;
  workspaceId?: string;
}

export interface ReconnectInput {
  connectionId: string;
  credential: string;
}

export interface UpdateConnectionInput {
  connectionId: ConnectionId;
  displayName: string;
  workspaceId?: string;
  credential?: string;
}

export interface CreateBotInput {
  name: string;
  description?: string;
  /** 创建时用户填写的工作指令；省略时使用普通或协作 Bot 的默认指令。 */
  instructions?: string;
  /** 创建时的模型 ID（百炼可选，缺省 qwen3.7-max；qoder 固定 auto，忽略该字段）。 */
  model?: string;
  /** 省略时沿用 Provider 默认工具；显式数组完整替换内置工具集合。 */
  builtinTools?: string[];
  skills?: BotSkillRef[];
  /** 百炼官方 MCP 的声明式绑定；Qoder 首版不开放该入口。 */
  mcpServers?: BotMcpBinding[];
  /**
   * 协作成员的外部 Agent ID roster；省略等价空数组（创建普通 Bot，向后兼容）。
   * 只引用本 Connection 上的远程 Agent，不把成员资料复制进当前 scope。
   */
  memberAgentIds?: string[];
  /** 创建来源标记；随 Agent IaC 写入 Provider metadata。 */
  metadata?: Record<string, string>;
}

export interface BotMcpToolRef {
  name: string;
  enabled: boolean;
}

/** 百炼免登 MCP 广场条目；只保留选择器需要的公开字段。 */
export interface McpCatalogEntry {
  serverCode: string;
  serverName: string;
  description?: string;
  icon?: string;
  category?: string;
  sourceName?: string;
  hasFee: boolean;
  hasFreePlan: boolean;
}

/** MCP 工具候选；inputSchema 仅用于后续详情展示，不参与 Bot 配置写入。 */
export interface McpToolOption {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** MCP 的稳定身份是 serverCode；serverName 只用于 Renderer 展示。 */
export interface BotMcpBinding {
  type: "official";
  serverCode: string;
  serverName: string;
  tools: BotMcpToolRef[];
  permissionPolicy: "always_allow" | "always_ask";
}

/** Bot 对 Provider 远程 Skill 的声明式引用。百炼要求 version，Qoder 当前不使用。 */
export interface BotSkillRef {
  type: "custom" | "official";
  skillId: string;
  version?: string;
}

/** Skill 选择器候选；只包含当前可挂载的 active Skill。 */
export interface BotSkillOption extends BotSkillRef {
  name: string;
  description?: string;
  latestVersion?: string;
  updatedAt?: string;
  /** Qoder Web 安装来源；用于技能市场识别已安装项。 */
  marketplaceSkillId?: string;
}

/** Provider 技能广场候选；add 后转换为可写入 Agent 声明的 Skill 引用。 */
export interface SkillCatalogEntry {
  catalogId: string;
  name: string;
  /** 市场包的稳定英文名称；API Key 上传后的 Skill 通常使用它作为名称。 */
  sourceName?: string;
  description?: string;
  version?: string;
  category?: string;
  author?: string;
  installCount?: number;
  /** 已有可直接使用的引用；用于展示已添加状态，不写入 Project Document。 */
  addedRef?: BotSkillRef;
}

/**
 * Managed Bot Configuration：本地 Project Document 中的期望 Agent 配置。
 * 四字段完整提交，不接受 partial patch（interfaces.md）。
 * memberAgentIds 是完整 roster（空数组 = 普通 Bot，不接受 partial 更新）。
 */
export interface ManagedBotConfiguration {
  name: string;
  description: string;
  instructions: string;
  model: string;
  /** 省略时 Project Document 没有显式内置工具声明。 */
  builtinTools?: string[];
  skills?: BotSkillRef[];
  mcpServers?: BotMcpBinding[];
  /** 协作成员的外部 Agent ID，按 YAML 声明顺序回显；不代表优先级或执行顺序。 */
  memberAgentIds: string[];
}

/** 模型候选；value 是提交给 Provider 的模型 ID，label 是展示名。 */
export interface BotModelOption {
  value: string;
  label: string;
}

/**
 * 配置表单的视图模型：四字段期望配置 + 模型候选 + 同步状态。
 * 只对管理完整性通过的 Managed Bot 返回；不携带 Provider wire 字段。
 * hasPendingChanges 由当前 agents.yaml 与最后成功 Sync 的配对 backup 差异派生。
 */
export interface BotConfigurationView extends ManagedBotConfiguration {
  ref: BotRef;
  provider: string;
  models: BotModelOption[];
  hasPendingChanges: boolean;
  /** 当前 Provider 是否有经过验证的 MCP 写入合同。 */
  supportsMcpConfiguration?: boolean;
}

/** 更新 Bot 的完整四字段输入，不接受 partial patch。 */
export type UpdateBotInput = ManagedBotConfiguration;

export interface SendResult {
  ok: boolean;
}

/** 上传文件入参：二进制经 IPC 以可结构化克隆的 ArrayBuffer 传递（沿用 getArtifact 先例）。 */
export interface UploadFileInput {
  filename: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

/** 上传成功后返回的文件引用；Main 已阻塞轮询至 available。 */
export interface UploadedFileView {
  fileId: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
}

/** 随消息发送携带的附件引用（引用已上传并就绪的文件）。 */
export interface MessageAttachment {
  fileId: string;
  filename: string;
  mimeType?: string;
}

/** 远程环境候选：多环境歧义时由用户显式选择。 */
export interface EnvironmentCandidate {
  environmentId: string;
  name: string;
}

export type ChatEventView =
  | { type: "token"; text: string; eventId?: string }
  | { type: "timeline"; item: ChatTimelineItemView }
  | { type: "done" }
  | { type: "error"; error: HostError };
