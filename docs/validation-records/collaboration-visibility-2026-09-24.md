# 协作能力展示验证记录（2026-09-24）

## 范围

Bot 当前远程协作成员、Session 创建时成员快照、基于 Provider Thread 事件的只读协作过程，以及 Qoder 子 Thread 状态不会误结束主 Session。

## 本地门禁

- `pnpm gate`：通过，包括 typecheck、lint、完整 Vitest、架构测试、应用打包和 packaged smoke。
- 完整 Vitest：57 个文件、536 个用例通过；11 个文件、15 个用例按条件跳过。
- `git diff --check`：通过。
- 本次端到端复测后 `pnpm lint`、`pnpm typecheck`、完整 `pnpm test` 通过（57 个文件、536 个用例）。

## 真实 Cloud

- 百炼：`OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/bailian-multi-agent-collaboration.live.test.ts --no-file-parallelism` 通过（1/1）。验证协作 roster、Session 快照与真实委派事件，临时资源按测试清理。
- Qoder：`OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/qoder-multi-agent-collaboration.live.test.ts --no-file-parallelism` 通过（1/1）。验证远程 roster 读回、Session 创建与真实 child Thread 创建/跨 Thread 双向消息。测试现按主 Session 实际状态检查 `done`，不再假定 child Thread 空闲表示主 Session 完成。临时 Session 在仍运行时按 Provider cancel 协议处理后删除；临时 Agent 与 Environment 按测试清理。

## 打包应用端到端复测

- `OPENAGENTBOT_LIVE=1 OPENAGENTBOT_PACKAGED_UI=1 pnpm vitest run tests/live/qoder-multi-agent-collaboration.live.test.ts --no-file-parallelism`：通过（1/1）。测试先创建真实 coordinator、成员、Session 并确认 child Thread 双向消息，再启动隔离用户数据的打包 Electron 应用，通过可见 UI 添加 Qoder Connection，检查 Bot 列表“协作”标记与当前成员、Session 列表“协作任务”标记、创建时成员快照和委派工作记录。检查 1024×700、790×650、640×600 下无水平溢出，结束后自动清理 Cloud 资源与本地测试用户数据。
- `OPENAGENTBOT_LIVE=1 OPENAGENTBOT_PACKAGED_UI=1 pnpm vitest run tests/live/bailian-multi-agent-collaboration.live.test.ts --no-file-parallelism`：通过（1/1）。打包应用中点击选择百炼 Provider、手动 API Key 方式和 Workspace，进入完整 Bot 列表，再点击 coordinator、展开远程成员、打开协作 Session、展开工作记录、核对跨线程发送/接收，点击刷新并复查记录。三种窗口尺寸无水平溢出；测试资源自动清理。
- 两家共用的页面检查均实际点击 Bot、成员折叠区、Session、工作记录和刷新按钮。早期 Qoder 检查发现发送/接收事件可能位于不同工作记录分组，因此验证脚本展开全部分组后逐项检查。
- 随后确认并修复上述分组问题：Renderer 原先按 `threadId` 切分连续工作，coordinator 与 child Thread 交替写事件时将一次往返拆开。现在连续协作工作按原始顺序保持在同一折叠组；两家打包应用真机回归均加入“发送与收到位于同组”断言并通过（Qoder 1/1、百炼 1/1）。普通跨 Thread 工具工作仍分别成组。完整单测、typecheck、lint 和重新打包通过。
- `OPENAGENTBOT_LIVE=1 pnpm live:packaged`：通过。覆盖 Connection 验证、Environment 选择、新任务选择 Bot、发送、远程历史重读、工作记录工具、Bot 创建表单协作成员入口、三种窗口尺寸和 Session 删除复查。
- 首次通用脚本失败的原因是测试账号有两个同名“QA助手”，脚本曾只回查第一个 ID；脚本现跟踪全部同名候选并按实际 Session 身份回查。另一个失败是脚本仍点击已移除的“更多配置”入口；现改为直接检查创建表单中的协作成员入口。两次失败期间产生的测试 Session 均已删除，其中一次按专属 marker 核对后手动删除。

## 已知边界

- Session 快照表示创建时可用成员，协作过程表示实际发生的委派；两者不等价。
- Qoder 的事件轨迹目前显示 Provider 事件和 Thread ID，生产 UI 尚未通过 Thread API 把 child Thread 归属到精确 Agent ID；百炼事件仅有 Provider 名称。界面不显示未经验证的“参与成员人数”。
- 三种窗口尺寸已通过真实打包 Electron 的 DOM 可见性与水平溢出断言；仍未做像素级视觉审阅或屏幕阅读器实测。
