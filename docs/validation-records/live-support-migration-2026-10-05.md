# live 支撑模块与真实 Cloud 全量验收记录（2026-10-05）

## 范围

覆盖本轮测试改造的最后一环：`tests/live/support/*` 八个支撑模块（credentials/endpoints/naming/rest/cleanup/project/multi-agent/sse-gate 及对应单测）、12 个 live 文件迁移到共享支撑模块、renderer 全局 act 环境与挂载入口。本文只记录真实 Cloud 运行结果、两个失败根因、资源清理与遗留状态；离线改造细节见 test-pruning-campaign-2026-10-04.md。

真实 Cloud 凭据使用仓库现有 `.env`（`QODER_PAT`、`DASHSCOPE_API_KEY`、`BAILIAN_WORKSPACE_ID`）。本窗口初 Qoder 腿全部被 `401 TOKEN_INVALID` 阻塞，用户重置 `QODER_PAT` 后以 `GET /agents?limit=1 → 200` 验证解除，随后完成全部 Qoder 真实运行。全程未输出、未修改、未提交凭据。

## 真实 Cloud 运行矩阵

统一命令形态：`OPENAGENTBOT_LIVE=1 pnpm vitest run <file> --no-file-parallelism [-t <provider>]`。

| 运行       | 文件 / 腿                                                     | 结果                                      | 用时   |
| ---------- | ------------------------------------------------------------- | ----------------------------------------- | ------ |
| Bailian 批 | bailian-provider-contract + bailian-multi-agent-collaboration | 2 passed                                  | 89.4s  |
| Bailian 批 | shared-environment（Bailian 腿）                              | passed                                    | —      |
| Bailian 批 | bot-archive（Bailian 腿）                                     | passed                                    | —      |
| Bailian 批 | bot-edit-session-version（Bailian 腿）                        | 失败×2（240s 超时，见根因一）             | 284.7s |
| Qoder 链   | qoder-connection                                              | 1 passed                                  | ~2s    |
| Qoder 链   | qoder-chat-write                                              | 1 passed                                  | —      |
| Qoder 链   | bot-sharing（Qoder 腿）                                       | 1 passed                                  | —      |
| Qoder 链   | bot-archive（Qoder 腿）                                       | 1 passed                                  | —      |
| Qoder 链   | bot-edit-session-version（Qoder 腿）                          | 1 passed                                  | —      |
| Qoder 链   | qoder-bot-create                                              | 1 passed                                  | —      |
| Qoder 链   | qoder-bot-update                                              | 1 passed                                  | —      |
| Qoder 链   | qoder-data-plane                                              | 2 passed                                  | —      |
| Qoder 链   | qoder-multi-agent-collaboration                               | 1 passed（25s 完成完整协作）              | —      |
| Qoder 链   | shared-environment（Qoder 腿）                                | 主体通过，afterAll 断言失败×1（见根因二） | ~3min  |
| 修复后     | bot-edit-session-version（Bailian 腿）                        | 1 passed                                  | 10.1s  |
| 修复后     | shared-environment（双 Provider）                             | 2 passed                                  | 11.0s  |

12 个 live 文件全部至少一次真实绿色运行；无 mock 参与（凭据校验在 describe 顶层强制，断言消费真实 API 响应）。当日平台空闲、Qoder/Bailian 均为秒级响应，快速通过经证据 JSON 核实为真实行为（例：multi-agent 证据 `openagentbot-v2ma-20261005010002-bo0rx7pm`，coordinator/worker/decoy 三个 Agent 与环境、Session、事件直方图、`childThreadAgentMatchedWorker=true`、`sseStreamErrors=[]` 齐备）。

## 根因一：bot-edit-session-version Bailian 腿确定性超时（历史 bug，非迁移回归）

`git diff` 逐字节核对迁移保真后，加临时取证日志实跑定位：

