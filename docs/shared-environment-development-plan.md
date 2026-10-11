# Connection 共享 Environment 开发计划

## 0. 执行契约（先读、不可自行改义）

下一个 Agent 必须按第 15 节顺序执行。以下契约是本计划的单一决策入口；正文只解释实现细节，不得在实现时重新做产品选择：

1. **可连接与可进入工作区是两个事实**：`credentialStored=true` 只表示账号凭据可用；只有 `credentialStored=true && environmentReady=true` 的 Connection 才可成为 active/default Connection、退出 onboarding 或创建 Bot/Chat。
2. **Renderer 编排只有一处**：`useConnections` 完成 `connect -> setupEnvironment`；页面不直接串联 DesktopHost 调用，不把候选塞入错误对象。
3. **Connection 创建成功不回滚**：Environment 列出、创建、选择或本地绑定失败时，保留已经验证并保存的 Connection 与 credential，使用该 `connectionId` 重试 setup。
4. **Workspace 变化是一个原子用户操作**：新 credential、新 workspaceId 与清除旧 Environment 绑定必须全部成功或全部保持旧值。
5. **Environment SDK 路径先做 tracer 验证**：在生产实现前，先证明公开 SDK 的 runtime 构造、完整列表读取和“不生成 state 文件”成立；证明失败即停止，不用内部导入或原生 HTTP 补洞。
6. **错误保持粗粒度**：首版不从通用 `not-found` 推断究竟是 Bot、Agent、Session 还是 Environment 消失，不解析错误 message。
7. **UI 只有一个环境设置流程**：新 Connection 与旧 Connection 共用同一 setup Module；只有多候选时出现一次 RadioGroup。
8. **不扩展范围**：实现结束时仍只有一个本地 Environment ID、一个 setup Interface 和一个 ready 布尔事实；不增加管理页、状态机、ownership、重绑或后台校验。

如果正文、现有代码或旧测试与以上契约冲突，以本节为准，并同步修正文档与测试；不要保留两套行为。

## 1. 目标与完成定义

把 Environment 从“每个 Managed Bot 自动创建的附属资源”改为“Connection 绑定一次、多个 Bot 与 Chat 复用的远程运行环境”。

完成后的用户流程固定为：

1. 用户添加 Connection；凭据验证与本地保存仍按现有流程完成；
2. Renderer 随即调用一次 Environment 设置：
   - 没有未归档 Environment：自动创建并绑定一个默认 Environment；
   - 只有一个未归档 Environment：自动绑定；
   - 有多个未归档 Environment：在当前添加 Connection 弹窗中要求用户选择一个；
3. Environment 设置完成后，Connection 才进入工作区；
4. 新建 Managed Bot 时，`agents.yaml` 通过 `environment_id` 外部引用 Connection 已绑定的 Environment，Bot Sync 不创建 Environment；
5. 新建 Chat 时，Renderer 不再选择或传递 Environment：
   - Managed Bot 使用本机 OpenAgentPack state 中记录的 Environment remote ID；
   - Remote-only Bot 使用 Connection 的 `defaultEnvironmentId`；
6. 现有 Managed Bot 不迁移，继续使用自己 state 中的 Environment；
7. 删除 Chat、断开 Connection、忘记 Connection 均不删除远程 Environment。

完成标准不是“Connection 多一个字段”，而是：新 Connection 的一次性设置、Bot 外部引用、Chat 无感创建、旧 Bot 兼容、设置失败恢复、Qoder/百炼真实 Cloud 证据形成闭环。

## 2. 先读材料与执行约束

实施前按本项目权威顺序完整读取：

1. `AGENTS.md`；
2. `CONTEXT.md`；
3. `docs/adr/0008-bind-connection-to-shared-environment.md`；
4. `docs/architecture.md`；
5. `docs/repository-layout.md`；
6. `docs/local-storage.md`；
7. `docs/interfaces.md`；
8. `docs/validation.md`；
9. `docs/research/environment-sharing-provider-contract.md`；
10. `tests/live/shared-environment.live.test.ts`。

开始修改前运行 `git status --short`。当前工作区可能包含用户正在进行的 Bot 编辑改动；保留所有无关修改，不还原、不覆盖、不顺带重构。

实现只允许使用 `@openagentpack/sdk` 包根公开导出。若需要从 OpenAgentPack `internal` 路径导入，立即停止并记录阻塞。

## 3. 简化原则

### 3.1 唯一产品模型

```text
Connection
  └─ defaultEnvironmentId
       ├─ 新 Managed Bot A
       ├─ 新 Managed Bot B
       └─ Remote-only Bot 的新 Chat
```

本地只持久化一个远程 ID。Provider 是 Environment 名称、配置、归档状态和当前存在性的事实权威。

### 3.2 本期明确不做

- Environment 管理页、列表页或侧边栏入口；
- Environment 编辑、归档或删除；
- ownership、managed/linked 分类；
- Environment 名称或配置的本地缓存；
- Bot 级 Environment 选择或覆盖；
- 创建 Chat 时选择 Environment；
- 自动迁移现有 Managed Bot；
- Connection 默认 Environment 的主动更换；
- Environment 被 Provider 外部删除后的批量 Bot 迁移；
- 通用资源控制面、Provider capability matrix、后台 reconciler；
- 新数据库、新状态机、新 Operation 或自动重试框架。

