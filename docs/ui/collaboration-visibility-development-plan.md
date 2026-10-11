# 协作能力展示开发计划

状态：批次 0–2 与批次 3 的基础展示已完成；保留精确身份映射、断流去重复核与屏幕阅读器走查的未完成事项。历史方案日期：2026-09-24；实际边界见 [验证记录](../validation-records/collaboration-visibility-2026-09-24.md)。

## 目标与选型

让用户在 **Bot** 中识别“这个助手配置了协作能力、有哪些可用成员”，在 **Session** 中识别“这次任务是否真的发生委派、由谁参与”。沿用现有互斥的任务与助手导航，不创建 Team、Room 或群聊。原型 A 的紧凑列表标识作为基础；Bot 详情吸收 B/C 的成员关系表达；Session 的事件轨迹参考 C，但只展示 Provider 能证明的事实。原型已移出主线，当前布局以实际 Feature 与验收规范为准。

成功时，普通 Bot/Session 不增加视觉噪声；协作 Bot 在列表、详情、新任务选择器里有一致的识别；Session 中“可用成员”与“实际参与”绝不混称。用户消息仍只发送给协调者，最终助手回复仍归属协调者。

## 实施前状态与约束（历史）

1. `ManagedBotConfiguration.memberAgentIds` 是本地期望配置，只有 Managed Bot 可通过 `bots.getConfiguration` 读取。两家 Provider 的 **Agent 列表真机响应均含 `multiagent`**，但当前 `BotView`、`BotCatalogView` 与 Adapter 尚未映射。Bot 列表应利用现有一次完整 `bots.list`，不逐行调用 `getConfiguration`。
2. 两家 Provider 的 **Session 列表与详情真机响应均有 `agent.multiagent` 创建时快照**，而当前 `ChatView` 未映射。历史 Session 展示应以自身快照为准，不使用当前 Bot roster 反推。
3. 现有 Qoder/Bailian Adapter 将 `thread_created`、`thread_message_sent`、`thread_message_received` 映射为 `kind: unknown`。真机原始事件有 child Thread ID 和 `to/from_agent_name`；Qoder Thread API 还可复核精确 Agent ID，百炼本轮只能证明 Provider 给出的名称与 Thread，不能保证精确 ID。名称匹配要处理重名与不可见成员。
4. 当前 Qoder `toChatEventView` 将 child Thread 的 `idle` 也映射为 Chat `done`；在协作 Session UI 上显示完成、参与统计或最终汇总前须修正。修正不得改变发送次数或引入客户端编排。
5. 服从 `CONTEXT.md`、ADR-0009、`docs/architecture.md` 的身份与所有权规则。Provider 是远程 Bot 当前状态、Session 快照、Thread 与委派事实权威；Project Document 是 Managed Bot 期望配置权威。真机已证实 roster 清空后旧 Session 仍保留创建时快照，**当前 Bot roster 不等于历史 Session roster**。

## 展示语义与文案

| 位置 | 展示条件 | 建议文案/形态 | 不显示的内容 |
| --- | --- | --- | --- |
| Bot 列表、Bot 选择器 | 已取得该 Bot 当前远程 roster 且非空 | 头像旁简洁“协作”标记；副信息可写“可用成员 3 位” | 未知时不显示 0，不把其他 Bot 被引用的关系反向标为协作 Bot |
| Bot 详情 | Managed Bot 的本地期望 roster；另有远程事实时可并列 | “协作成员”及姓名/不可见 ID；Sync pending 时明确“本地待同步” | 不宣称成员在线、可用或会参与每个任务 |
| Session 列表 | 该 Session 的 `agent.multiagent` 快照非空 | “协作任务”轻标记 | 不从当前 Bot roster、普通文本或最终回复猜测历史配置和实际参与人数 |
| Session 详情页头 | 该 Session 快照非空 | “由项目负责人处理”；“创建此任务时可用成员”入口 | 不将成员叠放头像解释为同一群聊里的发言者 |
| Session 工作记录 | Provider 事件证明 child Thread/双向消息 | “发生委派”“收到成员结果”；Qoder 通过 Thread API 的 Agent ID 归属成员。百炼可展示 Provider 原始名称，只有与当前目录中的快照成员唯一匹配才计入人数 | 不把 `@名称`、模型旁白、工具文本当委派证据；不将 child 消息提升为独立聊天气泡 |

