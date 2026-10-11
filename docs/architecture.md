# CloudAgentBot 架构

## 目标

是轻量远程 Agent 客户端，而不是本地可靠消息系统或通用 Agent 平台。复杂度只服务三件事：安全访问 Provider、用 IaC 管理 Agent、在线使用远程 Chat。

## 运行拓扑

```text
Renderer
  页面、表单、选择、查询缓存、流式临时状态
        │
        │ typed preload Interface
        ▼
Electron Main
  DesktopShell ──> MainWindow + Tray
  DesktopHost
    ├── ConnectionManager ──> CredentialStore
    ├── BotControlPlane ────> @openagentpack/sdk
    ├── EnvironmentControlPlane > @openagentpack/sdk
    └── ChatDataPlane ──────> V2-owned Provider Native Client Adapter
        │                              │
        └──────── Provider Cloud ──────┘
```

Preload 只安装固定方法、还原 IPC 信封并转发到 Main。输入形状校验在 Main（唯一信任边界）；Preload 不复制校验逻辑。

## 核心 Module

### DesktopShell

DesktopShell 是 Main 内部的桌面生命周期 Module，持有唯一主窗口、系统托盘和退出状态。普通窗口关闭只隐藏窗口；托盘、macOS activate 与第二实例统一恢复并聚焦主窗口；只有显式退出进入 `app.quit()`。它不进入 DesktopHost Interface，也不依赖 Connection、Bot、Chat 或 Provider。

### DesktopHost

DesktopHost 是 Renderer 使用 Main 的唯一 Interface。它按 Connection、Bot、Chat 三个用户用途组织方法，隐藏 Electron IPC、凭据、文件路径、OpenAgentPack 与 Provider wire schema。

### ConnectionManager

ConnectionManager 保存非敏感连接资料，使用 CredentialStore 管理原始凭据，并为一次控制面或数据面调用提供对应 Connection 的凭据。它不建立通用权限、lease、revision 或 Provider 生命周期系统。

Connection 完成凭据验证后，还要通过 `setupEnvironment` 准备运行环境：EnvironmentControlPlane 返回结果，ConnectionManager 把 ready 结果写入 Connection 的 `defaultEnvironmentId`，或把候选列表原样返回给 Renderer 让用户选择。任何设置失败都不回滚已创建的 Connection。Workspace ID 变更时，ConnectionManager 用新凭据完成验证、在同一写入中保存新凭据并清除 `defaultEnvironmentId`；任何一步失败都把凭据与绑定一起回滚。

### EnvironmentControlPlane

EnvironmentControlPlane 是运行环境设置的控制面 Module。它只消费 `@openagentpack/sdk` 包根公共导出（`resolveProjectConfigFromObject`、`StateManager.initialize`、`createProjectRuntime`、`listCloudEnvironments`、`createCloudEnvironment`），在内存 runtime 中执行，不写 Project Document，不落 `agents.state.json`。它把「列出未归档环境」「创建 CloudAgentBot 管理的默认环境」「按指定 ID 选中」三种能力收敛为一个 `setup` 方法，返回 ready 或候选列表；Provider 的认证、限流、网络与资源错误映射为现有 HostError 分类。

### BotControlPlane

BotControlPlane 是深 Module。它把产品输入交给 ProjectDocument 生成完整 `agents.yaml`，串行化同一 scope 的 Sync，通过 SDK 让远端收敛，并把远程结果翻译为 Bot view model。Renderer 不编排写文件、构造 runtime、apply 或读取 state 等内部步骤。

Bot 创建与配置页面通过 Provider-neutral `SkillCatalog` Module 获得统一的“我的 Skills / 技能广场”交互。Renderer 只执行列出目录和添加候选，不感知 Provider 差异。Qoder Adapter 读取公共技能市场，添加时下载 ZIP 并使用当前 Connection API Key 上传，最终返回 Provider 创建的 custom Skill ID；Bailian Adapter 经 OpenAgentPack 公共 `listSkills` 读取 official 目录，添加时直接返回带具体版本的 official Skill 引用，不伪造安装写操作。`BotControlPlane.listSkills` 继续提供当前 Connection 可挂载的“我的 Skills”：Bailian 为 custom 目录，Qoder 保留 Provider 已安装目录合同。该 Module 不拥有 Skill 内容编辑、版本发布或删除生命周期。