如果实现需要进入以上范围，停止并重新确认，不能以“顺手支持”为由扩张。

### 3.3 不增加状态枚举

Connection 是否完成设置由一个事实派生：

```text
defaultEnvironmentId 存在   -> environmentReady=true
defaultEnvironmentId 缺失   -> environmentReady=false
```

不新增 `environmentStatus`、`setupPhase`、`ownership`、`lastVerifiedAt` 或错误持久化字段。

## 4. 产品行为

### 4.1 新建 Connection

现有凭据表单不增加 Environment 字段。用户点击“验证并添加”后：

```text
connections.connect(input)
  -> 成功保存 Connection 与 credential
  -> connections.setupEnvironment(connectionId)
```

Environment 设置成功才调用现有 `onConnected` 进入工作区。

若设置期间网络或 Provider 调用失败：

- 已验证的 Connection 与 credential 保留；
- 添加弹窗停留在错误状态，显示“运行环境设置失败”；
- 提供“重试”按钮，重试只调用 `setupEnvironment`，不重复保存 Connection；
- settings 模式允许关闭弹窗；onboarding 模式在设置成功前不进入工作区。

### 4.2 候选数量规则

只考虑 `archived_at` 为空的 Environment：

| 未归档数量 | 行为                                        |
| ---------- | ------------------------------------------- |
| 0          | 创建默认 Environment，保存其 ID，返回 ready |
| 1          | 保存唯一 Environment ID，返回 ready         |
| 2+         | 不写绑定，返回候选列表，等待用户选择        |

用户选择后再次调用：

```ts
connections.setupEnvironment(connectionId, selectedEnvironmentId);
```

Main 必须重新列出未归档 Environment，并确认所选 ID 仍在列表中；候选已经消失或归档时返回 `not-found`，不按名称替代。

### 4.3 默认 Environment

自动创建参数固定为：

```ts
{
  name: `CloudAgentBot Default ${connectionId.slice(-6)}`,
  description: "Shared runtime environment for CloudAgentBot",
  config: {
    type: "cloud",
    networking: { type: "unrestricted" },
  },
  metadata: {
    openagentbot_managed: "true",
    openagentbot_connection_id: connectionId,
  },
}
```

使用 Connection ID 后六位避免同一 Provider account/workspace 下的名称冲突。不暴露自定义名称、包、setup script 或网络配置表单。

如果创建成功但保存 `connections.json` 失败，不删除刚创建的远程 Environment。下次重试重新列表；该资源带有唯一 metadata，可由用户在 Provider 控制台识别。不要为此引入远程事务或补偿队列。

### 4.4 旧 Connection

旧 `connections.json` 没有 `defaultEnvironmentId` 时必须继续正常读取，并在 UI 显示“需要设置运行环境”。用户点击“设置运行环境”后复用同一个 `setupEnvironment` 流程。

不在应用启动、页面打开或网络恢复时自动创建 Environment。

### 4.5 Workspace ID 修改

Bailian `workspaceId` 变化后，原 Environment ID 不再属于新 Workspace。`ConnectionStore.update` 在成功保存新 Workspace ID 时同时删除 `defaultEnvironmentId`。UI 保存成功后进入“需要设置运行环境”，不自动沿用旧 ID。

`ConnectionManager.update` 必须把 Workspace 变化视为一个原子用户操作，固定顺序为：

```text
读取旧 Connection 与旧 credential
  -> 使用新 workspaceId + 用户输入的新 credential 验证
  -> 保存新 credential
  -> 一次 ConnectionStore.update 写入新 workspaceId 并清除 defaultEnvironmentId
  -> 返回 environmentReady=false
```

失败语义固定为：

- 验证失败：不写任何内容；
- 新 credential 保存失败：不更新 Workspace 或 Environment 绑定；
- ConnectionStore 更新失败：把 CredentialStore 恢复为旧 credential；回滚失败只记录不含凭据的错误，并向调用方返回原始更新失败；
- displayName-only 更新不要求新 credential，也不改变 `defaultEnvironmentId`；
- Workspace 变化成功后，后续 `resolveCredential()` 必须取得新 credential，不能继续使用旧值。

`ConnectionStore.update` 接收同一次写入所需的 `workspaceId` 和“删除 `defaultEnvironmentId`”意图，使用现有原子文件写路径一次落盘；不得先写 Workspace、再通过第二次写调用清除绑定。

不修改 Workspace ID 未变化时的 Environment 绑定。

### 4.6 远端删除或归档

本期不轮询验证 Environment。Provider 在创建 Bot 或 Chat 时返回 `not-found` 后，UI 使用通用远程资源不存在提示：

> 当前远程资源不存在。请在 Provider 控制台检查 Bot 与运行环境。

同一个 `not-found` 可能来自 Bot、Agent、Session 或 Environment；Renderer 不解析 message，也不承诺精确归因。不要为区分资源类型新增错误码。

