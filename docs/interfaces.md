# Interface

本文件固定 Interface 的语义形状，不要求实施者照抄文件拆分。Interface 以用户用途命名，Provider wire 类型只能存在于 Adapter 内部。

## 共享引用

```ts
type ConnectionId = string;

interface BotRef {
  connectionId: ConnectionId;
  agentId: string;
}

interface ChatRef {
  connectionId: ConnectionId;
  agentId: string;
  sessionId: string;
}
```

## DesktopHost

```ts
interface DesktopHost {
  connections: {
    list(): Promise<ConnectionView[]>;
    connect(input: ConnectInput): Promise<ConnectionView>;
    // 零输入登录；API Key/Workspace 由 Main 的浏览器回调获得并验证，绝不返回 Renderer。
    connectBailianConsole(): Promise<ConnectionView>;
    reconnectBailianConsole(connectionId: ConnectionId): Promise<ConnectionView>;
    cancelBailianConsoleLogin(): Promise<void>;
    reconnect(input: ReconnectInput): Promise<ConnectionView>;
    update(input: UpdateConnectionInput): Promise<ConnectionView>;
    verify(connectionId: ConnectionId): Promise<void>;
    disconnect(connectionId: ConnectionId): Promise<void>;
    remove(connectionId: ConnectionId, options: { removeManagedBotData: boolean }): Promise<void>;
    // ready 分支不携带 environmentId：Renderer 只需知道设置成功，不持有远程 ID。
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
    get(ref: BotRef): Promise<BotView>;
    getConfiguration(ref: BotRef): Promise<BotConfigurationView>;
    create(connectionId: ConnectionId, input: CreateBotInput): Promise<BotView>;
    update(ref: BotRef, input: UpdateBotInput): Promise<BotView>;
    sync(ref: BotRef): Promise<BotView>;
    archive(ref: BotRef): Promise<void>;
  };

  chats: {
    list(bot: BotRef): Promise<ChatView[]>;
    // 环境引用在 Main 内部解析：Managed Bot 使用其 state 中绑定的 Environment remote ID；
    // Remote-only Bot 使用所属 Connection 的 defaultEnvironmentId。Renderer 不选择环境。
    create(bot: BotRef): Promise<ChatView>;
    get(ref: ChatRef): Promise<ChatDetailView>;
    send(ref: ChatRef, text: string): Promise<SendResult>;
    // 返回值是取消订阅函数；Promise resolve 时订阅已建立。
    subscribe(ref: ChatRef, listener: (event: ChatEventView) => void): Promise<() => void>;
    archive(ref: ChatRef): Promise<void>;
    delete(ref: ChatRef): Promise<void>;
  };

  // Deployment（定时任务，ADR-0010）。Provider 无对应能力时抛 unavailable；
  // 首版只有 Bailian 实现，Qoder Connection 下 Renderer 不展示入口。
  deployments: {
    // agentId 缺省时列出当前连接可见的全部 Deployment（运行监视轮询用）。
    list(connectionId: ConnectionId, agentId?: string): Promise<DeploymentView[]>;
    get(ref: DeploymentRef): Promise<DeploymentView>;
    create(connectionId: ConnectionId, input: CreateDeploymentInput): Promise<DeploymentView>;
    update(ref: DeploymentRef, input: UpdateDeploymentInput): Promise<DeploymentView>;
    setShared(ref: DeploymentRef, shared: boolean): Promise<DeploymentView>;
    pause(ref: DeploymentRef): Promise<DeploymentView>;
    unpause(ref: DeploymentRef): Promise<DeploymentView>;
    // 归档是唯一终态，不可逆；UI 必须使用 AlertDialog 语义组件二次确认。
    archive(ref: DeploymentRef): Promise<void>;
    run(ref: DeploymentRef): Promise<DeploymentRunView>;
    listRuns(ref: DeploymentRef): Promise<DeploymentRunView[]>;
  };
}
```

Deployment 可见性与 Bot 一致：当前 Key 范围与未分组（Provider 侧创建）可见，其他 Key 范围仅共享可见；写操作（update/pause/unpause/archive/setShared）仅限当前范围与未分组；手动触发与 Runs 读取对可见者开放。到期日期经 metadata 键 `openagentbot_expires_at` 保存（公开 API 无到期字段），metadata 更新是整体替换，Main 做 read-merge-write。执行输入是固定 prompt（`initial_events` 首条用户文本消息）；合并任务输出公开 API 不支持，首版仅独立任务输出。

