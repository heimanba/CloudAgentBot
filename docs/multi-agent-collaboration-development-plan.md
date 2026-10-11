# Multi-Agent 协作 Bot 开发计划

## 0. 执行契约（先读、不可自行改义）

实施 Agent 必须按第 12 节顺序完成工作。以下契约是本计划的单一决策入口；遇到旧文档、旧测试或实现细节冲突时，先按本节修正文档与测试，不重新发明产品模型：

1. **协作 Bot 仍是普通 Bot**：身份始终是 `Connection + remoteAgentId`；不新增 Room、Team、Role Instance、Coordinator Bot 类型或本地协作实体。
2. **一个 Managed Bot 仍只拥有一个 Agent**：每个 scope 的 Project Document、state 和 manifest 只管理当前 Agent；成员通过 OpenAgentPack 的外部 `{ agent_id }` 引用接入，不进入当前 scope 的 state，也不改变成员生命周期。
3. **控制面只表达 roster**：CloudAgentBot 保存“当前 Bot 引用了哪些远程 Agent”；OpenAgentPack 负责 Qoder/Bailian multiagent 声明、Provider 映射、更新和清空。
4. **数据面保持原样**：Chat 仍是当前协调 Agent 的 Provider Session；用户在普通文本中点名成员、coordinator 根据任务自动分工，都只作为 instructions 引导下的模型行为。Qoder 与百炼没有把 `@name` 定义为确定性路由协议；Renderer/Main 不解析 `@`、不转换 `agent_id`、不 fan-out、不汇总子任务、不持久化 Thread。
5. **配置只有一个新维度**：Shared model 使用 `memberAgentIds: string[]`。空数组表示普通 Bot 并清除远程 roster；非空数组表示 coordinator。首版不引入 `BotCollaborationConfiguration`、成员对象、路由策略或 capability matrix。
6. **现有 ProjectDocument Module 做深**：构建、读取、合并和校验 multiagent YAML 都归 `src/main/control-plane/project-document.ts`；不新增 roster/directory/service Module。
7. **候选复用完整 Bot 列表**：Renderer 使用已有 `bots.list(connectionId)` 结果选择成员；Bailian 已完整翻页，Qoder 必须先在现有 BotCatalog 内补齐 Agent 分页。Main 不新增 `RemoteBotDirectory`，不在 Sync 前重复远程存在性检查。
8. **一致性边界仍是 scope**：复用现有 scope lock；不增加 Connection 级 roster lock、跨 scope transaction、补偿队列或后台 reconciler。
9. **本地只校验稳定事实**：数组形状、非空 ID、去重、20 项上限和 update 自引用。成员是否存在、归档、可访问或被并发修改，由 OpenAgentPack/Provider 在 Sync 时判定。
10. **外部拓扑不做虚假保证**：OpenAgentPack 当前把 `{ agent_id }` 当作非本 Project 拥有的叶子引用，无法静态证明跨 scope 无嵌套或无环。首版不宣称该保证，也不在 CloudAgentBot 构建远程拓扑图。
11. **OpenAgentPack 合同是前置门禁**：只消费 `@openagentpack/sdk` 包根公共 Interface。V2 当前通过 `file:../OpenAgentPack/packages/sdk` 消费 dirty working tree；本次实施将该工作区视为只读基线，记录 HEAD、状态与 SDK diff 指纹，实施前后必须一致。若基线不支持外部 `{ agent_id }`、Managed Qoder/Bailian 更新或 roster 清空，立即停止并记录阻塞；不得修改 OAP、导入 `internal` 或用 Provider 原生控制面补洞。
12. **范围闭合**：本期交付配置、创建/编辑 UI、Project Document 映射、Sync 与验证。Provider child Thread 的专门可视化是独立后续能力，不得夹带进本次实现。

## 1. 目标与完成定义

