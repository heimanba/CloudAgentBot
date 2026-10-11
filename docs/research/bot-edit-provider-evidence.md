# Bot 编辑的 Provider 合同证据

> 来源说明：本文记录调研时的源码与 Provider 证据。外部仓库路径是历史检出的相对标识，未建立永久公开链接，不是运行或构建依赖；现行产品行为以本仓库权威规范为准。


更新时间：2026-09-19

## 调研范围与结论摘要

本文只使用以下一手来源：百炼 Managed Agents 官方文档、Qoder Cloud Agents 官方文档、本机 `OpenAgentPack` 的公开 SDK 入口与 Provider Adapter 实现，以及使用本仓库 `.env` 凭据执行的真实 Cloud 合同测试。凭据值未输出、未修改、未落盘。

可以确定：

1. 百炼和 Qoder 都支持在**保持同一个 Agent ID**的前提下修改名称、描述、模型和系统提示词；每次成功更新都会产生递增的新 `version`。
2. 两者的 Agent 更新语义不同：百炼是**全量替换**，省略字段会清空；Qoder 是**merge patch**，省略字段保持不变，但数组字段一旦提供就是完整替换。
3. 两者创建 Session 时都会锁定 Agent 快照。更新 Agent 后，新 Session 使用更新后的版本，已有 Session 默认不变。
4. Qoder 额外支持显式更新已有 Session 的运行时 Agent 快照；百炼文档没有对应能力。因此首版不应承诺“编辑 Bot 后已有 Chat 立即生效”。跨 Provider 的可靠承诺只能是：**新配置用于随后创建的新 Chat，已有 Chat 保持原快照**。
5. Qoder 有账户级动态模型目录 API；百炼 Managed Agents 文档和当前 OpenAgentPack Bailian Adapter 均没有对应模型枚举接口。百炼模型选择不能伪装为动态枚举。
6. 两个 Provider 的 Agent GET 都能返回 `model` 和系统提示词（wire 字段为 `system`），所以 Remote-only Bot 可以显示这两项远程事实；但这不足以授权本机接管其 IaC 所有权。
7. 真机验证确认两个 Provider 都能在保持 Agent ID 的情况下切换模型并再切回；Qoder 使用 `ultimate → efficient → ultimate`，百炼使用 `qwen3.7-max → qwen3.8-max → qwen3.7-max`。
8. 百炼官方创建文档示例中的 `qwen3-max` 在当前真实工作空间返回 `AGENT_010 模型不存在`；普通模型文档或示例值不能直接成为 Managed Agents 静态白名单。

## 1. 可编辑字段与更新语义

### 百炼