不清除本地绑定，不自动创建替代 Environment，也不改写 Managed Bot Project Document。重新绑定与既有 Managed Bot 的批量恢复是首版明确限制，不在本期实现。

## 5. Shared 与 DesktopHost Interface

### 5.1 Shared model

在 `src/shared/models.ts`：

```ts
interface ConnectionView {
  id: ConnectionId;
  provider: string;
  displayName: string;
  credentialStored: boolean;
  environmentReady: boolean;
  workspaceId?: string;
}

interface EnvironmentCandidate {
  environmentId: string;
  name: string;
}

type EnvironmentSetupResult =
  | { status: "ready" }
  | {
      status: "selection-required";
      candidates: EnvironmentCandidate[];
    };
```

规则：

- Renderer 只知道 `environmentReady`，不取得已绑定的 remote ID；
- Environment ID 只在候选选择时短暂跨 preload；
- 不给 `HostError` 增加 candidates 动态属性；
- 不新增 Environment view、详情或配置类型。

### 5.2 DesktopHost

在现有 Connection Interface 只增加一个方法：

```ts
connections: {
  // 现有方法保持
  setupEnvironment(
    connectionId: ConnectionId,
    environmentId?: string,
  ): Promise<EnvironmentSetupResult>;
}
```

同时把 Chat Interface 收窄回：

```ts
chats: {
  create(bot: BotRef): Promise<ChatView>;
}
```

删除 `chats.create` 的 `environmentId` 参数。Renderer 不再参与 Environment 解析。

### 5.3 Renderer `useConnections` Interface

`useConnections` 是 Renderer 中唯一编排 Connection 保存与 Environment setup 的 Module。公开 Interface 固定增加/修改为：

```ts
type ConnectAndSetupResult =
  | { status: "ready"; connection: ConnectionView }
  | {
      status: "selection-required";
      connection: ConnectionView;
      candidates: EnvironmentCandidate[];
    }
  | { status: "setup-error"; connection: ConnectionView; error: HostError };

connect(input: ConnectInput): Promise<ConnectAndSetupResult>;
setupEnvironment(
  connectionId: string,
  environmentId?: string,
): Promise<EnvironmentSetupResult>;
```

行为固定为：

```text
connect(input)
  -> DesktopHost.connections.connect(input)
  -> 立即把返回的 ConnectionView 写入 hook 列表
  -> DesktopHost.connections.setupEnvironment(created.id)
  -> ready：重新加载/替换该 ConnectionView，使 environmentReady=true，返回 ready
  -> selection-required：返回 created Connection 与候选，Connection 保持 environmentReady=false
  -> setup 抛错：转换为 setup-error 正常结果，携带 created Connection，列表保持 environmentReady=false
```

只有 Connection 验证/保存本身失败时 `connect` 才抛 `HostError`。Connection 已创建后的 setup 失败使用 `setup-error` 正常结果，使页面始终取得 `connection.id` 并可重试；不得把 `connectionId` 或 candidates 动态挂到 `HostError`。

`setupEnvironment` 用于多候选确认、失败重试和旧 Connection 设置。它 ready 后更新列表中对应 Connection 的 `environmentReady`；返回 selection-required 时保持 false。页面只调用这两个 hook 方法，不直接调用 `getDesktopHost()`。

### 5.4 Main 信任边界

在 `src/shared/validation.ts` 新增：

```ts
parseOptionalEnvironmentId(value: unknown): string | undefined | null;
```

语义：

- `undefined` 返回 `undefined`；
- 非空字符串返回原值；
- 其他输入返回 `null`。

`connections:setup-environment` IPC handler 必须分别校验非空 `connectionId` 与可选 `environmentId`。Preload 只转发并还原信封，不复制解析逻辑。

`chats:create` handler 只接收 `BotRef`，删除第二参数及其解析。

## 6. 本地存储

### 6.1 StoredConnection

在 `src/main/connections/connection-store.ts`：

```ts
interface StoredConnection {
  id: string;
  provider: string;
  displayName: string;
  credentialKey: string;
  workspaceId?: string;
  defaultEnvironmentId?: string;
}
```

`connections.json` 继续使用 `version: 1`。新增字段可选，旧文件无需迁移脚本。

只增加一个写方法：

```ts
setDefaultEnvironmentId(id: string, environmentId: string | null): Promise<StoredConnection | null>;
```

- 非空字符串写入字段；
- `null` 删除字段；
- 保留所有其他 Connection 字段；
- 使用现有原子写路径。

不要创建第二个 Environment 映射文件。

### 6.2 ConnectionView 映射

`ConnectionManager.list/connect/reconnect/update` 返回：

```ts
environmentReady: stored.defaultEnvironmentId !== undefined;
```

不把 ID映射到 Renderer。

ConnectionManager 增加 Main 内部只读方法：

```ts
getDefaultEnvironmentId(connectionId: string): Promise<string | null>;
```

它只读取 `ConnectionStore`，找不到 Connection 返回 `not-found`，字段缺失返回 `null`。BotControlPlane 与 ChatDataPlane 通过 Composition 注入的函数使用它，不直接读取 `connections.json`。