让用户可以把当前 Connection 列出的已有 Bot 选为某个 Managed Bot 的协作成员。保存后，该 Managed Bot 作为 Qoder 或 Bailian 原生 coordinator 工作：用户可以在普通 Chat 中用自然语言点名成员，也可以让 coordinator 根据任务判断是否委派。点名不是精确路由协议，产品不承诺一定命中或一定委派。

完成后的用户流程固定为：

1. 用户创建或编辑一个 Managed Bot；
2. 在“协作成员”字段中选择零到二十个当前 Connection 的已有 Bot；
3. 保存完整配置；
4. Main 先原子写入完整 `agents.yaml`，再走现有 OpenAgentPack Sync；
5. 非空成员写为 `multiagent.type=coordinator` 与外部 `{ agent_id }`；空成员删除整个 `multiagent`；
6. Sync 成功后更新配对 backup，Bot 远程 ID 不变；
7. 用户进入该 Bot 的普通 Chat，消息只发送给 coordinator Session；
8. Sync 失败时保留本地期望配置，配置页显示现有 pending 状态并允许重试；
9. 编辑页遇到已经配置、但当前完整 `bots.list` 未返回的成员时保留该 ID 并显示“当前列表不可见”，不推断删除、归档或权限状态；只有用户显式移除才清除。

完成标准不是“能写一段 multiagent YAML”，而是领域文档、Shared 合同、IPC 校验、Project Document 往返、失败恢复、创建/编辑 UI、Qoder 与 Bailian 真实 Cloud 验证形成一致闭环。

## 2. 当前阅读与依赖入口

本计划保留原实施方案；现行规则依次见 `AGENTS.md`、`CONTEXT.md`、ADR、架构、存储、接口和验收文档。Provider 证据见 `docs/research/multi-agent-mention-contract.md`。

控制面已使用 npm 发布的固定 SDK 版本，不再要求并列 OpenAgentPack checkout 或其工作区指纹。发布版对外部 `{ agent_id }` 引用的支持由本仓库 SDK 合同测试保护。

## 3. 已确认的 OpenAgentPack 合同

实施直接采用以下事实，不重新设计 Provider 协议：

```ts
type MultiagentMemberDecl = string | { agent_id: string };
```

- Managed Agent 可以通过 `{ agent_id }` 引用其他 Project 或非 OAP 管理的远程 Agent；
- 外部成员不需要本地 agent declaration 或 state entry；
- OAP 不创建、更新、归档或销毁外部成员；
- Qoder Managed 与 Bailian Managed 支持这种引用；Qoder Forward 不支持，CloudAgentBot 本期不使用 Forward；
- roster 最少一项、最多二十项且不可重复；空 roster 应通过删除 `multiagent` 表达；
- 更新时删除 `multiagent` 会由 Adapter 转换成 Provider 正确的清空 payload；
- reverse mapping 对其他 Project 拥有或无 OAP metadata 的成员保留 `{ agent_id }`；
- archived、missing 或不可表示的远程成员由 OAP 或 Provider 在解析、读取或提交过程中 fail closed；CloudAgentBot 不依赖它发生在某个固定阶段；
- OAP 对 Project 内逻辑引用执行 self/nested/cycle 检查，但外部 ID 不参与跨 Project 拓扑证明。

如实现观察到上述任一合同不成立，停止 CloudAgentBot 改动，附最小复现、命令和错误输出报告阻塞。

## 4. 产品与领域模型

### 4.1 Managed Bot Configuration

扩展现有配置，而不是创建新聚合：

```ts
interface ManagedBotConfiguration {
  name: string;
  description: string;
  instructions: string;
  model: string;
  skills?: BotSkillRef[];
  mcpServers?: BotMcpBinding[];
  memberAgentIds: string[];
}
```

规则：