列表默认只增加一个低干扰标记。叠放头像需要成员身份及名称稳定可得，且不能覆盖 Provider 角标；若只能得到 roster 数量，使用“协作”文字或双人图标。头像堆叠仅在有真实成员数据且窄窗口仍可读时启用。Bot 详情应区分“当前远程配置”“本地待同步配置”；remote-only Bot 可展示远程只读事实，但不得出现编辑入口。历史 Session 若无创建时快照，只给出可证明的事件事实，不回填当前 roster 为历史配置。

## 批次 0：合同与数据证据（开始 UI 前）

### 0.1 Bot 目录与 Session 快照证据（已完成）

- 2026-09-24 真机确认两家 `list agents` 与 `list sessions` 均返回 `multiagent`，Session 详情保留创建时快照，清空当前 roster 后历史快照仍未变化。字段矩阵见研究记录。后续增加归档、权限受限、缺字段样本的保守解析测试。
- 在现有 `bots.list` 的一次 Provider 列表响应中提取 **当前远程** roster；在 `chats.list/get` 中提取 **Session 创建时快照**。中立模型以 `coordinator | ordinary | unknown` 区分非空、明确空和缺失/异常，不为第二个 Provider 猜测通用 capability，也不逐行请求。
- `unknown` 与空 roster 必须区别。成员 ID 仅在当前 Connection 内解析显示名；不可见成员保留 ID 短尾和“当前列表不可见”，不推断被删除或归档。

### 0.2 委派事件证据

- 已在两家历史响应中确认稳定事件 ID、child Thread ID、发送/接收方向与 Provider 名称字段；仍需验证实时事件映射与历史重读去重。Qoder 的 Thread API child 行有精确 `agent.id`，百炼有 `to/from_agent_name`，但本轮无精确 Agent ID。姓名可作为 Provider 原文展示；只有该名称在**当前同 Connection 目录中**唯一对应某个 Session 快照成员 ID 时才归属到该成员，否则降级。重命名后匹配不到时不猜旧身份。
- 一次百炼探针产生两个 child Thread，不能把 Thread 数当人数。默认摘要写“协作过程 · N 个子任务”；只在 Agent ID 可验证或按上述目录名称唯一匹配、并按成员 ID 去重时写“N 位成员参与”。
- 确认同一事件在 SSE 和历史中的去重键、顺序；断流重连后不出现重复轨迹。原始长文本默认留在现有展开详情，不把成员内部消息自动铺成主聊天气泡。
- Qoder child `thread_status_idle` 误触发 Chat `done` 已在本轮复现：远端 Session 仍 running，删除返回 409。现已改为仅 Session 级状态结束回合，并补充 Adapter 回归测试；真机回归记录见验证记录。

**批次 0 已完成的门槛**：字段矩阵与真机记录已写入仓库。实时事件去重、重名/缺字段合同测试和 Qoder `done` 修复属于批次 3 的实施前置，不据此推迟批次 1/2 的只读展示。

## 批次 1：Bot 协作能力识别

