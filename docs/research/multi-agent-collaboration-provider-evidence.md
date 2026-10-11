# 协作 Bot 的 Provider 合同证据与验收记录

> 公开版本已将真实远程资源 ID 替换为占位符；相同占位符表示同一资源，不可用于 API 请求。

更新时间：2026-09-23
实测时间（UTC）：最终修订版 Qoder 2026-09-22T18:35Z、百炼 2026-09-22T18:36Z；早期对照运行 Qoder 2026-09-22T18:13Z、百炼 2026-09-22T18:16Z

本文是计划第 11.6 节 / 第 12 节步骤 8 的验证记录，只登记命令结果、资源 ID、事件类型与计数。不含凭据、Agent Instructions 正文、完整 Provider 响应或用户数据；所有临时资源均为唯一前缀创建的测试资源，已在验证结束时删除或归档。

## 结论摘要

1. Qoder 与百炼都能把**外部 `agent_id`** 引用写成 coordinator roster，并支持 roster `2 → 1 → 空` 收敛；全程 coordinator 的远程 Agent ID 不变，成员不是当前 scope 的资源。
2. 一次普通用户消息（不含 `@name`）触发了真实的 child Thread 协作：两个 Provider 都出现 child Thread 创建、coordinator → child 与 child → coordinator 的双向 thread message 事件。
3. Qoder 以 Thread API 证明 child Thread 上的 Agent 就是 roster 中的 worker；百炼以 child `session_thread_id` 与 thread message 事件证明实际协作。
4. 成员 Agent 在协作全程未被更新、归档或删除（配置身份字段逐字段一致，`updated_at` 不变）。
5. 稳定判据只能是 Thread 事件证据：Qoder 两次运行采集到的 worker token 都只出现在 thread message 载荷里，最终文本分别是「未包含 token 的旁白」与「空文本」；百炼本轮最终文本与 thread 载荷都含同一 token，`tokenProvenance` 为 `thread-message`。
6. coordinator 回合是否产生 assistant 文本、文本是否包含委派结果，都是模型行为，不可作为 pass/fail 条件（第 6 节记录了两轮 Qoder 的实测差异）。

## 只读 OpenAgentPack 基线（实施前后完全一致）

| 指纹 | 实施前 | 实施后（最终复核） |
| --- | --- | --- |
| HEAD | `e492cee0f9dfff72158a24abb886cdbc01aeef9f` | 同左 |
| `git status --porcelain -- packages/sdk \| shasum -a 256` | `b6294e92c545e52240c3715ae20b9c76f3ad0e7873071fe5f590b92320c12b40`（42 行） | 同左 |
| `git diff HEAD -- packages/sdk \| shasum -a 256` | `953f98e85da59bde9ca2f5aa3503b8a0eea17fa9527e20d09b53de92aadc7613` | 同左 |

实施过程未修改、提交、格式化或清理 OpenAgentPack；V2 只从 `@openagentpack/sdk` 包根公共 Interface 导入。

## 验证命令与结果（最终修订版）

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过（无输出） |
| `pnpm lint` | 1 个既有错误：`index.js:2551 'ListCloudVaultsResponseSchema' is assigned a value but never used`。该文件本次未改动，`git show HEAD:index.js \| npx eslint --stdin --stdin-filename index.js` 复现同一错误，与本次改动无关（详见「已知限制」） |
| `pnpm test` | 48 个文件通过 / 11 个跳过（59），496 用例通过 / 15 跳过（511） |
| `pnpm test:arch` | 通过（renderer/shared 特权、OpenAgentPack 边界、表单 Primitive 状态归属均成立） |
| `npx vitest run src/main/control-plane src/shared` | 11 文件 / 171 用例通过 |
| `npx vitest run src/renderer/features/bots src/renderer/ui/design-system` | 7 文件 / 88 用例通过 |
| `npx vitest run src/main/data-plane/providers/qoder/qoder-bot-catalog.test.ts` | 7 用例通过（分页 cursor 不前进时 fail closed） |
| OpenAgentPack 合同测试（第 11.4 节 5 个文件，`bun test`） | 50 通过 / 0 失败，105 expect |
| `OPENAGENTBOT_LIVE=1 npx vitest run tests/live/qoder-multi-agent-collaboration.live.test.ts` | 通过（20.4s），含 §14.7 清理后验证 |
| `OPENAGENTBOT_LIVE=1 npx vitest run tests/live/bailian-multi-agent-collaboration.live.test.ts` | 通过（37.1s），含 §14.7 清理后验证 |

