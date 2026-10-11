# Multi-Agent 点名、名称与委派验收合同核实

> 来源说明：本文记录调研时的源码与 Provider 证据。外部仓库路径是历史检出的相对标识，未建立永久公开链接，不是运行或构建依赖；现行产品行为以本仓库权威规范为准。


> 核实日期：2026-09-23  
> 范围：Qoder Cloud Agents、阿里云百炼 Managed Agents、`OpenAgentPack` 当前源码与已保存的真机结果。本文只界定第一阶段 OpenAgentBot 可以依赖的合同，不提出客户端路由实现。

## 结论

1. **Qoder 与百炼均未在本次核实范围内把 `@name` 定义为原生、确定性的路由语法。** 两家都接受普通用户消息，由 coordinator 根据 system prompt 和运行时判断是否委派。`@角色` 最多只能作为普通自然语言中的点名方式，不能成为 OpenAgentBot 的控制协议或验收承诺。
2. **OpenAgentPack 的外部成员声明只携带 `agent_id`，不携带名称，也不向调用方暴露可用于路由的 ID→名称映射。** Qoder 平台会自行解析 roster 条目的显示名，但这不是 OpenAgentPack 的公共配置合同；百炼公开 roster 合同只包含 `type`、`id`、`version`。
3. **可靠验收必须观察实际 child Thread 协作事件，不能只检查 coordinator 最终文本。** Qoder 应观察 `session.thread_created`、`agent.thread_message_sent`、`agent.thread_message_received`，并在需要确定目标 Agent 时通过 Qoder Thread API 检查 child Thread 的 Agent 快照。百炼应观察 `thread_created`、`thread_message_sent`、`thread_message_received` 以及对应的 `session_thread_id`；公开合同目前不足以像 Qoder 一样查询完整 child Thread 资源。
4. **默认 coordinator instructions 可以规定职责、拆分方式、委派标准和输出格式，但不能承诺 `@name` 必然路由到指定成员，也不能承诺普通任务必然发生委派。** 自动委派是 coordinator 的模型行为，应作为体验观察；只有强制委派探针才适合作为稳定 Cloud 验收。

## 1. `@name` 是否是原生路由语法

### Qoder

Qoder 官方 Multiagent 文档规定：coordinator 根据自己的 system prompt 从 `multiagent.agents` 中选择 child Agent；发送到 Session 的仍是普通 `user.message`。官方进一步明确，配置 roster 不会强制委派，coordinator 会根据自身判断和 system prompt 决定是否及如何委派。

官方文档展示的发送示例是普通自然语言任务，没有 `@name` 字段、mention 对象或显式目标 Agent 字段。当前页面也没有定义 `@` 语法。因此，不能把 `@成员名` 视为 Qoder 的稳定 API 协议。

Qoder CLI 的另一项 Agent Teams 功能会用 `@coder`、`@reviewer` 等形式展示 teammate 身份，但它没有把用户输入 `@name ...` 定义为 Cloud Agents Session 的确定性路由请求。该显示约定不能跨产品外推成这里的控制面合同。

来源：

