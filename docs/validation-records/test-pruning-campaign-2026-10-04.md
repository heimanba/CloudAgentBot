# 全项目 test-pruning campaign 验收记录（2026-10-04）

## 范围与基线

固定基线为 `main@482100f75f4eb2e9ec8ea0298b32ebf576d4a45c`。覆盖全仓 78 个原始测试文件及 live/QA 场景；三个独立审计分组分别负责 Main/shared、Renderer Feature、Shell/Primitive/live。原始台账共 631 个测试声明，参数化用例声明计一次。

最初只读审计期间工作区存在其他改动；用户回复“继续吧”后，以 `.scratch/test-pruning-campaign/resume/start/` 冻结快照为接续起点，并将整个 HEAD→工作区 diff 纳入保真复核。下述整体净变化包含接续前已有修改，不能全部归为本轮新增删减。未提交、推送或创建 PR。

| 指标                        | 固定基线 | 接续起点 | 最终候选 |
| --------------------------- | -------: | -------: | -------: |
| 测试文件                    |       78 |       77 |       77 |
| 通过的测试实例              |      676 |      661 |      648 |
| 显式 Cloud 跳过实例         |       17 |       17 |       17 |
| 测试源码行数                |   21,856 |   21,528 |   21,732 |
| 审计范围内生产/工具源码行数 |   22,482 |   22,443 |   22,423 |
| 测试支持行数                |      359 |      359 |      359 |

最终相对固定基线：测试净减 124 行，生产源码净减 59 行，测试支持净变化 0 行。`git diff --numstat` 中测试 +771/-895、生产 +14/-73、支持 +2/-2；包括局部格式化和恢复必要合同的成本，不把它们伪装成纯删除量。配置/架构守卫/AGENTS 修改另计 +20/-4；本文和完整复制的 autoreview 技能不计入应用代码收益。

## 主要调整与剩余 keeper

| 合同归属                | 删除或归并                                                                                  | 保留/增强的证明                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| EnvironmentControlPlane | 仅测试使用的 factory options、构造器字段及 helper export；默认访问真实云端的旧 tracer       | 通过公开 setup 调用真实 SDK runtime 构造，分别验证 Qoder/Bailian 配置；SDK→Provider 实际协议保留在显式 live suite                     |
| Provider Client/Adapter | createSession、archive/delete 底层重复；导出类型清单与架构源码扫描重复                      | Adapter→真实 Client→假网络的 HTTP/SSE 合同；统一架构守卫承接 `.mts/.cts` 与 `src/internal` 禁止规则                                   |
| Bot 更新与归档          | 重复四字段更新例、内部 store 方法 spy 清单                                                  | 解析 YAML 后验证配置、五份实际文件逐字不变；真实 ScopeLock 排队后改变 state，验证锁内二次检查                                         |
| 本地存储/共享校验       | 重复 prompt 否定、顺序读取、缺字段与空数组例                                                | 独立固定 prompt 字节、成员顺序往返、缺字段参数表；短内容覆盖长文件保持独立测试                                                        |
| Renderer 状态           | 伪 EOF、重复归档弹窗、重复失败列表保留                                                      | 显式 done keeper、AlertDialog 文案/取消零调用、错误前后同一列表；移除仅测试调用的 clearChatRosterCache，保留同一模块 remount 缓存证明 |
| Primitive/页面          | 原生属性透传、自比较、未调用的 ManagedBadge/PROVIDER_OPTIONS、仅测试使用的 data-layout 标记 | 有实际调用者的 UI 行为、冻结 token、历史弹窗定位、表单结构与长标题约束                                                                |

部分 class 断言确实保护冻结视觉，不按“实现细节”一律删除。Portal 存在不能替代定位证明；Shift+Enter/IME 与权限负控必须证明目标路径已进入；静默 SSE 与收到 `done` 的 mock 不是同一合同。相关规则已加入 AGENTS.md。

## 保真复核与故障注入

三个独立 reviewer 将被删合同与 keeper 对照。发现并补回架构扫描差集、静默 SSE 首帧前返回取消函数、Dialog 定位、Button 语义色、Input/Textarea 透明背景、Sheet 方向、Sidebar 标题、Composer、创建/编辑表单和 Skill 弹窗结构。

共 20 项生产行为/视觉 mutation 被目标 keeper 捕获：原子写临时文件清理、归档锁内复核、Bailian workspace 注入、静默 SSE、Dialog 定位、Button 前景色、Input 边框、Input bare、Textarea bare、Sheet 方向、Sidebar 标题、Shift+Enter、IME、remote 管理入口、非当前 Connection 刷新、Overview 横向约束、Composer 边框、Skill gutter、编辑表单间距、创建表单间距。另有 `.mts` SDK 越界与 `.cts` internal import 两项架构探针被执行脚本拒绝。

首轮暴露两类验证问题，均保留原始记录：

