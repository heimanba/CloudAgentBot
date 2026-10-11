# Managed Bot 归档开发计划

## 1. 目标与完成定义

为 Managed Bot 增加单一的“归档 Bot”能力。用户确认后，CloudAgentBot 通过当前 Connection 的 Provider 凭据调用远程 Agent 软归档接口；归档成功后，该 Agent 从 Provider 默认 Bot 列表消失，因而也从本客户端的 Bot 列表和 Chat roster 消失。

本功能不是永久删除，也不是本地资料清理。归档必须保留：

- Provider 中的 Agent 数据；
- Provider 中已有的 Chat、Message 与运行结果；
- Connection 与 credential；
- Environment；
- `managed-bots/<connectionId>/<scope>/` 下的完整 Project Document、state、manifest 与配对 backup。

完成后的用户流程固定为：

1. 用户在 Bot 管理页打开某个 Managed Bot 的操作菜单；
2. 点击“归档 Bot…”；
3. AlertDialog 明确说明 Bot 将从列表移除、不能再创建新 Chat、已有远程数据与本地管理资料仍保留；
4. 用户确认后，按钮进入“归档中…”且不能重复提交或关闭弹窗；
5. Main 在该 managed scope 的单写锁内再次校验完整性并调用 Provider 归档；
6. 成功后 Renderer 关闭弹窗并刷新 Bot 列表；归档 Bot 及其 Chat roster 项自然消失；
7. 失败时弹窗保持打开并显示稳定错误，用户可取消或重试；Bot 列表与本地管理资料保持不变。

完成标准不是“菜单能调用接口”，而是领域语义、scope 门禁、并发、Provider 错误、IPC 信任边界、Renderer 状态和真实 Cloud 结果形成一致闭环。

## 2. 已冻结的产品决策

### 2.1 唯一操作是远程软归档

- 产品名称、Interface 方法、IPC channel、测试名称和文档统一使用 `archive` / “归档”，不得使用 `delete` / “删除”指代本能力。
- 归档触发 Provider 的 Agent archive 操作，不调用 Agent `DELETE`。
- 本客户端不新增“停止本地管理”“删除本地 Bot”“本地归档”或“永久删除远程 Bot”。
- 不新增归档列表、恢复/取消归档或清理本地资料入口。

### 2.2 只允许 Managed Bot

- 只有 `BotView.management === "managed"` 的 Bot 在 Renderer 显示归档入口。
- `remote-only` 和 `state-missing` 不显示入口。
- Main 不信任 Renderer：即使直接调用 IPC，找不到完整可写 managed scope 时也必须在任何 Provider mutation 前拒绝。
- Remote-only 返回 `not-found`；state 缺失、损坏或配对关系不完整返回 `managed-state-missing`，沿用现有语义，不新增错误码。

### 2.3 本地 IaC 资料明确保留

归档成功后不得删除或修改 managed scope。原因固定为：

1. 本功能只表达 Provider 生命周期变化，不引入第二个本地生命周期；
2. 避免“远程归档成功、本地删除失败”的跨系统部分成功事务；
3. Agent 将来若在 Provider 外部恢复且重新出现在默认列表中，现有 state 仍能按同一 `Connection + remoteAgentId` 将其识别为 Managed Bot；
4. 本地期望配置与远程当前事实本来就是不同权威，不应因远程软归档删除本地期望资料。

由此产生的结果也一并冻结：归档 Bot 的 scope 仍计入删除本地 Connection 时展示的本地 managed scope 数量；只有用户执行现有“删除本地连接”并明确授权删除 managed data 时，这些文件才会被删除。

### 2.4 身份与资源影响

