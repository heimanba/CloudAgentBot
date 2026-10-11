# Managed Bot 编辑开发计划

## 1. 目标与完成定义

为 Managed Bot 增加一个简单、完整的配置编辑入口，支持修改：

- 名称；
- 描述；
- Instructions；
- 模型。

保存语义保持本客户端现有规则：先原子写入完整 `agents.yaml`，再通过 OpenAgentPack 公共 SDK 直接 Sync；更新必须作用于 state 指向的同一个远程 Agent，不改变 `Connection + remoteAgentId` 身份。

完成后的用户流程固定为：

1. 用户进入 Bot 列表；
2. Managed Bot 行尾菜单提供“编辑配置”和“重新同步”；
3. 点击“编辑配置”后，Bot 列表区域切换为配置表单；
4. 用户修改四个字段并点击“保存并同步”；
5. 成功后返回 Bot 列表并刷新远程事实；
6. 失败时停留在表单并保留输入；若本地 Project Document 已写入但远程 Sync 失败，再次打开时显示“本地配置尚未同步”；
7. 更新后的配置只保证用于随后创建的新 Chat，已有 Chat 保持创建时的 Agent 快照。

完成标准不是“表单能提交”，而是本地期望配置、远程 Agent、配对 backup、失败恢复和 UI 提示形成一致闭环，并通过 Qoder 与百炼真实 Cloud 验证。

## 2. 简化原则

### 2.1 只增加必要能力

- 只为 Managed Bot 增加编辑入口；Remote-only 和 state-missing 不增加设置页。
- 只新增一个配置读取 Interface，复用现有 `bots.update` 和 `bots.sync`。
- 只增加一个 Renderer 配置表单，由 `BotsPage` 持有当前正在编辑的 Bot。
- 同步状态只暴露 `hasPendingChanges: boolean`，不建立通用状态机。
- 模型差异隐藏在 BotControlPlane 内，不建设 Provider capability matrix。

### 2.2 明确非目标

- Remote-only Bot 接管、导入或编辑；
- 读取并展示 Remote-only Bot 的完整远程配置；
- 修改已有 Chat 的 Agent 快照；
- Qoder Beta Session patch；
- 编辑工具、MCP、Skill、Memory、Environment、网络或 metadata；
- plan/diff 预览、草稿、只保存不同步、撤销到上次同步版本；
- 本地 revision、通用乐观锁、Operation 或数据库；
- 改造创建 Bot 表单；
- 建立新的全局导航状态机；
- Bot 删除或归档（归档为后续独立阶段，见 `docs/bot-archive-development-plan.md`）。

如果实施需要进入以上范围，应停止并重新确认，而不是顺带扩展。

## 3. 已确认的 Provider 事实

详细证据见 `docs/research/bot-edit-provider-evidence.md`，实施直接采用以下结论：

- Qoder 与百炼都支持在保持 Agent ID 的情况下修改名称、描述、Instructions 和模型；成功更新产生新版本。
- Qoder 更新为 merge 语义，百炼为全量替换语义；Renderer 不感知该差异，BotControlPlane 必须始终从完整 Project Document Sync。
- 两个 Provider 的旧 Session 都保持创建时 Agent 快照；更新只保证影响新 Session。
- Qoder 通过 OpenAgentPack 公共 Interface 动态枚举账户可用模型。
- 百炼没有 Managed Agents 动态模型枚举合同；首版只提供当前值和真机验证通过的 `qwen3.7-max`、`qwen3.8-max`。
- `qwen3-max` 在当前百炼工作空间返回 `AGENT_010 模型不存在`，不得加入候选。
- Provider 可能因内容安全拒绝 Instructions；本客户端保留输入并返回稳定错误，不把完整 Provider response 跨 IPC。

## 4. 产品与领域规则

### 4.1 Managed Bot Configuration

在 `CONTEXT.md` 增加：

**Managed Bot Configuration**：Managed Bot 在本地 Project Document 中的期望 Agent 配置。它由名称、描述、Instructions 和模型组成；Provider 中的当前 Agent 是 Sync 后的远程事实，不反向覆盖本地期望配置。

该术语不创造新的持久对象；配置仍存放在 `agents.yaml`。

### 4.2 名称与身份

- `name` 是 Agent 显示名称；
- 修改 `name` 不修改 YAML `agents` 下的逻辑资源 key；
- 不修改 `manifest.projectName`、scope、Environment 逻辑名或描述；
- 不改变 `remoteAgentId`；
- Bot 身份始终是 `Connection + remoteAgentId`。

