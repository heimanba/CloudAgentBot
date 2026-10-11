# ADR-0009：协作 Bot 通过外部 Agent 引用组成 roster

状态：已接受

## 背景

用户希望某个 Managed Bot 能作为协调者，与当前 Connection 下已有的其他 Agent 协作。Qoder 与百炼都提供原生 multiagent 能力：Agent 声明一个 coordinator roster，运行期由 Provider 创建 child Thread、分派子任务并汇总结果。

本机已有的边界是「Provider 拥有 Bot、Chat、Message 与运行结果，本地只拥有 Connection 与 Managed Bot 的 IaC 资料」。若把成员做成本地对象（Room、Team、Role），CloudAgentBot 就必须拥有成员的身份、配置、生命周期与消息分发，等于在桌面端另建一套会话编排运行时。

## 决策

协作 Bot 仍是普通 Bot，身份始终是 `Connection + remoteAgentId`。**每个 Managed Bot scope 仍只拥有一个 Agent**：Project Document、`agents.state.json` 与 manifest 只管理当前 Agent。

配置只增加一个维度 `memberAgentIds: string[]`：

- 非空数组表示当前 Agent 是 coordinator，成员以 OpenAgentPack 外部引用 `{ agent_id }` 写入 Project Document 的 `multiagent` 声明；
- 空数组表示普通 Bot，Project Document 中不存在整个 `multiagent` 键；
- ID 是 Provider 远程 Agent ID，不新增本地成员 ID、成员对象或 roster 索引。

**roster 成员通过 `{ agent_id }` 外部引用**接入，不进入当前 scope 的 state。**当前 Bot 不拥有成员生命周期**：不创建、不更新、不复制、不归档、不删除成员，也不把成员的配置纳入本地资料。成员可以是 Managed Bot，也可以是 remote-only Bot；被引用不改变其身份、归档权或配置所有权。

控制面只表达 roster：CloudAgentBot 保存「当前 Bot 引用了哪些远程 Agent」，OpenAgentPack 负责 Qoder/Bailian 的 multiagent 声明、Provider 映射、更新与清空。

数据面保持原样：Chat 仍是当前协调 Agent 的 Provider Session。**Provider 是执行、child Thread 与委派事实的权威**。普通文本里的点名与自动分工都只是 instructions 引导下的模型行为——Qoder 与百炼都没有把 `@name` 定义为确定性路由协议；Renderer 与 Main 不解析 `@`、不映射名称、不 fan-out、不汇总子任务、不持久化 Thread。

## 理由

该方案把复杂度留在已经拥有它的两层：OpenAgentPack 表达 Provider 拓扑，Provider 执行委派。本机只新增一个字符串数组，复用现有 Project Document、scope lock、Sync 与配对 backup，不需要新 Module、新存储、后台同步或跨 scope transaction。

没有选择单 Project 多 Agent：那会把成员的创建与所有权搬进当前 scope，让成员生命周期随宿主 Bot 变化，并需要在本地维护「哪些 Agent 属于这个 Bot」的所有权事实。

没有选择本地聊天室编排：那要求客户端解析点名、分发消息、并行调用并汇总结果，等于在桌面端实现一份 Provider 编排语义的近似替代；两份语义一旦分歧，用户看到的行为将与 Provider 事实不符。

## 后果

- **外部引用不能提供跨 Project 静态拓扑保证**：OpenAgentPack 把 `{ agent_id }` 当作非本 Project 拥有的叶子引用，无法静态证明跨 scope 无嵌套或无环。本产品不宣称该保证，也不在 CloudAgentBot 构建远程拓扑图。
- 成员的当前状态（存在、归档、可访问、被并发修改）只在 Sync 时由 OpenAgentPack/Provider 判定；本地只校验数组形状、非空 ID、去重、20 项上限与 update 自引用。
- 成员重命名不触发 coordinator 更新；编辑页遇到当前 `bots.list` 未返回的已配置成员时显示「当前列表不可见」并默认保留，不推断删除、归档或权限状态。
- roster 变更不改变当前 Bot 的 `remoteAgentId`、逻辑资源 key、scope、manifest 或 Environment。
- Provider child Thread 的专门可视化不属于本 ADR 当时的 roster 交付。后续协作展示可以只读 Provider 的 Session 快照与委派事件，在 Renderer 临时派生展示；不得因此产生本地 Thread 身份、持久化或消息分发。

证据见 [`multi-agent-mention-contract.md`](../research/multi-agent-mention-contract.md) 与 [`multi-agent-collaboration-development-plan.md`](../multi-agent-collaboration-development-plan.md)。
