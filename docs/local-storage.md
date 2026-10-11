# 本地存储

## 数据分类

| 数据                     | 位置                                        | 权威         |
| ------------------------ | ------------------------------------------- | ------------ |
| Connection 元数据        | `connections.json`                          | 本地         |
| Provider 凭据            | OS Keychain 或 safeStorage 加密文件         | 本地安全存储 |
| Managed Bot 期望配置     | `agents.yaml`                               | 本地         |
| OpenAgentPack 资源映射   | `agents.state.json`                         | 本地         |
| Bot 当前实际状态         | Provider                                    | 远程         |
| Chat、Message、历史      | Provider                                    | 远程         |
| 查询缓存与流式增量       | Renderer/Main 内存                          | 可丢弃       |
| 主题、最近访问和窗口偏好 | Renderer localStorage/Electron window state | 可丢弃偏好   |

首版不使用 SQLite。

协作成员（roster）不是独立数据类别：它只作为 Managed Bot 期望配置的一部分存在于 `agents.yaml` 与其配对 backup 文本中；不新增 roster 文件、成员清单、索引、缓存或数据库。成员是外部引用，不出现在 `agents.state.json`——该 state 只记录当前 scope 拥有的资源，即当前 Bot 自己。

## 目录

```text
<app.getPath("userData")>/v2/
  connections.json
  credentials.enc                 # 仅 safeStorage 实现需要
  managed-bots/
    <connection-id>/
      <stable-scope>/
        manifest.json
        agents.yaml
        agents.state.json
        backup/
          agents.yaml
          agents.state.json
```

`stable-scope` 使用随机稳定 ID，不从可修改的 Bot 名称生成。目录扫描是 Managed Bot 的索引；首版不维护额外全局 managed-agent 表或索引文件。

## Connection Schema

```ts
interface ConnectionsFile {
  version: 1;
  connections: Array<{
    id: string;
    provider: string;
    displayName: string;
    credentialKey: string;
    /**
     * 该 Connection 已绑定并可直接用于 Bot/Chat 创建的 Provider Environment remote ID。
     * 仅在 setupEnvironment 返回 ready 后写入；缺失表示尚未完成运行环境设置。
     * Bot 与 Chat 的创建使用该值，不做 Provider 侧探测或名称猜测。
     */
    defaultEnvironmentId?: string;
    /** 百炼 Workspace remote ID；qoder 连接无此字段。 */
    workspaceId?: string;
  }>;
}
```

原始凭据不进入该文件。`defaultEnvironmentId` 是 Provider 资源的 remote ID，不是密钥；
它记录「该 Connection 的运行环境已设置完成」这一事实，写入与清除由
ConnectionManager.setupEnvironment 与 Workspace 变更的原子更新负责。
`workspaceId` 变更时必须与新凭据一起原子写入，并在同一次写入中清除
`defaultEnvironmentId`（Workspace 变化后旧 Environment 引用不再可信）。

若使用 Electron `safeStorage`，`credentials.enc` 只保存加密 blob；`safeStorage` 负责加解密而不负责文件持久化。

## Manifest Schema

```ts
interface ManagedBotManifest {
  version: 1;
  scope: string;
  connectionId: string;
  provider: string;
  projectName: string;
  phase: "new" | "applying" | "managed";
}
```

Manifest 不复制远程 Agent ID。Agent ID 由 OpenAgentPack 的公共只读结果获得；不得为方便而解析 `agents.state.json` 的内部 Schema。若 SDK 缺少所需公共读方法，应先补公共 Interface。

## 原子写

应用自己管理的 JSON/YAML 文件使用同目录临时文件、flush 和 rename 原子替换。`agents.state.json` 由 `LocalFileStateBackend` 管理，应用不接管其写入。Main 使用进程内 scope lock 保证同一 scope 单写。

## 配对备份

一次成功 Sync 后，把当时的 `agents.yaml` 与 `agents.state.json` 复制为同一份 backup。恢复只能成对恢复，不能组合不同时间的 Project Document 与 state。

备份是防止本地文件损坏或误删的措施，不是远程事务。恢复旧备份后允许出现对同一 Agent 的重复 update；必须重新 Sync 并等待收敛。

## 完整性矩阵

| 本地文件                           | 分类                    | 允许行为                            |
| ---------------------------------- | ----------------------- | ----------------------------------- |
| phase=new + project，无 state      | 尚未触发远程创建        | 允许一次首次创建                    |
| phase=applying + project + state   | 创建中断但 state 已落地 | 允许用户手动 Sync；成功后转 managed |
| phase=applying + project，无 state | 创建结果不明            | Chat；停止重试和自动认领            |
| phase=managed + project + state    | managed                 | Chat、update、Sync                  |
| project + state，无 manifest       | 中断 scope              | 只读检查，人工修复后才开放写入      |
| phase=managed + project，无 state  | state-missing           | Chat；停止 update/Sync              |
| manifest + state，无 project       | project-missing         | Chat；停止 update/Sync              |
| Provider Agent 存在，本地无 scope  | remote-only             | Chat                                |
| Connection 或凭据缺失              | disconnected            | 展示本地管理资料；停止远程请求      |

首次创建调用 Provider 前必须先把 phase 从 `new` 原子改为 `applying`。只有 `new + project + 无 state` 可以发起无 state 的首次创建；其他 state 缺失情形不得重新 apply、按名称认领或创建替代 Agent。恢复/接管是未来独立产品能力，首版不实现。

## 数据删除

不提供永久删除远程 Agent。Managed Bot 的“归档”是 Provider 侧软归档：只改变远程 Agent 生命周期状态，不删除、不改写、不移动本地 managed scope（`agents.yaml`、`agents.state.json`、manifest 与配对 backup 全部保留）；已归档 scope 仍属于本地 IaC 资料，计入删除本地连接时展示的 managed scope 数量。`disconnect` 只删除 credential，保留 Connection 元数据与 managed scope。`remove` 在产品中称“删除本地连接”：删除 Connection 元数据和 credential，但不删除 Provider 远程资源；存在 managed scope 时，只有用户在破坏性确认中明确授权，才同时删除该 Connection 下的 `managed-bots/` 本地 IaC 资料。未明确授权必须以 `conflict` 拒绝。普通缓存清理不得触及 `managed-bots/` 与 credential store。