## Qoder 真实 Cloud 闭环（最终修订版运行）

唯一前缀 `openagentbot-v2ma-20260922183500-mn08`；coordinator `agent_REDACTED_01`、worker `agent_REDACTED_02`、decoy `agent_REDACTED_03`、environment `env_REDACTED_01`、session `sess_REDACTED_01`。

断言与结果：

- scope state 只有 1 个 agent 资源，`remote_id` 为 coordinator；不存在任何 `remote_id` 等于成员 id 的 state 资源；成员 id 只出现在 `agents.yaml` 的外部引用与 coordinator 远端读回快照中，`agents.yaml` 不含凭据。
- 远端 roster 读回：create 为 `{type: "coordinator", agents: [worker, decoy]}`；收敛为 `[worker]` 后 coordinator id 不变；清空后 `agents` 为空。
- scope state 在成员收缩后不再包含 worker id。
- 成员最终仍存在，名称/描述/system/model/multiagent/archived_at 与协作前快照逐字段一致，`updated_at` 未变。
- 用户消息为普通文本（不含 `@name`）；SSE 到达 `done` 且无 error 事件。

Thread 证据（硬门，`processed_at`）：

| 事件 | 时间 |
| --- | --- |
| `session.thread_created` | 2026-09-22T18:35:06.412881Z |
| `agent.thread_message_sent`（create_thread 后） | 2026-09-22T18:35:06.412881Z |
| `agent.thread_message_sent`（send_message 后） | 2026-09-22T18:35:07.672805Z |
| `agent.thread_message_received` | 2026-09-22T18:35:09.389937Z |

事件类型直方图：`session.status_running` 1、`session.thread_status_running` 4、`user.message` 1、`span.model_request_start` 5、`agent.thinking` 4、`agent.tool_use` 4、`span.model_request_end` 4、`session.thread_created` 1、`agent.thread_message_sent` 2、`agent.tool_result` 4、`session.thread_status_idle` 1、`agent.thread_message_received` 1。

Thread API（`/sessions/{id}/threads`）：2 行，1 个 child（`parent_thread_id` 非空），child 上的 Agent 标识为 `agent_REDACTED_02` 与 `openagentbot-v2ma-20260922183500-mn08-worker`，即 roster 中的 worker。child Thread 事件读取到 11 条，且含 worker token。

辅助观察（不参与 pass/fail）：`tokenInFinalText: []`（文本为空）、`tokenInThreadMessages: ["MK-X7K2P9"]`、`rawAgentMessageEvents: 0`、`sseTokenFrames: 0`。即本轮 coordinator 只做了 thinking + 4 次 tool_use，没有产出任何 assistant 文本；token 仅存在于 thread message 载荷中。

## SSE 判据：为何 token 帧不能作为 pass/fail

最终修订版删除了「必须出现 token 帧」的断言，理由是实测与单测两条证据：

1. **原始事件证明 V2 没有丢帧**：本轮 `rawAgentMessageEvents`（远端持久化的 `agent.message` 事件）为 0，同时 `sseTokenFrames` 为 0。即 Provider 本身没有产生 assistant 文本事件，不是适配器丢弃了帧。同一适配器的 token 映射由单测确定性覆盖（`src/main/data-plane/providers/qoder/qoder-chat-adapter.test.ts`：assistant message → token、idle → done；`bailian-chat-adapter.test.ts`：delta → token）。
2. **同一探针在不同轮次结果不同**：早期对照运行（`openagentbot-v2ma-20260922181337-a2p0`，18:13Z）产生了 1 条 `agent.message`、无 token（`tokenInFinalText: []`，文本为 “Delegation probe dispatched to …-worker. Waiting for the member's result.”）；本轮完全没有文本。这正是计划第 11.6 节列为「体验观察」的类别。

因此保留的硬门是 `sseStreamErrors === []`、`doneSeen === true` 与计划第 11.6 节的 Thread 事件证据；观察项（token 帧数、assistant 文本）只记录不断言。