### 4.3 字段规则

```ts
interface ManagedBotConfiguration {
  name: string;
  description: string;
  instructions: string;
  model: string;
}
```

- `name`：trim 后 1–80 字符；
- `description`：允许空字符串清除，最多 500 字符；
- `instructions`：允许空字符串清除，最多 20,000 字符；这是本客户端的产品保护上限，不宣称为 Provider 上限；
- `model`：非空字符串；正常 UI 只允许选择表单候选，最终有效性由 Provider 在 Sync 时确认；
- 保存时完整提交四字段，不使用 partial patch。

### 4.4 本地未同步状态

成功 Sync 后 `ManagedBotStore.writePairBackup()` 已保存与远程最后一次成功收敛对应的 `backup/agents.yaml`。因此：

```text
当前 agents.yaml === backup/agents.yaml  -> hasPendingChanges=false
当前 agents.yaml !== backup/agents.yaml  -> hasPendingChanges=true
```

比较使用文件内容，不引入额外状态文件。backup 缺失、Project Document 缺失或 state 不完整继续走现有完整性与 fail-closed 规则，不能据此猜测为 pending。

## 5. 跨层 Interface

### 5.1 Shared model

在 `src/shared/models.ts` 新增：

```ts
interface BotModelOption {
  value: string;
  label: string;
}

interface BotConfigurationView extends ManagedBotConfiguration {
  ref: BotRef;
  models: BotModelOption[];
  hasPendingChanges: boolean;
}

interface UpdateBotInput extends ManagedBotConfiguration {}
```

不把 `management`、远程状态或 Provider wire 字段放入 `BotConfigurationView`。该 View 只对已通过管理完整性检查的 Managed Bot 返回。

### 5.2 DesktopHost

扩展现有 Bot Interface：

```ts
bots: {
  list(connectionId: ConnectionId): Promise<BotView[]>;
  get(ref: BotRef): Promise<BotView>;
  getConfiguration(ref: BotRef): Promise<BotConfigurationView>;
  create(connectionId: ConnectionId, input: CreateBotInput): Promise<BotView>;
  update(ref: BotRef, input: UpdateBotInput): Promise<BotView>;
  sync(ref: BotRef): Promise<BotView>;
}
```

`update` 与 `sync` 的返回类型保持不变，避免为一个调用方扩大现有 Interface。保存成功后 Renderer 返回列表并通过既有 reload 重读远程事实。

### 5.3 Main 信任边界

在 `src/shared/validation.ts`：

- `parseUpdateBotInput` 改为要求四字段完整存在；
- 按 4.3 的规则校验；
- 忽略之外的属性不应进入返回值；
- 新增 `BotConfigurationView` 不需要 Renderer 输入 parser。

在 `src/main/bootstrap.ts`：

- 新增 `bots:get-configuration` handler；
- 先用 `parseBotRef` 校验 ref；
- 更新 `bots:update` 的稳定错误信息；
- 不在 IPC handler 复制字段合并或 Provider 逻辑。

在 `src/preload/index.ts` 只增加对应 invoke 转发。

## 6. Main 实现

### 6.1 ManagedBotStore

只增加两个局部能力，不新增 Module：

```ts
readBackupProject(dir: string): Promise<string | null>;
hasPendingProject(dir: string, currentProject: string): Promise<boolean>;
```

具体规则：

- backup Project 不存在时不返回 `true`，而由调用方依据 scope 完整性拒绝配置读取；
- 比较当前 Project Document 与配对 backup 的完整文本；
- 不解析或修改 `agents.state.json`；
- 不增加 hash、revision 或缓存。

如现有 snapshot 已能暴露 backup Project 完整性，优先复用，不创建重复查询路径。

### 6.2 Project Document 解析与合并

把当前 `mergeProjectDocument()` 深化为同一处负责读取和更新四字段的内部函数，避免 get/update 各自理解 YAML：

```ts
interface EditableAgentDocument {
  logicalName: string;
  configuration: ManagedBotConfiguration;
}

readEditableAgentDocument(yaml: string, scope: string): EditableAgentDocument;

mergeEditableAgentDocument(
  yaml: string,
  input: UpdateBotInput,
  scope: string,
): { yaml: string; configuration: ManagedBotConfiguration };
```

解析规则：

