# 协作模板 UI 真实 Cloud 验证（2026-09-24）

> 公开版本已将真实远程资源 ID 替换为占位符；相同占位符表示同一资源，不可用于 API 请求。

- 环境：V2 开发版，百炼 Connection；通过 UI 执行 `Bots → 从模板创建`。
- 模板：Competitor Watch；成员 Watcher 与协调者 Prism 均为新建 Managed Bot。
- 唯一名称前缀：`openagentbot-team-e2e-0924-1030-`。两个 Agent 的 Project Document metadata 均含 `openagentbot_template: Competitor Watch` 和相同的 `openagentbot_template_run`。
- 创建结果：成员先创建，协调者后创建；协调者配置页显示 1 位协作成员，远程 ID 为 `agent_REDACTED_14`。
- Chat 探针：在 Prism Chat 请求委派 Watcher 回复 `E2E-WATCHER-1030`。UI 显示 Watcher 的该回复，Prism 报告已委派并原样引用，Session 结束为 `idle · end_turn`。
- 清理：测试 Session `sesn_REDACTED_10` 已在用户确认后通过 UI 删除；两个测试 Agent 已按 Provider 的软归档协议通过 UI 归档，并从默认 Bot 列表消失。本地 Managed Bot IaC 资料按产品归档规则保留。
- 限制：当前 Chat UI 不提供创建时的 Session metadata 输入；此次临时 Session 没有测试 metadata，已删除。后续真实 Cloud UI 验证应先补齐该能力或通过可标记 Session 的验证路径进行。
- 观察到并修复：成员下拉框的“创建新 Bot”默认项为空白；模板创建输入缺少必需的 `skills: []` 导致 `invalid-input`；百炼归档弹窗误称 Qoder。
