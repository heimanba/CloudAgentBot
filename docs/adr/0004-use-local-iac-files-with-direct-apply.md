# ADR-0004：以本地 IaC 文件为权威并直接同步

状态：已接受

每个 Managed Bot 使用独立 `agents.yaml` 与 `agents.state.json`：前者是期望配置，后者是远程资源映射账本。创建或编辑时先原子保存 `agents.yaml`，再通过 SDK 执行语义等价于 `apply -f` 的直接 Sync，不建立 plan 预览、pending/current 双槽或通用 Operation。只有 `phase=new` 的 scope 可以在无 state 时首次创建；一旦进入 `applying`，state 缺失就停止写操作，因为真实 Qoder 验证已证明无 state 重新 apply 可能重复创建 Agent。