Deployment Run 产生的 Session 继承所属 Deployment 的归属范围：Qoder 的 Run Session 不继承 Deployment metadata（仅携带 `deployment_id`，2026-10-08 真实环境探测确认），百炼则原生继承标记；ChatDataPlane 对无归属标记但带 `deployment_id` 的 Session 解析其 Deployment 的 Key 范围与共享状态后按 Session 规则判定可见性与写权限，Deployment 查询失败时按未分组处理（隐藏）。

`update` 先保存完整本地期望配置再直接 Sync；`sync` 不改变 Project Document。两个方法都要求完整 state，并在同一 scope 内串行。

`archive` 归档 Managed Bot：对 Provider 执行远程 Agent 软归档。前置条件与 `update`/`sync` 相同——只接受完整可写的 Managed Bot：Remote-only 返回 `not-found`，state、manifest 或 Project Document 不完整返回 `managed-state-missing`，Connection 与 manifest 的 Provider 不一致返回 `conflict`，且在任何 Provider mutation 之前拒绝。归档与同一 scope 的 update/sync 串行（同一 scope lock）。成功返回 `void`：远程 Agent 从 Provider 默认列表消失、不能再创建新 Chat，已有 Chat、Message 与远程数据保留；本地 managed scope（Project Document、state、manifest、配对 backup）原样保留，不新增本地归档状态。Renderer 成功后经 `bots.list` 重读 Provider 事实，不做乐观删除。归档目标只由校验后的 `BotRef` 定位；归档不触碰 Environment、Connection 与 credential。

`getConfiguration` 读取 Managed Bot 的本地期望配置与同步状态，供配置表单初始化；它只对管理完整性通过的 Managed Bot 返回，Remote-only 返回 `not-found`，state 缺失返回 `managed-state-missing`。模型候选由控制面按 Provider 给出：Qoder 动态枚举 enabled 模型，百炼使用当前值加真机验证列表；枚举失败降级为仅当前模型，不升级为页面错误。`listSkills` 返回“我的 Skills”：Bailian 读取 active custom 目录并要求具体版本，Qoder 保留当前 Provider 已安装目录合同。`listSkillCatalog` 与 `addSkillFromCatalog` 对两个 Provider 提供相同 Interface：Qoder 从公开市场下载安装并返回 custom Skill 引用；Bailian从 official 目录返回可直接挂载的具体版本引用。Renderer 不感知两者远程副作用差异。本产品不编辑、发布或删除 Skill。

```ts
interface ManagedBotConfiguration {
  name: string;
  description: string;
  instructions: string;
  model: string;
  /** 可选；缺省表示沿用 Project Document 原有声明或 Provider 默认工具。 */
  builtinTools?: string[];
  skills: BotSkillRef[];
  mcpServers: BotMcpBinding[];
  /** 协作成员：Provider 远程 Agent ID 的外部引用；空数组表示普通 Bot。 */
  memberAgentIds: string[];
}

interface BotMcpBinding {
  type: "official";
  serverCode: string;
  serverName: string;
  tools: Array<{ name: string; enabled: boolean }>;
  permissionPolicy: "always_allow" | "always_ask";
}

interface BotSkillRef {
  type: "custom" | "official";
  skillId: string;
  version?: string;
}

interface BotSkillOption extends BotSkillRef {
  name: string;
  description?: string;
  latestVersion?: string;
  updatedAt?: string;
}

interface SkillCatalogEntry {
  catalogId: string;
  name: string;
  description?: string;
  version?: string;
  category?: string;
  author?: string;
  installCount?: number;
  addedRef?: BotSkillRef;
}

interface BotModelOption {
  value: string;
  label: string;
}

interface BotConfigurationView extends ManagedBotConfiguration {
  ref: BotRef;
  provider: string;
  models: BotModelOption[];
  hasPendingChanges: boolean;
}

interface UpdateBotInput extends ManagedBotConfiguration {}
```

`UpdateBotInput` 是完整配置输入，不接受 partial patch；Skill 引用是完整替换集合，最多 20 项，按 `type + skillId` 唯一。百炼引用必须携带具体版本，Qoder 当前不使用版本。空集合必须以 `skills: []` 同步，从而解除最后一个远程绑定。百炼 MCP 引用按 `serverCode` 唯一，必须至少包含一个启用工具，并同时生成同名 `mcp_servers` 与 `mcp_toolkit`；当前 OpenAgentPack 公共合同只允许自动执行，Renderer 不开放尚未贯通的审批策略。Qoder 首版不接受 MCP 输入。`hasPendingChanges` 由当前 `agents.yaml` 与最后一次成功 Sync 的配对 backup 文本差异派生，不新增持久化状态。名称只修改显示名，不修改逻辑资源 key、projectName、Environment 身份或 `remoteAgentId`。