- Project Document 必须是本客户端当前支持的单 Agent 形状；
- `name` 缺失时沿用逻辑 key 作为显示名；
- `description` 缺失时映射为空字符串；
- `instructions` 和字符串 `model` 必须存在；
- 暂不接受 Provider map/object model；本客户端当前生成的是单 Provider 字符串模型；
- YAML 形状不满足时返回 `invalid-input`，不猜测修复。

合并规则：

- 只替换 `agent.name`、`agent.description`、`agent.instructions`、`agent.model`；
- `agents` 的逻辑 key 保持不变；
- environment、tools、mcp_servers、skills、files、memory、metadata 和未知键全部保留；
- 顶层 providers、defaults、environments 和未知键全部保留；
- 使用现有 `yaml` 库 parse/stringify；
- 不把 Instructions 拆成新文件。

这两个函数放在 `src/main/control-plane/` 内部，可留在 `bot-control-plane.ts`，只有当文件明显超出仓库规模规则时再提取为 `bot-project-document.ts`；不要预先增加文件层级。

### 6.3 BotControlPlane.getConfiguration

流程固定为：

```text
用当前 state 按 agentId 定位 scope
  -> 找不到：not-found（Remote-only）
  -> 获取 scope 锁
  -> assertWritable（完整 state 门禁）
  -> 读取 agents.yaml
  -> 解析四字段
  -> 与 backup/agents.yaml 比较
  -> 获取模型候选
  -> 返回 BotConfigurationView
```

即使这是读取操作也进入同一 scope 锁，避免与正在进行的 update 在 Project Document 写入与 backup 更新之间观察到不一致组合。锁内不应长时间等待模型网络请求：先在锁内读取配置与 pending 状态，释放锁后再查询模型候选。

模型候选：

- Qoder：用当前连接凭据、当前 Project Document 与 state 通过 OpenAgentPack 公共 `listProviderModelsForContext()` 获取；只取 `is_enabled=true`；
- 百炼：返回 `qwen3.7-max`、`qwen3.8-max`；
- 两者都必须把当前模型并入列表，即使动态目录未返回；
- 去重并保持当前模型在第一项；
- Qoder 枚举失败时降级为只包含当前模型，不让整个配置页失败；
- 不把模型枚举错误新增为跨层状态或错误类型。

### 6.4 BotControlPlane.update

复用现有写入与 Sync 顺序，只扩大合并字段：

```text
定位 scope
  -> scope 单写锁
  -> assertWritable
  -> 读取 agents.yaml
  -> 完整合并四字段
  -> 原子写新版 agents.yaml
  -> syncProjectResourcesWithStateBackend(policy=force)
  -> 成功后 writePairBackup
  -> 返回 BotView
```

关键失败语义保持不变：

- 解析或本地写失败：不调用 Provider；
- Sync 失败：新版 `agents.yaml` 保留，backup 不更新；
- 再次打开配置页：`hasPendingChanges=true`；
- 点击现有“重新同步”：直接应用当前 `agents.yaml`；
- Sync 成功：更新 backup，后续 `hasPendingChanges=false`；
- state 缺失：任何 Provider mutation 前返回 `managed-state-missing`。

### 6.5 错误映射

不增加新的 `HostErrorCode`。使用现有分类：

- 字段/YAML 非法：`invalid-input`；
- Remote-only：`not-found`；
- state 不完整：`managed-state-missing`；
- Provider 400（包括内容安全或模型拒绝）：`invalid-input`；
- 401/403/409/429/5xx 沿用现有映射。

Renderer 对 `invalid-input` 使用“Provider 未接受该配置，请检查 Instructions 和模型后重试”，不显示 Provider 原始 response。

## 7. Renderer 实现

### 7.1 状态归属

`BotsPage` 新增本地状态：

```ts
const [editingBot, setEditingBot] = useState<BotView | null>(null);
```

- 只有 `management === "managed"` 的 Bot 显示“编辑配置”；
- 点击后在同一页面区域渲染 `BotSettingsForm`；
- 取消、保存成功后将 `editingBot` 置空；
- 不修改 `App`、`useWorkspace`、Sidebar 或 Chat 导航。

### 7.2 数据 Hook

新增 `use-bot-configuration.ts`，Interface 保持最小：

```ts
interface UseBotConfigurationResult {
  configuration: BotConfigurationView | null;
  loading: boolean;
  saving: boolean;
  error: HostError | null;
  save(input: UpdateBotInput): Promise<boolean>;
}
```

- ref 改变时调用 `desktopHost.bots.getConfiguration(ref)`；
- `save` 调用既有 `bots.update`；
- 成功返回 `true`，由表单关闭并触发 Bot 列表 reload；
- 失败返回 `false`，保留表单本地输入；
- 不在 hook 内加入 retry queue、缓存库或表单状态。