- 归档目标只能由经过校验的 `BotRef { connectionId, agentId }` 定位；不得按名称、metadata 或列表位置查找。
- Bot 身份仍是 `Connection + remoteAgentId`，归档不创造本地身份。
- 不列举、不修改、不归档、不删除 Environment。
- 不遍历或修改已有 Session；Provider 保留已有 Session 是远程合同的一部分。
- 归档后不得再为该 Agent 创建新 Chat。正常 UI 中 Agent 已从 Bot 列表消失；若旧页面或伪造 IPC 继续调用创建，最终由 Provider 拒绝，本客户端不建立本地 archived Agent 缓存。

## 3. Provider 与 SDK 事实

### 3.1 Provider 合同

百炼：

- `POST /api/v1/agentstudio/agents/{agent_id}/archive`；
- 软归档，`archived_at` 被填入；
- 默认列表不返回，`include_archived=true` 可返回；
- 不可用于创建新 Session；
- 已有 Session 不受影响；
- 归档不增加 Agent version。

文档：<https://docs.agent.bailian.aliyun.com/zh/api/managed-agents/agent/archive>

Qoder：

- `POST /api/v1/cloud/agents/{agent_id}/archive`；
- Agent 数据保留，默认列表不返回，按 ID 和 `include_archived=true` 仍可读取；
- 操作幂等；
- 归档不增加 Agent version，也不创建 version snapshot。

文档：<https://docs.qoder.com/cloud-agents/api/agents/archive>

### 3.2 OpenAgentPack 公共 Interface

当前依赖 `@openagentpack/sdk` 0.7.2 已从包根公开：

```ts
archiveCloudAgent(
  ctx: ProjectRuntimeContext,
  id: string,
  options?: { provider?: string },
): Promise<void>;
```

该公共 Interface 已把 Qoder 与百炼 Adapter 的 Agent mutation 映射为对应的软归档请求。本客户端必须只从 `@openagentpack/sdk` 包根导入 `archiveCloudAgent`；不得：

- 从 OpenAgentPack `internal` 路径导入；
- 在本客户端新建 Qoder/百炼 Agent archive HTTP Adapter；
- 直接拼接 Provider URL；
- 调用 OpenAgentPack 的 destroy/plan-destroy 路径；
- 修改 `agents.yaml` 后通过 Sync 间接删除 Agent。

## 4. 非目标

- 永久删除远程 Agent；
- 归档 Remote-only 或 state-missing Bot；
- 删除或归档 Chat、Message、Environment；
- 删除、移动、重命名或增加本地 managed scope 文件；
- 在本地记录归档状态、归档时间或 Operation；
- 展示 Provider 的已归档 Agent；
- 恢复或取消归档；
- 自动重新绑定、接管或迁移 Agent；
- Provider capability matrix 或第二套 Adapter seam；
- 修改 OpenAgentPack；
- 改变 Bot/Chat 的远程身份规则；
- 后台重试、持久重试队列或启动时自动执行远程 mutation。

实施中一旦需要进入以上范围，停止并记录阻塞，不得临场扩展。

## 5. 领域与权威文档更新

### 5.1 `CONTEXT.md`

在 Bot 相关术语后增加：

> **Archived Bot**：Provider 中被软归档的远程 Agent。它保留远程 Agent 数据和已有 Chat，但不出现在 Provider 默认 Agent 列表中，也不能创建新 Chat。归档不改变 Bot 身份，也不删除本机已有的 Managed Bot IaC 资料。
> _避免使用_：已删除 Bot、本地归档 Bot

不要在 `CONTEXT.md` 写 endpoint、SDK、文件路径或 UI 实现。

### 5.2 其他权威文档

- `docs/architecture.md`：把“首版永久删除远程 Agent”继续保留为范围外；在 BotControlPlane 职责中加入“归档 Managed Bot”，并明确它保留本地 scope。
- `docs/local-storage.md`：在“数据删除”补充远程归档不删除、不改写 managed scope；归档 scope 仍属于本地 IaC 资料。
- `docs/interfaces.md`：记录 `bots.archive(ref): Promise<void>` 的前置条件、成功影响和错误语义。
- `docs/validation.md`：加入本计划第 12 节的验收项。
- `docs/bot-edit-development-plan.md` 的“Bot 删除或归档”仍是编辑阶段非目标，不改成已在该阶段实现；如需说明，只添加指向本计划的后续阶段引用。