- workspace mutation 的筛选名称未匹配参数化测试，实际执行 0 例；改正筛选后捕获故障，未把零测试当成功。
- Input/Textarea 的字符串 contains 会把 `disabled:bg-transparent` 误认为基础 `bg-transparent`；改为 classList 精确 token 后，两项 mutation 均失败。

每次 mutation 在 finally 中核对当前内容并恢复原始字节，记录 SHA-256；架构临时探针已删除。这里验证的是特定缺陷检测能力，不代表所有生产分支均经过 mutation。happy-dom 的结构/token 断言不宣称真实浏览器几何布局验收。

## 验证结果

- 定向验证：22 文件、391 项测试通过。
- 最终 `OPENAGENTBOT_LIVE=0 CSC_IDENTITY_AUTO_DISCOVERY=false pnpm gate` 通过：typecheck、lint、648 项测试、架构检查、macOS arm64 构建打包、packaged smoke 和 4 项真实 Electron/IPC 连接删除验收全部通过。
- 打包显式关闭自动签名，仅证明本机未签名包可用；不代表其他平台或签名发布验证。
- 已运行修改范围格式化并去除部分无关换行变化，核对生成 JavaScript 未改变；`git diff --check` 通过。一次范围格式化产生语法错误，被 typecheck 拒绝，修复后完整门禁重跑通过；失败过程未计为成功。
- 新复制技能中的负向 fixture 有意包含未使用变量，eslint 仅忽略 `.agents/skills/autoreview/tests/fixtures/**`，未改变应用源码检查或修改 vendored 内容。
- 原始基线 gate 的非当前 Connection 测试存在初始化竞态：先记录 0 次调用，初始化后来使其变为 1。keeper 现等待选中连接、loading 完成及实际 Bot 列表，再记录计数；删除生产身份比较的 mutation 被捕获。未修改生产刷新逻辑，不以单次重跑代替修复。

### 独立自动审查

按 autoreview 技能对固定基线到整个工作区执行 `--mode local --base 482100f75f4eb2e9ec8ea0298b32ebf576d4a45c --max-priority P2`。默认 `gpt-6-sol` 及访问失败回退未完成，首次状态为 `reviewer_unavailable`；保持隔离设置，使用本机已配置的 `gpt-6-astra` 重试，5 批审查全部完成。

最终状态为 `findings`，共一项 P2，不能称为 scoped-clean。应用剪枝变更未报告 P0–P2 问题；发现位于完整复制的 `.agents/skills/autoreview/scripts/autoreview:1703`：流式子进程关闭 stdout/stderr 后，进入无界 `proc.wait()`，不再检查配置的 deadline。使用关闭两个输出流后睡眠 1.5 秒的有界子进程复现：配置 deadline 0.15 秒，实际等待 1.637 秒且返回 0。

该项属于复制的上游审查工具，非应用剪枝引入的产品逻辑，作为上游后续修复项保留；本轮不分叉其实现。复制目录与来源逐文件一致。完整审查报告位于 `/Users/mamba/.codex/autoreview-oab-astra-cfo6qlke/review.md`，状态 sidecar 为同目录 `status.json`；本地复现证据为 `.scratch/test-pruning-campaign/resume/autoreview-timeout-reproduction.json`。

## 限制与后续项

真实 Cloud 本次未启用。旧 tracer 用虚构 `probe` 凭据访问 Qoder 并期望 401，不是可靠的离线 gate；其临时目录未交给 SDK，空目录断言也不能证明 SDK 不落盘。退休后，SDK runtime 装配由本地测试保护，SDK→远端 dispatch 留给 `tests/live/shared-environment.live.test.ts` 等显式 live keeper。本次不声称执行过这些远端合同。

审计发现但未借剪枝扩大修复范围的既存问题：Bailian 编辑 marker 与轮询正则不匹配、部分 QA cleanup 吞错与旧 selector、DPR 设置不能证明浏览器 zoom；Renderer 发送握手尚缺等待期间 send=0 的证明，部分取消和共享菜单负控可继续加强。详见本地三个分组台账与 preservation 记录。

规模检查：`bot-control-plane.test.ts` 1,158 行、`qoder-chat-adapter.test.ts` 1,108 行、`use-chats.test.tsx` 1,367 行；生产 Qoder Adapter 803 行。本轮只归并/恢复现有合同，没有新增独立职责，暂不按行数机械拆分；Adapter 测试的行数增长包含格式化和真实受控流 fixture。后续按 HTTP、SSE 生命周期等变化原因评估拆分。

原始证据位于忽略的 `.scratch/test-pruning-campaign/`，包含逐文件基线、声明台账、接续快照、lane plan、独立保真报告、mutation 红/绿日志、最终 gate 日志和分类行数。该临时目录不作为现行规范依赖；本记录保留可提交的结论与限制。