- `memberAgentIds` 是完整替换集合；数组顺序按用户选择顺序写入并往返保留，只用于稳定表单回显与 YAML 序列化，不表示优先级、串并行关系或执行顺序；
- 空数组表示没有 coordinator 配置；
- 非空数组表示当前 Agent 是 coordinator；
- ID 是 Provider 远程 Agent ID，不新增本地成员 ID；
- member 可以是 Managed 或 remote-only Bot；引用不改变其身份、归档权或配置所有权；“当前 Connection”是 Renderer 候选与本次 credential/workspace 调用上下文，不是 Main 能从裸 `agent_id` 静态证明的新身份关系；
- 创建时不存在 self ID，因此无需 self 校验；update 时拒绝 `ref.agentId` 出现在数组中；
- 修改 roster 不修改当前 Bot 的 `remoteAgentId`、逻辑资源 key、scope、manifest 或 Environment。

### 4.2 默认协调 Instructions

创建表单选择至少一个成员时，创建 Project Document 使用协作版默认 Instructions：

```text
You coordinate the available specialist agents.

- Decide whether delegation is useful based on the task and each specialist's capabilities.
- When the user explicitly requests a particular available specialist, prefer delegating the relevant work to that specialist when the runtime can identify it unambiguously.
- Avoid unnecessary delegation.
- Define clear task boundaries and reconcile the specialists' results into one coherent final response.
```

规则：

- 普通 Bot 继续使用现有默认 Instructions；
- 协作提示只决定创建时的默认值；
- 编辑 roster 时不自动改写用户现有 Instructions；
- 不把成员 ID、显示名或动态候选写进默认提示；成员显示名只来自当前 Bot 列表，不成为持久事实源，成员重命名不触发 coordinator 更新；
- `prefer` 是行为指导，不是平台保证；不承诺 `@name` 必然命中、普通任务必然委派或同名成员可以消歧；Provider runtime 负责成员身份与实际委派。

### 4.3 非目标

- 本地 Room/Team/Role/Task/Thread 实体；
- Chat、Message、Turn、Operation、roster index 或拓扑图持久化；
- 客户端 `@` 解析、消息分发、并行调用或结果汇总；
- 成员 instructions、模型、Skill 或 MCP 的联动编辑；
- 成员批量创建、复制、删除、归档或所有权迁移；
- Remote-only Bot 的接管；
- coordinator 嵌套/循环的跨 scope 强保证；
- Provider capability matrix、插件化控制面或第二套 multiagent Adapter；
- Advisor、自定义路由策略、handoff policy、member version pinning；
- child Thread 专门 UI、调试拓扑或 token 聚合；
- 新数据库、后台同步、自动重试、跨 scope transaction。

实施需要进入任一非目标时停止并请求重新设计。

## 5. 文档与 ADR 先行

编码前按本计划已经获得的产品认可记录一条状态为“已接受”的 ADR，标题固定为：

```text
ADR-0009：协作 Bot 通过外部 Agent 引用组成 roster
```

ADR 必须记录：

- 每个 Managed Bot scope 仍只拥有一个 Agent；
- roster 成员通过 `{ agent_id }` 外部引用；
- 当前 Bot 不拥有成员生命周期；
- Provider 是执行、child Thread 与委派事实权威；
- 外部引用不能提供跨 Project 静态拓扑保证；
- 选择该方案而不是单 Project 多 Agent或本地聊天室编排的理由与后果。

同步更新：

- `CONTEXT.md`：Managed Bot Configuration 增加协作成员引用；明确它不是新身份；
- `docs/architecture.md`：BotControlPlane/ProjectDocument/OAP/ChatDataPlane 的责任边界；
- `docs/repository-layout.md`：继续使用现有 `project-document.ts`，不增加新 Module；
- `docs/local-storage.md`：roster 只存在于 `agents.yaml` 和配对 backup，不新增文件；
- `docs/interfaces.md`：完整替换、空数组清除、错误与失败语义；
- `docs/validation.md`：增加本计划第 11 节的验收矩阵。

完成条件：六份权威文档与 ADR 使用同一术语和同一所有权规则，不出现“聊天室由客户端调度”或“一个 scope 管理多个成员 Agent”的表述。

