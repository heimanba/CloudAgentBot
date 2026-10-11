# Managed Agent Environment 共享与生命周期合同调研

日期：2026-09-19

## 问题与结论

本调研只使用 Qoder、阿里云百炼官方文档，以及当前仓库依赖的 OpenAgentPack SDK 公共类型与实现。结论中的“明确合同”和“推论”刻意分开。

1. **Environment 不是 Agent 的子资源。** 两家 Provider 都把 Environment 暴露为独立的顶层资源；创建 Session 时分别提交 Agent 标识和一个已经存在的 `environment_id`。Agent 创建合同本身不包含 Environment 绑定。因此，把一个 Environment 绑定到某个 Bot 并不是 Provider 的领域约束。[Qoder 创建 Environment](https://docs.qoder.com/cloud-agents/api/environments/create)；[Qoder 创建 Session](https://docs.qoder.com/cloud-agents/api/sessions/create)；[百炼创建 Environment](https://help.aliyun.com/zh/model-studio/environment-create)；[百炼创建 Session](https://help.aliyun.com/zh/model-studio/session-create)；[百炼创建 Agent](https://docs.bailian.console.aliyun.com/zh/model-studio/agent-create)
2. **Environment 的远程作用域高于单个 Agent/Session。** 百炼明确称列表返回“当前工作空间”下的 Environment，并规定 `scope=organization` 时“工作空间全部成员可见与复用”。Qoder 列表合同称返回“current account”下的 Environment；其 Session 指南又说明 Environment 可见性受目标 workspace 中认证主体权限约束。因此，产品上最保守且跨 Provider 一致的边界是：Environment 属于一条 Connection 所指向的远程 account/workspace，而不是属于 Bot。[百炼列出 Environment](https://help.aliyun.com/zh/model-studio/environment-list)；[百炼创建 Environment](https://help.aliyun.com/zh/model-studio/environment-create)；[Qoder 列出 Environment](https://docs.qoder.com/cloud-agents/api/environments/list)；[Qoder Sessions](https://docs.qoder.com/cloud-agents/sessions)
3. **同一 Environment 可被多个 Session 复用；多个 Agent 也可通过各自 Session 选择同一 Environment。** “多个 Session 复用”由 Session 创建合同的独立 `environment_id` 引用直接支持；“多个 Agent 复用”是由同一个 Environment ID 可与不同 Agent ID 独立组合得到的合同推论，而非官方文档中逐字写出的配额承诺。两家文档均未规定 Environment 与 Agent 是一对一关系。[Qoder 创建 Session](https://docs.qoder.com/cloud-agents/api/sessions/create)；[百炼创建 Session](https://help.aliyun.com/zh/model-studio/session-create)
4. **创建 Session 不会创建 Environment。** 两家的 `POST /sessions` 都要求调用方传入既有 `environment_id`；百炼还明确说明创建 Session 前需先有 Agent 和 Environment。Environment 通过独立的 `POST /environments` 创建。[Qoder 创建 Session](https://docs.qoder.com/cloud-agents/api/sessions/create)；[百炼创建 Session](https://help.aliyun.com/zh/model-studio/session-create)
5. **OpenAgentPack 已公开支持引用外部 Environment。** 公共 `EnvironmentDecl.environment_id` 的注释规定：传入已有 Provider Environment ID 后，将其视作外部引用，不执行远端创建、更新或删除。执行器也只把 ID 记入 state，不产生远程 mutation。这允许 Managed Bot 的 `agents.yaml` 引用 Connection 已选定的共享 Environment，无需新增 SDK 能力。[SDK 公共导出](../../../../../OpenAgentPack/packages/sdk/src/index.ts)；[`EnvironmentDecl`](../../../../../OpenAgentPack/packages/sdk/src/internal/types/config.ts)；[执行器外部引用分支](../../../../../OpenAgentPack/packages/sdk/src/internal/executor/executor.ts)

## Provider 合同对照

| 语义         | Qoder                                                                                             | 阿里云百炼                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 资源作用域   | `GET /environments` 列出 current account 下的环境；实际可见性受目标 workspace 的 PAT/SAT 权限控制 | `GET /environments` 列出当前工作空间环境；创建时 `scope` 默认 `organization`，该值表示工作空间全部成员可见与复用 |
| 创建         | `POST /api/v1/cloud/environments`；`name` 必填，`config` 默认 cloud                               | `POST /environments`；`name` 是工作空间内唯一标识；`scope` 默认 `organization`                                   |
| 获取         | `GET /api/v1/cloud/environments/{environment_id}`                                                 | `GET /environments/{environment_id}`                                                                             |
| 列出         | 游标分页；默认排除归档项；`include_archived=true` 可包含                                          | 游标分页；默认排除归档项；`include_archived=true` 可包含                                                         |
| Session 绑定 | `POST /sessions` 必填 `agent` 与“Existing Environment ID”                                         | `POST /sessions` 必填 `agent` 与 `environment_id`；创建前需已有 Agent 与 Environment                             |
| 归档         | 归档后不能承载新 Session；已有 Session 不受影响；操作幂等                                         | 软归档；默认列表隐藏但仍可 GET；已绑定 Session 继续可用                                                          |
| 删除         | 硬删除；若仍被 Session 或 tool call 引用，返回 409，并明确建议改为 archive                        | 硬删除、不可恢复；官方页面没有说明被 Session 引用时的状态码或行为                                                |

来源：[Qoder Get](https://docs.qoder.com/cloud-agents/api/environments/get)、[List](https://docs.qoder.com/cloud-agents/api/environments/list)、[Create](https://docs.qoder.com/cloud-agents/api/environments/create)、[Archive](https://docs.qoder.com/cloud-agents/api/environments/archive)、[Delete](https://docs.qoder.com/cloud-agents/api/environments/delete)、[Session Create](https://docs.qoder.com/cloud-agents/api/sessions/create)；百炼 [Get](https://docs.bailian.console.aliyun.com/zh/model-studio/environment-get)、[List](https://help.aliyun.com/zh/model-studio/environment-list)、[Create](https://help.aliyun.com/zh/model-studio/environment-create)、[Archive](https://docs.bailian.console.aliyun.com/zh/model-studio/environment-archive)、[Delete](https://help.aliyun.com/zh/model-studio/environment-delete)、[Session Create](https://help.aliyun.com/zh/model-studio/session-create)。

## 对最小产品设计的直接含义

Provider 合同不要求为 Environment 再发明一个独立本地资源管理子系统。最小模型可以只有：

```text
Connection
  └─ defaultEnvironmentId
       ├─ Managed Bot A 的新 Session
       └─ Managed Bot B 的新 Session
```

- Connection 保存一个已选择的远程 `environment_id`。
- 新建 Connection 时列出远程 Environment：有现成环境则选一个；没有则创建一个，然后保存其 ID。
- 新建 Managed Bot 时，在它自己的 Project Document 中用 OpenAgentPack 的 `environment_id` 外部引用表达该绑定。
- 新建 Session 时直接使用该 ID；不创建新 Environment，也不按名称动态猜测。
- 删除 Bot、Session 或 Connection 时不联动删除共享 Environment。需要删除时应当作为独立、显式的远端资源操作处理。

上述方案只引入一个 Connection 字段和一次设置流程，不需要第一阶段实现 ownership 枚举、Bot 级 override 或本地 Environment 列表缓存。OpenAgentPack 已保证外部引用不会被 Project 的 apply/destroy 修改或删除。

## 尚未被文档完全回答的问题

以下不能从官方合同中继续推断，必须留给真机验证或产品保守处理：

1. **百炼删除一个仍被 Session 引用的 Environment 会返回什么。** 官方删除页面只描述硬删除成功响应，没有列出引用冲突。当前 OpenAgentPack 百炼适配器也只是直接调用 `DELETE /environments/{id}`，没有像 Qoder 适配器那样实现 409 后的 session 扫描或 archive fallback。[百炼删除 Environment](https://help.aliyun.com/zh/model-studio/environment-delete)；[OpenAgentPack 百炼适配器](../../../../../OpenAgentPack/packages/sdk/src/internal/providers/bailian/adapter.ts)
2. **百炼归档后的 Environment 能否创建新 Session。** 官方只明确“已绑定的会话继续可用”，没有明确写出新 Session 必然被拒绝。产品应把归档项视为不可选择；若要依赖具体错误码，需要真机验证。[百炼归档 Environment](https://docs.bailian.console.aliyun.com/zh/model-studio/environment-archive)
3. **Qoder 文档中 account 与 workspace 的精确层级。** Environment 列表页使用 current account，Session 指南又说明权限面向 target workspace。对 OpenAgentBot 来说无需引入更大的全局身份：按 Connection 隔离绑定即可避免跨凭据或跨 workspace 错绑。[Qoder 列出 Environment](https://docs.qoder.com/cloud-agents/api/environments/list)；[Qoder Sessions](https://docs.qoder.com/cloud-agents/sessions)

## 真实 Cloud 验证

2026-09-19 使用仓库 `.env` 中的 Qoder 与百炼测试凭据运行
`tests/live/shared-environment.live.test.ts`。所有资源使用唯一前缀与测试 metadata；测试结束后删除
Session、删除或归档 Agent，并删除 Environment。测试没有输出或修改凭据。

验证结果：

1. **跨 project 复用成立。** 两家 Provider 均成功让两个独立 OpenAgentPack project 通过同一个 `environment_id` 创建各自 Agent；两个 Agent 创建的 Session 均返回该 Environment ID。这把“多个 Agent 可复用”从合同推论提升为真机证据。
2. **OpenAgentPack 外部引用成立。** 第二个 project 使用 `EnvironmentDecl.environment_id` Sync 成功，state 记录同一远程 ID，没有创建第二个 Environment。
3. **百炼引用中硬删除没有保护。** 在两个 Session 仍引用 Environment 时调用 `DELETE /environments/{id}`，真实服务返回 HTTP 200。产品不得依赖 Provider 的引用冲突保护，也不应让删除 Bot、Session 或 Connection 级联删除共享 Environment。
4. **百炼归档阻止新 Session。** Environment 归档后，以该 ID 创建新 Session 返回 HTTP 404；归档前创建的两个 Session 仍可读取，并继续返回原 `environment_id`。
5. **清理已验证。** 持久化 live 测试使用归档路径验证既有 Session，再删除 Session、归档 Agent、删除 Environment；清理请求失败会使测试失败，不吞掉错误。

因此，上节前两项文档空白已有真机答案；它们仍保留在原位置，以区分“官方合同未写明”和“OpenAgentBot 已实测”的证据层级。

## OpenAgentPack 外部引用细节

公共类型定义如下（摘述，不复制实现）：

```yaml
environments:
  shared:
    environment_id: env_xxx
    config:
      type: cloud
```

- `environment_id` 是公共 `EnvironmentDecl` 的可选字段，不需要从 `internal` 路径导入任何符号。[SDK 公共导出](../../../../../OpenAgentPack/packages/sdk/src/index.ts)
- 字段存在时，执行器记录 `{ id: environment_id, type: "environment" }`，跳过远程 mutation。[执行器](../../../../../OpenAgentPack/packages/sdk/src/internal/executor/executor.ts)
- Planner 将它标记为 externally managed；若之后只删掉 `environment_id`，会拒绝把外部资源静默转成项目自管资源，避免误更新或误删。[Planner](../../../../../OpenAgentPack/packages/sdk/src/internal/planner/planner.ts)
- 从原先项目自管 Environment 切换到另一个外部 ID 时，Planner 会警告旧的自管 Environment 将成为未跟踪资源。因此现有 Bot 的迁移不能等同于新 Bot 的默认行为，应单独验证和处理。[Planner](../../../../../OpenAgentPack/packages/sdk/src/internal/planner/planner.ts)