该决策是新的产品生命周期语义，但仍是可扩展的软归档能力，不新建 ADR；只有未来决定自动恢复、永久删除或清理本地 scope 时再评估 ADR。

## 6. 跨层 Interface

### 6.1 Shared model

`src/shared/models.ts` 不增加 View、输入结构或错误码。复用 `BotRef` 与现有 `HostErrorCode`。

### 6.2 DesktopHost

在 `src/shared/desktop-host-contract.ts` 的 `bots` Interface 增加且只增加：

```ts
archive(ref: BotRef): Promise<void>;
```

返回 `void`：Renderer 成功后通过现有 `bots.list` 重读 Provider 事实，不让 Main 构造一个已经不应显示的 `BotView`。

### 6.3 IPC 与 Preload

固定使用 channel：

```text
bots:archive
```

`src/main/bootstrap.ts`：

```ts
ipcMain.handle("bots:archive", (_event, ref: unknown) =>
  invoke(() => {
    const parsed = parseBotRef(ref);
    if (parsed === null) {
      throw hostError("invalid-input", "bot ref must be {connectionId, agentId}");
    }
    return host.bots.archive(parsed);
  }),
);
```

- 必须复用 `parseBotRef`；
- IPC handler 不检查 management、不解析 state、不调用 SDK；
- 错误继续走现有 `IpcResult<void>` 信封。

`src/preload/index.ts` 只增加：

```ts
archive: (ref: BotRef) =>
  unwrap(ipcRenderer.invoke("bots:archive", ref) as Promise<IpcResult<void>>),
```

不得通过 preload 暴露 Provider、scope、archive response 或 `archived_at`。

## 7. Main 控制面实现

### 7.1 Seam 与职责

归档属于 `BotControlPlane`，不属于 `ChatDataPlane`、Bot catalog、ConnectionManager 或 Renderer。`DesktopHost` 只转发：

```ts
bots: {
  // existing methods...
  archive: (ref) => options.botControlPlane.archive(ref),
}
```

`BotControlPlane` 隐藏 scope 定位、锁、完整性、credential、runtime 和 Provider 差异，公开：

```ts
async archive(ref: BotRef): Promise<void>
```

### 7.2 精确执行流程

实现必须按以下顺序，不得交换：

```text
findScopeByAgentId(connectionId, agentId)
  -> null 或 manifest=null：not-found，零 Provider mutation
  -> 取得 snapshot.scope
  -> scopeLock.runExclusive(scope)
     -> assertWritable(connectionId, scope)
     -> manifest=null：managed-state-missing
     -> 再次从当前 state 确认该 scope 的 agentId === ref.agentId
     -> 读取 agents.yaml；缺失：managed-state-missing
     -> resolveCredential(connectionId)
     -> connection.provider 必须等于 manifest.provider；否则 conflict
     -> parse YAML + resolveProjectConfigFromObject
     -> readProjectRuntime(..., runtime =>
          archiveCloudAgent(runtime, ref.agentId, { provider: connection.provider })
        )
     -> SDK/Provider 错误经 toControlPlaneError(error, `archive agent ${ref.agentId}`)
     -> 成功返回 void；不写任何本地文件
```

锁内“再次确认 agentId”不可省略：首次定位和真正 mutation 之间可能有并发或外部文件变化。使用当前 state 的公共只读入口确认，不解析 `agents.state.json` 原文，也不使用 backup 作为 mutation 权威。

为避免给 Store 增加宽泛 Interface，优先复用 `findScopeByAgentId` 后在锁内再次调用一次，并确认返回的 `scope` 与当前 scope 相同；随后调用 `assertWritable`。若现有 Store 实现无法在不重复全目录扫描的情况下完成，可增加一个只读 helper：

```ts
scopeManagesAgent(connectionId: ConnectionId, scope: string, agentId: string): Promise<boolean>
```

