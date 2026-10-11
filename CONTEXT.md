# CloudAgentBot 领域词汇

CloudAgentBot 是远程 Agent 的轻量桌面客户端。Provider 拥有 Bot、Chat、Message 与运行结果；本地只拥有 Provider Connection 和受管理 Bot 的 IaC 资料。

## 产品对象

**Provider**：
提供远程 Agent、Session 和 Message 的云端产品。身份模型允许多个 Provider，当前交付 Qoder 与 Bailian。
_避免使用_：执行目标、运行模式

**Connection**：
用户在本机配置的一条 Provider 连接，用于定位账号凭据和路由远程请求。同一个 Provider 可以存在多个 Connection。Connection 不是 CloudAgentBot 用户身份；资源可见范围由 Provider 对认证主体的授权决定，不以密钥字符串本身区分用户。
_避免使用_：Provider Account、Credential Reference

**API Key 范围**：CloudAgentBot 用 Provider 类型与连接凭据确定的分组。同 Provider 使用同一凭据的设备属于同一范围；不同凭据属于不同范围，即使 Provider 侧资源空间相同。它用于 CloudAgentBot 内的 Bot/Session 归属与未共享 Bot 分组；共享 Bot 的发现不受相同 Key 限制。它不改变 Provider 资源身份，也不是 Provider 访问控制。
_避免使用_：用户账号、Workspace 权限

**Bot**：
一个 Provider Connection 下的远程 Agent。Bot 不拥有额外本地身份，其身份由 Connection 与远程 Agent ID 共同构成。
_避免使用_：本地 Bot、Runtime Binding

**Managed Bot**：
本机同时持有完整 Project Document 与 OpenAgentPack state、因而能够继续执行 IaC 更新的 Bot。Managed 只描述本机管理资料是否完整，不创造新的 Bot 身份。一个 Managed Bot 只拥有一个 Agent：它的 Project Document、state 与 manifest 都只管理当前 Agent，协作成员不进入该 scope。
_避免使用_：绑定 Bot、本地 Agent

**Remote-only Bot**：
Provider 中存在、但本机没有完整 IaC 管理资料的 Bot。它可以用于 Chat，但不能由本机直接更新配置。
_避免使用_：未导入 Bot、外部 Bot

**Shared Bot**：
带有 CloudAgentBot 共享标记且当前 Connection 获 Provider 授权可见的 Bot，表示它应显示在团队共享入口，不要求接收方与维护者使用相同 API Key。共享是 Bot 的展示状态，不是新身份或访问权限；接收者本机没有完整管理资料时仍将它视为 Remote-only Bot。
_避免使用_：共享权限、共享账号、Bot 副本

**Archived Bot**：
Provider 中被软归档的远程 Agent。它保留远程 Agent 数据和已有 Chat，但不出现在 Provider 默认 Agent 列表中，也不能创建新 Chat。归档不改变 Bot 身份，也不删除本机已有的 Managed Bot IaC 资料。
_避免使用_：已删除 Bot、本地归档 Bot

**Chat**：
某个 Bot 下的远程 Provider Session。Chat 不拥有本地身份，也不在本地持久化。CloudAgentBot 以 API Key 范围标记新建 Session；Session 可独立标记为共享，其他 API Key 范围可继续访问已共享 Session，但不能修改共享状态、归档或删除。Bot 与 Session 的共享状态互不继承。应用内分组不是 Provider 访问控制，使用其他客户端或直接调用 Provider API 时仍由 Provider 权限决定。
_避免使用_：本地 Session、Conversation

**Message**：
Provider Session 中的远程消息或持久事件。Provider 是 Message 内容与历史的唯一事实权威。
_避免使用_：本地 Message、Turn、Operation

**Environment**：
Provider 账号或 Workspace 下可被多个 Bot 与 Chat 复用的远程执行环境。Connection 可以绑定一个默认 Environment；Managed Bot 只引用它，不因创建 Bot 或 Chat 而创建专属 Environment。
_避免使用_：Bot Environment、Session Environment

**Sync**：
把 Managed Bot 的本地 Project Document 直接应用到 Provider，使远程资源向本地期望状态收敛。
_避免使用_：部署、发布、迁移

