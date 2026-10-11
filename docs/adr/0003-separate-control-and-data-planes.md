# ADR-0003：分离 Agent 控制面与 Chat 数据面

状态：已接受

Agent 的创建、更新与重新同步属于控制面，统一使用 `@openagentpack/sdk` 的 IaC Interface；Session、Message、历史和流式观察属于数据面，使用 Provider 原生 Client Adapter。两者只共享 Connection 与远程 Agent ID，控制面类型、Project Document、state 和 Provider wire object 不跨越各自 Interface。
