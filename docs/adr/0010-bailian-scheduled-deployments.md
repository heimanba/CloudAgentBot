# ADR-0010：百炼定时任务作为数据面 Deployment 能力

状态：已接受（API 合同已经真实环境探测确认，结论见 [`bailian-deployment-api-contract-2026-10-08.md`](../research/bailian-deployment-api-contract-2026-10-08.md)）

## 背景

用户需要定时任务能力：让某个远程 Agent 按调度自动执行一段固定任务，并能看到每次执行的过程与结果。百炼与 Qoder 均有 Deployment API（均对齐 Anthropic CMA `POST /v1/deployments` 规范）：Deployment 绑定一个远程 Agent 与触发方式，传 cron 表达式即定时触发，不传则只能手动触发；每次触发产生 Deployment Run，Run 关联一个新建 Session。百炼合同已经真实环境探测确认；Qoder 侧合同见 [`qoder-deployment-api-contract-2026-10-08.md`](../research/qoder-deployment-api-contract-2026-10-08.md)（文档分析，实施前需补探测），因两家合同同构，Adapter seam 设计支持低成本接入 Qoder（2026-10-08 已接入，映射对文档未明确的字段名做防御性兼容，待真实探测收敛）。

需要决定的点：Deployment 在对象模型中的归属、创建参数形态、共享语义、UI 入口、执行结果如何呈现，以及桌面客户端如何感知后台执行完成。

## 决策

**定时任务是数据面能力，不是本地对象**。Deployment 身份是 `Connection + remoteAgentId + deploymentId`；Provider 是 Deployment、Run 与执行结果的唯一事实权威；本地不持久化 Deployment、Run 或其历史，不建本地定时器，不在本机执行调度。view model 按 Provider-neutral 设计（两家合同同构）；Renderer 入口与区块由 `supportsDeployments` 谓词统一门控（百炼、Qoder 均展示）。

**创建参数**（Renderer 表单收集，Main 做唯一信任边界校验）：

- 执行 Bot 是表单字段而非隐式上下文：从 Bot 详情页进入创建时默认选中当前 Bot、允许改选；候选范围与新任务页 Bot 选择器一致（团队共享 / 我的 Bot / 全部可用），排除其他 Key 标记且未共享的 Bot；
- 执行输入是创建时确定的固定 prompt 文本，不支持变量或参数模板；
- 任务输出模式首版只有**独立任务输出**（每次执行新建 Session）：两家 Provider 的 Managed/Deployment API 均不支持合并输出（百炼已探测验证四种候选字段均无效；Qoder 文档无此字段且明确每次运行新建 Session）。合并输出、到期自动暂停、IM 推送与会话内创建只存在于 Qoder Forward Mode 的 Schedules API（`execution.session_mode=reuse_session`、`trigger_policy.stop_at` 等，见 research 文档「Forward Mode Schedules API」一节），Forward Mode 是另一套身份模型（Identity + Template + SAT），接入它是独立决策，不属于本 ADR；
- 调度以「频率预设 + 时间 + 时区」表达，不暴露裸 cron 输入：用户选择频率预设（如每天/每周/每月）、具体时间（`HH:mm`）与时区（首版只提供 `Asia/Shanghai` 与 `UTC`，默认 `Asia/Shanghai`；Provider 侧仍接受任意 IANA 时区，需要更多选项时再加），由客户端编译为 cron 表达式提交；编辑时能把现存 cron 反解回预设，反解失败的自定义表达式按只读原文展示；
- 到期日期可选，默认关闭：公开 API 无到期字段，按降级方案实现——到期后 UI 将 Deployment 展示为「已到期」并引导用户手动暂停，不做本地定时暂停；若未来 API 支持到期字段则切换为 Provider 侧自动暂停。

**metadata 写入规则**：Deployment metadata 的更新是整体替换，任何 metadata 变更必须先读出旧值合并后再提交（read-merge-write）。Run 关联 Session 自动继承 Deployment 的 metadata 与名称，因此归属标记随 Session 传播，Run Session 在会话列表中天然按创建者 Key 范围分组。

