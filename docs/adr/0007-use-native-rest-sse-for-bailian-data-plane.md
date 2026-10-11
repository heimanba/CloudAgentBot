# ADR-0007：Bailian 数据面使用原生 REST/SSE

状态：已接受

Bailian AgentStudio 数据面由 Electron Main 内的自有 Adapter 直接使用官方 REST/SSE 合同，不引入 Python/Java sidecar，也不复用控制台的 SEC_TOKEN 网关。官方没有 Managed Agents Node/TypeScript SDK；原生 Adapter 能保持现有两进程拓扑、凭据边界和 `ChatAdapter` seam，并把 Bailian 分页、Event wire、delta 聚合、断线补拉与错误归一化集中在 Provider Module 内。