## 7. EnvironmentControlPlane Module

### 7.1 放置与 Interface

新增：

```text
src/main/control-plane/environment-control-plane.ts
src/main/control-plane/environment-control-plane.test.ts
```

该 Module 是唯一理解 OpenAgentPack Environment 公共能力的实现。Interface 固定为：

```ts
type ResolvedEnvironmentSetup =
  | { status: "ready"; environmentId: string }
  | { status: "selection-required"; candidates: EnvironmentCandidate[] };

interface EnvironmentControlPlane {
  setup(
    connectionId: string,
    connection: ResolvedConnection,
    requestedEnvironmentId?: string,
  ): Promise<ResolvedEnvironmentSetup>;
}
```

不要增加 `list/get/create/update/delete/archive` 公共方法；候选解析与创建全部隐藏在 `setup` 后面。

### 7.2 SDK 使用

只使用 `@openagentpack/sdk` 包根公开导出：

- `resolveProjectConfigFromObject`；
- `StateManager.initialize`；
- `createProjectRuntime`；
- `listCloudEnvironments`；
- `createCloudEnvironment`。

生产编码前先完成一个 tracer test，使用包根公开导出编译并运行以下完整链路：

```text
resolveProjectConfigFromObject
  -> StateManager.initialize
  -> createProjectRuntime
  -> listCloudEnvironments
```

tracer 必须明确并固化到 `environment-control-plane.test.ts` 的构造 helper 中：

- `resolveProjectConfigFromObject` 的完整 object 与 `{ basePath, projectName }`；
- `StateManager.initialize` 的公开参数和 backend；
- `createProjectRuntime` 的完整参数；
- Qoder 与 Bailian provider 凭据对象；
- 列表 limit/分页终止方式；
- 调用前后临时目录中不存在新增 state 文件。

如果当前公开 SDK 无法同时满足这些条件，立即停止并记录具体缺失的公开导出或参数；不改用 OpenAgentPack `internal`、Provider 原生 HTTP、长期临时目录或新的本地状态文件。

验证通过后，构造仅存在于本次调用中的最小 runtime。Project config 固定为：

```ts
{
  version: "1",
  providers: { [provider]: {} },
  defaults: { provider },
}
```

凭据通过 `createProjectRuntime(...providers)` 注入：

- Qoder：`{ api_key: credential }`；
- Bailian：`{ api_key: credential, workspace_id: workspaceId }`。

不得把凭据写入 Project Document、日志、错误或本地 state。`StateManager` 只为满足 runtime Interface 初始化；本流程不调用 `save()`，不产生 Environment state 文件。不要仅根据类型推断这一点，必须由上述 tracer test 证明。

`listCloudEnvironments` 必须读取全部候选后再执行 0/1/多分支。当前锁定的 OpenAgentPack SDK 中，Qoder 与 Bailian Adapter 的 `listEnvironments` 都经 `getAllPaged()` 读取完整列表，因此应用层只调用一次公开 `listCloudEnvironments`，不重复实现分页。若未来 SDK 合同改为只返回单页，先更新 SDK 公共 Interface/Adapter，再调整本 Module；不能把截断结果当作完整列表。

### 7.3 setup 算法

```text
listCloudEnvironments
  -> 过滤 archived_at != null
  -> requestedEnvironmentId 存在：
       在未归档列表按 id 精确查找
       找不到 -> not-found
       找到 -> ready(id)
  -> 0 个：createCloudEnvironment(固定默认配置) -> ready(new id)
  -> 1 个：ready(唯一 id)
  -> 2+ 个：selection-required(候选)
```

候选按 Provider 返回顺序展示；不增加本地排序。候选 name 缺失或空时使用 environment ID 作为 name。

SDK/Provider 错误映射复用控制面已有 `toControlPlaneError` 规则；如果当前函数是 `bot-control-plane.ts` 私有函数，把它提取为同目录内部 `control-plane-errors.ts` 供两个控制面 Module 共用。只在确实发生重复时提取，不预先建立 Provider 错误框架。

## 8. ConnectionManager 编排

给 `ConnectionManagerOptions` 增加一个依赖：

```ts
setupEnvironment: (
  connectionId: string,
  connection: ResolvedConnection,
  requestedEnvironmentId?: string,
) => Promise<ResolvedEnvironmentSetup>;
```

`ConnectionManager.setupEnvironment` 的固定流程：

```text
resolveCredential(connectionId)
  -> 调用 setupEnvironment dependency
  -> selection-required：原样返回候选，不写 connections.json
  -> ready：setDefaultEnvironmentId(connectionId, id)
  -> 返回 {status: "ready"}
```

如果远程 setup 成功但本地绑定写入失败，抛 `unavailable`；不删除远程 Environment。

`connect` 本身仍只负责验证、保存 Connection 和 credential，不在 Main 内自动调用 Environment setup。Renderer 的 `useConnections.connect` 负责紧接着调用一次 setup，这样多候选可以自然进入选择 UI，失败时已验证 Connection 仍然存在。