## 6. Shared model 与 IPC 信任边界

### 6.1 类型修改

在 `src/shared/models.ts`：

- `CreateBotInput` 增加 `memberAgentIds?: string[]`；
- `ManagedBotConfiguration` 增加必填 `memberAgentIds: string[]`；
- `BotConfigurationView` 和 `UpdateBotInput` 通过继承自然携带该字段；
- 不新增 `CollaborationConfiguration`、`MemberView` 或 Provider wire 类型。

创建输入保持可选是为了兼容现有调用方；进入 Main 后必须归一化为空数组。配置读取与更新始终返回/要求完整数组。

### 6.2 Parser

在 `src/shared/validation.ts` 增加：

```ts
export const BOT_MEMBERS_MAX = 20;

/** undefined 仅供 create 使用，归一化为空数组。 */
export function parseMemberAgentIds(value: unknown): string[] | null;
```

解析规则：

- `parseMemberAgentIds(undefined)` 固定返回 `[]`，供 create 向后兼容；
- `parseUpdateBotInput` 必须先用 `Object.hasOwn(v, "memberAgentIds")` 检查字段存在；缺少字段直接返回 `null`，存在后再调用 `parseMemberAgentIds`；
- 长度不超过 20；
- 每项必须是 trim 后非空字符串；
- trim 后 ID 唯一；
- 返回 trim 后、保持原顺序的新数组；
- 多余输入属性继续按现有模式丢弃。

`parseUpdateBotInput` 无法知道当前 `BotRef`，因此 self 校验放在 `BotControlPlane.update` 的任何文件写入和 Provider mutation 之前。

完成条件：Shared parser 测试覆盖 omitted create、empty、trim、duplicate、21 项、非字符串、update 缺字段和合法 20 项；所有既有调用方通过类型检查。

## 7. 深化 ProjectDocument Module

### 7.1 文件归属

把当前位于 `bot-control-plane.ts` 尾部的单 Agent YAML 提取/读取/合并函数移动到现有 `src/main/control-plane/project-document.ts`。该文件成为 Managed Bot Project Document 的唯一解释者。

目标 Interface 保持紧凑：

```ts
buildProjectDocument(input: ProjectDocumentInput): string;

readEditableAgentDocument(
  yaml: string,
  scope: string,
): EditableAgentDocument;

mergeEditableAgentDocument(
  yaml: string,
  input: UpdateBotInput,
  scope: string,
): { yaml: string; configuration: ManagedBotConfiguration };
```

不要增加 class、repository、service 或第二个 YAML Module。

### 7.2 写入规则

创建与更新共用以下序列化语义：

```ts
memberAgentIds.length > 0
```

对应：

```yaml
multiagent:
  type: coordinator
  agents:
    - agent_id: "agent_xxx"
    - agent_id: "agent_yyy"
```

```ts
memberAgentIds.length === 0
```

对应 agent 上完全不存在 `multiagent` 键。

合并时：

- 非空数组完整替换 roster；
- 空数组删除 `agent.multiagent`；
- 保留 agent 和顶层所有其他已知/未知键；
- 不改变 agent 逻辑 key；
- 不写逻辑名称字符串成员；
- 不直接写 Qoder/Bailian wire payload。

### 7.3 读取规则

- 缺少 `multiagent` 映射为 `memberAgentIds: []`；
- 只接受 `type: coordinator`；
- `agents` 必须是 1–20 个 `{ agent_id: string }`；
- 保持 YAML 顺序；
- duplicate、空 ID、逻辑名字符串成员、混合成员、未知 type 或其他形状返回 `invalid-input`；
- 不猜测、不自动接管同 Project 内的逻辑成员。

严格读取是产品所有权门禁：CloudAgentBot 的一个 scope 只拥有一个 Agent，因此逻辑成员意味着该文件已离开本客户端支持的 Managed Bot 形状。