- [Qoder Multiagent orchestration：How it works / Create and run a Session](https://docs.qoder.com/cloud-agents/multi-agents#how-it-works)
- [Qoder Multiagent orchestration：What to delegate](https://docs.qoder.com/cloud-agents/multi-agents#what-to-delegate)
- [Qoder CLI：Agent Teams](https://docs.qoder.com/cli/agent-teams)

### 阿里云百炼

百炼官方多智能体文档只定义 coordinator 编队以及成员的 `type`、`id`、`version`；Session 的发送接口接受普通 Event。多智能体相关的额外发送字段只有中断时可选的 `session_thread_id`，用于定向中断子线程，不是用户消息路由字段。

本次核实的官方页面没有定义 `@name`、mention 对象或“按成员名强制路由”的请求字段。因此，也不能把 `@成员名` 视为百炼的稳定协议。

来源：

- [百炼：多智能体协作](https://docs.agent.bailian.aliyun.com/zh/managed-agents/build-agent/multiagent)
- [百炼：发送 Event](https://docs.agent.bailian.aliyun.com/zh/api/managed-agents/session/send-event)

### OpenAgentBot 的约束

第一阶段必须明确：

- Renderer 和 Main 都不解析 `@`；
- 不把 `@显示名` 转换为 `agent_id`；
- 不拆分或 fan-out 用户消息；
- 不提供“明确点名就一定由该成员执行”的产品保证；
- UI 可以把 `@角色` 描述为自然语言点名，但不应称其为“精确路由”或“强制指派”。

如果未来产品必须支持确定性点名，需先取得 Provider 的正式目标路由合同，或者单独设计 OpenAgentBot 自己的路由协议；这不属于当前接入。

## 2. 外部 `agent_id` roster 是否带有或可推导名称

### OpenAgentPack 公共声明

当前声明类型是：

```ts
type MultiagentMemberDecl = string | { agent_id: string };
```

字符串表示当前 Project 拥有的逻辑 Agent 名；对象形式表示外部 Managed Agent。外部对象没有 `name` 字段。

解析后的内部对象对外部成员只保留 `remote_id`；`logical_name` 仅在当前 Project 拥有并命名该成员时存在。Qoder Managed 和百炼 mapper 最终都只发出 `{ type: "agent", id: remote_id }`。

来源：

- `OpenAgentPack/packages/sdk/src/internal/types/config.ts:273-279`
- `OpenAgentPack/packages/sdk/src/internal/multiagent/model.ts:1-10`
- `OpenAgentPack/packages/sdk/src/internal/executor/resolver.ts:59-82`
- `OpenAgentPack/packages/sdk/src/internal/providers/qoder/mapper.ts:488-495`
- `OpenAgentPack/packages/sdk/src/internal/providers/bailian/mapper.ts:313-321`
- `OpenAgentPack/docs/reference/configuration.md:395-436`

### Provider 差异

Qoder 官方 schema 说明平台会从被引用 Agent 的 `name` 解析 roster 条目的 display name；调用方即使提交 `name` 字段也会被忽略，而且最终 display name 要求大小写不敏感地唯一。这说明 Qoder runtime 内部有平台解析的名称，但它不是调用方可定义的成员别名，也不改变两个事实：

- Managed roster 请求仍以 Agent `id` 为身份；
- OpenAgentPack 的外部引用和解析结果没有把 display name 作为公共合同暴露给 OpenAgentBot。

百炼公开多智能体 schema 只定义 `type`、`id`、`version`，没有成员名称字段。顶层 Agent 资源另有 `name`，因此 UI 如需回显名称，应使用现有 Agent/Bot 列表按 ID 关联；不能声称 roster 自带名称。

来源：

- [Qoder Agent schemas：Multiagent Agent entry](https://docs.qoder.com/cloud-agents/api/agents/schemas#multiagent-agent-entry)
- [百炼：多智能体协作——编队配置](https://docs.agent.bailian.aliyun.com/zh/managed-agents/build-agent/multiagent#%E7%BC%96%E9%98%9F%E9%85%8D%E7%BD%AE)

### 实施含义

- `memberAgentIds` 是唯一持久身份；成员显示名仅是 UI 当前列表中的展示数据。
- 不把名称写入 `agents.yaml` 的外部成员对象。
- 不把名称动态拼入 coordinator instructions 形成第二事实源。
- 成员重命名不触发 coordinator 配置更新。
- 同名消歧不属于当前控制面合同。
- “Qoder 平台能解析显示名”不能外推成“用户输入 `@显示名` 会精确路由”。

## 3. 委派的可靠验收证据

### 不充分的证据

以下现象都不能单独证明目标成员执行过任务：

- coordinator 返回了正确答案；
- 最终答案提到了成员名称；
- roster 在远端读回正确；
- Session 最终回到 idle；
- 模型文字声称“我已委派”。

### Qoder

Qoder 官方公开了 child Thread 生命周期和跨线程消息事件：

- `session.thread_created`；
- `session.thread_status_running` / `idle`；
- `agent.thread_message_sent`；
- `agent.thread_message_received`。

相关事件按官方合同携带 `session_thread_id`；还可以列出 Session Threads，并读取指定 Thread 的完整事件。若验收要求证明“由指定成员执行”，应通过 Thread 详情中的 Agent 快照/身份确认目标 Agent，而不是从最终文本猜测。

来源：[Qoder Multiagent orchestration：Observe threads and events](https://docs.qoder.com/cloud-agents/multi-agents#observe-threads-and-events)

OpenAgentPack 现有真机探针已经观察到 `session.thread_created`、`agent.thread_message_sent` 和 `agent.thread_message_received`。但当前统一事件摘要中 Qoder `threaded=0`，探针本身也声明 Qoder Thread ID 暴露不属于其 Phase 1 范围。因此，V2 第一阶段若只走当前 OpenAgentPack event projection，可以验证“真实发生 child 协作”；若要稳定证明具体目标 Agent，必须直接使用 V2 的 Qoder 原生数据面 Thread 能力或先补齐明确的公共 Interface，不能根据名称猜测。

来源：

- `OpenAgentPack/docs/reference/multi-agent-live-probe-results.md:10-53`
- `OpenAgentPack/docs/reference/multi-agent-live-probe-results.md:137-164`

### 阿里云百炼

百炼官方 Webhook 合同公开 Session Thread 生命周期事件；发送 Event API 又确认 `session_thread_id` 可用于多 Agent 定向中断。OpenAgentPack 的 Bailian event mapper会从事件顶层、metadata 或 content data 中提取 `session_thread_id`。

来源：

- [百炼：Webhook 概述与回调投递](https://docs.agent.bailian.aliyun.com/zh/api/managed-agents/webhook/callback)
- [百炼：发送 Event](https://docs.agent.bailian.aliyun.com/zh/api/managed-agents/session/send-event)
- `OpenAgentPack/packages/sdk/src/internal/providers/bailian/event-mapper.ts:8-39`
- `OpenAgentPack/packages/sdk/src/internal/providers/bailian/event-mapper.ts:72-81`

已有真机结果观察到 `thread_created`、`thread_message_sent`、`thread_message_received`，并有事件携带 child `session_thread_id`，足以证明该次 coordinator→worker 委派真实发生。百炼公开文档目前没有与 Qoder 等价的完整 Thread list/get/events API，因此不应把“可按 child Thread 查询完整 Agent 快照”列为百炼第一阶段验收要求。

来源：`OpenAgentPack/docs/reference/multi-agent-live-probe-results.md:96-135`、`:137-164`

### 推荐 Cloud 验收

稳定的正向验收应使用一个临时 worker，并让 worker 产生不可由 coordinator 预先知道的唯一 marker：

1. 创建外部 worker 和引用它的 coordinator；
2. coordinator instructions 明确要求本次任务必须委派给唯一 worker，并原样返回 worker 生成的 marker；
3. 向 coordinator 发送普通用户消息，不依赖 `@name`；
4. 断言远端 roster 含目标 `agent_id`；
5. 断言出现 child Thread 创建和双向 thread message 事件；
6. Qoder 可进一步用 Thread API 确认 child Agent ID；百炼以 child `session_thread_id` 和 thread message 事件确认实际委派；
7. marker 只作为辅助证据，不能替代 Thread 证据；
8. 清理 Session、coordinator、worker 和 Environment。

“coordinator 面对普通任务会不会主动委派”应单独作为体验探针记录，不应成为确定性的 CI pass/fail 条件。

## 4. 默认 coordinator instructions 的合同

默认提示词可以安全承诺的是行为目标，而不是路由结果：

```text
You coordinate the available specialist agents.

- Decide whether delegation is useful based on the task and each specialist's capabilities.
- When the user explicitly requests a particular available specialist, prefer delegating the relevant work to that specialist when the runtime can identify it unambiguously.
- Avoid unnecessary delegation.
- Define clear task boundaries and reconcile the specialists' results into one coherent final response.
```

这里的 `prefer` 是 coordinator 行为指导，不是平台确定性保证。默认提示词不得写成以下强合同：

- “`@name` always routes to that Agent”；
- “OpenAgentBot resolves mentions”；
- “the named Agent must execute”；
- “every complex task is delegated”；
- “member ordering determines priority”。

若产品文案需要最保守、跨 Provider 的表述，建议使用“在消息中点名成员，协调者会结合任务和成员能力决定如何协作”，不要使用“通过 `@` 强制指派”。

OpenAgentPack 当前文档也明确要求在 `instructions` 中描述任务拆分、委派标准与输出格式，并明确实际委派仍由 coordinator system prompt 和 runtime 决定：`OpenAgentPack/docs/reference/configuration.md:424-434`。

## 对开发计划的明确修订

实施 Agent 应按以下文字理解需求：

1. 第一阶段交付“配置原生 coordinator roster 并展示实际协作事件”，不交付确定性 mention routing。
2. `@角色` 是普通输入文本和可选的用户表达习惯，不是 IPC、Project Document 或 Provider API 字段。
3. 不新增名称映射存储、mention parser、消息 fan-out、成员路由器或本地 child Thread 状态。
4. 自动委派只受 instructions 引导；稳定验收使用明确的强制委派探针和 child Thread 事件。
5. 若未来验收要求“准确命中被点名成员”，必须先单独获得 Qoder 与百炼均可验证的目标成员身份合同，不得由实施 Agent自行补客户端协议。