## 9. Managed Bot 控制面

### 9.1 Project Document

修改 `ProjectDocumentInput`：

```ts
interface ProjectDocumentInput extends CreateBotInput {
  projectName: string;
  provider: "qoder" | "bailian";
  environmentId: string;
}
```

`buildProjectDocument` 固定生成：

```yaml
environments:
  default:
    environment_id: "env_xxx"
    config:
      type: cloud

agents:
  "Bot Name":
    environment: default
```

外部引用中不复制远程 Environment name、description、networking、packages 或 metadata。`config.type` 是 OpenAgentPack 当前 `EnvironmentDecl` 的必填形状；它不表示本客户端管理远程配置。

删除 `<Bot名称>-environment` 命名约定和 managed environment description。

### 9.2 BotControlPlane.create

给 `BotControlPlaneOptions` 注入：

```ts
resolveDefaultEnvironmentId(connectionId: string): Promise<string | null>;
```

创建流程最前面解析绑定：

```text
resolveCredential
  -> resolveDefaultEnvironmentId
  -> null：conflict("connection environment is not configured")
  -> buildProjectDocument(environmentId)
  -> 现有 createScope / phase / Sync / backup 流程
```

Environment 缺失时必须在写 manifest、Project Document 或调用 Provider 前失败。

Bot update、sync、配置编辑和旧 managed scope 保持原样。

## 10. ChatDataPlane

### 10.1 Environment 解析

给 `ChatDataPlaneOptions` 增加：

```ts
resolveDefaultEnvironmentId(connectionId: string): Promise<string | null>;
```

保留现有 `resolveManagedEnvironmentId(connectionId, agentId)`，解析顺序固定为：

```text
验证远程 Bot 存在
  -> managed state 中有唯一 Environment ID：使用它
  -> 否则读取 Connection defaultEnvironmentId
  -> 仍为空：conflict("connection environment is not configured")
  -> Adapter.createChat(agentId, resolvedEnvironmentId)
```

这保证：

- 旧 Managed Bot 继续使用旧 Environment；
- 新 Managed Bot 的 state 记录外部引用 ID，继续使用共享 Environment；
- Remote-only Bot 使用 Connection 默认 Environment。

### 10.2 删除旧候选路径

删除：

- `ChatDataPlane.createChat` 的 `environmentId?` 参数；
- `resolveEnvironmentId()`；
- `HostError & { candidates?: ... }` 动态属性；
- `BotCatalog.listEnvironments()`；
- `BotEnvironmentView`；
- Qoder/Bailian BotCatalog 的 Environment 列表实现；
- `useChats.create(environmentId?)` 参数；
- workspace 的 `envCandidates` 状态；
- ChatsPage 的候选 Environment UI；
- App 到 ChatsPage 的 Environment 参数转发。

不要保留两套解析路径做兼容；Renderer 从未拥有 Environment 身份，旧参数应直接删除。

## 11. Renderer UI

### 11.1 添加 Connection 弹窗

现有 `connections-page.tsx` 已超过 800 行，新 Environment 交互是独立变化原因。提取完整添加流程，而不是只提取候选列表：

```text
src/renderer/features/connections/add-connection-dialog.tsx
src/renderer/features/connections/add-connection-dialog.test.tsx
src/renderer/features/connections/environment-setup-panel.tsx
src/renderer/features/connections/environment-setup-panel.test.tsx
```

职责固定为：

- `ConnectionsPage`：Connection 列表、选中详情、打开添加/设置入口；不持有 credential、候选或 setup 重试状态；
- `AddConnectionDialog`：持有 credentials、验证、setup、候选选择、setup error 与重试状态；调用 `useConnections` Interface；
- `EnvironmentSetupPanel`：只渲染候选、选择值和确认/重试动作，不访问 DesktopHost。

旧 Connection 的“设置运行环境”复用 `EnvironmentSetupPanel` 和同一个 `useConnections.setupEnvironment`，不复制候选获取逻辑。若需要父级容纳状态，使用同一个内存状态类型，不创建第二套 setup hook。

`EnvironmentSetupPanel` props 固定为展示型 Interface，避免它自行产生第二套编排：

```ts
interface EnvironmentSetupPanelProps {
  candidates: EnvironmentCandidate[];
  selectedEnvironmentId: string | null;
  pending: boolean;
  error: HostError | null;
  onSelectionChange(environmentId: string): void;
  onConfirm(): void;
  onRetry(): void;
  onCancel?(): void;
}
```

`connectionId` 留在调用方状态中，不传给展示 Panel；调用方通过闭包调用 `useConnections.setupEnvironment(connectionId, selectedEnvironmentId)`。onboarding 不提供取消退出工作区，settings 可以提供取消。

添加流程只使用三个 UI 状态：

```ts
type AddConnectionStep =
  | { type: "credentials" }
  | {
      type: "environment-selection";
      connectionId: string;
      candidates: EnvironmentCandidate[];
    }
  | { type: "environment-error"; connectionId: string };
```

这只是 Renderer 内存状态，不进入 shared model 或本地持久化。

提交凭据后的按钮/文案：

