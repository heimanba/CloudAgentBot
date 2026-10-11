# ADR-0008：Connection 绑定共享 Environment

状态：已接受

## 背景

Qoder 与百炼都把 Environment 暴露为账号或 Workspace 下的顶层资源。创建 Session 时显式传入 Agent ID 与已有的 Environment ID，Environment 不属于单个 Agent。真实 Cloud 验证进一步证明，两家 Provider 均允许两个独立 IaC project 的 Agent 与 Session 复用同一个 Environment。

当前实现为每个 Managed Bot 声明并创建一个 `<Bot名称>-environment`，把远程共享资源错误收窄成 Bot 附属资源，也会随 Bot 数量制造重复 Environment。

## 决策

每条 Connection 保存一个可选的 `defaultEnvironmentId`，其身份为 `Connection + remoteEnvironmentId`。不新增本地 Environment 实体、ownership 枚举、Environment 缓存、Bot 级覆盖或 Environment 管理页面。

新建 Connection 完成凭据验证后设置默认 Environment：

- 没有未归档 Environment 时，创建一个带 CloudAgentBot metadata 的默认 Environment 并绑定；
- 只有一个未归档 Environment 时，直接绑定；
- 有多个未归档 Environment 时，让用户选择一个，不按名称猜测。

如果 Environment 设置失败，保留已验证的 Connection，但不允许创建 Managed Bot 或新 Chat，并允许用户重试设置。

新建 Managed Bot 的 Project Document 通过 OpenAgentPack 公共 `EnvironmentDecl.environment_id` 引用 Connection 的默认 Environment。该引用是 externally managed，Bot Sync 不创建、更新或删除远程 Environment。Managed Bot 创建 Chat 时仍可从自己的 state 取得所引用的 remote ID；remote-only Bot 使用 Connection 默认 Environment。

现有 Managed Bot 不自动迁移，继续使用各自 state 中的 Environment。新建 Bot 才采用共享绑定。删除 Bot、Session、断开或遗忘 Connection 都不删除 Environment；首版不提供 Environment 删除操作。

## 理由

该方案只增加一个 Connection 字段和一次设置流程，复用现有 Provider 列表/创建 API、OpenAgentPack 外部引用与 Managed Bot state。它避免引入独立 Environment 控制面，同时保留未来把默认绑定提升为显式 Project 设置的可能。

删除必须与普通资源生命周期解耦：Qoder 在 Environment 被引用时返回 409，但百炼真机会在仍有 Session 引用时返回 200 并直接删除，不能依赖 Provider 提供统一保护。

## 后果

- 同一 Connection 下的新 Managed Bot 默认共享 Environment。
- Connection 默认 Environment 被远端删除或归档时，新建 Bot/Chat 失败；首版不自动替换、不重新绑定，也不批量改写现有 Managed Bot。
- 修改 Bailian Workspace ID 后原绑定失效，必须重新设置 Environment。
- 若未来需要隔离工作区，再引入明确的 Project 或 Bot override；首版不预建该抽象。

证据见 [`environment-sharing-provider-contract.md`](../research/environment-sharing-provider-contract.md) 与 `tests/live/shared-environment.live.test.ts`。
