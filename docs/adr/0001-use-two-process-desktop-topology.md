# ADR-0001：使用 Renderer 与 Electron Main 两进程拓扑

状态：已接受

CloudAgentBot 只使用 Renderer 与 Electron Main 两个运行进程：Renderer 负责交互，Main 负责桌面特权、凭据、控制面和数据面。Preload 是固定安全 Interface 的 Adapter，不是第三个业务层；不建立独立 Background、生命周期 Kernel 或 Main–Background 协议，因为 Chat 与 Message 不在本地持久化，也不要求退出后的本地后台恢复。