- 验证阶段：`正在验证连接…`；
- Environment setup 阶段：`正在准备运行环境…`；
- ready：清空 credential 表单并关闭；
- selection-required：清空 credential 字符串，切到选择面板；
- setup error：清空 credential 字符串，显示重试。

选择面板固定文案：

```text
选择运行环境
Bot 和 Chat 将在选定的云端运行环境中执行。
```

使用 design-system 公开的 RadioGroup；若尚未存在，先通过 shadcn CLI 引入官方 Radio Group，实现放在 `ui/design-system/` 并从 `index.ts` 导出。它有真实 Feature 调用方，满足 Primitive 门槛。不得用普通按钮列表伪造 radio 语义。

每项只显示：

- Environment name；
- name 与 ID 相同或 name 缺失时只显示 ID；
- 同名候选时追加缩短 ID 便于区分。

不显示 config JSON，不提供“创建新环境”选项。

### 11.2 Connection 设置详情

在现有 Connection 详情中增加一行：

```text
运行环境    已设置
```

或：

```text
运行环境    需要设置    [设置运行环境]
```

首版不显示 Environment 名称或 ID，因为它们没有存入 `ConnectionView`；也不提供“更换”。

点击“设置运行环境”调用同一个 setup 流程。0/1 个候选直接完成；多个打开 `EnvironmentSetupPanel`。

### 11.3 工作区门禁

`useWorkspace` 必须区分两个集合：

```ts
const connectedConnections = connections.filter((connection) => connection.credentialStored);
const readyConnections = connectedConnections.filter((connection) => connection.environmentReady);
```

语义固定为：

- Connection 设置页和账号管理可以展示 `connectedConnections`；
- `defaultConnectionId`、`activeConnection`、工作区账号切换候选和 `needsConnection` 只使用 `readyConnections`；
- `needsConnection = !loading && readyConnections.length === 0`；
- 新 Connection 保存 credential 后即使已进入 `connectedConnections`，在 setup ready 前仍停留 onboarding；
- `onConnected` 只在 setup 返回 ready 后调用；selection-required 或 setup error 不关闭 onboarding；
- 若 selected Connection 因 Workspace 修改变为 not-ready，清除/替换 selection 并打开 Connection 设置，不保留一个不可创建资源的 active Connection。

以下创建入口在没有 ready `activeConnection` 时不执行远程写入：

- 新建 Bot；
- 全局新建 Chat；
- Bot 下新建 Chat。

统一动作是打开 Connection 设置。显示：

```text
需要设置运行环境
设置后即可创建 Bot 和 Chat。
[设置运行环境]
```

不要在 BotsPage、NewChatPanel、ChatsPage 各自实现候选获取；它们只触发同一个 `openConnections` 动作。在 `App` 内容区域建立一个 Connection-ready gate，页面内部只保留防御性 early return，不能复制 setup 流程。

### 11.4 Chat 页面

删除当前“环境选择” warning 与候选按钮。`+ 新建 Chat` 始终是无参数动作。

`conflict` 且 Connection 未配置 Environment 时，文案为“需要先设置运行环境”；普通远程冲突仍使用现有通用冲突文案。优先依据 `activeConnection.environmentReady` 决定提示，不解析 HostError message。

## 12. Composition 与依赖方向

`createComposition` 固定装配：

```text
EnvironmentControlPlane
  <- ConnectionManager.setupEnvironment

ConnectionManager.getDefaultEnvironmentId
  -> BotControlPlane.resolveDefaultEnvironmentId
  -> ChatDataPlane.resolveDefaultEnvironmentId
```

依赖规则：

- Renderer 不导入 OpenAgentPack、Node、Provider Client；
- ConnectionStore 不调用 Provider；
- ConnectionManager 不理解 Qoder/Bailian HTTP；
- EnvironmentControlPlane 是 Environment SDK 知识的唯一位置；
- ChatDataPlane 不导入 OpenAgentPack；
- BotControlPlane 不读取 `connections.json`。

不要为只有一个实现的 EnvironmentControlPlane 建工厂注册表或 Provider Adapter seam。Provider 差异由 OpenAgentPack 吸收。

## 13. 错误语义

不新增 `HostErrorCode`：

| 场景                            | code                                                      |
| ------------------------------- | --------------------------------------------------------- |
| Connection/Environment 不存在   | `not-found`                                               |
| credential 已移除               | `not-connected`                                           |
| 选择的候选已归档或消失          | `not-found`                                               |
| Connection 尚未绑定 Environment | `conflict`                                                |
| Provider 鉴权/权限/限流         | 复用现有 `authentication` / `permission` / `rate-limited` |
| 网络、SDK 或本地绑定写入失败    | `unavailable`                                             |
| Provider 或输入不支持           | `invalid-input`                                           |

多候选是正常交互结果，使用 `EnvironmentSetupResult.selection-required`，不是错误。

错误对象不携带凭据、Provider response body、Project Document 或 Environment config。

## 14. 测试计划

测试遵循风险驱动原则，只覆盖用户流程、不变量和危险边界。

### 14.1 ConnectionStore