该 helper 只能通过 `LocalFileStateBackend` 公共读取能力判断当前 state，不读 backup、不解析 JSON。不要让它返回 Provider wire 数据。

### 7.3 Runtime 构造

复用 `BotControlPlane.#modelOptions` 与 `#syncScope` 已有模式，不新增 Adapter：

- `dir = store.scopeDir(connectionId, scope)`；
- `projectYaml = store.readProject(dir)`；
- `parseProjectYaml(projectYaml, scope)`；
- `resolveProjectConfigFromObject(rawConfig, { basePath: dir, projectName: manifest.projectName })`；
- `stateBackend = createManagedStateBackend(dir)`；
- `stateScope = { projectId: manifest.projectName }`；
- providers override 只在本次 runtime 调用中注入：
  - Qoder：`{ qoder: { api_key: credential } }`；
  - Bailian：`{ bailian: { api_key: credential, workspace_id: workspaceId } }`。

不得把 credential 写入 Project Document、state、日志或 HostError。

若重复代码明显，可在 `BotControlPlane` 内提取 private helper 构造 runtime input；不要为单一调用方增加新的公共 Module。

### 7.4 错误映射

沿用 `toControlPlaneError`：

| 情况                                     | HostError               |
| ---------------------------------------- | ----------------------- |
| 无 managed scope / Remote-only           | `not-found`             |
| state、manifest、Project Document 不完整 | `managed-state-missing` |
| Connection 未连接                        | `not-connected`         |
| Provider 变更                            | `conflict`              |
| 凭据无效                                 | `authentication`        |
| 无归档权限                               | `permission`            |
| Provider Agent 不存在                    | `not-found`             |
| Provider 冲突                            | `conflict`              |
| 限流                                     | `rate-limited`          |
| 网络或未知 Provider 失败                 | `unavailable`           |

不得新增 `archive-failed`、`partial-failure` 或 Provider 专用错误码。不得把 Provider response body、URL、credential 或 Project 内容放入跨 IPC message。

### 7.5 并发与重试

- 归档必须持有与 `create/update/sync/getConfiguration` 同一个 scope lock；同一 scope 的 update、sync、配置读取和 archive 串行。
- 不同 scope 可以并行。
- Renderer 只允许一个归档请求在飞行中。
- Provider 失败不自动重试；用户可在原弹窗中重试。
- Qoder 远程归档幂等；百炼不依赖未写明的幂等承诺。由于成功后立即关闭弹窗并刷新列表，正常路径不会重复请求；失败路径只由用户明确重试。
- 不新增持久 Operation、定时重试或应用启动恢复。

## 8. Renderer 实现

### 8.1 `useBots`

在 `UseBotsResult` 增加：

```ts
archive(ref: BotRef): Promise<HostError | null>;
```

固定行为：

```text
调用 desktopHost.bots.archive(ref)
  -> 成功：reload()，返回 null
  -> HostError：原样返回
  -> 未知错误：{ code: "unavailable", message: "archive bot failed" }
```

`archive` 不做乐观删除；只有远程成功后才触发 reload。请求互斥由 `BotsPage` 的 pending 状态保证，Main 的 scope lock 是最终并发门禁。

### 8.2 `BotsPage`

`BotsPageProps` 增加：

```ts
onArchive(ref: BotRef): Promise<HostError | null>;
```

在 `ManagedBotActions` 菜单中按以下顺序显示：

1. 编辑配置；
2. 重新同步；
3. 分隔线；
4. 带 `Archive` icon、destructive 视觉的“归档 Bot…”。

若 design-system 当前 `DropdownMenuItem` 已支持 destructive variant，直接使用；否则只用现有 token 工具类表达 destructive 文本，不新增颜色常量、不写 CSS、不修改 Primitive。

`BotsPage` 持有：

