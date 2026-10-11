import type {
  BotConfigurationView,
  McpCatalogEntry,
  McpToolOption,
  BotSkillOption,
  SkillCatalogEntry,
  BotRef,
  BotView,
  ChatDetailView,
  ChatEventView,
  ChatRef,
  ChatArtifactView,
  ChatView,
  ConnectInput,
  ConnectionId,
  ConnectionView,
  CreateDeploymentInput,
  DeploymentRef,
  DeploymentRunView,
  DeploymentView,
  EnvironmentSetupViewResult,
  ReconnectInput,
  RemoveConnectionOptions,
  UpdateDeploymentInput,
  UpdateConnectionInput,
  CreateBotInput,
  MessageAttachment,
  SendResult,
  UpdateBotInput,
  UploadFileInput,
  UploadedFileView,
} from "./models";

/**
 * DesktopHost 是 Renderer 使用 Main 的唯一 Interface。
 * Connection 域、Bot/Chat 只读浏览、Chat 创建/发送/订阅、
 * Bot 创建/更新/同步均已接线（Stage 02–08）。
 */
export interface DesktopHost {
  app: {
    version(): Promise<string>;
    copyText(text: string): Promise<void>;
    toggleWindowMaximize?(): Promise<void>;
  };

  connections: {
    list(): Promise<ConnectionView[]>;
    connect(input: ConnectInput): Promise<ConnectionView>;
    connectBailianConsole(): Promise<ConnectionView>;
    reconnectBailianConsole(connectionId: ConnectionId): Promise<ConnectionView>;
    cancelBailianConsoleLogin(): Promise<void>;
    reconnect(input: ReconnectInput): Promise<ConnectionView>;
    update(input: UpdateConnectionInput): Promise<ConnectionView>;
    verify(connectionId: ConnectionId): Promise<void>;
    disconnect(connectionId: ConnectionId): Promise<void>;
    remove(connectionId: ConnectionId, options: RemoveConnectionOptions): Promise<void>;
    setupEnvironment(
      connectionId: ConnectionId,
      environmentId?: string,
    ): Promise<EnvironmentSetupViewResult>;
  };

  bots: {
    list(connectionId: ConnectionId): Promise<BotView[]>;
    listSkills(connectionId: ConnectionId): Promise<BotSkillOption[]>;
    listSkillCatalog(connectionId: ConnectionId, query?: string): Promise<SkillCatalogEntry[]>;
    addSkillFromCatalog(connectionId: ConnectionId, catalogId: string): Promise<BotSkillOption>;
    listMcpCatalog?(query?: string): Promise<McpCatalogEntry[]>;
    listMcpTools?(serverCode: string): Promise<McpToolOption[]>;
    get(ref: BotRef): Promise<BotView>;
    getConfiguration(ref: BotRef): Promise<BotConfigurationView>;
    create(connectionId: ConnectionId, input: CreateBotInput): Promise<BotView>;
    update(ref: BotRef, input: UpdateBotInput): Promise<BotView>;
    sync(ref: BotRef): Promise<BotView>;
    setShared(ref: BotRef, shared: boolean): Promise<BotView>;
    archive(ref: BotRef): Promise<void>;
  };

  chats: {
    list(bot: BotRef): Promise<ChatView[]>;
    // 环境引用在 Main 解析：Managed Bot 用 state 绑定，其他用 Connection defaultEnvironmentId。
    create(bot: BotRef): Promise<ChatView>;
    get(ref: ChatRef): Promise<ChatDetailView>;
    // 文件上传是 Connection 级（Workspace 全局）：新任务首条消息在 Session 尚未创建时即可上传。
    uploadFile(connectionId: ConnectionId, input: UploadFileInput): Promise<UploadedFileView>;
    send(ref: ChatRef, text: string, attachments?: MessageAttachment[]): Promise<SendResult>;
    subscribe(ref: ChatRef, listener: (event: ChatEventView) => void): Promise<() => void>;
    setShared(ref: ChatRef, shared: boolean): Promise<ChatView>;
    archive(ref: ChatRef): Promise<void>;
    delete(ref: ChatRef): Promise<void>;
    getArtifact(
      ref: ChatRef,
      fileId: string,
      options?: { includeContent?: boolean },
    ): Promise<ChatArtifactView>;
  };

  /**
   * Deployment（定时任务）。Provider 无对应能力时抛 unavailable；
   * 首版只有 Bailian 实现，Qoder Connection 下 Renderer 不展示入口。
   */
  deployments: {
    /** agentId 缺省时列出当前连接下可见的全部 Deployment（运行监视轮询用）。 */
    list(connectionId: ConnectionId, agentId?: string): Promise<DeploymentView[]>;
    get(ref: DeploymentRef): Promise<DeploymentView>;
    create(connectionId: ConnectionId, input: CreateDeploymentInput): Promise<DeploymentView>;
    update(ref: DeploymentRef, input: UpdateDeploymentInput): Promise<DeploymentView>;
    setShared(ref: DeploymentRef, shared: boolean): Promise<DeploymentView>;
    pause(ref: DeploymentRef): Promise<DeploymentView>;
    unpause(ref: DeploymentRef): Promise<DeploymentView>;
    /** 归档是唯一终态，不可逆；UI 必须使用 AlertDialog 二次确认。 */
    archive(ref: DeploymentRef): Promise<void>;
    run(ref: DeploymentRef): Promise<DeploymentRunView>;
    listRuns(ref: DeploymentRef): Promise<DeploymentRunView[]>;
  };
}