更新 `connection-store.test.ts`：

1. 旧 version 1 文件没有 `defaultEnvironmentId` 时仍可读取；
2. 设置 ID 后其他字段不变；
3. 清除 ID 后字段消失；
4. 非字符串 `defaultEnvironmentId` 判定文件损坏。

### 14.2 EnvironmentControlPlane

新增定向测试：

1. tracer：公开 SDK 完整 runtime 构造可运行，且不产生 state 文件；
2. 完整列表：确认锁定 SDK 的 Qoder/Bailian Adapter 均由 `getAllPaged()` 返回完整集合后再判断数量；
3. 0 个未归档 Environment：创建固定默认配置并返回新 ID；
4. 1 个未归档 Environment：直接返回该 ID，不创建；
5. 多个：返回候选，不创建；
6. archived 项不参与数量判断；
7. requested ID 存在：ready；
8. requested ID 不存在或已归档：`not-found`；
9. SDK 错误映射不泄露 Provider body 或 credential。

通过公开 `setup` Interface 测试，不断言私有 helper。

### 14.3 ConnectionManager

更新 `connection-manager.test.ts`：

1. setup ready 后持久化 ID并返回 ready；
2. 多候选不写绑定；
3. setup 失败保留 Connection 和 credential；
4. Bailian workspaceId 改变时清除绑定；
5. Workspace 改变成功后 `resolveCredential` 返回新 credential；
6. credential 保存失败时 Workspace 与绑定保持旧值；
7. ConnectionStore 更新失败时 credential 回滚为旧值，Workspace 与绑定保持旧值；
8. displayName-only update 保留 credential 与绑定；
9. list/reconnect/update 的 `environmentReady` 与存储一致。

### 14.4 Project Document 与 BotControlPlane

更新现有测试：

1. 新文档只声明一个 `environment_id` 外部引用；
2. 不再生成 `<Bot名称>-environment`；
3. Agent 引用固定逻辑名 `default`；
4. 未绑定 Environment 时 create 在本地写盘和 Provider 调用前返回 conflict；
5. 有绑定时 Sync state 记录同一个 Environment remote ID；
6. Bot edit/update 不改变 Environment ID；
7. 旧 Project Document 的 update/sync 测试继续通过。

### 14.5 ChatDataPlane

重写 Environment 相关测试：

1. Managed Bot state ID 优先；
2. state 无 Environment ID时使用 Connection 默认 ID；
3. 两者都缺失返回 conflict；
4. createChat 只把解析后的 ID传给 Adapter；
5. 删除旧的账号唯一环境猜测、多候选 conflict 和显式 override 测试。

### 14.6 Renderer

连接 UI 测试覆盖：

1. 0/1 个环境时不出现额外选择步骤并完成连接；
2. 多个环境时显示 RadioGroup，选中后才能完成；
3. 选择期间 credential 已从输入 state 清空；
4. setup 失败显示重试且 Connection 保留；
5. 旧 Connection 显示“需要设置”；
6. ready Connection 只显示“已设置”，没有更换或删除操作；
7. Environment 未设置时创建 Bot/Chat 打开 Connection 设置；
8. Chat 页面不再展示 Environment 候选；
9. credential 保存成功但 setup 未完成时 onboarding 不关闭；
10. `needsConnection`、default/active Connection 与账号切换只接受 ready Connection；
11. selection-required 和 setup error 不调用 `onConnected`；
12. 新 Connection 与旧 Connection 使用同一个 setup Interface。

避免断言 Tailwind class；断言 role、label、disabled、可见文本和调用参数。

### 14.7 真实 Cloud

保留并调整 `tests/live/shared-environment.live.test.ts`：

- 通过生产 `EnvironmentControlPlane.setup` 创建/选择 Environment；
- 两个独立 Managed Bot project 引用同一 ID；
- 两个 Agent 各创建 Session，Session 返回同一 ID；
- Qoder 与百炼都执行；
- 资源使用唯一前缀和 metadata；
- 删除 Session、Agent 后删除或按协议归档 Environment；
- 清理失败必须让测试失败。

不要在每次普通测试执行 live；继续使用 `OPENAGENTBOT_LIVE=1` 门禁。

## 15. 实施顺序与每阶段完成条件

### 阶段 A：权威文档与 shared contract

1. 更新 `docs/local-storage.md` 的 Connection Schema；
2. 更新 `docs/interfaces.md` 的 `ConnectionView`、`EnvironmentSetupResult`、`setupEnvironment` 与无参数 `chats.create`；
3. 更新 `docs/architecture.md` 的 EnvironmentControlPlane 与依赖方向；
4. 更新 `docs/validation.md` 用户流程、故障和 live smoke；
5. 更新 `docs/architecture.md`，删除 Chat 页选择 Environment 的旧结论；
6. 修改 shared model、DesktopHost contract 和 validation。

完成条件：文档与 TypeScript Interface 对同一行为只有一个描述，`chats.create` 不再暴露 Environment 参数。

### 阶段 B：存储与 EnvironmentControlPlane