```ts
const [pendingArchiveBot, setPendingArchiveBot] = useState<BotView | null>(null);
const [archiving, setArchiving] = useState(false);
const [archiveError, setArchiveError] = useState<HostError | null>(null);
```

整页只渲染一个现有 `ConfirmDialog`，不得每行创建一份 Dialog。属性固定为：

- `title`: `归档 “${bot.name}”？`
- `description`: `归档后，该 Bot 将从列表中移除，不能再创建新的 Chat。已有 Chat、远程数据和本机管理资料仍会保留。`
- `confirmLabel`: `归档 Bot`
- `confirmVariant`: `destructive`
- `pending`: `archiving`
- pending 时取消按钮、确认按钮、overlay 与 Esc 均不能关闭（复用 `ConfirmDialog` 既有语义）。

错误显示在 Dialog description 内，使用现有 `Alert` 或符合 design-system 的 destructive 文本。失败后：

- `archiving=false`；
- Dialog 保持打开；
- 显示 `errorText(archiveError)`；
- 用户可以重试或取消；
- 再次确认前清除旧错误。

成功后：

- 清空 `pendingArchiveBot`、`archiveError`；
- Dialog 关闭；
- `useBots.archive` 已触发 reload；
- 不手工修改 `bots` 数组。

### 8.3 App 接线与导航

`src/renderer/app.tsx` 给 `BotsPage` 传入：

```tsx
onArchive={workspace.bots.archive}
```

归档入口首版只存在于 Bot 管理页，不在 AppSidebar、NewChatPanel、ChatDetailPage、ChatsPage 或编辑表单重复增加。这样归档发生时 `selectedBot === null`，无需新增跨页面选中态清理逻辑。

Bot list reload 后，`useChatRoster` 基于新的 Bot 集合重新聚合，归档 Bot 的既有 Chat 从当前 UI 自然消失；不得为此删除远程 Chat或创建本地 Chat tombstone。

### 8.4 文案与可访问性

- 菜单项可访问名称包含 Bot 名称或由上下文菜单触发器提供关联；
- Dialog title 必须包含 Bot 名称；
- pending 文案由 `ConfirmDialog` 现有“处理中…”承担，不新建 spinner 文案；
- Provider 错误文案复用并补足 `BotsPage.errorText`，不得显示原始 Provider body；
- 成功后不弹 toast；列表消失即为结果反馈。

## 9. 明确不修改的文件与行为

- `src/shared/models.ts` 的 `BotView.management` 不新增 `archived`；
- `ManagedBotStore` 不增加 remove/archive 方法，不修改 manifest phase；
- `agents.yaml`、`agents.state.json` 和 backup 内容不变；
- `ConnectionManager` 和 EnvironmentControlPlane 不变；
- Chat archive/delete Interface 不变；
- Bot catalog 继续只返回 Provider 默认未归档 Agent；
- 不使用 `include_archived=true` 驱动生产 UI；该参数只允许用于 live test 的归档后证据检查；
- 不修改 design-system Primitive，除非实施发现现有 `ConfirmDialog` 无法满足本计划列出的交互；若必须修改，按 AGENTS.md 运行 design-system 定向测试并记录原因。

## 10. 单元与集成测试计划

### 10.1 `BotControlPlane` 测试

在 `src/main/control-plane/bot-control-plane.test.ts` 增加：

1. 完整 Managed Bot 使用 state 中精确 `agentId` 调用一次 `archiveCloudAgent`；
2. Qoder runtime 只注入当前 Connection credential，provider option 为 `qoder`；
3. 百炼 runtime 同时注入 credential 与 `workspace_id`，provider option 为 `bailian`；
4. archive 成功后 Project、state、manifest、backup 内容逐一保持不变；
5. 无匹配 scope 时返回 `not-found` 且 archive mock 零调用；
6. state-missing、损坏 state、缺 manifest、缺 Project 时在远程 mutation 前失败；
7. manifest Provider 与 Connection Provider 不一致时返回 `conflict` 且零 mutation；
8. archive Provider 错误经稳定 HostError 映射；
9. 同一 scope 的 archive 与 sync/update 不并行进入 Provider mutation；
10. 不同 scope 不被全局锁串行化；
11. 首次定位后 scope/state 被改变时，锁内复核失败并保持零 mutation；
12. archive 不调用 `writeProject`、`writePairBackup`、`transitionPhase` 或任何删除方法。