1. **模型和 Adapter**：按真机字段扩展 `BotCatalogView` 与 `BotView` 的只读协作摘要，由 Qoder/Bailian 各自 Adapter 解析；`ChatDataPlane` 只做 Connection 身份绑定。`bots.list` 保持完整分页、单次目录来源和现有失败语义。Managed 本地期望数据不反向覆盖远程目录摘要；Pending 状态来自现有 `getConfiguration.hasPendingChanges`。
2. **Bot 列表/导航/新任务选择器**：复用一个轻量展示组件，普通、协调、未知三种状态可辨；有成员数才显示数字。Bot 行仍以名称、描述、管理类型为主。当前 Connection 切换时旧账号标记立即消失。搜索与排序不受标记影响。
3. **Bot 详情**：在当前已有 Bot 详情布局内加只读“协作成员”区块。Managed Bot 显示本地期望 roster；Pending 时提示“已保存，尚未同步”，远程实际摘要若可得则分开列示。Remote-only 仅显示已证实的远程摘要。点击“编辑成员”只进入已有 Managed 配置页，不提供针对 remote-only 的写入口。成员行可链接到同 Connection 的独立 Bot，但不暗示它归当前 Bot 所有。
4. **配置变更刷新**：保存/重新 Sync 成功后刷新当前 Bot 的远程目录摘要；失败时保留本地待同步提示，不把本地已选成员当作远程已生效。列表失败保持已知旧内容但标注刷新中/失败，不以旧缓存宣称最新状态。

**批次 1 验收**：同一 Connection 下普通/协调/remote-only/不可见成员/Pending 五类呈现正确；清空 roster 后远程标记随成功 Sync 消失；Bot 身份、成员生命周期和当前 scope state 不变。窄窗口的名称与主要操作仍完整可达。

## 批次 2：Session 的协作标识与成员摘要

1. **Session 模型与列表**：两家 `chats.list/get` Adapter 从 `agent.multiagent` 解析创建时快照，扩展只读 `ChatView` 协作摘要。在 `chat-navigation-row.tsx` 和总览复用同一标记规则，任务标题始终是主信息，所属 Bot 是副信息；快照缺失/异常时隐藏协作标记，不以当前 Bot 配置回填。
2. **详情页头**：维持标题和协调者 Bot 身份；增加“创建此任务时可用成员”按需展开入口。成员 ID 从 Session 快照读取，名称只按同 Connection 的当前目录解析并标明“当前名称”；不可见时显示 ID 短尾。无需读取 Managed 本地配置；当前 Bot roster 的变化不改旧 Session 摘要。
3. **空态与非委派场景**：协调 Bot 的 Session 未出现 child Thread 事件时，写“本次暂无委派记录”，不写“未使用成员”或“协作失败”。普通 Bot 的 Session 保持现有页面密度。

**批次 2 验收**：新旧 Session、配置后来新增/清空成员、列表刷新失败、切换 Connection 均不造成虚假“参与”；Bot 与 Session 的头像/标记表达一致；键盘与屏幕阅读器能读到完整身份和时间语义。

## 批次 3：基于真实事件的协作轨迹

1. **事件模型**：只为已验证的 Thread 生命周期与跨 Thread 消息补充有意义的 `ChatTimelineItemView` 分支或窄字段（如 `kind: 'delegation'`、方向、child Thread ID、已验证的目标 Agent ID）。Provider wire 形状留在 Adapter 内；Main 不建立新的 Thread 存储/路由器。无法识别的事件仍进入现有原始工作记录。
2. **纯派生轨迹**：由当前 Session 历史与 live events 按稳定 ID 派生“委派开始/收到结果”记录。只有 child 创建或等价双向事件才计入子任务；事件中的 Provider 名称可以原文展示，但只有 Agent ID 或该名称在当前目录中唯一对应 Session 快照成员 ID 时才归属并去重为“成员人数”。重名/重命名/不在目录中时显示“协作成员”，不拼凑 ID。事件缺失、部分历史、断线时显示“记录可能不完整”，不显示确定性 0。
3. **页面**：参考原型 C，将协作轨迹放进现有工作记录的清晰分组；默认只见简短摘要（例如“协作过程 · 2 位成员”），展开看到真实时间顺序。展开内容可查看原始 Thread ID/事件与可复制详情。用户和协调者的正文气泡不变，失败事件仍在折叠层外可见。长历史按现有筛选/锚点模型工作，不增加第三栏。
4. **跨 Provider 降级**：Qoder 优先以 Thread API Agent ID 归属；百炼可使用 Provider 事件里的 `to/from_agent_name` 展示名称，但重名或与 Session 快照不一致时只写“协作成员”。任一 Provider 不得因为自然语言里出现成员名就生成轨迹。