完成条件：`project-document.test.ts` 覆盖普通/协作创建、读取往返、增删替换 roster、空数组删除键、未知字段保留、非法形状 fail closed；`bot-control-plane.ts` 不再包含 YAML 结构理解代码，并显著低于当前 800 行规模触发线。

## 8. BotControlPlane 流程

### 8.1 完整成员候选目录

成员选择继续复用 `ChatDataPlane.listBots(connectionId)`，但实现前必须补齐 Qoder 当前只读取 `/agents` 第一页的问题：

- 在现有 `QoderDataClient.listAgents` / `QoderBotCatalog` 内按 Qoder `next_page`/`has_more` 合同循环读取全部未归档 Agent；
- 使用明确的每页 limit，并在 cursor 不前进时 fail closed，避免死循环；
- Bailian 保留现有 `listAll` 分页实现；
- 不为成员选择新增 DesktopHost 方法、目录 Module、缓存或后台刷新；
- Renderer 列表整体请求失败时保留已有表单选择，不把任何单个成员标记为删除或归档。

完成条件：Qoder BotCatalog 单元测试覆盖两页、空页、cursor 不前进和错误映射；`bots.list` 对 Qoder/Bailian 都返回完整当前列表。

### 8.2 Create

保持现有事务顺序，只扩展 Project Document 输入：

```text
parseCreateBotInput 已归一化 memberAgentIds
  -> 现有 Connection/Provider/Environment 前置检查
  -> buildProjectDocument
  -> 写 manifest/project，phase=new
  -> phase=applying
  -> OpenAgentPack sync
  -> 从 state 取得当前 Agent remote ID
  -> phase=ready
  -> writePairBackup
```

没有成员时行为必须与现有普通 Bot 完全一致。有成员时只多出 Project Document 的 `multiagent` 字段。

远程成员无效导致 Sync 失败时沿用现有保守创建失败语义；不要为了改善该错误引入远程 preflight、回滚猜测或删除补偿。

### 8.3 Get configuration

复用 `readEditableAgentDocument`，返回完整 `memberAgentIds`。pending 仍由当前 `agents.yaml` 与配对 backup 文本差异派生，不新增 roster 状态。

### 8.4 Update

在获取 scope lock 且完成现有 writable/identity 检查后、写文件前执行：

```ts
if (input.memberAgentIds.includes(ref.agentId)) {
  throw hostError("invalid-input", "a bot cannot include itself as a collaboration member");
}
```

之后保持现有顺序：

```text
读取 agents.yaml
  -> mergeEditableAgentDocument
  -> 原子写新版 agents.yaml
  -> OpenAgentPack force sync
  -> 成功后 writePairBackup
```

失败语义不变：

- 解析或写盘失败：不调用 Provider；
- Sync 失败：保留新版 `agents.yaml`，不更新 backup；
- 重新打开配置页显示 pending，并从本地期望配置读出 roster；
- retry sync 直接应用当前 Project Document；
- 清空数组 Sync 成功后，远程 roster 必须清空而不是保留旧成员。

### 8.5 Sync/archive/data plane

- `sync` 无新参数，直接应用 Project Document；
- `archive` 仍只归档当前 Bot，不归档成员；
- `ChatDataPlane`、`ChatAdapter`、Session identity 与 Message API 不改；
- 不新增 DesktopHost 方法。

完成条件：BotControlPlane 测试证明 create/update/clear/error/pending/self-ref；archive 和 chat 现有测试无行为变化。

## 9. Renderer 控制面

历史 UI 原型验证的结论是：采用 **A 的表单内嵌信息架构 + 原位折叠候选列表**。不采用双栏编队工作台，也不把核心 roster 配置藏进 Dialog/Popover。

固定结构：

```text
名称 / 描述 / 模型 / Skills / MCP

协作成员
  [已选成员 Chip ×]
  [＋ 添加成员]  -> 在当前位置展开搜索与候选列表
  点名与委派说明

Instructions

取消                              保存并同步
```

成员为空时显示：

