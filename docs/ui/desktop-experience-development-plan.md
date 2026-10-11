# 桌面体验改进开发计划

## 目标和范围

依据 [桌面体验改进建议](./desktop-experience-improvement-plan.md)，先解决长 Chat 的阅读噪声和大目录定位，再收敛 Bot 创建与 Connection 状态的表达。每一批都应可独立验收和回退。当前 `docs/architecture.md` 的 Chats/Bots 双模式导航是实施基线；较早的 Chat 树形导航计划只作历史参考。

身份、持久化、跨层调用和 Provider 合同继续由 `CONTEXT.md`、ADR 及架构文档决定。此次改动默认限于 Renderer 的纯派生模型和组件；不增加本地 Chat/Message/Turn/Operation 存储，不改变 `DesktopHost` 或 Provider Adapter，不制造跨 Chat 的任务、待办或 Bot 在线状态。若验证发现某一项必须修改这些边界，应停止该项并单独提出合同变更。

## 实施前基线

1. 固定当前工作树状态、现有测试结果和三类真实数据样本：短 Chat、100 条以上事件的长 Chat、包含多个 Thread 与失败事件的 Chat。样本只记录无凭据的事件形状与截图；敏感内容不写入仓库。
2. 记录 Qoder、Bailian 各自 `ChatView.remoteStatus` 和时间线 `status/error/tool-result` 的真实取值、更新时间与重读行为。此步仅验证已有数据，不创建新的 Provider 抽象。
3. 在真实 Electron 窗口测量 1024×700、约 790×650、640×600 的布局。此前被截取的窗口截图不能当作溢出证据。
4. 记录现有 `pnpm typecheck`、`pnpm lint`、相关 Renderer 测试和 `pnpm test:arch` 的基线；实施期间不改动 OpenAgentPack 工作区。

## 批次 A：Chat 阅读层级

### A1. 纯派生时间线模型

**文件**：新增 `src/renderer/features/chats/chat-timeline-model.ts` 及其测试；调整 `chat-detail-page.tsx`。`ChatTimelineItemView` 和 Provider Adapter 保持不变。

**规则**：输入为当前已去重的历史事件与实时事件；先保留现有原始顺序及原始 ID，再派生 `message | artifact | error | work-group | standalone-work` 展示节点。只合并相邻、同一明确 `threadId` 的成功操作事件；无 `threadId` 的事件只在相邻且没有消息边界时合并，不猜测属于哪个 Thread。用户消息、助手消息、artifact、`error`、失败 `tool-result` 为硬边界；失败项始终外露。单个操作事件可保持原有紧凑行，避免「1 步工作记录」的冗余外壳。分组标题只用实际计数，例如「调用工具 4 次 · 处理记录 12 条」，不从工具名推断任务意图。

**搜索**：先在原始事件上执行现有类别/文本筛选，再派生展示节点。过滤后的一个分组必须自动可见匹配事件，不能出现搜索命中但用户看不到内容的情况。清空筛选后恢复默认折叠。实时事件结束、历史重读时以事件 ID 去重，展示节点 key 稳定；分组展开状态只在当前 Renderer 中保留。

**验证**：纯函数测试覆盖消息边界、Thread 交错、缺失 Thread ID、失败结果、产物、未知事件、过滤/搜索、实时到历史重读。Feature 测试验证展开后的原始事件顺序及键盘操作。真实长 Chat 对照事件总数，确认没有隐藏或重复。

### A2. 工作记录组件与错误层级

**文件**：调整 `timeline-item.tsx`，必要时新增同目录的 `work-group.tsx`；复用 `ui/design-system` 的 `Collapsible` 和现有 token。

**行为**：默认显示工作记录摘要；展开显示每条原有 `TimelineItem` 的详细输入输出、时间与 Thread ID。错误沿用现有错误语义并在折叠层外展示，摘要同时显示该段曾发生失败。用户和助手正文保持现有宽度与排版，不因分组改动阅读列。

**验收**：100 条以上的操作事件在默认视图不占据 100 多行；展开后每条仍可访问、可复制；辅助技术读到「工作记录、记录数、展开/折叠」；reduced motion 下无强制滚动动画。

### A3. 页头与原始 ID

**文件**：`chat-detail-page.tsx`、`shell/chat-navigation-row.tsx`、`features/chats/chats-page.tsx`、`features/chats/chats-overview-page.tsx` 共用一个纯展示标题函数。

**规则**：远程标题可读时原样展示；为空或与 `sessionId` 完全相同才显示 `新 Chat · 日期/时间`。列表不为了生成预览额外请求各 Chat 历史。详情页头主行显示展示标题，副行显示 Bot 和 Provider；完整 Session ID 保留在现有管理菜单并可复制。Thread ID 只在展开的记录详情出现。菜单中显示远程原始标题，方便排障。展示标题不写回 Provider，也不落本地缓存。

