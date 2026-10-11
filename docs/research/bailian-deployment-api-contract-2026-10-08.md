# 百炼 Deployment API 合同探测（2026-10-08）

探测对象：真实百炼 workspace（`.env` 凭据）。方法：唯一前缀 `oab-probe-*` + `openagentbot_probe=true` metadata 标记，生命周期全量走查后清理（4 个 Deployment 归档、9 个 Session 删除）。原始响应存于 `.scratch/probe-results/`（不入库）。官方接口列表：<https://help.aliyun.com/zh/model-studio/deployment-api/>。

## 端点清单（官方文档确认）

| 操作 | 方法与路径 |
|---|---|
| 创建 | `POST /deployments` |
| 获取 | `GET /deployments/{id}` |
| 列表 | `GET /deployments`（支持 `agent_id`、`keyword`、`status`、`include_archived`、`limit≤100`、`page` 游标、创建时间区间筛选） |
| 更新 | `POST /deployments/{id}`（`schedule` 传 `null` 清除定时） |
| 归档 | `POST /deployments/{id}/archive`（幂等，200） |
| 手动触发 | `POST /deployments/{id}/run` |
| 暂停 / 恢复 | `POST /deployments/{id}/pause`、`/unpause`（均幂等，200） |
| Run 列表 | `GET /deployments/{id}/runs` |
| Run 详情 | `GET /deployment_runs/{run_id}`（注意：不在 deployments 路径下） |

无删除端点，归档是唯一终态；无 webhook 相关端点。

## 探测结论

### 支持且行为符合预期

- **metadata 自定义键值对**：创建写入、响应回显，可作为 `openagentbot_key_scope` / `openagentbot_shared` 的载体。
- **cron + IANA 时区**：`schedule: { type: "cron", expression, timezone }`，`Asia/Shanghai` 与 `UTC` 均接受，`next_run_at` 计算正确（UTC 示例：`"30 8 * * 1-5"` → `2026-10-08T08:30:00Z`）。schedule 对象还回读 `last_run_at` / `next_run_at`。
- **Run 关联 Session**：手动触发约 5 秒内 `session_id` 分配并到达 `succeeded`；`trigger_source` 区分 `manual` / `schedule`；`status` 为 `running / succeeded / failed`，失败带 `error` 对象。
- **Run Session 出现在会话列表**：`GET /sessions?agent_id=` 可见，**继承 Deployment 的 metadata 与名称**（Session title = Deployment 名称，key-scope 归属标记自动随 Session 传播）。这对 OpenAgentBot 的归属分组是关键利好。
- **暂停/恢复**：`paused_reason: { type: "manual", error: null }`；恢复后 `next_run_at` 重算。
- **归档语义**：归档后从默认列表消失，`include_archived=true` 可见；归档后触发返回 `409 DEPLOYMENT_STATE_CONFLICT`；并发触发返回 `409 DEPLOYMENT_TRIGGER_CONFLICT`。

### 关键限制

- **metadata 更新是整体替换**：`POST /deployments/{id}` 传 `metadata` 会丢弃未包含的旧键。客户端更新时必须读出旧值合并后再提交。
- **未知字段静默忽略**：update 对不认识的字段返回 200 且不报错，无法靠状态码区分「支持」与「忽略」。
- **无到期/结束时间字段**：`ends_at`、`expires_at`（顶层与 schedule 内）均静默忽略。「到期自动暂停」公开 API 不支持，只能按 ADR-0010 的降级方案处理（UI 层提示到期，引导手动暂停）。
- **任务输出模式（独立/合并）公开 API 不支持**：`session_mode=reuse`、`session_strategy=merge`、`output_mode=merge`、run 请求体携带 `session_id` 四种候选全部行为验证失败——同一 Deployment 连续两次触发均各自新建 Session。控制台的「合并任务输出」属控制台私有能力。首版只能提供独立任务输出。
- 响应含文档未列字段 `environment_variables`，以及内嵌完整 Agent 定义（体积大，客户端列表场景应忽略该字段）。

## 对 ADR-0010 的影响

1. key-scope 归属与共享标记落在 Deployment metadata，可行；Session 继承归属标记，无需额外标注。
2. 创建表单的「任务输出」首版移除合并选项，仅独立任务输出；待公开 API 支持后恢复。
3. 到期日期按降级方案实现，不做本地定时暂停。
4. 更新 metadata 前必须先读后并（read-merge-write）。
