# ADR-0002：Bot 与 Chat 直接使用 Provider 资源身份

状态：已接受

Bot 直接对应远程 Agent，Chat 直接对应远程 Session，不生成额外本地主键。为支持同 Provider 多账号和未来多 Provider，Bot 使用 `connectionId + agentId`，Chat 使用 `connectionId + agentId + sessionId`；Chat、Message 和历史只从 Provider 读取，不进入本地持久化。