百炼 Managed Bot 可在创建与配置时声明 official MCP。Main 通过百炼 MCP 广场的匿名只读 `SquarePageList` 与 `getTools` 网关读取候选（请求不携带 Connection 凭据、Cookie 或 Console 登录态），Renderer 提供服务搜索、添加与工具勾选；稳定 `serverCode` 与工具名成对写为 `mcp_servers` 和 `tools.mcp` 后经 OpenAgentPack Sync。目录失败只关闭选择，不回退为要求用户手填内部标识。Qoder 在没有同等真实目录和写入验证前不展示 MCP 配置入口。

产品中的 Sync 语义等价于 `apply -f agents.yaml`。实现直接调用 `@openagentpack/sdk` 公共 Interface，不启动 OpenAgentPack CLI 子进程，也不解析 CLI 输出。

归档 Managed Bot 也属于 BotControlPlane：在 scope 单写锁内复核管理完整性后，经 SDK 公共归档能力对远程 Agent 执行软归档。归档只改变 Provider 生命周期状态，不删除、不改写本地 managed scope（Project Document、state、manifest 与配对备份全部保留）。

协作 Bot 复用同一 Module，不新增协作控制面。BotControlPlane 把 `memberAgentIds` 作为完整替换集合交给 ProjectDocument 写入 `multiagent` 声明：非空写为 `type: coordinator` 与外部 `{ agent_id }` 引用，空数组删除整个 `multiagent` 键；update 在写文件与任何 Provider mutation 之前拒绝把当前 Agent 自己列为成员。multiagent 声明到 Qoder/Bailian 的 Provider 映射、更新与清空由 OpenAgentPack 公共 Interface 负责；成员 Agent 的存在性、归档、可访问性与并发修改由 OpenAgentPack/Provider 在 Sync 时判定。控制面不做远程 preflight、不接管成员生命周期、不归档成员，也不为 roster 增加 Connection 级锁、跨 scope transaction 或后台 reconciler。

### ProjectDocument

ProjectDocument 是 Managed Bot Project Document 的唯一解释者，只处理 `agents.yaml` 文本：构建（`buildProjectDocument`）、读取可编辑 Agent 文档（`readEditableAgentDocument`）与合并更新（`mergeEditableAgentDocument`）。multiagent 声明的 YAML 形状、往返与非法形状拒绝只在这里实现，BotControlPlane 不含 YAML 结构理解代码；不新增 roster、directory 或 service Module。文件原子写、scope lock、Sync 与配对备份仍属于 ManagedBotStore 与 BotControlPlane。

### ChatDataPlane

ChatDataPlane 根据 Connection 选择 Provider 原生 Client Adapter，负责列出/创建远程 Session、读取历史、发送 Message 和流式观察。它从当前凭据派生 CloudAgentBot API Key 范围，对 Bot/Session metadata 做应用内分组；Session 列表、详情和操作只允许 scope 与当前 Key 匹配的资源，未分组历史默认隐藏且不可操作。百炼的 Session 列表响应省略 metadata，Adapter 对每条缺少 scope 的 Session 调详情接口补齐标记后再由 Main 过滤。这个校验不是 Provider ACL，Provider API 仍决定真实访问能力。事件流只用于当前运行期展示；流断开、Renderer 重载或应用重启后重新读取 Provider 历史。

创建远程 Session 需要 Environment remote ID：Managed Bot 使用其本机 state 中已绑定的 Environment；其他 Agent 使用所属 Connection 的 `defaultEnvironmentId`。Connection 未完成环境设置时，创建 Bot 或 Chat 以 `conflict` 拒绝；数据面不再列举、匹配或猜测环境，也不向 Renderer 透传候选。