1. 先完成公开 SDK tracer test，固化 runtime 参数、完整列表读取和无 state 文件证据；失败则停止；
2. 扩展 ConnectionStore；
3. 实现 EnvironmentControlPlane；
4. 实现 ConnectionManager setup/getDefaultEnvironmentId；
5. 完成 Workspace 更新的 credential/metadata 原子语义；
6. 完成 Composition 装配；
7. 通过定向 Main 测试。

完成条件：公开 SDK tracer 通过；完整列表的 0/1/多候选与指定候选四条路径都能通过 Main Interface 验证；Workspace 更新失败可恢复旧值；credential 不进入普通文件或日志。

### 阶段 C：Bot 与 Chat 收敛

1. Project Document 改为外部引用；
2. Bot create 增加绑定门禁；
3. ChatDataPlane 使用 managed-state → Connection-default 顺序；
4. 删除旧候选/override 路径；
5. 更新所有相关单元测试。

完成条件：新 Bot Sync 不创建 Environment；旧 Bot 仍读 state；Remote-only Bot 使用 Connection 默认值；Renderer 无法给 Chat 传 Environment。

### 阶段 D：Renderer

1. 先固定 `useConnections` Interface 与测试，完成 connect → setup 编排；
2. 从 `ConnectionsPage` 提取 AddConnectionDialog；
3. 新增 EnvironmentSetupPanel，并由新旧 Connection 设置共用；
4. Connection 详情增加 ready/missing 展示；
5. 建立基于 `readyConnections` 的工作区 gate；
6. 删除 ChatsPage 候选 UI；
7. 更新用户行为测试。

完成条件：普通 0/1 候选流程无额外步骤；只有多候选显示一次选择；setup 完成前 onboarding 不关闭；not-ready Connection 不会成为 active/default；环境未设置时没有 Bot/Chat 远程写请求。

### 阶段 E：验证与收尾

1. 运行所有定向测试；
2. 运行完整静态与架构门禁；
3. Qoder、百炼各运行一次 live；
4. 检查并确认所有远程临时资源已清理；
5. 搜索并删除陈旧的 `<botName>-environment`、`envCandidates`、`create(environmentId)` 和 Chat 环境选择文案；
6. 统计本次涉及文件行数，确认超过触发线的文件已按独立职责拆分；
7. 检查 diff，只保留本计划范围内变化。

完成条件：第 16 节验收命令全部通过，真实 Cloud 证据与最终代码一致，不存在旧环境选择路径。

## 16. 验收命令

先运行定向测试：

```bash
pnpm test src/main/connections
pnpm test src/main/control-plane/environment-control-plane.test.ts
pnpm test src/main/control-plane/project-document.test.ts
pnpm test src/main/control-plane/bot-control-plane.test.ts
pnpm test src/main/data-plane/chat-data-plane.test.ts
pnpm test src/renderer/features/connections
pnpm test src/renderer/features/chats
```

再运行完整门禁：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:arch
```

涉及 design-system RadioGroup 时额外运行：

```bash
pnpm test src/renderer/ui/design-system
```

真实 Cloud：

```bash
OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/shared-environment.live.test.ts --no-file-parallelism
```

如果任务要求完整交付门禁，再运行：

```bash
pnpm gate
```

打包下载因网络失败时，按根 `AGENTS.md` 使用 Electron 镜像重试；不得把网络失败误报为实现通过。

## 17. 最终验收清单

- [ ] Connection 本地只新增可选 `defaultEnvironmentId`；
- [ ] Renderer 只看到 `environmentReady`，不持有默认远程 ID；
- [ ] 0 个 Environment 自动创建，1 个自动绑定，多个要求选择；
- [ ] 多候选使用正常结果而不是动态扩展 HostError；
- [ ] 自动创建只使用固定 cloud/unrestricted 配置；
- [ ] 新 Managed Bot 使用 `environment_id` 外部引用；
- [ ] Bot Sync 不创建、更新或删除共享 Environment；
- [ ] 旧 Managed Bot 继续使用 state 中的 Environment；
- [ ] Remote-only Bot 使用 Connection 默认 Environment；
- [ ] Chat DesktopHost Interface 没有 Environment 参数；
- [ ] Chat 页面没有 Environment 选择 UI；
- [ ] 未完成 Environment 设置时不创建 Bot/Chat；
- [ ] credential 已保存但 Environment 未 ready 时 onboarding 不关闭，Connection 不成为 active/default；
- [ ] `useConnections` 是 connect → setup 的唯一 Renderer 编排位置；
- [ ] 不存在 Environment 管理页、缓存、ownership、Bot override 或删除操作；
- [ ] Bailian Workspace ID 修改会保存新 credential 并清除绑定，失败时恢复旧 credential、Workspace 与绑定；
- [ ] Environment 列表读取完整；公开 SDK runtime tracer 证明不产生 state 文件；
- [ ] 凭据不进入日志、文件、IPC 返回或测试快照；
- [ ] Qoder 与百炼 live 共享复用测试通过并完成清理；
- [ ] 所有陈旧测试与文档已同步删除或改写；
- [ ] 全量门禁通过，或对与本次无关的既有失败提供精确证据。