测试必须 mock `@openagentpack/sdk` 包根公开函数，不 mock或导入 internal Adapter。

### 10.2 DesktopHost、IPC、Preload

- `src/main/desktop-host.test.ts`：`host.bots.archive(ref)` 精确转发到 BotControlPlane；错误不被 DesktopHost 吞掉。
- `src/main/bootstrap` 对应测试：合法 BotRef 调用 archive；空 connectionId、空 agentId、错误类型返回 `invalid-input`；无 Provider 调用。
- preload/contract 类型测试：`bots.archive` 返回 `Promise<void>`，错误经 `unwrap` 恢复为 HostError。

如 bootstrap 当前没有独立 handler 测试 seam，不为本功能大规模重构 bootstrap；至少由 `parseBotRef` 现有测试和 DesktopHost 测试覆盖信任边界，并在计划完成记录中说明。

### 10.3 Renderer 测试

在 `src/renderer/features/bots/bots-page.test.tsx` 或现有对应测试中覆盖：

1. managed 行显示“归档 Bot…”，remote-only/state-missing 行不显示；
2. 点击只打开确认 Dialog，不立即调用 `onArchive`；
3. Dialog 展示 Bot 名称和冻结文案；
4. 取消不调用 archive；
5. 确认只传入该 Bot 的完整 `BotRef`；
6. pending 时无法重复确认或取消；
7. 成功后 Dialog 关闭；
8. 失败后 Dialog 保持打开、显示映射后的错误并允许重试；
9. 归档一个 Bot 不影响其他行；
10. 创建、编辑和重新同步入口仍可用。

在 `use-bots.test.tsx`（如不存在则创建同目录测试）覆盖：

- 成功调用 host archive 并触发 reload；
- HostError 原样返回且不 reload；
- 未知错误收敛为 `unavailable`；
- 不做本地乐观删除。

### 10.4 回归测试

- Bot create/update/sync/getConfiguration 全部既有测试通过；
- Chat archive/delete 测试不因同名方法接错 channel；
- Connection 删除统计仍包含保留的 managed scope；
- Chat roster 对 Bot 列表刷新后的收敛测试通过。

## 11. 真实 Cloud 验证

新增或扩展一个受 `RUN_LIVE=1` 门禁的 live test，Qoder 与百炼分别运行相同生命周期。不得使用现有用户 Agent；每个测试必须创建带唯一前缀与测试 metadata 的临时 Agent，并使用仓库现有 `.env`，不得输出、修改或提交凭据。

### 11.1 每个 Provider 的固定步骤

```text
创建独立临时 Environment（或按现有 live helper 使用测试 Environment）
  -> 通过生产 BotControlPlane 创建 Managed Bot
  -> 创建一个临时 Session，记录 sessionId
  -> 调用生产 BotControlPlane.archive(ref)
  -> 默认 Agent list 断言不再包含 agentId
  -> include_archived=true 断言仍能找到 agentId 且 archived_at 非空
  -> 断言本地 scope 的 manifest/project/state/backup 全部仍存在且内容未变
  -> 读取已有 Session，断言仍存在
  -> 尝试为已归档 Agent 创建新 Session，断言 Provider 拒绝
  -> 清理临时 Session
  -> Environment 能删除则删除；引用阻塞时按 Provider 正式协议归档并记录
```

Agent 已按产品能力归档，不再尝试永久删除，也不把“仍可通过 include_archived 查询”记为资源泄漏。

### 11.2 Qoder 额外断言

- 对同一 Agent 直接重复调用 archive，验证文档声明的幂等行为；
- Agent version 不因归档增加；
- 按 ID读取仍成功。

