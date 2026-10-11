# 协作能力展示：Qoder 与百炼真机字段核查

日期：2026-09-24。范围：Agent 列表、Session 列表与详情、child Thread 事件、Session 完成语义。只记录字段形状和匿名化结论；凭据来自仓库现有 `.env`，未输出、修改或提交。

## 方法与来源

- 用现有自动清理的 [`qoder-multi-agent-collaboration.live.test.ts`](../../tests/live/qoder-multi-agent-collaboration.live.test.ts) 和 [`bailian-multi-agent-collaboration.live.test.ts`](../../tests/live/bailian-multi-agent-collaboration.live.test.ts) 创建唯一前缀 worker、decoy、coordinator 和 Session，发送强制委派探针。临时增加只输出字段键名、引用和事件类型的诊断日志，验证后已从两个测试文件撤销。
- 使用两家 Provider 的原生 `/agents?limit=100`、`/sessions?limit=1`、`/sessions/{id}`、`/sessions/{id}/events` 只读响应核对原始字段；Qoder 另读 `/sessions/{id}/threads`。不以 Renderer 当前模型代替远端原始合同。
- Bailian 最终诊断运行通过；Qoder 核心协作测试通过，但 `afterAll` 删除仍在 `running` 的 Session 时收到 409，导致文件结果失败。随后按 [Qoder Sessions 官方 cancel 语义](https://docs.qoder.com/cloud-agents/sessions) 调用 cancel，待 Session 回到 idle 后删除了两轮探针 Session。最终核查 Qoder 当前日期探针前缀的 Agent、Session、Environment 活动列表均为 0。Bailian 测试的自动清理与清理后断言通过。

## 真机结论

| 问题 | Qoder | 百炼 | 产品结论 |
| --- | --- | --- | --- |
| Agent 列表能否识别协调者？ | `/agents` 行含 `multiagent: {type: "coordinator", agents: [{id, type, version}, …]}`；本次两位成员 | 同形，`version` 为 null | 两家都可在现有分页 `bots.list` 一次请求中取得 roster。现有 Adapter 丢弃该字段，需补映射；无需逐 Bot 请求。 |
| Session 列表是否有创建时 Agent 快照？ | `/sessions?limit=1` 行有 `agent` 对象及 `multiagent` 键 | 同左 | 任务列表可直接依据每个远程 Session 自身的快照标记“协作任务”，不借用当前 Bot roster。 |
| Session 详情是否保留成员快照？ | `/sessions/{id}.agent.multiagent` 包含创建时两位成员；在协调 Agent 清空 roster、随后被测试清理删除后仍可读到 | 清空远程 roster 后重新读取原 Session，仍返回创建时两位成员，和初始 roster 一致 | Session 页头的“可用成员”应明确为“创建此任务时的成员”，不受后续 Bot 编辑影响。 |
| 委派事件如何关联目标？ | `session.thread_created` 带 child `session_thread_id` 与 `agent_name`；`agent.thread_message_sent/received` 带 `to/from_agent_name`、`to/from_session_thread_id`。Thread 列表 child 行的 `agent.id` 与 worker ID 相符 | `thread_created` 的 `content[].data` 带 `agent_name`、`session_thread_id`；发送/接收事件的 `metadata` 带 `to/from_agent_name` 与 `to/from_session_thread_id`。本轮名称集合有 worker 和 coordinator | 两家都能展示 Provider 给出的协作名称及 Thread 轨迹。Qoder 可用 Thread API 验证精确 Agent ID；百炼本轮仅能验证名称与 child Thread，不应仅凭名称宣称稳定 Agent ID。重名时降级为“协作成员”。 |
| 一个成员是否只会有一个 child Thread？ | 本轮 1 个 child Thread | 一轮观测出现 2 个 `thread_created`，但名称集合只对应同一 worker；另轮也有多次双向消息 | Thread 数不等于参与成员数。先显示“子任务/委派记录”数量；“N 位成员”只在身份去重可验证时显示。 |
| `done` 是否代表完整主回合结束？ | 本轮 SSE 收到 `done`，历史事件中没有 `session.status_idle`，只有 `session.thread_status_idle`；测试结束时远端 Session 仍 `running`，直接删除返回 409 | 本轮测试完成且清理通过；未观察到同样的 Qoder 映射错误 | Qoder 当前 `toChatEventView` 把 child idle 当 done 的问题在本轮再次复现。只允许 Session 级 idle/terminated 触发 Chat done；完成后仍需按远端 Session 状态核对。 |

## 现有产品路径与开发修订

- [`qoder-bot-catalog.ts`](../../src/main/data-plane/providers/qoder/qoder-bot-catalog.ts) 与 [`bailian-bot-catalog.ts`](../../src/main/data-plane/providers/bailian/bailian-bot-catalog.ts) 目前不映射 `multiagent`。[`models.ts`](../../src/shared/models.ts) 中 `BotView` 和 `ChatView` 也没有协作快照字段；Provider 有数据，产品路径尚未暴露。
- Qoder/百炼当前事件 Adapter 将 thread 创建/跨线程消息映射为 `unknown`。下一步应分别解析各自原始字段，生成只读中立事件；不创建本地 Thread 身份或持久化。
- Bot 列表应读取**当前远程 roster**。Session 列表和详情应读取**该 Session 的 Agent 快照**。Bot 配置页继续读取 Managed Bot 的**本地期望 roster**；Sync pending 时三者可能不同，UI 要明确时间与来源。
- 协作轨迹初版放在现有工作记录的折叠摘要。Provider 事件证据才算委派；自然语言提及成员不算。参与成员的身份必须由 Thread API ID，或事件名称与当前同 Connection 目录中某个 Session 快照成员 ID 的唯一匹配支持；重命名、重名或目录不可见时只展示“协作成员/子任务”。Session 快照中的 roster 项有 ID 与版本，本轮不含成员名称。

## 范围限制

本次各 Provider 使用强制委派的临时资源，证明的是这些字段在当前真机响应中的形状与一次真实协作链路；未测试大量历史 Session、重名 Agent、归档成员、所有分页边界及网络断线。名单匹配与降级必须有单元/合同测试，不能仅凭本次样本推断所有响应完整。
