# Qoder Deployment API 合同分析（2026-10-08，文档分析，未经真实环境探测）

> 实施状态（2026-10-08）：已按本文档接入（`qoder-deployment-adapter.ts`），
> 同日完成真实环境探测（凭据为本机 `QODER_PAT`）。探测确认：
>
> - Deployment wire：`agent` 为 `{id, type:"agent", version}` 对象；`schedule` 含
>   `upcoming_runs_at`（未来 5 次）与 `last_run_at`；`archived_at` 字段存在（未归档为 null）；
>   `openagentbot_*` metadata 标记被接受并原样回读。
> - Run wire：`session_id` 与 `error`（null）互斥、`trigger_context.type`、`created_at`，
>   无 `started_at`/`finished_at`（终态时间字段待有失败样本后再收敛）。
> - **Run Session 不继承 Deployment metadata**：Session metadata 只有
>   `{deployment_id, deployment_run_id}`（wire 顶层同时有 `deployment_id`）。
>   因此 ChatDataPlane 增加归属继承：无归属标记的 Run Session 继承所属 Deployment 的
>   Key 范围与共享状态（见 `docs/interfaces.md`）。
> - `GET /deployments/{id}`、`/runs`、`/pause`、`/unpause` 均按文档工作。
> - 防御性兼容保留：`agent` 字符串形态、`status:"archived"` 判定、`error` 字符串形态。

来源：Qoder Cloud Agents 官方文档 <https://docs.qoder.com/zh/cloud-agents/api/deployments/create> 及同系列页面（create/update/get/list/search/archive/pause/unpause/run/list-runs/get-run/list-all-runs/get-run-global）。未做真实环境探测（本机无 `QODER_PAT`），结论以文档为准，实施前需补探测。

## 与百炼的对比

两家 Deployment API 高度同构，均声明对齐 Anthropic CMA `POST /v1/deployments` 规范：

| 维度 | Qoder | 百炼 |
|---|---|---|
| Base | `https://api.qoder.com/api/v1/cloud` | `https://{workspace}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio` |
| ID 前缀 | `dep_` / `drun_` / `sess_` | `depl_` / `drun_` / `sesn_` |
| agent 引用 | 字符串（最新版本）或 `{id, type:"agent", version}` | `{id, version}` 对象 |
| environment_id | **创建必填** | 可选 |
| schedule | `{type:"cron", expression, timezone}` + `upcoming_runs_at`（未来 5 次） | 同左，但只回读 `next_run_at` / `last_run_at` |
| initial_events | 事件类型 `user.message` / `user.define_outcome` | `type:"message"`（形状略异，待对齐细节） |
| metadata | 字符串键值，最多 16 键（key≤64，value≤512） | 无公开限制说明；更新为整体替换 |
| environment_variables | Deployment 级环境变量，注入 Run 创建的 Session | 响应含同名字段，文档未描述 |
| 更新语义 | merge-patch（未传字段不变） | 字段级部分更新，metadata 整体替换 |
| 列表筛选 | 有 list + search + 全局 runs 列表 | agent_id/keyword/status/include_archived |
| Run | 每次运行新建 Session；`session_id` 与 `error` 互斥；`trigger_context: {type:"manual"|"schedule"}` | 同语义，`trigger_source` 字段名不同 |
| 错误 | `400 invalid_request_error` / `401 authentication_error` / `404 not_found_error` | `400 InvalidParameter` / `401 InvalidApiKey` / `409 DEPLOYMENT_*_CONFLICT` |

## 关键结论

1. **合并任务输出两家公开 API 均不支持**：Qoder 创建/更新/run 请求体无任何 Session 复用或输出模式字段，文档明确每次运行为本次执行新建 Session。百炼探测已验证同样行为。「合并任务输出」是百炼控制台私有能力，不是 Provider 公开合同。
2. Qoder 同样无到期/结束时间字段，到期降级方案两家通用。
3. Qoder Forward Mode 另有「自然语言管理 Schedule」能力（`create_forward_schedule` / `list_forward_schedules` / `delete_forward_schedule` 托管工具，Template 默认不启用），属于 Forward 模板模式，与 Managed 模式的 Deployment 是不同对象；本应用的「会话内创建定时任务」问题与此无直接复用关系。
4. Qoder 的 `upcoming_runs_at`（未来 5 次触发时间）对 UI 展示更友好；百炼需要自己按 cron+时区推算或只展示下一次。

## 待探测项（2026-10-08 部分已确认，见文首实施状态）

- ~~Qoder Deployment 是否接受并回读 `openagentbot_*` metadata 标记~~（已确认：接受并回读）；
- ~~Qoder Run 关联 Session 是否出现在 Session 列表、是否继承 Deployment metadata~~（已确认：出现在列表；不继承 metadata，仅带 `deployment_id`）；
- Qoder 归档/并发触发的状态码细节（暂停/恢复已确认 200）；
- ~~`initial_events` 事件形状与百炼的差异（`type:"user.message"` vs `type:"message"`）~~（已确认：`user.message`，回读形状一致）。

## 补充：Forward Mode Schedules API（2026-10-08 同日发现）

Qoder 产品界面的定时任务表单（执行位置/计划时间/到期日期/任务输出）对应的不是 Managed Mode Deployment，而是 **Forward Mode 的 Schedules API**（<https://docs.qoder.com/zh/cloud-agents/api/forward/schedules/schemas>）。它完整覆盖了那些「公开 Deployment API 缺失」的能力：

| 产品表单字段 | Forward Schedule 字段 |
|---|---|
| 任务输出（独立/合并） | `execution.session_mode`: `new_session` / `reuse_session` |
| 到期日期（到期自动暂停） | `trigger_policy.stop_at`（另有 `start_at` 执行窗口开始） |
| 频率（每天/每周/单次/间隔） | `trigger_policy.type`: `cron` / `once` / `interval` / `manual` |
| 结果推送 | `sinks`（IM 投递，含 `push_status` 独立状态机） |
| 会话内 Agent 创建定时任务 | `source: "tool"` + `source_session_id`（配合 `create_forward_schedule` 托管工具，见「使用自然语言管理 Schedule」） |

Schedule Run 还有 Deployment Run 没有的语义：`status` 含 `pending/skipped`、`max_attempts` 重试（1 或 2）、`max_concurrent_runs` 并发上限与 `concurrency_limit_reached` 跳过、`timeout_ms` 超时、`result_payload` 文本结果。

**但 Forward Mode 是另一套产品模型**：面向「把 Agent 嵌入自有产品」的场景，身份链是 Forward Identity + Template + Service Account Token，与本应用当前接入 Qoder 的 Managed Mode（PAT + agents/sessions）不同。合并输出、到期自动暂停、会话内创建定时任务这些能力只存在于 Forward Mode；Managed Mode 的 Deployment API（本应用的接入路径）均不具备。百炼控制台的「合并任务输出」同理，属于其托管产品私有能力。

结论维持：首版定时任务仅独立任务输出 + 到期 UI 降级。若未来要合并输出/到期自动暂停/IM 推送/会话内创建，需要单独评估接入 Forward Mode（新身份模型，属另一项决策，不属于 ADR-0010 范围）。