如果直接在 `BotSettingsForm` 中用一个 `useEffect` 和两个 async handler 能保持测试清晰，可不创建 hook；以最终代码是否减少重复和分支为准，不强制增加文件。

### 7.3 BotSettingsForm

使用现有 design-system Primitive：

- `Input`：名称；
- `Textarea`：描述；
- `Textarea`：Instructions；
- `Select`：模型；
- `Alert`：pending 和错误；
- `Button`：取消、保存并同步。

不新增 Primitive，不新增 CSS 文件，不使用内联 `<style>`。样式只使用现有 Tailwind token。

表单行为：

- loading 时显示现有加载态；
- 加载成功后以 `BotConfigurationView` 初始化表单；
- 名称 trim 后提交；描述和 Instructions 保留用户文本，仅受长度限制；
- 表单与初始值完全相同时禁用保存；
- saving 时禁用所有输入、取消和重复提交；
- `hasPendingChanges=true` 时显示“本地配置尚未同步到 Provider；保存并同步将再次应用当前配置”；
- 保存成功后返回列表并 reload；
- 保存失败时不重置字段；
- 显示固定提示：“新配置用于新建 Chat，已有 Chat 继续使用创建时的配置。”

第一版不做浏览器离开确认；设置表单只替换 Bot 列表区域，没有多层路由。用户点击取消即明确放弃尚未提交的 Renderer 输入。

### 7.4 替换现有行内编辑器

删除 `ManagedBotEditor` 的名称/描述行内表单，保留菜单触发器：

- “重新同步”继续调用现有 `onSave(ref, "sync")`；
- “编辑配置”设置 `editingBot`；
- 不同时保留两套编辑入口。

`useBots.save()` 继续负责现有 update/sync 调用与列表 reload；配置表单若使用独立 hook，成功后调用 `onReload()`，不要再扩充 `useBots` 为混合列表与详情状态容器。

## 8. 文件级实施清单

### 阶段 A：文档与 Shared Interface

修改：

- `CONTEXT.md`：增加 Managed Bot Configuration；
- `docs/interfaces.md`：增加 `getConfiguration` 与四字段输入；
- `docs/validation.md`：增加编辑与 pending 验收；
- `src/shared/models.ts`；
- `src/shared/desktop-host-contract.ts`；
- `src/shared/validation.ts` 及其测试。

阶段验收：

- 类型与输入合同唯一、无 Provider wire 类型；
- `UpdateBotInput` 不再接受缺字段 patch；
- 不新增 HostErrorCode、持久对象或 Provider capability。

### 阶段 B：Store 与控制面

修改：

- `src/main/control-plane/managed-bot-store.ts` 及测试；
- `src/main/control-plane/bot-control-plane.ts` 及测试；
- 必要时才新增 `src/main/control-plane/bot-project-document.ts`。

阶段验收：

- 配置读取、完整字段更新和 pending 派生通过；
- 未开放 YAML 字段不丢失；
- 更新保持同一 Agent ID；
- 所有 state 缺失场景在 Provider mutation 前失败。

### 阶段 C：DesktopHost、IPC、Preload

修改：

- `src/main/desktop-host.ts` 及测试；
- `src/main/bootstrap.ts` 及测试；
- `src/preload/index.ts` 及 contract 测试；
- 所有 `DesktopHost["bots"]` fake 增加 `getConfiguration`。

阶段验收：

- Renderer 只能通过 DesktopHost 读取配置；
- IPC 输入在 Main 校验；
- 错误信封不包含 Project Document、Instructions 或 Provider response。

### 阶段 D：Renderer

修改：

- `src/renderer/features/bots/bots-page.tsx`；
- `src/renderer/features/bots/use-bot-configuration.ts`（仅在确实减少复杂度时新增）；
- 新增或扩展 Bot 编辑行为测试；
- 更新所有 BotsPage 测试 harness。

阶段验收：

- Managed Bot 可进入完整表单；
- Remote-only/state-missing 无编辑入口；
- 行内编辑器被移除；
- 保存、失败保留、pending 提示和取消行为通过；
- `App` 与 workspace 导航无需修改。

### 阶段 E：完整验证与真机 smoke

扩展：

- `tests/live/bot-edit-session-version.live.test.ts`，改为优先穿过产品 `BotControlPlane.getConfiguration/update` 路径；
- 保留 Provider 原生 Session/Event 断言用于验证旧/新 Session 快照。