### 11.3 百炼额外断言

- Agent version 不因归档增加；
- 已有 Session 不受影响；
- 新 Session 创建失败符合文档；
- 不把重复 archive 作为产品路径的前置要求。可记录重复调用实际结果，但不得据此扩大本客户端行为。

真实 Cloud 测试若发现 Qoder 或百炼当前 SDK `archiveCloudAgent` 实际执行永久删除、删除 Session、修改 Environment，必须停止实施并记录合同偏差，不能调整产品语义迁就实现。

### 11.4 真机验证发现的 Provider 合同偏差（已记录，未调整产品语义）

2026-09-20 真机验证（`tests/live/bot-archive.live.test.ts`，多次独立运行复现）发现以下与官方文档的矛盾。两者均**不是**上列破坏性停止条件（无永久删除、无 Session 删除、无 Environment mutation），故实施继续，但如实记录。本产品语义未迁就这些实现：归档 Bot 从列表消失、正常 UI 无法发起新 Chat，均不依赖下列 Provider 行为。

1. **Qoder 归档后按 ID / include_archived 不可读**。文档声明“Agent 数据保留，默认列表不返回，按 ID 和 `include_archived=true` 仍可读取”。真机归档生效后（默认列表已不含、重复归档幂等不报错）按 ID `GET /agents/{id}` 返回 404，`include_archived=true` 列表也不命中；行为跨运行不稳定（偶发可读）。归档实际等同“从所有读取路径隐藏”。Qoder 归档后无法获取 `archived_at`/`version` 做归档后对比，version 不增加改由“重复归档幂等且不产生新可读资源”间接佐证。

2. **百炼归档生效后仍接受新建 Session**。文档声明归档 Agent“不可用于新建会话”。真机在归档确认生效（`archived_at` 已填入、`include_archived` 命中、version 不变）后，新建 Session 仍返回 200/201 并成功（已轮询 60s 排除传播窗口），跨运行偶发拒绝。测试已清理偏差路径创建的临时 Session。

两项偏差的测试断言按实际真机行为记录并保留 `CONTRACT DEVIATION (recorded)` 日志，未降低核心软归档断言（默认列表不含、本地 scope/manifest/state/backup 不变、已有 Session 保留、幂等、version 不增加）。若 Provider 未来按文档收紧，对应断言应恢复严格。

## 12. 验收矩阵

以下全部成立才算完成：

| 场景                        | 预期                                                |
| --------------------------- | --------------------------------------------------- |
| Managed Bot 打开菜单        | 显示“归档 Bot…”                                     |
| Remote-only / state-missing | 不显示归档入口                                      |
| 未确认                      | 零远程 mutation                                     |
| 确认归档                    | 只调用目标 Provider 的 Agent archive                |
| 归档成功                    | Dialog 关闭，列表刷新，Bot 与其 Chat roster 消失    |
| 归档成功后的远端            | 默认列表不可见，include_archived 可见，数据保留     |
| 归档成功后的本地            | scope、Project、state、manifest、backup 原样保留    |
| 归档成功后的 Chat           | 已有 Chat 保留；不能创建新 Chat                     |
| Provider 失败               | Dialog 保持、显示稳定错误、本地资料不变             |
| state 不完整                | fail-closed，零远程 mutation                        |
| Provider 不一致             | conflict，零远程 mutation                           |
| 与 sync/update 并发         | 同 scope 串行，不发生交叉 mutation                  |
| Environment                 | 无创建、修改、归档或删除                            |
| Connection 删除统计         | 归档 scope 仍计入本地管理资料数量                   |
| 应用重启                    | 不自动重试归档，不显示归档 Agent                    |
| 外部恢复 Agent 后刷新       | 同一 remoteAgentId 重新与保留 scope join 为 managed |

最后一项不要求在本客户端提供恢复按钮，只验证保留本地资料不会改变身份或自动接管规则。

## 13. 实施顺序