**验收**：侧栏、总览、Bot Chat 列表与详情使用同一展示标题；同名 Chat 仍可由 Bot 和时间区分；原始 ID 可找到、可复制；缩窄窗口时主要操作不被标题推走。

**交付门槛 A**：只做 A1–A3 即应能发布一版：消息阅读顺畅、失败可见、所有诊断细节仍可还原。不要为等后续批次而引入半成品的右侧栏。

## 批次 B：目录和长会话定位

### B1. 新建 Chat 的 Bot 排序

**文件**：新增 `features/chats/new-chat-candidates.ts` 纯函数与测试；调整 `new-chat-panel.tsx` 和 `app.tsx` 传入当前 Connection 已加载的 roster。

**规则**：空搜索时先列最近使用的 Bot（按已加载 Chat 的 `updatedAt` 聚合、Bot 身份去重），再列其余受管理 Bot，最后列其他 Bot；每个 Bot 只出现一次。加载中的 roster 不阻止选择已获取的 Bot，也不把尚未加载的 Bot 判定为「未使用」。搜索非空时恢复完整 Bot 目录匹配，精确名称优先，再前缀、包含、描述包含，同级稳定排序。重复 Bot 名用远程 Agent ID 短尾作辅助标识，完整 ID 可通过 tooltip/可访问名称读取。

**性能**：候选按已有 `bots.list` 完整数据在内存派生；数百 Bot 规模下避免每次按键都重新读取 Provider。必要时对列表做窗口化或分批渲染，但不得截断搜索结果或损坏键盘导航。

**验收**：最近用过的 Bot 出现在前列；搜索仍覆盖所有 323 个左右的候选；重复名称可区分；当前 Connection 切换后不会沿用旧账号的「最近」排序。

### B2. 长 Chat 定位入口

**文件**：扩展 `chat-detail-page.tsx` 现有「工作记录」Popover，新增同目录的纯锚点派生函数与测试。

**行为**：提供用户消息、失败、产物、最近助手回复四类锚点；每类从当前已载入的事件生成，显示短文本和时间。点击后滚动到对应 DOM 节点并聚焦可聚焦的目标；若目标位于折叠工作记录中先展开该组。保留现有事件搜索/类别筛选，锚点与筛选互不覆盖。首版不增加常驻第三栏，不增加未被 Provider 证实的「任务目标」。

**验收**：数百事件的 Chat 能在两次操作内跳到最近失败或产物；键盘可操作；锚点更新时不跳错事件；窄窗口 Popover 不遮住输入框。

### B3. Chats 状态标记的证据门槛

**先验证，后实现**：对 Qoder、Bailian 的 `ChatView.remoteStatus` 与详情事件做真实只读核查。只有确认某个状态在 roster 中语义稳定且刷新及时，才在 `chat-navigation-row.tsx` 和 `chats-overview-page.tsx` 增加对应文字标记。第一版只考虑「运行中」和「失败」这类明确状态；不做「待你处理」推断、不改变按更新时间排序。若 Provider 数据不满足门槛，此项记录证据并延期，B 批其他任务仍可交付。

**验收**：不同 Connection 的状态不串线；旧缓存刷新中不被当作当前实时状态；无可靠状态时不显示标记。

## 批次 C：配置与 Connection 表达

### C1. 创建 Bot 的信息层级

**文件**：`features/bots/bots-page.tsx`、`bot-settings-form.tsx`，选择器内部行为保持不变。

**行为**：创建页说明改为「设置名称和职责，创建后即可开始 Chat」，并用简短说明告诉用户创建时采用默认 Instructions。名称、职责描述、模型为基础段；Skills、MCP、协作成员进入同一「更多配置」可展开段，收起时展示已选数量/名称摘要，已选数据绝不因收起而丢失。编辑页的职责描述与 Instructions 保持两字段，旁边说明各自用途。配置变更只用于新建 Chat 的说明集中放在提交区。

**实现边界**：使用已公开的 `Collapsible` 等 Primitive；若需要新 Primitive，必须先证明官方 shadcn 实现无法满足当前真实调用方，再遵循 `AGENTS.md`。

**验收**：无高级配置与含成员/Skill/MCP 的两种创建流程均能提交；展开/收起不重置草稿；保存失败后选择保留；Qoder 不出现没有真实合同的 MCP 入口。

### C2. Connection 就绪层级

**文件**：`features/connections/connections-page.tsx`、`shell/app-sidebar.tsx` 中的连接入口。

**行为**：列表第一层区分「可用于创建」「需要设置运行环境」「凭据已断开」等已有本地事实。已保存凭据不等于 Provider 此刻在线，不显示没有重新验证支持的「在线」。详情首屏给出对应下一步动作：设置环境、更新凭据、验证连接。Workspace ID 和凭据说明仍留在详情层。切换 Connection 后沿用现有重置到 Chats 总览的行为，并显示 roster 加载进度。

**验收**：三种可判定状态均有清楚文案和操作；真实网络失败与未设置环境不混为一类；切换账号后不短暂显示旧账号 Chat。

## 批次 D：视觉与端到端验收