**归属与共享复用 API Key 范围 metadata 模型**：创建时标记 `openagentbot_key_scope` 归属；可标记 `openagentbot_shared` 供其他 Key 范围发现。共享是展示状态，不授予或撤销 Provider 权限；语义与 Bot/Session 共享一致。

**UI 入口与展示**：

- 主入口是侧栏底部导航的「定时任务」（与「管理助手」「协作模板」并列，仅百炼 Connection 可见），进入跨 Bot 的定时任务总览页：列表标注所属 Bot，创建表单内选择执行 Bot，支持编辑、暂停/恢复、手动触发、归档；
- Bot 详情页保留「定时任务」区块作为第二入口，创建时 Bot 已锁定不显示选择器；
- 归档是不可逆操作，必须使用 AlertDialog 确认；
- Run 关联的 Session 就是普通 Chat，复用现有 Chat 详情页与时间线展示执行过程与结果，不新建展示页面；
- UI 使用 shadcn/ui Primitive 与 Tailwind v4 token，遵守 ADR-0005 与 UI 实现规范。

**完成通知**：桌面客户端无公网回调地址，不使用 webhook；通过轮询 Deployment 与 Run 状态感知执行，检测到 Run 进入终态时经系统通知告知用户。轮询与通知状态只存在 Main/Renderer 内存，不落盘。

**会话内 Agent 创建定时任务**：首版不提供。把 Deployment 写操作封装为 MCP 交给模型，等于把控制面写权限暴露给 prompt injection，且创建结果缺乏 UI 确认环节；二期可先评估只读 MCP（查询我的定时任务与运行结果），写操作仍走 UI。

## 理由

该方案与 ADR-0003 的控制面/数据面分离一致：Deployment 不涉及本地 IaC 资料，OpenAgentPack 不参与，复用现有 Bailian 数据面 Client/Adapter 家族与 DesktopHost 组织方式。固定 prompt、必选输出模式与显式时区把百炼 Console 已验证的交互形态（创建表单中的「任务输出」与时区选择）直接映射进产品，不自创概念。共享与归属不新建模型，避免第二套权限语义。

没有选择本地调度：本地定时器要求客户端常驻且与 Provider 执行状态双写，违背「轻量远程 Agent 客户端」目标。

没有选择通用 Provider capability 抽象：Provider 差异（agent 引用形态、environment_id 必填性、initial_events 事件类型、Run 字段名）收敛在各自 Adapter 内，`DeploymentAdapter` seam 保持稳定。

## 后果

- 定时任务的执行只发生在 Provider 侧；客户端退出、断网不影响已激活的 Deployment，但客户端也感知不到期间的执行，重新打开后通过读取远程状态补齐。
- 合并任务输出的 Session 会随时间积累历史，其展示性能与上下文长度由 Provider 行为决定，客户端不做截断或摘要。
- 独立任务输出会让会话列表随执行频率增长；用户创建时已显式选择该模式，首版不做额外过滤，观察真实使用后再评估。
- Deployment 的 metadata 标记依赖百炼对该资源类型的 metadata 支持；若探测发现不支持，则归属与共享只能做到「Provider 可见即可见」，需在实现前重估。
- Qoder 已探测确认：Run Session 不继承 Deployment metadata（百炼原生继承）。ChatDataPlane 对带 `deployment_id` 的无标记 Session 继承所属 Deployment 的归属范围，保证两家行为一致；Deployment 查询失败时按未分组隐藏。
- 轮询带来延迟与请求开销；通知不是实时保证。

## 探测确认的合同要点

全部待确认项已于 2026-10-08 完成真实环境探测：metadata 支持（整体替换语义）、cron+IANA 时区支持、Run 关联 Session 进入会话列表且继承 metadata、暂停/恢复/归档幂等、归档后触发返回 `409 DEPLOYMENT_STATE_CONFLICT`、并发触发返回 `409 DEPLOYMENT_TRIGGER_CONFLICT`、无到期字段、无合并输出能力、无删除端点（归档是唯一终态）。细节见上述 research 文档。