阶段验收：

- Qoder：动态模型目录、四字段更新、同 ID、新旧 Session；
- 百炼：`qwen3.8-max`、四字段更新、同 ID、新旧 Session；
- Sync 拒绝后本地 Project Document 保留且 backup 不更新；
- 测试资源清理，百炼 Agent 按协议归档；
- 验证记录不包含 credential、Instructions 正文或完整 Provider response。

## 9. 测试矩阵

### Shared validation

- 四字段完整输入通过；
- 缺少任一字段失败；
- 空名称、空模型失败；
- 名称、描述、Instructions 超限失败；
- description/Instructions 空字符串通过；
- 非字符串与非对象失败；
- 多余字段不进入解析结果。

### Project Document

- 读取本客户端生成的单 Agent YAML；
- 多行、引号、反斜线和 Unicode Instructions round-trip；
- name 缺失回退到逻辑 key；
- description 缺失映射空字符串；
- instructions/model 缺失或 model 非字符串失败；
- 多 Agent 文档失败；
- 更新四字段后逻辑 key 不变；
- environment/tools/MCP/skills/metadata/未知键保持；
- 顶层未知键保持。

### ManagedBotStore / pending

- 当前 Project 与 backup 相同：false；
- Sync 失败后当前 Project 与 backup 不同：true；
- 再次 Sync 成功并写 backup：false；
- backup、state 或 manifest 不完整：按现有完整性规则拒绝，不猜测。

### BotControlPlane

- getConfiguration 只接受 Managed Bot；
- Qoder 模型枚举只返回 enabled，并总包含当前值；
- Qoder 枚举失败降级为当前值；
- 百炼候选包含当前值、`qwen3.7-max`、`qwen3.8-max` 且去重；
- update 先写本地再调用 Provider；
- update 返回相同 Agent ID；
- Provider 失败保留新版 YAML、旧 backup；
- state-missing 零 Provider mutation；
- 同 scope get/update 不观察到中间态；
- sync 成功消除 pending。

### Renderer

- 只有 Managed Bot 显示“编辑配置”；
- 点击后加载并展示四字段；
- 当前模型不在候选时仍可见；
- 未修改时保存禁用；
- 保存中禁止重复提交；
- 成功关闭表单并刷新列表；
- 失败保留全部输入并显示稳定错误；
- pending 显示明确提示；
- 取消返回列表且不调用 update；
- “重新同步”行为保持现有测试覆盖。

## 10. 验证命令

每个阶段运行定向测试；最终运行：

```bash
pnpm typecheck
pnpm lint
pnpm test src/shared
pnpm test src/main/control-plane
pnpm test src/renderer/features/bots
pnpm test
pnpm test:arch
```

真实 Cloud：

```bash
OPENAGENTBOT_LIVE=1 pnpm vitest run \
  tests/live/bot-edit-session-version.live.test.ts \
  --no-file-parallelism
```

如果修改 design-system Primitive，额外执行：

```bash
pnpm test src/renderer/ui/design-system
```

本计划预期不需要修改 Primitive。

## 11. 实施顺序与停止条件

严格按 A → B → C → D → E 实施。每阶段保持可编译，不先写 UI 再补控制面。

遇到以下情况停止并记录阻塞：

- 需要从 OpenAgentPack `internal` 路径导入；
- 需要解析或修改 `agents.state.json` 内部字段；
- 需要为 Remote-only Bot 生成或反推 Project Document；
- 需要改变 `Connection + remoteAgentId` 身份；
- 模型编辑必须引入 Provider capability matrix；
- 百炼候选需要加入未经真实 Cloud 验证的模型；
- 实现要求增加数据库、Operation、draft、revision 或 plan 预览；
- 第二个 Provider 没有真实合同却要求抽象新字段。

## 12. 交付检查

实施结束时逐项确认：

- 只有一个 Bot 配置编辑入口；
- 只有一个新增 DesktopHost 方法；
- 没有新的持久化文件；
- 没有修改 Bot/Chat 身份规则；
- 没有 Provider wire 类型越过 Adapter/控制面；
- 没有 Remote-only 写路径；
- 没有使用 `qwen3-max`；
- 没有把模型枚举失败升级为页面整体失败；
- 没有泄露 credential、Instructions 或 Provider response；
- Qoder 临时资源已删除；
- 百炼临时 Session/Environment 已删除，Agent 按正式协议归档；
- 全量测试、架构守卫和真实 Cloud smoke 通过。