严格按以下阶段提交和验证；每阶段先完成测试再进入下一阶段：

### 阶段 A：文档与契约

1. 更新 `CONTEXT.md`；
2. 更新 architecture/local-storage/interfaces/validation；
3. 在 DesktopHost 增加 `bots.archive`；
4. 增加 DesktopHost 契约与转发测试。

完成条件：类型层清楚表达归档，不出现 delete 命名，不涉及 UI。

### 阶段 B：Main 控制面

1. 在 `BotControlPlane` 导入包根 `archiveCloudAgent`；
2. 实现 managed scope 定位、锁内复核、完整性门禁与 runtime 调用；
3. 接入 `toControlPlaneError`；
4. 补齐控制面测试；
5. 确认所有本地文件在成功与失败路径均不变。

完成条件：通过 BotControlPlane Interface 可以安全归档两种 Provider 的 Managed Bot，Remote-only/state-missing fail-closed。

### 阶段 C：IPC 与 Preload

1. 增加 `bots:archive` handler；
2. 使用 `parseBotRef`；
3. 增加 preload 转发；
4. 补齐信任边界测试。

完成条件：Renderer 只能提交 BotRef，Provider 与 scope 细节不跨 preload。

### 阶段 D：Renderer

1. `useBots` 增加 archive；
2. `BotsPage` 增加单一 ConfirmDialog 与 pending/error 状态；
3. Managed Bot 菜单增加归档入口；
4. App 接线；
5. 补齐用户行为测试。

完成条件：确认前零调用、失败可重试、成功刷新、其他 Bot 与现有动作不受影响。

### 阶段 E：验证与收尾

1. 运行静态与自动测试；
2. 运行 Qoder、百炼真实 Cloud 验证；
3. 检查资源清理与归档证据；
4. 搜索并消除本能力中的“删除 Bot”陈旧文案；
5. 检查 diff 确认没有 internal import、本地删除、Environment mutation 或新持久对象。

## 14. 命令与验证门禁

实施完成后至少运行：

```bash
pnpm typecheck
pnpm lint
pnpm test src/main/control-plane/bot-control-plane.test.ts
pnpm test src/main/desktop-host.test.ts
pnpm test src/renderer/features/bots
pnpm test
pnpm test:arch
pnpm build
```

若修改 design-system Primitive，再额外运行：

```bash
pnpm test src/renderer/ui/design-system
```

真实 Cloud：

```bash
RUN_LIVE=1 pnpm test:live -- <bot-archive-live-test-file>
```

使用实际新增的 live test 文件名替换占位符。不得为了通过测试降低 fail-closed 门禁、跳过 Provider 事实检查或删除已有断言。

## 15. 实施完成检查表

- [ ] 所有产品文案使用“归档”，没有把软归档写成永久删除；
- [ ] 仅 Managed Bot 有入口，Main 也执行相同门禁；
- [ ] 使用 `@openagentpack/sdk` 包根 `archiveCloudAgent`；
- [ ] 归档目标只来自校验后的 Connection + remoteAgentId；
- [ ] 同 scope 归档与 update/sync 串行；
- [ ] 成功和失败路径都不修改或删除本地 managed scope；
- [ ] 不触及 Environment、Chat、Message、Connection、credential；
- [ ] Provider 错误映射为现有 HostError 且不泄漏敏感信息；
- [ ] Renderer 使用现有 ConfirmDialog，pending 不可重复提交；
- [ ] 失败保留 Dialog 并允许用户重试；
- [ ] 成功只通过 reload 收敛，不做乐观删除；
- [ ] Qoder 与百炼真实 Cloud 归档结果符合文档；
- [ ] 已有 Session 保留，新 Session 被拒绝；
- [ ] 全量测试、架构检查与 build 通过；
- [ ] 权威文档与代码行为一致；
- [ ] diff 中没有 OpenAgentPack internal import、直接 Provider HTTP、Bot DELETE 或新的本地归档状态。
