# Bailian 数据面合同与验证边界

整理日期：2026-10-04。以下公开 API 摘要和实测结论来自 2026-09-18 接入验证；本次整理没有重新执行 Cloud 测试，也不表示上游文档已重新核验。现行产品行为以架构、接口和验收规范为准。

## 公开 REST/SSE 合同

1. 创建 Session：`POST /sessions`，必填 `agent` 与 `environment_id`；新 Session 为 `idle`，并锁定 Agent 当前最新版本快照。[创建 Session](https://help.aliyun.com/zh/model-studio/session-create)
2. 先建立 SSE：`GET /sessions/{id}/events/stream`，带 `Accept: text/event-stream`；建立后收到 `: connected`。[订阅 Event SSE](https://help.aliyun.com/zh/model-studio/event-sse-stream)
3. 发送纯文本：`POST /sessions/{id}/events`，body 为 `{input:[{role:"user",type:"message",content:[{type:"text",text}]}]}`，数组长度 1–50。[发送 Event](https://help.aliyun.com/zh/model-studio/event-post)
4. `200` 只代表事件入队成功，不代表 Agent 开始处理；响应回显已分配 `id` 和 `request_id`。运行结果必须观察 SSE 或 GET history。[发送 Event](https://help.aliyun.com/zh/model-studio/event-post)
5. 状态经 `session_status` 推送：`running` 后回 `idle`（`end_turn` / `requires_action` / `retries_exhausted`），或进入 `terminated`。[Session and Event](https://help.aliyun.com/zh/model-studio/session-api)、[订阅 Event SSE](https://help.aliyun.com/zh/model-studio/event-sse-stream)
6. GET history 使用 cursor `page=next_page`，`limit<=100`，默认 `asc`；返回完整持久事件。[列出 Event](https://help.aliyun.com/zh/model-studio/event-list)


## 已执行验证

- 公共 SDK 创建 Environment 与 Agent、重复 Sync、更新描述及 Instructions、列表读回均通过；重复 Sync 与更新保持远程 Agent 身份。
- Session 创建、发送前建立 SSE、发送 Event、观察完整回复与状态、按 ID 从历史找回完整事件通过。
- 增量流使用 `event_start` 与 `event_delta`；按 `event_id + delta.index` 聚合，最终完整事件校准内容；reasoning start 后可以没有 delta。
- 收到首个 delta 后主动断流，不重发用户 Event；GET history 能找回最终完整事件和后续 idle 状态。恢复不依赖未经承诺的持久续传 cursor。
- 无效凭据的 HTTP 401 与不存在 Session 的 HTTP 404 使用不同错误 envelope，Adapter 必须归一化错误。
- 测试 Session 已删除、Agent 已归档、测试 Environment 已删除；包括失败尝试的遗留 Environment，清理失败数为 0。

## 当次未覆盖的场景

- REST 首屏与 SSE 建连之间发送的独立竞态；断线恢复验证不能替代该专项场景。
- `requires_action`、`retries_exhausted`、`terminated` 与顶层 SSE `type=error`。
- HTTP 403、409、429、5xx；当次没有修改权限、主动压测或人为制造这些响应。
- 多 content index 与多页历史并发增长。

以上是当次验证边界，不宣称后续版本仍未覆盖。复验方法见 [验收说明](../validation.md)，测试入口为 `tests/live/bailian-provider-contract.live.test.ts`。发送超时或断流不应自动重发 POST；由 Provider 历史恢复远程事实。