协作成员不改变数据面：Chat 仍是当前协调 Agent 的 Provider Session。新任务输入框中的 `@` 仅在 Renderer 中筛选并选择当前任务的执行 Bot，选择后移除触发用的 `@` 文本；已发送消息中的普通文本点名成员只作为 instructions 引导下的模型行为。Main 不解析 `@`，不向成员 fan-out、不汇总子任务，也不持久化 child Thread。成员候选复用现有 `ChatDataPlane.listBots(connectionId)`，Qoder 与 Bailian 的 `BotCatalog` 都必须返回完整当前 Agent 列表（分页在各自 Provider Module 内完成，cursor 不前进时 fail closed），不新增成员专用目录 Interface、DesktopHost 方法或缓存。

协作展示仅消费 Provider 已有只读事实：Agent 列表的当前 `multiagent` roster 用于 Bot 标识；Session 列表/详情的 Agent 快照用于该 Session 创建时的协作标识与成员摘要；历史/实时 Thread 事件用于工作记录。缺失或无法识别的字段保持未知，不从当前 Bot 配置反推历史 Session。Renderer 只在内存中派生协作轨迹，不创建本地 Thread 模型或存储，不把 child 消息提升为群聊发言；最终助手消息仍归协调者。

### ManagedBotStore

ManagedBotStore 集中处理 scope 目录、manifest、Project Document、配对备份、原子写和损坏检测。OpenAgentPack 的 LocalFileStateBackend 独占 `agents.state.json` 内容；其他 Module 只判断文件是否完整，不解析或修改内部字段。

## 多 Provider 策略

身份从第一天包含 Connection，数据面保留一个小型 `ChatAdapter` seam。Qoder 与 Bailian 共用该 seam；两者的 HTTP/SSE、分页、Event wire 和错误映射各自封装在 Provider Module 内。

控制面 Provider 差异由 OpenAgentPack 吸收。首版不建设 capability matrix、动态插件发现、admission、fallback、跨 Provider 迁移或自动切换。

## 列表与管理关系

Bot 列表来自 Provider，再与本地 ManagedBotStore 做内存 join：

```text
Provider Agent[] + local managed scopes -> BotView[]
```

Provider 目录仍返回完整 Agent 列表，供关系解析与协作配置使用。本机普通助手管理列表展示 Provider 可见的共享 Bot、当前 API Key 范围或本机持有管理/恢复资料的 Bot；未分组且未共享的 Remote-only 通过次级“浏览 Provider 资源”入口显式发现，不计入工作区数量。管理页的「团队共享」包含本机共享与 Provider 授权可见的跨 Key 共享 Bot；有本机 Managed Bot 时默认「我的助手」，否则默认「团队共享」，显式选择范围后不自动切换。范围用 Tabs 表示，协调者角色通过独立筛选叠加。Managed Bot 的列表和详情共用共享 Popover：打开面板不写入，用户在面板中明确开启或取消；共享范围说明只在面板内显示。新任务默认团队共享，Provider 浏览保留当前 Key 与未分组资源的兼容选择；明确标记为其他 Key 范围且未共享的 Remote-only Bot 不展示，也不能通过 CloudAgentBot 创建 Chat 入口操作；共享 Bot 允许跨 Key 新建 Session，Session 仍标记为创建者当前 Key，取消共享不影响其已有 Session。本机只有在 Project Document 与 state 都完整时，才把 Agent 标记为 `managed` 并允许 update/Sync；其他 Agent 是 `remote-only`，首版不自动接管。Key scope 是 CloudAgentBot metadata 分组，不授予或撤销 Provider 权限。

## Workspace 导航

