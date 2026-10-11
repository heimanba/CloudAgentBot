# Chat 事件时间线开发计划

## 目标

把 Chat 从“只显示 user/assistant 纯文本气泡”升级为以 Provider Event 为事实来源的对话时间线。用户在同一对话视图中看到消息、工具、产物和运行状态。

本计划不改变 Bot/Chat 的远程身份，不在本地持久化 Chat、Message、Turn 或 Event，也不把 Qoder wire object 暴露给 Renderer。

## 产品范围

### 对话视图

- 用户与 Agent 消息；
- 可折叠的 thinking；
- 工具调用、输入、输出、错误状态；
- Artifact 文件名、类型、大小与 file ID；
- Session/Thread 运行、完成、终止和停止原因；
- Session error；
- 模型调用 credits；
- 发送期间的文本增量和实时事件。

## 实施阶段

### 阶段 1：协议合同正确性

1. 为 Event List 建立独立响应 schema，使用 `first_id`、`last_id`、`has_more`。
2. 使用 `after_id` 拉取完整历史，按 Event ID 去重并防止游标停滞。
3. 使用 `processed_at` 作为 Event 展示时间。
4. SSE 支持 `event_deltas[]` 和 `Last-Event-ID`。
5. 解析 `event_start` / `event_delta`；最终完整 Event 用于校准临时增量。
6. SSE 非正常结束时有限重连；无法恢复时触发历史重读，不自动重发消息。

### 阶段 2：跨层展示模型

1. `ChatDetailView` 增加 Provider-neutral `events` 判别联合。
2. Qoder Adapter 映射 message、thinking、tool、artifact、status、usage、error 和 unknown。
3. `ChatEventView` 同时承载文本 delta、实时 timeline item、done 和 error。
4. Provider raw payload 保持在 Qoder Adapter 内；未知类型只输出 envelope。

### 阶段 3：Renderer 对话时间线

1. 默认对话视图突出消息，工具、thinking、状态和产物使用紧凑事件卡片。
2. 对话时间线支持搜索和事件类别筛选；未知 envelope 不进入用户界面。
3. 长输入/输出默认折叠，使用 `pre` 保留格式；错误事件有明确视觉状态。
4. 发送期间显示增量回复和实时事件，idle 后重读远程历史校准。
5. 桌面和 320px 窄视口均不得横向溢出。

### 阶段 4：验证

1. 单元测试覆盖事件映射、cursor 分页、delta 聚合、SSE header/query 和重连。
2. Renderer 测试覆盖筛选、工具/产物/状态展示与发送状态。
3. 运行 typecheck、lint、unit、architecture、build/package/smoke。
4. 使用真实 Qoder Cloud 创建唯一前缀资源，完成 Bash、Write、DeliverArtifacts、最终消息和 idle 全链路。
5. 通过打包应用可见 UI 验证事件卡片、时间和窄视口布局；完成后删除 Session/Agent，Environment 按 Provider 协议删除或归档。

## 验收标准

- 历史超过 100 条时不缺页、不重复；
- 用户和 Agent 消息显示 `processed_at`；
- 工具调用、结果、Artifact、状态、错误与 credits 在 UI 可见；
- 对话时间线的搜索/筛选有效；
- 新消息在完整 Event 到达前有真实增量反馈，最终内容以历史重读为准；
- SSE 断线不会自动重发用户消息；
- Renderer 不依赖 Qoder wire 类型；
- Chat/Event 不写本地文件或数据库；
- 真实 Cloud 与打包应用结果符合上述行为。