`builtinTools` 是可选的完整内置工具集合：省略时创建沿用 Provider 默认，编辑保留 Project Document 原有声明；显式空数组表示关闭全部内置工具。Main 只接受已知工具名，BotControlPlane 再按 Provider 拒绝不支持的名称。百炼平台的九项内置工具均可选择：`bash`、`write`、`read`、`edit`、`glob`、`grep` 默认选中，`web_search`、`web_fetch`、`mark_artifacts` 默认未选中；所依赖的 OpenAgentPack SDK 的百炼映射同步支持这九项。Qoder 使用小写声明名，OpenAgentPack 在 Sync 时映射为原生名称；工具集合包含前六项与 `web_fetch`、`web_search`、`image_search`、`image_gen`、`deliver_artifacts`。勾选变化后完整替换 `tools.builtin`，保留同一工具声明中的 MCP 绑定及其他字段。

`memberAgentIds` 同样是完整替换集合，最多 20 项，按 trim 后的 ID 唯一；数组顺序只用于稳定表单回显与 YAML 序列化，不表示优先级、串并行关系或执行顺序。`CreateBotInput` 该字段可选，省略等价于空数组，由 Main 归一化；`UpdateBotInput` 与 `BotConfigurationView` 必须始终携带完整数组，缺字段的更新输入以 `invalid-input` 拒绝。空数组表示普通 Bot：Project Document 中不存在整个 `multiagent` 键，并清除远程 roster；非空数组表示当前 Bot 作为 coordinator，成员以外部 `{ agent_id }` 写入。创建可选填 Instructions：用户填写时直接写入 Project Document；留空时普通创建沿用固定系统提示，roster 非空时写入协调版缺省提示，该提示只承诺协调行为目标，不写入成员 ID、显示名或动态候选；编辑时 Instructions 只取用户提交值，roster 变化不自动改写。更新时当前 Agent 的 `agentId` 不得出现在数组中，Main 在任何文件写入与 Provider mutation 之前以 `invalid-input` 拒绝。成员是否存在、归档、可访问或被并发修改由 OpenAgentPack/Provider 在 Sync 时判定：本地不做远程存在性预检，不在 Renderer 推断单个成员状态，也不把成员纳入当前 scope 的 state。成员身份、生命周期与配置始终属于成员自身；当前 Bot 不创建、不更新、不归档、不删除成员。DesktopHost 不新增成员相关方法，候选复用 `bots.list`。

从 `teams/` 导入协作模板时，Renderer 顺序创建独立成员 Bot，最后以成员远程 ID 创建 coordinator。`CreateBotInput.metadata` 可携带最多 8 个受校验的短字符串键值，作为创建来源标记写入 Agent Project Document；它不进入 `ManagedBotConfiguration`，后续编辑保留原有 metadata。导入时使用 `openagentbot_template` 和同一次导入共享的 `openagentbot_template_run`，可选名称前缀仅影响新建 Bot 的显示名。导入失败不自动归档已创建的独立成员。

`bots.listMcpCatalog(query?)` 与 `bots.listMcpTools(serverCode)` 是 Main 提供给 Renderer 的匿名只读目录 Interface。Main 只返回选择器所需的公开元数据与工具 Schema；请求不读取 Connection，也不附加 API Key、Workspace、Cookie 或 Console 会话。Renderer 不能直接访问百炼网关。

`disconnect` 只删除安全存储中的 credential，使 Connection 进入未连接状态；它保留 Connection 元数据与全部 managed scope。

`connectBailianConsole` 是国内站北京地域的实验性浏览器登录入口：Main 临时监听
`127.0.0.1`、打开百炼官方页面，只接受一次性 state 对应的 API Key 与 Workspace 回调，
再复用 `ConnectionManager.connect` 的远端验证与安全存储事务。API Key、Console token 和原始
callback 不跨 IPC；连接名默认为英文 Provider 名 `Bailian`，用户可在设置中再修改；Renderer 只接收普通 `ConnectionView`。`cancelBailianConsoleLogin` 只终止
当前内存登录 attempt，不改变已有 Connection。手动 `connect` 始终保留。

`reconnectBailianConsole(connectionId)` 复用同一入口更新已有百炼连接。Main 校验目标 Provider；
Workspace 未变化时只验证并替换凭据，Workspace 变化时原子更新凭据与 Workspace 并清除旧的
默认 Environment 绑定。API Key 不进入 Renderer。