百炼创建 Agent 接受 `name`、`description`、`model`、`system`、`tools`、`mcp_servers`、`skills`、`multiagent` 和 `metadata`。`model.id` 必填，`system` 可选。[创建 Agent](https://docs.bailian.console.aliyun.com/zh/model-studio/agent-create)

更新接口为 `POST /agents/{agent_id}`，必须携带当前 `version` 做乐观锁。它是**全量替换**：完整配置必须随请求发送，省略的可选字段按清空处理；版本不匹配返回 409；成功后 `version` 自动递增。[更新 Agent](https://docs.bailian.console.aliyun.com/zh/model-studio/agent-update)

由路径参数和响应结构可以确认更新的是原 `agent_id`，响应仍返回该 ID，只增加版本号。因此“编辑不改变远程 Agent 身份”有官方合同支撑。

OpenAgentPack 的 Bailian Adapter 与此一致：先 GET 当前 Agent 取得版本，再以同一个 ID POST 完整映射后的声明。`mapAgent` 映射名称、描述、模型和 `decl.instructions -> system`，同时保留工具、MCP、技能等完整声明。参见：

- `OpenAgentPack/packages/sdk/src/internal/providers/bailian/adapter.ts:253`
- `OpenAgentPack/packages/sdk/src/internal/providers/bailian/mapper.ts:213`

实现含义：即使首版 UI 只编辑四个字段，控制面也必须从完整 `agents.yaml` 产生完整 Agent payload；绝不能只向百炼提交四字段 patch，否则会清空未开放编辑的工具、技能等配置。

### Qoder

Qoder 创建 Agent 支持同类字段。官方明确限制：`name` 1–256 字符、`description` 最多 2048 字符、`system` 最多 100000 字符；工具最多 128 项，MCP Server 和 Skill 各最多 20 项。[Create an agent](https://docs.qoder.com/cloud-agents/api/agents/create)

更新接口为 `POST /api/v1/cloud/agents/{agent_id}`，必须携带当前 `version`。更新成功发布新 Agent version，并保持同一个 ID。其语义是 merge：未传的可选字段保留；`tools`、`mcp_servers`、`skills` 一旦提供则完整替换；metadata 是键级 merge/null 删除。[Update an agent](https://docs.qoder.com/cloud-agents/api/agents/update)

OpenAgentPack 当前 Qoder Adapter 先 GET 当前版本，再将映射后的完整声明通过 `PUT /agents/{id}` 发送。虽然 SDK 的 HTTP method 与当前公开文档的 `POST` 不一致，但它同样保持 ID 并携带当前 version；这属于 SDK/文档需要后续对齐的实现事实，不影响本产品通过公开 SDK 的同步抽象使用它：

- `OpenAgentPack/packages/sdk/src/internal/providers/qoder/adapter.ts:649`
- `OpenAgentPack/packages/sdk/src/internal/providers/qoder/mapper.ts:398`

2026-09-19 真机验证进一步确认：当前生产端接受该 Adapter 的 `PUT` 更新路径，连续两次更新均保持同一个 Agent ID 并生成新版本；Adapter 的 `DELETE /agents/{id}` 也能完成测试资源清理。公开文档与真实兼容路径仍应由 OpenAgentPack 后续对齐，但不阻塞本产品使用公共 Sync Interface。

## 2. Agent 版本与 Session 生效边界

### 百炼：已有 Session 永远使用创建时快照

百炼创建 Session 时会拍摄当时最新 Agent version 的完整快照，Session 响应内嵌 `agent.id`、`agent.version`、`model`、`system` 等。官方明确写明：后续编辑 Agent 只影响新建 Session，已有 Session 继续使用快照配置。[创建 Session](https://docs.bailian.console.aliyun.com/zh/model-studio/session-create)

GET Session 同样返回这份内嵌完整 Agent 快照。[获取 Session](https://docs.bailian.console.aliyun.com/zh/model-studio/session-get)

### Qoder：默认锁定，但可显式更新 Session 本地快照

Qoder Agent 更新文档明确：发布新 Agent version 后，已有 Session 继续使用其 pinned runtime snapshot；要让已有 Session 使用新的 model、prompt、tools、MCP 或 Skill bindings，必须另行调用 Session update。[Update an agent](https://docs.qoder.com/cloud-agents/api/agents/update)

Qoder `POST /sessions/{session_id}` 可更新已有 Session 内嵌快照的 `model`、`system`、`tools`、`mcp_servers`、`skills`，以及名称和描述；其中部分字段要求 Beta header `session-agent-patch-2026-07-21`。该操作不会改变来源 Agent version，也不会推进 Session 内嵌的 `agent.version`。更新后的快照用于后续 turns，已经 dispatch 的 turn 可能仍使用旧配置；若需要清晰边界，应等 Session 回到 idle 再更新。[Update a session](https://docs.qoder.com/cloud-agents/api/sessions/update)

这不是跨 Provider 能力，且包含 Beta 合同。因此首版不应自动遍历并重写已有 Qoder Chat。可靠产品文案应是：

> 配置同步后，新建 Chat 使用新配置；已有 Chat 继续使用创建时的配置。

OpenAgentPack 的 Session 创建绑定也将本地 state 中的 `agentState.version` 显式传为 `agent_version`，进一步证明 Session 是按应用后的版本绑定，而非随 Agent 漂移：`OpenAgentPack/packages/sdk/src/internal/session/session-manager.ts:158`。

## 3. 远程读取能否得到 model 和 instructions

### 百炼

`GET /agents/{agent_id}` 默认返回最新版本，也可以用 `version` 查询历史版本。响应含完整的 `model` 和 `system`，以及工具、MCP、技能、多 Agent 和 metadata。[获取 Agent](https://docs.bailian.console.aliyun.com/zh/model-studio/agent-get)

OpenAgentPack 的反向映射将 `raw.model.id` 还原为 `model`，将 `raw.system` 还原为 `instructions`：`OpenAgentPack/packages/sdk/src/internal/providers/bailian/mapper.ts:160`。

### Qoder

`GET /agents/{agent_id}` 返回完整 Agent，包含 `model` 与 `system`；`version` query 可查询特定历史版本。[Get an agent](https://docs.qoder.com/cloud-agents/api/agents/get)

OpenAgentPack 的反向映射同样将 `raw.system` 映射为 `instructions`：`OpenAgentPack/packages/sdk/src/internal/providers/qoder/mapper.ts:199`。

结论：Remote-only 页面可以可靠展示远程名称、描述、模型、系统提示词、版本和 ID。但远程 GET 只证明“可以读到远程配置”，不能证明本机拥有它对应的 Project Document、state、Environment/Skill/File 等资源所有权，因此不能据此开放编辑或自动接管。

## 4. 模型枚举

### Qoder：有动态、账户相关的模型目录

`GET /api/v1/cloud/models` 返回当前认证账户可用且 enabled 的模型；字段包括 ID、显示名、来源、价格因子、支持的 reasoning effort、默认 effort、最大输入 tokens 和可选择的 context-window 档位。官方明确要求创建或更新 Agent 时用该接口发现可用 `model` 值。[List models](https://docs.qoder.com/cloud-agents/api/models/list)

OpenAgentPack 的 Qoder Adapter 已实现 `listModels()`，调用 `/models`：`OpenAgentPack/packages/sdk/src/internal/providers/qoder/adapter.ts:1240`。

### 百炼：当前没有 Managed Agents 模型目录合同

在百炼 Managed Agents 官方索引和 Agent 创建/更新文档中，没有与 Qoder `/models` 等价的账户级 Agent 模型枚举接口。Agent API 只要求 `model.id`，示例使用 `qwen3-max`。普通模型产品文档虽然列出大量模型，但不能证明每个模型都适用于 Managed Agent Harness，也不是账户可用性枚举。

OpenAgentPack 的 Bailian Adapter 没有实现 `listModels()`。公共入口 `listProviderModelsForContext()` 对没有该方法的 Adapter 返回 `supportsDynamicListing: false` 和空列表，而 Qoder 返回动态数据：

- `OpenAgentPack/packages/sdk/src/internal/core/models-runtime.ts:42`
- `OpenAgentPack/docs/reference/sdk.md`（Models 公共入口）

因此推荐策略为：

- Qoder：动态加载官方目录，只展示返回项；目录暂时失败时保留当前模型，不阻止编辑其他字段。
- 百炼：第一版保留当前模型，并提供经过真机验证的受控选项或手工模型 ID 输入；不得声称它是“账户当前所有可用模型”。若选择静态白名单，它必须由本产品明确维护并随验证记录更新。

真机结果使百炼策略可以进一步收敛：当前工作空间已验证 `qwen3.7-max` 与 `qwen3.8-max` 可用于 Agent 更新，而文档示例 `qwen3-max` 返回 `AGENT_010`。因此首版推荐使用“当前值 + 本产品已验证列表”，并在 Provider 拒绝时保留本地期望配置、显示原始稳定分类，不把普通模型目录包装成 Agent 可用目录。

## 5. 字段限制

### 已证实

Qoder：

- 名称 1–256 字符；
- description 最多 2048 字符；
- system 最多 100000 字符；
- model 可为字符串或 `{id, effort, context_window}`；effort 仅允许 `none/low/medium/high/xhigh/max`，context window 必须为正整数且应来自模型目录；
- tools 最多 128，MCP Servers 和 Skills 各最多 20。

来源：[Create an agent](https://docs.qoder.com/cloud-agents/api/agents/create)、[Update an agent](https://docs.qoder.com/cloud-agents/api/agents/update)、[Model data structures](https://docs.qoder.com/cloud-agents/api/models/schemas)。

百炼：

- `name` 与 `model` 必填；`description`、`system` 可选；
- `model.id` 必填，另可配置 `enable_thinking`、`max_tokens`、`temperature`、`thinking_budget`；
- multiagent roster 为 1–20 个普通成员。

来源：[创建 Agent](https://docs.bailian.console.aliyun.com/zh/model-studio/agent-create)、[更新 Agent](https://docs.bailian.console.aliyun.com/zh/model-studio/agent-update)。

### 官方资料未证实

百炼上述文档没有公布 `name`、`description`、`system` 的字符上限或允许字符集合。不能从示例或 SDK 类型推断硬限制。本产品可以先做产品级合理非空/长度保护，但错误提示不能声称是 Provider 上限，直到真机边界测试或官方合同给出证据。

## 6. 删除与归档清理协议

### Agent

百炼 Agent 没有硬删除接口；官方 `POST /agents/{id}/archive` 是软归档。归档后默认列表隐藏，不能用于新建 Session，已有 Session 不受影响，且 `include_archived=true` 可查。[归档 Agent](https://docs.bailian.console.aliyun.com/zh/model-studio/agent-archive)

Qoder 官方同样记录 `POST /agents/{id}/archive`，归档对象默认列表隐藏但仍可按 ID 获取。[Archive an agent](https://docs.qoder.com/cloud-agents/api/agents/archive)

需要注意一个代码差异：OpenAgentPack Bailian Adapter 的 `deleteAgent()` 调用 archive，符合文档；Qoder Adapter 当前 `deleteAgent()` 使用 `DELETE /agents/{id}`，而当前官方文档公开的是 archive。本产品不应自行绕过 SDK 处理清理，但 OpenAgentPack 应单独核对该差异：

- `OpenAgentPack/packages/sdk/src/internal/providers/bailian/adapter.ts:310`
- `OpenAgentPack/packages/sdk/src/internal/providers/qoder/adapter.ts:658`

### Session

百炼硬删除 Session 会删除元数据、事件历史和内部资源副本且不可恢复；若需保留事件历史应归档。归档将状态置为 `terminated` 并保留可查询事件。[删除 Session](https://docs.bailian.console.aliyun.com/zh/model-studio/session-delete)、[归档 Session](https://docs.bailian.console.aliyun.com/zh/model-studio/session-archive)

Qoder 同时公开 Session DELETE 和 archive。DELETE 返回 `session_deleted`；archive 填充 `archived_at`，但 `status` 不变成 `archived`。[Delete a session](https://docs.qoder.com/cloud-agents/api/sessions/delete)、[Archive a session](https://docs.qoder.com/cloud-agents/api/sessions/archive)

## 7. 对本产品设计问题的明确裁决

1. **编辑范围**：第一版可以确定为名称、描述、Instructions、模型；Provider 都有合同支持。
2. **身份规则**：编辑必须保持同一 remote Agent ID，只更新版本。逻辑资源 key 也不应因显示名称改变。
3. **保存语义**：本产品继续通过 OpenAgentPack 完整声明 Sync；不要由 Renderer 直调 Provider patch。这样可正确处理百炼全量替换与 Qoder merge 的差异。
4. **已有 Chat**：第一版明确不更新；仅承诺新 Chat 使用新版本。Qoder 的 Session patch 留作未来 Provider-specific 能力，不纳入跨 Provider Bot 编辑合同。
5. **模型选择**：Qoder 动态枚举；百炼不宣称动态枚举。当前模型必须始终可见且不可在枚举失败时被静默替换。
6. **Instructions 空值**：Provider 都允许 system 可选，但本产品若决定禁止空字符串，那是产品约束而不是 Provider 要求。建议允许清空，以忠实表达 Provider 能力；百炼更新时必须显式提交空值/完整配置以清除。
7. **Remote-only**：可只读展示 model/instructions，但没有编辑权限；远程事实不等于本地 IaC 所有权。
8. **漂移**：Agent GET 足以读取远程配置和 version，但本产品不应将其自动回写 agents.yaml。若本地 state 中 version 与远端 version 不一致，应交给 OpenAgentPack plan/sync 的漂移与乐观锁处理。
9. **输入长度**：Qoder 可在客户端按官方限制验证；百炼没有官方字符上限证据，先采用温和的产品限制或只处理 Provider 返回错误。
10. **清理**：Bot 的“删除”在产品上应采用 Provider archive 语义描述，不能暗示永久删除；Session 删除与归档必须区分。

## 8. 真实 Cloud 验证记录

验证入口：`tests/live/bot-edit-session-version.live.test.ts`。

2026-09-19 使用唯一前缀和 `openagentbot_test=bot-edit-session-version` metadata 进行了以下验证：

### Qoder

- 动态模型目录返回 `supportsDynamicListing=true`，且 `ultimate` 为 enabled；真实目录还包含 `auto`、`performance`、`efficient` 等账户可用 ID。
- 创建 Agent 后创建旧 Session；把模型从 `ultimate` 更新为 `efficient`，再把模型切回 `ultimate` 并更新 Instructions。
- 三个版本共享同一个 Agent ID；GET Agent 返回最终模型与 Instructions，测试 metadata 未丢失。
- 旧 Session 回复 V1 marker；最终更新后创建的新 Session 回复 V3 marker，证明 Session 快照隔离。
- 单独观察到 `efficient` Session 在 240 秒内未返回确定性测试回复；这不否定模型可更新，但证明“目录 enabled”不等于“适合确定性 smoke”。产品可以展示 Provider enabled 项，但验证不能任意挑选一个模型作为执行基线。
- Qoder Adapter 的 PUT 更新与 DELETE 清理在当前真实服务可用。

### 百炼

- 公共 SDK 返回 `supportsDynamicListing=false, models=[]`，与 Adapter 能力一致。
- 创建 Agent 后创建旧 Session；把模型从 `qwen3.7-max` 更新为 `qwen3.8-max`，再切回 `qwen3.7-max` 并更新 Instructions。
- 三个版本共享同一个 Agent ID，版本号连续递增；GET Agent 返回最终模型与 Instructions，测试 metadata 未丢失。
- 旧 Session 回复 V1 marker；最终更新后创建的新 Session 回复 V3 marker，证明 Session 快照隔离。
- `qwen3-max` 虽出现在官方创建文档示例中，但当前工作空间真实返回 `AGENT_010 模型不存在`。
- 将随机测试串直接拼入 system 曾触发 `AGENT_017 智能体内容未通过安全检测`；稳定、中性的 Instructions 可正常创建。UI 必须把此类 Provider 拒绝映射为可理解错误并保留用户输入。

#### 创建路径模型可用性探针（2026-09-20，metadata `openagentbot_test=model-probe`）

针对「新建 Managed Bot 时 model 可填哪些值」，用 agentstudio 直连 API（`POST {workspace}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/agents`，body `model: { id }`）逐候选创建并 GET 回读。分两轮：

第一轮（auto 家族与既有旗舰）：可创建且远端原样落库 `qwen3.7-max`、`qwen3.8-max`、`auto`、`performance`、`balanced`、`economy`；`qwen3-max` 返回 `400 AGENT_010 模型不存在`。远端 `model` 为 `{id, temperature, max_tokens, enable_thinking, thinking_budget}`，未设超参时为 null。

第二轮（对照控制台 `listFoundationModels` 返回的 `managedAgents:true` 模型）：`qwen3.8-max`、`qwen3.8-flash`、`qwen3.7-max`、`qwen3.7-plus`、`qwen3.6-plus`、`qwen3.6-flash`、`deepseek-v4-pro`、`deepseek-v4-flash`、`glm-5.2`、`glm-5.1` 全部 200 创建成功并回显原 ID；`qwen3-max` 仍 400。

结论：控制台 `listFoundationModels` 接口返回的 `managedAgents:true` 模型 ID 口径与 apply/直连 API 一致、可信（仅其历史示例值 `qwen3-max` 这类模型中心笼统别名不可用于 apply）。百炼创建候选白名单 = 上述 14 个已验证值。本产品创建表单的百炼分支展示该白名单，main 侧 `BotControlPlane.create` 对未在列表内的 model fail-closed。第三方模型（deepseek/glm）虽可创建，但是否纳入产品默认推荐属产品决策，技术上已验证可用。

### 清理审计

- Qoder：0 个测试 Agent、0 个 Environment、0 个 Session 残留。
- 百炼：0 个活动测试 Agent、0 个 Environment、0 个 Session；5 个历次测试 Agent 按 Provider 正式协议保留为 archived。百炼没有 Agent 硬删除合同，这符合本产品 Cloud 验证规则。

## 9. 已收敛的实施决策

1. **编辑对象**：定义 `Managed Bot Configuration`，表示本地 `agents.yaml` 中的期望配置；不是远程配置镜像。
2. **首版字段**：名称、描述、Instructions、模型。名称只修改显示名，不修改逻辑资源 key、projectName、Environment 名或 Bot 身份。
3. **提交形状**：Renderer 提交完整四字段表单；BotControlPlane 将它合并进完整 Project Document，保留未开放字段，再经 SDK Sync。Renderer 不理解 Provider patch/full-replacement 差异。
4. **同步状态**：以当前 `agents.yaml` 和最后成功配对 backup 的差异派生 `synced | pending-sync`；state 不可用时为 `state-missing`。不新增 Operation、数据库或 pending/current 双槽。
5. **失败语义**：本地写失败时不调用 Provider；Provider Sync 失败时保留新 `agents.yaml`，backup 仍代表最后成功配置，设置页显示 `pending-sync` 并允许重新同步。
6. **Session 生效范围**：只承诺新建 Chat 使用新配置；已有 Chat 保留创建时快照。首版不采用 Qoder-only Beta Session patch。
7. **模型选择**：Qoder 使用动态目录且保留当前值；百炼使用“当前值 + 本产品真机验证列表”，首版至少包含 `qwen3.7-max`、`qwen3.8-max`。枚举失败不阻止其他字段编辑，也不静默替换当前模型。
8. **Instructions 空值**：Provider 合同允许 system 可选。本产品应允许清空 Instructions，避免创造没有产品依据的限制；若产品希望提供安全默认值，应只在创建初始值中提供，不应阻止用户清空。
9. **产品长度限制**：沿用名称 80、描述 500 的现有 UI 限制；Instructions 首版采用 20,000 字符的产品保护上限。Qoder 官方上限更高（100,000），百炼未公布上限，因此错误文案不得声称 20,000 是 Provider 限制。
10. **Remote-only**：调用远程 GET 后可只读展示 name、description、model、system、version；仍不得编辑或自动接管。`state-missing` 同样只读并 fail closed。
11. **漂移**：设置表单读取本地期望配置；不把远程 GET 自动回写本地。重新同步意味着用本地期望覆盖远程，冲突和漂移交由 OpenAgentPack 的 plan/sync 语义处理。
12. **删除语义**：Bot 产品动作应称“归档”，不能承诺永久删除；Chat 的删除与归档继续保持不同语义。

### 实施后仍需加入回归矩阵的边界

- 20,000 字符 Instructions 的本地 YAML round-trip，以及 Provider 拒绝时输入保留；不需要用随机或敏感文本做 Cloud 边界探测。
- 已存在 tools/skills/MCP 的完整 Project Document，经四字段编辑后所有未开放字段保持原样。此项应在 BotControlPlane 本地合同测试精确覆盖；Provider 端已验证 metadata 保留，不能为制造真机 fixture 而扩大首版产品范围。
- 应增加安全错误映射，确保 `AGENT_017` 等 Provider 正文不会跨 IPC 泄露，但用户能得到“内容未通过 Provider 检查”的可行动提示。