**Managed Bot Configuration**：
Managed Bot 在本地 Project Document 中的期望 Agent 配置。它由名称、描述、Instructions、模型、MCP、Skill 引用与协作成员引用组成；Provider 中的当前 Agent 是 Sync 后的远程事实，不反向覆盖本地期望配置。MCP 与 Skill 引用只表达 Bot 与 Provider 已有资源的关联，不表示本机拥有或编辑其内容。
_避免使用_：远程配置镜像、Bot 草稿

**协作成员**：
Managed Bot Configuration 中由 `memberAgentIds` 引用的其他远程 Agent。非空引用表示当前 Bot 作为 coordinator 工作，空引用表示普通 Bot 并清除远程 roster。成员只以 Provider 远程 Agent ID 的外部 `{ agent_id }` 引用进入当前 Bot 的 Project Document，不进入当前 Bot 的 scope state，也不产生本地成员实体、Room、Team 或 Role；`coordinator` 只是 Project Document 中的 multiagent 声明类型，不是新的 Bot 类型。当前 Bot 不拥有成员的生命周期与配置，成员可以是任意 Managed 或 remote-only Bot。创建时 roster 非空使用协调版缺省 Instructions，编辑 roster 不改写用户已有 Instructions。
_避免使用_：成员 Bot、子 Bot、团队角色

**Deployment（定时任务）**：
远程 Agent 的定时触发配置，由执行 Bot、固定执行输入、调度与任务输出模式组成。百炼与 Qoder 均有 Deployment API（同源于 Anthropic CMA 规范），首版只交付并验证百炼。调度以「频率预设 + 时间 + IANA 时区」表达并编译为 cron 表达式，可选到期日期（公开 API 无到期字段，到期后 UI 提示并引导手动暂停）。身份是 `Connection + remoteAgentId + deploymentId`；本地不持久化，不建本地定时器，Provider 是事实权威。任务输出模式首版仅独立任务输出（每次执行新建 Session），两家公开 API 均不支持合并输出，待支持后恢复。归属与共享复用 API Key 范围标记，Run 关联 Session 自动继承该标记。
_避免使用_：本地定时器、Scheduler、Cron Job 实体

**Deployment Run**：
Deployment 一次触发产生的远程执行记录，记录触发来源、状态与关联 Session。Provider 是 Run 事实权威；Run 关联的 Session 就是普通 Chat，复用现有会话视图展示执行过程与结果。本地不持久化 Run 历史，执行完成通过轮询感知并经系统通知告知用户。
_避免使用_：本地执行历史、任务实例

## 身份与事实权威

- Bot 身份是 `Connection + remoteAgentId`。
- Chat 身份是 `Connection + remoteAgentId + remoteSessionId`。
- Deployment 身份是 `Connection + remoteAgentId + deploymentId`。
- API Key 范围只影响 CloudAgentBot 内的归属与发现，不改变 Bot、Chat 或 Environment 身份。
- Environment 身份是 `Connection + remoteEnvironmentId`。
- 协作成员不是新身份：它只是当前 Bot Project Document 中的外部 Provider Agent ID；成员的身份、生命周期与配置始终由其自身 Connection 与 Managed Bot 资料决定，当前 Bot 不拥有它们。
- `agents.yaml` 是 Managed Bot 的期望配置权威。
- `agents.state.json` 是 OpenAgentPack 远程资源映射与漂移账本的本地权威。
- Provider 是远程资源当前实际状态、Chat、Message 和执行结果的权威。
- Bot 共享 metadata 只表达 Bot 的团队发现状态，不表达 Session 归属或 Session 共享状态。
- Session 共享 metadata 只表达该 Session 在 CloudAgentBot 内可由其他 API Key 范围继续访问；所有者范围仍由独立的归属 metadata 决定。
- Provider 凭据授权范围是远程资源可见性的边界；持有同一访问范围凭据的设备按 Provider 返回结果访问资源。
- CloudAgentBot 的 API Key 范围可窄于 Provider 凭据实际可见范围；应用只对带有明确归属标记的 CloudAgentBot 资源执行分组，未标记资源仍是 Provider 可见资源。
- Provider 是 child Thread 与委派事实的权威；普通文本中的点名与自动分工只是 instructions 引导下的模型行为，不是产品路由保证。
- 原始凭据只属于操作系统安全存储，Connection 只保存凭据定位信息。
- Renderer 状态是可丢弃的交互状态。