`update` 只修改 Connection 的本地展示名称和 Provider 所需的非敏感路由资料，不允许改变 Provider 或 Connection ID。仅修改展示名称不发起远程请求；修改 Workspace ID 时必须同时提供 credential，并在落盘前按新 Workspace 完成验证，失败时保留原配置。`verify` 使用已保存凭据执行 Provider 验证，不修改本地资料。

`remove` 删除本机 Connection 元数据和 credential，产品文案统一称“删除本地连接”。它从不删除 Provider 中的 Bot、Chat 或 Message。存在 managed scope 时，Renderer 必须明确展示数量与后果，并传入 `removeManagedBotData: true` 才会同时永久删除这些本地 IaC 文件；否则操作以 `conflict` 拒绝。

`reconnect` 验证并替换 Connection credential；它既可恢复已断开的 Connection，也可轮换已连接 Connection 的凭据，不创建新 Connection，也不改变 displayName、provider 与 workspaceId。

`setupEnvironment` 为 Connection 准备运行环境：环境已在远端存在（或已创建成功）后，
把 Environment remote ID 写入 Connection 的 `defaultEnvironmentId` 并返回 `ready`；
当 Provider 返回多个可选 Environment 且未指定 `environmentId` 时，返回 `selection-required`，
此时不产生任何本地写入，也不回滚已创建的远端资源（新创建的远端 Environment 直接作为 ready）。
设置失败（验证、远端调用、本地写入）抛出 HostError；任何失败都不删除 Connection 本身。

## View model

```ts
interface BotView {
  ref: BotRef;
  name: string;
  description?: string;
  model?: string;
  remoteStatus?: string;
  management: "managed" | "remote-only" | "state-missing";
  keyScope?: "current" | "other" | "ungrouped"; // CloudAgentBot 应用内分组，不是 Provider ACL
  shared?: boolean; // Provider 可见 Bot 的 metadata 精确为 "true" 时为 true，不要求相同 Key
  collaboration?: CollaborationRosterView; // Provider 当前远程 roster；缺失表示未知
}

interface CollaborationRosterView {
  memberAgentIds: string[]; // 明确空数组表示普通 Bot；非空表示 coordinator
}

interface ChatView {
  ref: ChatRef;
  title: string;
  remoteStatus?: string;
  updatedAt?: string;
  keyScope?: "current" | "other" | "ungrouped"; // Renderer 不接收远程 scope 指纹
  collaboration?: CollaborationRosterView; // Session 创建时 Agent 快照，不随 Bot 编辑变化
}

interface ChatDetailView {
  chat: ChatView;
  messages: MessageView[]; // 兼容性投影；由 message 类 timeline event 派生
  events: ChatTimelineItemView[];
}

interface DeploymentView {
  ref: DeploymentRef; // { connectionId, agentId, deploymentId }
  name: string;
  status: "active" | "paused" | "archived";
  prompt: string; // initial_events 首条用户文本消息
  schedule?: { expression: string; timezone: string; nextRunAt?: string; lastRunAt?: string };
  expiresAt?: string; // metadata 保存；到期仅 UI 标记与引导暂停，不做本地定时暂停
  keyScope?: "current" | "other" | "ungrouped";
  shared?: boolean;
}

interface DeploymentRunView {
  id: string;
  sessionId?: string; // 异步 Session 创建完成前为空；关联 Session 即普通 Chat
  trigger: "manual" | "schedule";
  status: "running" | "succeeded" | "failed";
  errorMessage?: string;
}

interface ConnectionView {
  id: ConnectionId;
  provider: string;
  displayName: string;
  workspaceId?: string;
  credentialStored: boolean;
  managedBotDataCount: number;
  /**
   * 该 Connection 的运行环境是否已设置完成并可被 Bot/Chat 创建直接使用。
   * 只在 defaultEnvironmentId 存在时为 true；Renderer 不接收 Environment ID 或名称。
   */
  environmentReady: boolean;
}

/** setupEnvironment 跨 IPC 结果：环境就绪，或返回候选列表要求用户选择。ready 分支不携带 environmentId。 */
type EnvironmentSetupViewResult =
  { status: "ready" } | { status: "selection-required"; candidates: EnvironmentCandidate[] };

interface EnvironmentCandidate {
  environmentId: string;
  name: string;
}
```

`ChatTimelineItemView` 是 message、delegation、thinking、tool-call、tool-result、artifact、status、usage、error 和 unknown 的判别联合。delegation 只携带 Provider 已证实的动作、child Thread ID、原始 Agent 名称与可展示文本；名称不自动等于已验证的成员 ID。unknown 只携带安全 envelope。Provider raw payload 不越过 Adapter seam。

这些类型是远程事实的展示结果，不是本地持久模型。

## Main 内部 seam