```text
尚未添加协作成员
添加后，当前 Bot 将作为协调者工作。
[＋ 添加成员]
```

### 9.1 内嵌选择器

在 `src/renderer/features/bots/` 增加一个真实调用方驱动的简单 `BotMemberSelector`。优先用 `ui/design-system` 已导出的 shadcn Primitive；缺少 Primitive 时按 `AGENTS.md` 的 UI 规则引入官方实现，不手写 CSS。

选择器输入：

```ts
interface BotMemberSelectorProps {
  value: string[];
  candidates: BotView[];
  currentAgentId?: string;
  candidatesLoading: boolean;
  candidatesError: HostError | null;
  disabled: boolean;
  onChange(value: string[]): void;
  onRetry(): void;
}
```

行为：

- 默认只展示已选成员 Chip 和“添加成员”按钮；点击后在原位置展开搜索与候选列表，不打开 Dialog/Popover；
- 按当前完整 `bots` 列表展示候选名称、Provider 管理状态和稳定 agent ID 的短标识；
- 编辑时排除 `currentAgentId`；创建时无需排除；
- 最多选择 20 项，达到上限后禁用未选项并给出说明；
- 保持选择顺序，但不使用拖拽排序，不展示优先级；
- 选择和取消是显式操作；
- 已配置但未出现在当前列表的 ID 显示为“当前列表不可见”的已选 Chip；默认保留，只有点击该 Chip 的移除动作才删除；
- 候选列表加载失败时显示就地错误与重试，继续展示并保留所有已选 ID，不给单个成员推断状态；
- 不根据描述、名称或所谓角色类型自动推荐成员；
- 不在组件内调用 DesktopHost。

### 9.2 创建表单

`BotsPage` 已持有当前 Connection 的 `bots`，直接传给 `BotCreationForm`：

- 增加 `memberAgentIds` 本地状态；
- 提交时始终将该数组带入 `CreateBotInput` 或在空数组时按 Shared 合同省略；
- UI 文案说明“成员由当前 Bot 协调；不会被复制或归当前 Bot 管理”；
- 固定说明文案为“在消息中点名成员会影响协调者的选择，但不保证精确路由。”；
- 创建自己尚无 remote ID，不存在 self 候选问题。

### 9.3 编辑表单

`BotSettingsForm` 需要由 `BotsPage` 传入现有 `bots` 作为候选，不新增获取目录 hook：

- 初值来自 `config.memberAgentIds`；
- unchanged 比较包含 roster，顺序变化视为变更；
- save 完整提交 `memberAgentIds`；
- 当前 Bot 从候选中排除；
- 对 `config.memberAgentIds` 中未出现在候选列表的 ID，显示为“当前列表不可见”的已选条目并默认保留；
- 用户可以显式移除当前列表不可见的条目；
- 不允许因为候选列表加载失败、刷新或过滤而静默删除它；
- pending 状态下按原值重试仍可提交。

### 9.4 聊天页面

本期不修改发送路径。说明只放在创建/编辑配置页，不为 Chat 页面新增配置读取请求。聊天页不承担 coordinator 状态判断、`@` 自动补全、名称消歧或成员路由。

完成条件：创建与编辑组件测试覆盖折叠展开、搜索、选择、20 项门禁、self 排除、当前列表不可见成员保留、候选加载失败、显式清空、保存失败保留输入和完整提交；所有样式只使用 design-system 与 Tailwind v4。

## 10. 错误与并发语义

不新增 HostErrorCode。继续使用：

- `invalid-input`：本地数组/YAML/self 校验或 Provider 拒绝 roster；
- `not-found`：Provider/OAP 判定成员或当前 Agent 不存在；
- `permission`、`authentication`、`rate-limited`、`unavailable`：沿用现有映射；
- `managed-state-missing`：当前 Managed Bot scope 不完整。

Renderer 展示稳定动作提示，不显示原始 Provider response，不把完整 Project Document 或成员远程详情塞进错误对象。