1. 用现有 `theme.css` token 核对标题、消息、工作记录、元数据、错误四层层级；可见辅助文字不低于 caption；焦点、选中、禁用、加载状态一致。
2. 真实 Electron 窗口依次检查 1024×700、约 790×650、640×600；检查新建 Chat Dialog、创建 Bot 表单、连接设置、长 Chat、Popover/Sheet 与底部输入框。只修复真实复现的溢出、遮挡和双滚动。
3. 键盘流程：切换 Chats/Bots → 搜索并打开 Chat → 展开工作记录 → 跳转错误/产物 → 输入并发送 → 返回；检查 Escape 和焦点归还。
4. 数据面闭环：在唯一前缀的测试 Chat 中发送短消息，观察增量、最终回复和历史重读；确认归档后 roster 更新。真实 Cloud 资源按 `AGENTS.md` 清理并记录结果。
5. 每批运行 `pnpm typecheck`、`pnpm lint`、相关 Renderer 测试、`pnpm test:arch`；改动 Primitive 时额外运行 `pnpm test src/renderer/ui/design-system`；最终运行 `pnpm gate` 及打包应用人工走查。不要把纯 UI 改造误扩大为 Provider 资源变更测试。

## 待验证和产品决策

| 事项                                           | 当前判断                                               | 处理方式                                                  |
| ---------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| roster 的 `remoteStatus` 能否代表当前运行/失败 | 尚无两 Provider 的完整现场证据                         | B3 先做只读核查；不可靠就不显示标记，不阻塞其他批次       |
| 无标题 Chat 用什么展示                         | 默认 `新 Chat · 日期/时间`，不从每个 Chat 加载首条消息 | A3 先按此实现；若未来 Provider 提供轻量标题可替换展示规则 |
| 中间过程的助手文本是否折叠                     | 默认全部保留在正文                                     | 只有用户研究证明噪声问题来自中间文本时再单独评估          |
| 是否增加常驻第三栏、Bot 全局在线态、收藏/待办  | 当前没有足够产品和 Provider 事实基础                   | 本计划不实现；需要独立需求与合同证据                      |
| 窄窗口弹窗是否真的溢出                         | 截图不能证明，当前 Primitive 已限制视口宽度            | D 批实测；有复现才修                                      |

这些事项均已有保守默认路径，**没有必须在开工前由用户确认的阻塞**。若希望改变「无标题展示方式」或让「工作记录默认展开」，属于产品偏好，可以在 A 批验收时根据真实效果调整。

## 2026-09-23 实施记录

- A1–A3 已实施：Renderer 内派生工作记录分组；失败事件外露；统一标题兜底；原始 Session ID 留在管理菜单。复核时补充了 `status/usage` 必须可展开读取、历史与实时事件按 ID 和种类去重的规则。
- B1、B2 已实施：新建 Chat 根据已加载的 roster 排最近 Bot；长 Chat 可跳转到消息、失败和产物。候选搜索仍覆盖完整 Bot 目录。
- B3 暂缓：现有 Provider Adapter 仅透传 `remoteStatus` 原始字符串，尚无两个 Provider 的 roster 刷新及时性与状态含义的现场证据。依据本计划门槛，不显示推断性状态标记。
- C1、C2 已实施：Bot 创建的扩展配置收起但保留选择；Connection 文案只描述已知的本地配置状态。
- D 的静态与打包检查已通过：`pnpm typecheck`、Renderer 相关测试、全量 `pnpm test`（最终 503 通过、15 跳过）、`pnpm test:arch`、`pnpm build`、`pnpm package`、`pnpm smoke:packaged`。全量 `pnpm lint` 受未改动的根目录 `index.js:2551` 未使用变量影响，改动文件单独 lint 通过。
- 打包应用经现有 `scripts/live-packaged.mjs` 实际连接 Qoder Cloud：添加 Connection、在多个现有 Environment 中选择、以现有 Bot 新建 Chat、发送并收到助手回复、远程历史重读、查看工作记录筛选和跳转锚点、打开 Bot 创建的基础与扩展表单。1024×700、790×650、640×600 三种模拟窗口尺寸的关键入口均可见且无横向溢出；测试新建的 Session 已删除。此次真实 Chat 只有两条消息、无工具事件，不能据此宣称长 Chat 分组已获 Cloud 现场验证。
- 现场发现添加 Connection 后、Environment 候选加载前，完成卡片会使添加弹窗提前关闭；现保持弹窗打开直至用户选定 Environment，并增加回归测试。修复后重跑打包应用端到端流程通过。
- Qoder 的连接/数据面只读测试、Bot 创建与 Chat 写入 Cloud 测试，以及 Bailian Provider 合同 Cloud 测试均通过。旧 Chat 写入测试已改用当前 Connection 默认 Environment 规则；各测试临时 Agent 清理后列表无活动同前缀资源。完整 Cloud 工具事件分组及两个 Provider 的 roster 状态语义仍待真实样本验证，B3 继续延期。