Renderer 以任务 Chat 为日常工作入口；Bot 管理从侧栏次级入口进入。两类对象不在同一个长树中混排。点击「新任务」先填写 Renderer 内存草稿并选择已有 Bot；选择 Bot 不创建远程资源，只有发送首条消息时才创建远程 Session。Bot 创建是选择器中的显式动作：创建成功回到原草稿并选中新 Bot，不自动发送。协作 Bot 与普通 Bot 使用相同任务入口，成员配置仍属于 Bot 控制面：

- `src/renderer/shell/chat-navigation-model.ts`：纯派生模型。从 Bot、roster Chat 与 per-Bot 加载状态计算最近 8 个 Chat、全部 Chat、模式内搜索结果以及 Bot 的可靠 Chat 数量；不渲染、不持有状态。
- `src/renderer/features/chats/use-chat-roster.ts`：并行拉取各 Bot 的 Chat 列表，维护 `loading | loaded | error`、已完成/总 Bot 进度与缓存保留刷新。每个 Bot 返回后立即合并，Chat 与 Message 仍不落本地持久化。
- `src/renderer/shell/chat-navigation-content.tsx`：桌面与窄窗口共享导航。主视图只显示最近任务、搜索与「全部任务」；侧栏底部的「管理助手」进入 Bot 资源视图，并列的「协作模板」直接进入模板创建页；支持定时任务的 Provider（百炼、Qoder）下还有「定时任务」入口，进入跨 Bot 的 Deployment 总览页；Bot 不展开 Chat 子树。
- `src/renderer/features/deployments/deployments-page.tsx`：定时任务总览页。按 Connection 列出全部可见 Deployment 并标注所属 Bot；创建表单内选择执行 Bot，编辑、暂停/恢复、手动触发与归档都在本页完成；运行记录跳转复用 Chat 详情页。
- `src/renderer/features/chats/new-task-page.tsx`：任务草稿与 Bot 选择界面。提供“团队共享 / 我的 Bot / 全部可用”范围，默认团队共享；`@` 搜索沿用当前范围。全部可用包含共享、当前 Key 与未分组 Bot，不显示其他 Key 标记且未共享的资源。草稿只在 Renderer 内存中，不新增本地 Chat 持久化。
- `src/renderer/features/chats/chats-overview-page.tsx`：在主内容区展示当前 Connection 的完整 Chat roster，按最近/更早分组并每次渲染 50 条；继续加载只扩展 Renderer 中已取得的远程结果，不创建本地 Chat 数据副本。
- `src/renderer/shell/use-workspace.ts`：用判别联合表达 Chats overview/new/detail、Bots list/detail/edit 与 Deployments list；启动、Chat 返回和进入任务区域时显示新任务输入页，只有显式选择「全部任务」才进入总览。在新任务或由任务进入的 Bot 创建中切换 Connection 时保留任务草稿、清除旧 Connection 的 Bot 选择，其他页面切换 Connection 后进入新任务输入页。发送首条消息时依次创建 Chat、建立订阅并发送一次；创建或发送失败不自动重试。
- `src/renderer/shell/chat-navigation-row.tsx`：Chat 标题为主信息、所属 Bot 为副信息。Chat 详情页同样以 Chat 标题为一级身份。
- `src/renderer/shell/app-sidebar.tsx` 与 `src/renderer/shell/mobile-chat-navigation.tsx`：复用同一导航内容；窄窗口打开目标后关闭 Sheet，进入助手管理时保持 Sheet 打开。

## Sync 规则

- 创建：先写 `phase=new` 的 manifest 和 `agents.yaml`；首次远程调用前把 phase 改为 `applying`；Sync 成功且 state 已保存后改为 `managed` 并建立配对备份。
- 更新：原子写新版 `agents.yaml`，直接 Sync，成功后更新配对备份。
- 手动恢复：用户点击“重新同步”时对现有 `agents.yaml` 直接 Sync。
- roster 变更与其他配置变更同序：roster 属于完整 `agents.yaml` 的一部分，非空写为外部引用、空数组删除整个 `multiagent` 键，只有 Sync 成功后才真正改变远程 roster 并更新配对备份。
- 启动、打开页面和网络恢复只读远程状态，不自动 Sync。
- 同一 scope 同时最多一个控制面写操作；不同 scope 可以并行。
- `phase=new` 且没有 state 的 scope 可以开始首次创建；`phase=applying` 且没有 state 表示结果不明，保留 Chat 能力并停止重试；`phase=managed` 缺失或损坏 state 时停止 update/Sync。任何缺失情形都不按名称自动认领。