并发保证只覆盖当前 scope 的 update/sync/archive。成员在保存期间被其他客户端修改、归档或删除时，以 Provider 调用结果为准；不重试猜测，不锁其他 scope。

## 11. 测试与验证矩阵

### 11.1 Shared/unit

- create 省略成员归一化为空；
- update 要求完整数组；
- trim、去重、空值、类型、20/21 项边界；
- 普通 Project Document 不产生 `multiagent`；
- 协作 Project Document 产生纯 external refs；
- read/build/merge 往返保持顺序；
- 清空删除整个键；
- 非 roster 未知 YAML 字段不丢失；
- logical/mixed/empty/duplicate/unknown type fail closed；
- update self-ref 在写文件和 Provider mutation 前失败；
- Sync 失败保留本地 roster 且 backup 不变；
- retry 成功后 pending 消失；
- archive 当前 coordinator 不触碰成员。

### 11.2 Renderer

- 创建选择零/一/二十个成员；
- 达到上限后的交互；
- 编辑排除 self；
- 当前列表不可见的已选成员保留和显式移除；
- 候选列表失败不清空选择、不推断单个成员状态；
- roster 参与 unchanged 判断；
- 保存失败保留成员选择；
- 清空后提交 `[]`；
- 候选加载/刷新不改变已有选择。

### 11.3 架构守卫

- Renderer 不依赖 OpenAgentPack、Provider Client、Node 或文件系统；
- ChatDataPlane 对 OpenAgentPack 保持零依赖；
- 控制面只从 `@openagentpack/sdk` 包根导入；
- 没有新增 Chat/Message/Turn/Operation 持久化；
- 每个 Project Document 仍恰好一个本地 agent declaration；
- 没有新增 roster store、Connection lock 或 Provider capability matrix。
- Qoder/Bailian `bots.list` 都读取完整 Agent 列表，Qoder 分页 cursor 不前进时 fail closed。

### 11.4 OpenAgentPack 合同测试

在第 2 节记录的只读 OpenAgentPack 工作区基线上至少运行：

```bash
bun test \
  packages/sdk/tests/unit/multiagent-topology.test.ts \
  packages/sdk/tests/unit/multiagent-resolver.test.ts \
  packages/sdk/tests/unit/multiagent-reverse-index.test.ts \
  packages/sdk/tests/unit/qoder-examples.test.ts \
  packages/sdk/tests/unit/bailian-examples.test.ts
```

### 11.5 V2 常规验证

按仓库脚本实际名称运行并记录结果：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

修改或新增 design-system Primitive 时，额外运行 `pnpm test src/renderer/ui/design-system` 和相关 Feature 测试。

### 11.6 真实 Cloud

Qoder Managed 与 Bailian 各验证一次完整闭环：

1. 创建两个带唯一前缀的临时成员 Agent；
2. 创建一个 coordinator，并以 external IDs 引用成员；
3. 确认当前 scope state 只记录 coordinator，不记录成员；
4. coordinator instructions 明确要求把本次探针强制委派给唯一 worker，并原样返回 worker 生成的唯一 marker；
5. 创建新 Chat 并发送普通用户消息，不依赖 `@name`；
6. 断言远端 roster 含目标 `agent_id`，并观察真实 child Thread 创建与双向 thread message 事件；Qoder 在可用时进一步用 Thread API 确认 child Agent ID，百炼以 child `session_thread_id` 和 thread message 事件证明实际协作；
7. 将 roster 从两个成员更新为一个，确认远程收敛且 coordinator ID 不变；
8. 清空 roster，确认远程 multiagent 被清除；
9. 确认成员 Agent 未被更新、归档或删除；
10. 归档/删除临时资源，遵循 Provider 正式协议；
11. 验证记录不包含凭据、完整响应或用户数据。

稳定验收只使用强制委派探针；最终文本、模型声称“已委派”或 marker 本身都不能替代 Thread 事件证据。“普通任务是否主动委派”和“自然语言点名是否影响选择”只作为体验观察记录，不作为确定性 pass/fail 条件。