**批次 3 验收**：一个真实多 Agent Session 从实时流到历史重读，轨迹条数和排序稳定；Qoder/Bailian 各一例；无委派普通任务、只创建 Thread 未收到结果、重复 SSE、断线重读、成员重命名/不在目录中均不误标；最终回复仍以协调者名义呈现。

## 修改位置与文档同步

- 数据合同：`src/shared/models.ts`、`docs/interfaces.md`；Qoder/Bailian `*-bot-catalog.ts` 与 `*-chat-adapter.ts`；必要的 `ChatDataPlane` 映射。不要新增成员目录、持久化文件或 DesktopHost 成员专用方法。
- Renderer：`shell/chat-navigation-row.tsx`、`shell/chat-navigation-content.tsx`、`features/chats/chats-overview-page.tsx`、`features/chats/chat-detail-page.tsx`、`features/chats/chat-timeline-model.ts`、`features/chats/work-group.tsx`、`features/bots/bots-page.tsx`；按实际调用方放置复用展示组件。修改 Primitive 时遵守 shadcn/Tailwind v4 规则。
- 现有 ADR-0009 与 `docs/architecture.md`/`docs/validation.md` 把 child Thread 专门 UI 列为未来能力或未纳入本次交付；启动批次 3 前应更新这些规范文件，将“只读、事件证据驱动的可视化”明确纳入范围，同时保留不持久化、不分发、不编排的边界。批次 1/2 也须同步 Bot/Session 只读摘要合同。
- 本 HTML 原型只作讨论材料，不复制其静态假数据、内联 CSS 或临时交互到产品实现。

## 验证顺序与交付门槛

1. 每批先完成最小 Provider 合同测试与纯派生规则测试，再覆盖可观察的 Renderer 流程。重点验证“未知与零不同”“配置与参与不同”“历史与当前不同”；避免对静态文案做重复快照测试。
2. 批次 1/2 完成后运行 `pnpm typecheck`、`pnpm lint`、相关 Renderer/Adapter 测试、`pnpm test:arch`；改动 Primitive 额外运行 `pnpm test src/renderer/ui/design-system`。批次 3 修复发送完成语义后再做真实 Cloud 协作闭环。
3. 用 1024×700、790×650、640×600 检查列表、Bot 详情、Session 详情的层级、截断、焦点、折叠和底部输入框；移动端 Sheet 复用同一导航信息。最终运行 `pnpm gate` 与打包应用走查；Cloud 测试使用唯一前缀和 metadata，清理 Session/Agent。Qoder 运行中 Session 先按官方 cancel 接口回到 idle 再删除；按仓库规则记录 Environment 归档例外。
4. 分批可交付：批次 1 的 Bot 标识和详情可先发布；批次 2 的 Session 标记必须带时间语义；批次 3 仅在事件与目标身份验证后发布具体成员轨迹。任何批次均不阻塞普通 Bot/Session 使用。

## 当前实施进度（2026-09-24）

- 批次 0：两家真机字段与委派事件已确认，见 `docs/research/collaboration-visibility-live-2026-09-24.md`。
- 批次 1：Bot 目录只读 roster、列表/导航标记、详情远程成员与 Managed 本地待同步配置已实现。
- 批次 2：Session 创建时快照、列表标记、详情成员摘要已实现。
- 批次 3：真实 Thread 事件的只读协作记录和 Qoder 主 Session 完成语义修复已实现；Qoder 与百炼的打包应用页面点击和三种尺寸检查已通过。尚需精确成员身份映射、断流重读去重与屏幕阅读器走查。身份未验证前不显示参与人数。
- 本地门禁和两家真实 Cloud 回归已通过，细节见 `docs/validation-records/collaboration-visibility-2026-09-24.md`。
