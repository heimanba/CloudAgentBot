# ADR-0006：CloudAgentBot 自有 Provider 数据面

状态：已接受

## 背景

OpenAgentPack 的核心职责是用声明式配置管理 Agent Harness 资源。CloudAgentBot 的后续产品能力将主要围绕 Session、Event、Message 与 SSE 演进。如果通过 OpenAgentPack 的公共数据面入口使用这些能力，每次产品演进都需要同时修改两个仓库，产品知识和验证证据会被拆散。

## 决策

OpenAgentPack 只作为本客户端的资源控制面依赖，负责 Project Document、state、apply 与 sync。CloudAgentBot 在 Electron Main 内拥有 Qoder HTTP、SSE、Session、Event、Message、分页和错误转换实现。

`ChatAdapter` 是产品数据面的 seam。Qoder wire 类型只存在于 `src/main/data-plane/providers/qoder/`，并在 `QoderChatAdapter` 中转换成 Chat、Message 与 ChatEventView。Renderer、shared 和 DesktopHost 不感知 Provider wire schema。

Provider 继续拥有 Session、Event、Message 和运行结果的事实权威。自有代码不意味着本地持久化这些对象；重载和断线后仍重新读取 Provider 历史。

## 理由

- Session/Event/SSE 是 CloudAgentBot 的主要产品变化方向，把实现与测试留在同一仓库可提高 locality。
- OpenAgentPack 不需要为单个桌面产品维持 provider-specific 公共入口。
- 小型 ChatAdapter Interface 可以隐藏 Qoder 协议复杂度，同时避免把假想的多 Provider 差异固化成通用框架。

## 后果

- CloudAgentBot 独自承担 Qoder 与 Bailian 数据面协议变化与维护成本，并通过合同测试和真实 Cloud smoke 防止漂移。
- 控制面仍通过 `@openagentpack/sdk` 公共 Interface 使用；数据面禁止导入该 package。
- 不创建新的 workspace package，不复制 OpenAgentPack 的完整 provider adapter，只实现实际使用的最小 wire 合同。
- 取代 `interfaces.md` 与 `repository-layout.md` 中优先公开 `@openagentpack/sdk/qoder-data` 的旧默认选择；历史 Stage 03 执行事实保留但不再代表当前架构。