**同步观察到的 `done` 语义**（本功能未修改 ChatAdapter，记录为已知限制）：Qoder 的 `toChatEventView` 把任何 `status idle`（包括 `session.thread_status_*` 线程域状态）映射为 `done`，且该分支不再产生 timeline 项。本轮直方图中不存在 `session.status_idle`，唯一的 idle 是 `session.thread_status_idle`（18:35:09.389937Z，与 `agent.thread_message_received` 同刻），因此 chat 级 `done` 由 child Thread 空闲触发，而 coordinator 的第 5 次 `span.model_request_start`（18:35:08.6488953Z）尚无配对的 `model_request_end`。多 Agent 会话下这可能让 UI 在主回合结束前显示完成。

## 百炼真实 Cloud 闭环（最终修订版运行）

唯一前缀 `openagentbot-v2mab-20260922183622-yk5s`；coordinator `agent_REDACTED_04`、worker `agent_REDACTED_05`、decoy `agent_REDACTED_06`、environment `env_REDACTED_02`、session `sesn_REDACTED_01`。

断言与结果与 Qoder 同构：scope state 只记录 coordinator；远端 roster create → `[worker, decoy]`、shrink → `[worker]`、clear → 空 coordinator roster（百炼以空 `agents` 表达清除）；coordinator id 不变；成员配置逐字段一致；普通文本消息即触发协作。

Thread 证据（硬门）：`thread_created` 1、`thread_message_sent` 5、`thread_message_received` 4，带 child `session_thread_id` 的 thread 事件 1 条，child Thread `sthr_01M356FDE7P27HDS7SQE06NQ50` 1 个。

事件类型直方图：`session_status` 2、`message` 5、`model_request_start` 10、`reasoning` 10、`model_request_end` 10、`tool_call` 7、`thread_created` 1、`thread_message_sent` 5、`thread_message_received` 4、`thread_status` 4、`tool_call_output` 7。

SSE 视图计数：`timeline` 65、`token` 92、`done` 1，无 error 事件（比早期 18:16Z 运行更完整：那次最终文本与 thread 载荷都没有 token）。

辅助观察（不参与 pass/fail）：`tokenInFinalText: ["MK-X9B3KP"]`、`tokenInThreadMessages: ["MK-X9B3KP"]`、`tokenProvenance: "thread-message"`——最终回答中的 token 来自 child Thread 载荷，最终文本是成员产出的代码内容。

## 清理

- Qoder：session 删除（远端 finalize 阶段返回 409 时按 2s 退避重试）；3 个 Agent 删除；environment 删除返回 409（仍有引用）→ 按 Provider 协议 `POST /environments/{id}/archive` 归档。清理后校验：活动 Agent / Environment 清单均无本次前缀残留。
- 百炼：session 删除；3 个 Agent 归档（百炼协议）；environment 删除。清理后校验：活动 Agent / Environment / Session 清单均无本次资源。
- 两侧的本地临时目录（`managed-bots` 根）均已删除。
- 早期失败运行遗留的资源已在人工清理时删除并复核（成员 `multiagent` 为空，未被污染）。

## 已知限制

- Qoder 的 chat 级 `done` 可能由 child Thread 空闲触发（`toChatEventView` 的 `status idle` 分支，HEAD 既有行为，本功能未改 ChatAdapter）。多 Agent 会话下 UI 可能在 coordinator 主回合未结束时显示完成；child Thread 的专门 UI 不在本期范围（计划第 0 节第 12 条）。
- coordinator 回合可能不产生 assistant 文本帧（本轮 `rawAgentMessageEvents: 0`），也可能产出不含委派结果的旁白（18:13Z 运行）。这只是模型行为，稳定判据仍以 Thread 事件为准。
- 计划第 8.1 节要求 Qoder 分页 cursor 不前进时 fail closed，百炼侧没有等价的“cursor 不前进”守卫（百炼使用 `next_page` 分页且已完整翻页）。两侧 `bots.list` 都返回完整 Agent 列表。
- `pnpm lint` 因仓库根 `index.js`（本次未改动的既有文件）存在 1 个 `no-unused-vars` 错误而退出非零；该错误在 HEAD 内容上同样复现，不属于本功能范围，未在本功能中修改该文件。
- 测试 stderr 存在既有噪音：`The current testing environment is not configured to support act(...)`（Renderer 测试，非失败）。
- OpenAgentPack 侧只记录了 HEAD、status 与 SDK diff 三项指纹，未记录 src 内容哈希配方。
- 跨 scope 的 coordinator 嵌套/循环没有静态保证（计划第 0 节第 10 条）。