## 数据面规则

- Chat 与 Message 不写本地文件或数据库。
- Deployment 与 Deployment Run 同样不写本地文件或数据库；执行完成通过轮询感知，不使用 webhook。
- 首版支持纯文本发送、Provider 公开事件历史、文本增量和一次一个发送动作；事件在 Adapter 中转换为 Provider-neutral 时间线展示模型。
- 发送与 SSE 状态只存在 Renderer/Main 内存。
- 打开处于运行中的远程 Session（如定时任务触发的会话）时，Renderer 在没有发送动作的前提下建立只读 SSE 订阅，把后续事件实时并入时间线；到达终态或订阅出错即收口，由历史重读接管展示。取消订阅不影响远程运行。
- 发送失败或超时不自动重发；UI 引导用户刷新远程 Chat 后自行决定。
- SSE 断开后以订阅建立时记录的历史 Event ID 为本轮边界，重新读取历史补齐本轮事件；不重放旧消息、不把旧终态误作本轮终态，也不持久化 cursor。
- 明确退出只关闭本地订阅，不停止 Provider 已经接受的远程运行。
- 窗口关闭到托盘使用 hide，Renderer 与当前 SSE 订阅继续存在；显式退出才销毁窗口和订阅。

## 依赖方向

```text
renderer -> shared DesktopHost Interface
preload  -> shared Interface + Electron contextBridge
main     -> shared Interface + internal Modules
BotControlPlane          -> ManagedBotStore + OpenAgentPack public Interface
BotControlPlane          -> ProjectDocument（唯一 YAML 解释者）
EnvironmentControlPlane  -> OpenAgentPack public Interface（无文件落盘）
ConnectionManager        -> CredentialStore + EnvironmentControlPlane
ChatDataPlane            -> ConnectionManager + ChatAdapter
BotControlPlane          -> ConnectionManager（defaultEnvironmentId 绑定）
ChatDataPlane            -> ConnectionManager（defaultEnvironmentId 绑定）
QoderChatAdapter -> private Qoder HTTP/SSE Client
BailianChatAdapter -> private Bailian REST/SSE Client
```

架构守卫必须保证 Renderer 不依赖 Node、Electron、文件系统、凭据、OpenAgentPack 或 Provider Client；只有控制面可以依赖 OpenAgentPack 公共 Interface；数据面对 OpenAgentPack 零依赖，也不依赖 Project Document 或 IaC；Provider wire type 不进入 shared view model；每个 Project Document 仍恰好包含一个本地 agent declaration，协作成员只以外部引用出现。`bots.list` 必须返回完整当前 Agent 列表。

## 非目标

- 独立 Background 进程；
- SQLite 产品数据库；
- 本地 Bot、Chat、Message 或 Turn 身份；
- 本地 Room/Team/Role 实体、roster 索引或成员生命周期管理；
- 消息 Operation、Unknown Outcome、reconciler 或退出后恢复；
- Projection、sequence、token、Event replay；
- 动态 Module、Kernel、DAG 或通用工作流；
- 自动接管 remote-only Agent；
- 首版永久删除远程 Agent（归档是软归档，不属于永久删除）；
- 已发送消息的客户端 `@` 解析、成员名称映射、消息 fan-out、结果汇总与 child Thread 持久化；新任务草稿中的 `@` 仅用于选择执行 Bot。
- Connection 级 roster lock、跨 scope transaction、后台同步或 Provider capability matrix；
- V1 数据库迁移与兼容路径。
