# 跨 Key 共享修复验收

> 公开版本已将真实远程资源 ID 替换为占位符；相同占位符表示同一资源，不可用于 API 请求。

日期：2026-09-29。前置复现见 [双 Key 实测](bot-sharing-cross-key-2026-09-29.md)。

## 根因与修复

实测两个百炼 Key 在指定业务空间均能从云端读取对方共享 Bot 并创建 Session。应用却把 Key 指纹的归属分组当成共享的必要条件：Main 去掉其他 Key 的 shared，Renderer 目录和任务候选再过滤，shell 把所选 Bot 判为不可用，Main createChat 最终拒绝。这组规则完整解释了“云端可见、应用不可见且不可发起任务”。

现改为 Provider 返回的精确共享标记决定团队发现与新建任务，不要求共享 Bot 属于当前 Key。所有相关入口一致修复，包括管理页数量、候选范围、已选 Bot 校验与 Main 新建入口。接收方无本机管理资料时仍为 Remote-only；创建出的 Session 仍写入发起者的 Key 标记。

其他 Key 的未共享 Bot 继续不进入新任务候选且不能新建；取消共享后接收方刷新移除候选，但已创建的本 Key Session 仍能使用。Session 的列表、详情、发送与其他操作继续验证当前 Key，Bot/Chat 身份、Provider 权限及 IaC 权威未改变。CONTEXT、架构、接口、验收规范与使用指南同步更新。

## 自动化

`pnpm gate` 完整通过：63 个文件通过、12 个文件按既有条件跳过；613 项通过、17 项跳过。包含类型检查、lint、架构检查、构建、Electron 打包和 packaged smoke。`git diff --check` 通过，SDK 工作区未修改。目标生产文件小于 800 行，测试小于 1000 行。

重点覆盖跨 Key 共享发现、新任务使用创建者标记、取消共享后拒绝新建、选择失效时保留草稿，并继续运行原有 Session 跨 Key 访问拒绝测试。旧测试中限定同 Key 的共享预期已按新合同修订，未删除 Session 隔离断言。

## 真实应用验证

使用最终构建的 Electron 应用，独立 userData，用户提供的两个 Key 分别配置为 Key A、Key B。全流程通过 computer use 操作真实页面；资源带唯一名称及 `openagentbot_test: cross-fix-0929`。没有使用 UI 替身或假响应。

| 场景 | 结果 |
| --- | --- |
| A 创建并共享，B 刷新候选并选择 A Bot | 通过 |
| B 使用 A Bot 新建任务、发送并收到回复 | 通过 |
| B 创建并共享，A 刷新候选并选择 B Bot | 通过 |
| A 使用 B Bot 新建任务、发送并收到回复 | 通过 |
| 接收方管理页展示共享 Bot，未显示本机共享/编辑控制 | 通过 |
| 切换 Key 后最近任务不包含另一 Key 创建的任务 | 通过 |
| A 取消共享，B 刷新后 A 不再出现在团队候选 | 通过 |
| B 打开取消前创建的任务，历史恢复且续问收到回复 | 通过 |

远程 Session metadata 独立核对：A 创建的 B Bot Session 归 A，B 创建的 A Bot Session 归 B；两者最终 idle。模型均返回了普通问候而非预设测试 marker，因此本轮证明共享发现、真实发送与历史边界，不将模型指令符合性计为通过。

本次为同 Mac、同百炼业务空间、两个不同 Key 的真实切换；不推断任意不同空间可互访。本轮没有新增 Qoder 跨 Key 的真实验证，Qoder 共用逻辑由自动化覆盖。

## 清理

- A Bot：`agent_REDACTED_09`；B Bot：`agent_REDACTED_10`。
- B 的 Session：`sesn_REDACTED_04`；A 的 Session：`sesn_REDACTED_05`。
- 两个 Session 删除成功并读回 404；两个 Bot 通过百炼正式 archive 接口归档，读回 archived_at 确认，不声称物理删除。
- 无新建 Environment；隔离 userData、加密凭据副本与临时 Managed 资料已删除。用户日常连接和资源未改动。