- 该测试在 `dec4ad8` 把新 Session marker 从 `BAILIAN_EDIT_V2_OK` 改名为 `BAILIAN_EDIT_OK`，但 Bailian 轮询闭包里的正则 `/BAILIAN_EDIT_V[12]_OK/` 未同步改名。新 marker 不含 `V`+数字，正则结构性无法命中，新 Session 腿必然走满 240s 超时。Qoder 腿用 `text.includes(afterMarker)` 匹配，因此从未暴露。
- 取证实跑证据：新 Session（`sesn_01M44SF56EYMEZ2MBB8142N57Z`）第一个 assistant 回复就是 `BAILIAN_EDIT_OK`——模型第一轮即合规，是轮询看不见它；同时每秒一次的重发在 240s 内灌入 30+ 条未获回复的 `Respond now.`（仅 8 个 model_request，最后一个悬挂），加重服务端排队。
- 该文件自创建（`4509dd0`，2026-09-20）以来没有绿色验收记录，此 bug 一直存在。
- 修复：`historyText(sessionId, marker)` 改为按各自期望 marker `includes` 匹配（old 用 `beforeMarker`、new 用 `afterMarker`），保留原有「轮询时重发一次」语义与 240s 窗口。修复后 Bailian 腿 10.1s 通过，双 Session 均在第一轮回出 marker。
- 取证日志已全部移除；probe 运行创建的资源由测试自身 afterAll 清理（Bailian 清单复核 agents/environments/sessions 均无当日残留）。

每秒重发的节奏保留原样：marker 命中正常时数秒内终止，实测无危害；本次只修根因，不顺手调节奏。

## 根因二：shared-environment afterAll 残留断言撞列表最终一致性（flake）

Qoder `DELETE` 返回成功后，列表接口短窗口内仍返回该资源；原 afterAll 立即断言「活动清单无本次资源」，偶发误报（实测一次：断言时刻清单仍含本前缀环境，数秒后消失）。修复为两个 Provider 的残留断言统一走 `pollUntil` 有界重试（20s 预算、2s 间隔，每次轮询重新拉取三个清单），先等清单收敛、再逐项断言，保留精确失败信息。修复后双 Provider 腿 11.0s 通过。

## 资源清理与 Provider 协议执行

- `openagentbot-arch-q-20261005005906-am4q0o3c-environment`（`env_00rgjiud8rl6p3ekk22g`，bot-archive Qoder 腿静默清理路径遗留）：`DELETE` 返回 409 `Environment ... is in use and cannot be deleted: 1 session still reference it. Archive the environment instead.` → 按 Provider 正式协议 `POST /environments/{id}/archive` 返回 200 归档。
- 两个 2026-09-20 遗留 Bailian 环境（`ocb-probe-5c12663e-env`、`ocb-arch-b-20260920081946-912zts-environment`）：`DELETE` 200 清除。
- 最终残留核查（测试前缀过滤）：Qoder agents/environments/sessions 与 Bailian agents/environments/sessions 均为 NONE。
- `shared-environment` 的 EnvironmentControlPlane 对既有未归档环境返回 `selection-required` 的合同，依赖账号存在多个未归档环境；归档 arch-q 后仍满足。

## 已知限制

- 快速通过依赖当日空闲平台，不代表高峰期时延；live 超时预算（如 240s/480s）按原文件保留。
- pending（sync 失败→重试恢复）语义无法经真实 Provider 确定性触发，继续由控制面单元测试覆盖。
- 打包验收不在本轮范围；离线门禁结果见下节。

## 离线门禁

`pnpm gate` 通过（未设置 `OPENAGENTBOT_LIVE`，live 用例显式跳过）：prettier、typecheck、lint、73 个测试文件（678 项测试通过、17 项显式 Cloud 跳过）、架构检查、macOS arm64 打包与 packaged smoke 全部绿色。打包未做签名与跨平台验证，与前述记录口径一致。