## 12. 实施顺序与逐步完成条件

### 步骤 1：冻结只读依赖基线

- 按第 2 节记录 OpenAgentPack HEAD、status 与 SDK diff 指纹；
- 运行第 11.4 节测试；
- 确认 V2 的 `file:` 依赖实际消费该工作区；
- 后续不得修改 OpenAgentPack，步骤 8 前再次校验三项基线完全一致。

完成条件：external Managed member、Qoder/Bailian mapping、reverse 与 clear 均有绿色测试证据。失败则停止。

### 步骤 2：更新权威文档与 ADR

- 完成第 5 节全部文档；
- 检查术语、身份和所有权一致。

完成条件：代码尚未改动时，另一个读者仅靠权威文档即可准确复述第 0 节十二条契约。

### 步骤 3：补齐 Qoder Bot 目录分页

- 先写两页、空页和 cursor 不前进测试；
- 在现有 Qoder DataClient/BotCatalog 内实现完整分页；
- 不新增成员专用目录 Interface。

完成条件：Qoder 与 Bailian 的 `bots.list` 都提供完整当前列表，分页测试全绿。

### 步骤 4：先写 Shared 与 ProjectDocument 测试

- 添加 parser 和 YAML round-trip 的失败测试；
- 测试必须先证明缺失能力，而不是复述实现细节。

完成条件：新测试按预期失败，且每个失败对应第 6、7 节的一条合同。

### 步骤 5：实现 Shared 与 ProjectDocument

- 扩展 models/validation；
- 深化 `project-document.ts`；
- 从 `bot-control-plane.ts` 移走 YAML 理解代码。

完成条件：第 6、7 节测试全绿；普通 Bot 既有 snapshot/行为无变化。

### 步骤 6：实现 BotControlPlane 流程

- 扩展 create/getConfiguration/update；
- 保持 sync/archive/data plane Interface 不变；
- 添加失败恢复与 clear 测试。

完成条件：本地 Project Document、Provider Sync、backup 和 pending 形成闭环，且任何失败都符合第 8、10 节。

### 步骤 7：实现 Renderer 控制面

- 按方案 A 添加表单内嵌、原位折叠的成员选择器；
- 接入创建和编辑表单；
- 完成当前列表不可见成员保留、候选失败保护与完整提交。

完成条件：第 9、11.2 节组件测试全绿，未新增聊天运行时逻辑。

### 步骤 8：全量和真实 Cloud 验证

- 运行第 11.3–11.6 节；
- 保存不含凭据的验证记录；
- 清理临时远程资源。

完成条件：Qoder/Bailian 都完成 create/update/clear/chat/ownership 闭环；全量 typecheck、lint、test 通过。

### 步骤 9：偏移审计

逐条检查第 0 节和第 4.3 节，并用 `git diff --stat`、`git diff --name-only` 审视改动范围。

完成条件：没有新增本地协作实体、数据面编排、额外控制面 Interface、跨 scope 状态或未授权 OpenAgentPack internal 依赖；所有新增生产代码都能对应到本计划的一项验收条件。

## 13. 交付报告格式

实施 Agent 最终报告必须包含：

1. **结果**：用户现在可以完成什么；
2. **架构边界**：证明每 scope 单 Agent、external member、Provider 原生 runtime 未被破坏；
3. **文件变更**：按 Shared、Main、Renderer、Docs/Test 分组；
4. **验证证据**：列出实际运行命令和结果，区分 unit、full suite、real Cloud；
5. **已知限制**：明确跨 scope nested/cycle 不做静态保证，child Thread 专门 UI 不在本期；
6. **工作区状态**：指出保留的用户原有改动和任何未提交文件；
7. **阻塞**：若未完成，说明违反了哪条前置合同，禁止用范围扩张绕过。

不得把“代码已写”作为完成结论；只有第 12 节全部完成条件满足后，才可声明设计目标达成。