```ts
interface CredentialStore {
  set(key: string, secret: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

interface BotControlPlane {
  list(connectionId: ConnectionId): Promise<BotView[]>;
  listSkills(connectionId: ConnectionId): Promise<BotSkillOption[]>;
  get(ref: BotRef): Promise<BotView>;
  getConfiguration(ref: BotRef): Promise<BotConfigurationView>;
  create(connectionId: ConnectionId, input: CreateBotInput): Promise<BotView>;
  update(ref: BotRef, input: UpdateBotInput): Promise<BotView>;
  sync(ref: BotRef): Promise<BotView>;
  // 软归档远程 Agent；只接受完整可写 Managed Bot，成功与失败都不改本地 scope。
  archive(ref: BotRef): Promise<void>;
}

// ChatAdapter 只处理已解析的 Chat 数据面调用；环境引用由 ChatDataPlane 解析后以显式参数传入。
interface ChatAdapter {
  listChats(agentId: string): Promise<ChatView[]>;
  createChat(agentId: string, environmentId: string): Promise<ChatView>;
  getChat(sessionId: string): Promise<ChatDetailView>;
  sendMessage(sessionId: string, text: string): Promise<SendResult>;
  subscribe(sessionId: string, listener: ChatEventListener): () => void;
}

// BotCatalog 是只读 Provider 目录：只列 Agent。Environment 目录属于控制面职责，
// 数据面不再列举或猜测环境。
interface BotCatalog {
  listBots(): Promise<BotCatalogView[]>;
}
```

`listBots` 对两个 Provider 都返回完整当前 Agent 列表：分页在各自 Provider Module 内按 `has_more`/cursor 合同完成，cursor 不前进时 fail closed，不返回部分结果。它是协作成员候选的唯一来源；不新增成员专用目录 Interface。

ChatDataPlane 使用 Connection 找到 Provider 和调用作用域凭据，再构造/调用 ChatAdapter。Adapter 不长期持有共享 credential，不把原始错误响应或 wire event 返回给 Renderer。

## EnvironmentControlPlane

环境设置的控制面 seam，只对 ConnectionManager 暴露：

```ts
interface EnvironmentControlPlane {
  /**
   * 列出凭据可见的未归档 Environment；或在不提供 environmentId 时创建 CloudAgentBot 管理的默认环境。
   * 只使用 @openagentpack/sdk 包根公共导出，不落 state 文件、不写 Project Document。
   */
  setup(
    connection: { provider: Provider; credential: string; workspaceId?: string },
    environmentId?: string,
  ): Promise<
    | { status: "ready"; environmentId: string }
    | { status: "selection-required"; candidates: EnvironmentCandidate[] }
  >;
}
```

语义：`environmentId` 存在 → 按 Provider 返回的未归档列表校验并直接 ready（不做存在性预检，
由 Provider 失败承担）；不存在 → 列出未归档环境，0 个时创建 `CloudAgentBot Default <id>`
（`config.type: "cloud"`、`networking.type: "unrestricted"`，metadata 标记
`openagentbot_managed` 与 `openagentbot_connection_id`），1 个时直接选中，多个时返回
`selection-required`。任何网络/SDK/配置失败抛 HostError；不解释 Provider 错误消息。

## 错误语义

跨 preload 只使用小型稳定分类：

```ts
type HostErrorCode =
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
```

错误对象不携带 credential、Project Document、state、Message 正文或完整 Provider response。Provider 新增错误先映射到现有用户动作；只有出现新的稳定用户处理方式时才扩展分类。

协作成员沿用同一分类，不新增 HostErrorCode：本地数组形状、YAML 形状或自引用校验失败，以及 Provider 拒绝 roster，都映射为 `invalid-input`；OpenAgentPack/Provider 判定成员或当前 Agent 不存在映射为 `not-found`；当前 Managed Bot scope 不完整映射为 `managed-state-missing`；认证、权限、限流与不可用沿用现有映射。成员在保存期间被其他客户端修改、归档或删除时，以 Provider 调用结果为准，不重试猜测、不锁其他 scope。Renderer 只展示稳定动作提示，不接收完整 Project Document 或成员远程详情。

## Provider Client 所有权

Qoder 与 Bailian 的 HTTP、SSE、Session、Event 与 Message 数据面由本客户端在各自 `src/main/data-plane/providers/` 目录内直接拥有，并由本地合同测试与真实 Cloud smoke 保护。OpenAgentPack 仅用于资源控制面；数据面不得导入其默认入口、subpath 或 `internal` 源码。Provider wire 类型只存在对应 Adapter 内部，不跨越 ChatAdapter seam。
