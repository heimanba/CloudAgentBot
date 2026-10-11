# 百炼同业务空间跨 Key 共享实测

> 公开版本已将真实远程资源 ID 替换为占位符；相同占位符表示同一资源，不可用于 API 请求。

日期：2026-09-29。用户提供两个不同 Key，分别标为 A、B；均使用用户指定业务空间。本文不记录凭据。

## 结论

云端允许本次两个 Key 相互发现和访问测试 Bot；当前 OpenAgentBot 将不同 Key 的共享 Bot 过滤，导致切换连接后无法在团队共享使用对方 Bot。这是应用分组规则导致的产品缺口，不能解释为百炼不支持跨 Key 访问。此次结论仅适用于这两个 Key 和指定空间，不推广到任意账号或业务空间。

## 真实应用操作

通过 computer use 在真实 Electron 应用中添加临时连接 QA-CrossKey-A、QA-CrossKey-B，分别完成认证和既有运行环境选择。分别在应用创建 QA-CrossKey-A-0929、QA-CrossKey-B-0929，再通过应用共享开关同步。同步前为测试项目补充 `openagentbot_test: cross-key-0929`，未修改其他资源。

- A 共享后切换 B，刷新新任务助手目录，团队共享为空。
- B 创建并共享后，B 的管理页团队共享数量为 1，仅显示 B Bot，没有 A Bot。
- 切回 A，刷新新任务助手目录，团队共享仅显示 A Bot，没有 B Bot。

## 直接 Provider 请求对照

| 检查 | Key A 访问 B Bot | Key B 访问 A Bot |
| --- | --- | --- |
| Agent 列表包含对方，shared 为 true | 是 | 是 |
| Agent 详情 | HTTP 200 | HTTP 200 |
| 用对方 Agent 创建临时 Session | HTTP 200 | HTTP 200 |
| 提交普通问候消息 | HTTP 200 | HTTP 200 |
| Session 最终状态 | idle | idle |
| 返回预设标记 | CROSS_KEY_B_OK | 未观察到预设标记，不判定指令符合性 |

云端列表和详情证明可见性；会话创建和提交成功证明调用请求未被权限拒绝。未把 HTTP 成功解释为所有模型行为均符合预期。

## 根因

- `src/main/data-plane/chat-data-plane.ts`：仅为 `keyScope === current` 的 Bot 保留 shared；createChat 对 other 范围拒绝创建。
- `src/renderer/features/bots/bot-directory-model.ts`：团队共享计数和过滤要求 current，Provider 资源入口也排除 other。
- 这是当前 CONTEXT 中“共享属于同 Key 范围”的显式规则。此次仅测试和记录，没有擅自更改领域合同或放开 Session 历史分组。

后续最小修复应把“Provider 已授权可见的共享 Bot”作为团队发现和新建任务依据，保留本机 Managed 配置权威及 Session 归属边界；无需先引入复杂组织权限系统。实施前须同步修订现有共享领域定义和验收。

## 清理

- Agent A：`agent_REDACTED_07`。
- Agent B：`agent_REDACTED_08`。
- 两个测试 Agent 按百炼正式 archive 协议归档，HTTP 200，读回确认 archived_at；不是物理删除。
- Session `sesn_REDACTED_02`、`sesn_REDACTED_03` 删除返回 200，再读均为 404。
- 已移除两条临时连接、对应加密凭据与临时 Managed scope；原有连接、资源、凭据保留。主应用恢复原 Bailian 连接并重载。
- 没有新建 Environment，没有产品代码变更。

## 后续修复

上述应用限制已修复；最终行为与真实回归见 [修复验收](bot-sharing-cross-key-fix-2026-09-29.md)。本页保留修复前的复现事实。
