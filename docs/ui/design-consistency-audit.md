# Renderer 设计一致性审计

日期：2026-09-18  
范围：`src/renderer/` 当前实现；仅对照 `CONTEXT.md`、`docs/adr/0005-adopt-shadcn-ui-primitives.md`、`docs/ui/refinement-plan.md` 与 Renderer 源码、测试。  
性质：静态代码审计，不包含真实 Electron 窗口的视觉走查。因此，本文把“已明确规范”“代码事实”和“设计推断”分开表述。

## 结论

当前 Renderer 的**产品结构和大方向一致，视觉细节与状态行为尚未完全收敛**。

- 信息架构遵循本产品领域模型：Connection → Bot → Chat，Chat 及 Message 由远程 Provider 提供；UI 没有重新制造本地 Chat 身份或持久化入口（`CONTEXT.md:5-36`，`src/renderer/app.tsx:47-69`）。
- “左侧连续性导航 + 右侧工作区”“消息优先、技术事件折叠”“daylight 单主题”“Radix/CVA/Tailwind primitive”均已落地，符合精致化计划和 ADR-0005（`docs/ui/refinement-plan.md:3-38`，`docs/adr/0005-adopt-shadcn-ui-primitives.md:11-25`）。
- Chat 详情的时间线、错误反馈和 composer 已共享 `656px` 阅读列；这是明确的代码契约，不应仅因宽屏留白而任意扩大（`src/renderer/features/chats/chat-detail-page.tsx:32-36,455-505`）。
- 主要一致性缺口集中在：窄窗口高度模型、Button pending 状态、原生/设计系统控件混用、反馈状态可感知性、字号与对比度、任意值持续增加。

优先级统计：P0 0 项，P1 1 项，P2 10 项，P3 4 项。

## 修复状态（2026-09-18）

本轮已完成并通过自动验证：

- P1 mobile header / `h-full` 高度冲突：主工作区已改为 column flex，子页面位于 `min-h-0 flex-1` 容器。
- Button pending 契约：已改为 `disabled || pending`，并增加显式 `disabled={false}` 的组合测试。
- Connection Provider：已改用 Design System `Select`。
- 移动 topbar 与 Chat 返回操作：点击区域已扩大到 44px。
- Message token：普通与流式消息已消费 user/assistant 语义 token。
- 可见 9–10px metadata：已提升为 caption 11/16px。
- loading/sending：已增加克制的 `role=status`/`aria-live` 语义，流式正文不逐字播报。
- reduced-motion：JavaScript 自动滚动会读取系统偏好并禁用 smooth behavior。
- 低透明度时间和副标题：已改用 `muted-foreground`。
- `description` 表单文案：已改为“职责描述（可选）”。

仍保留为后续结构性工作：窄窗口可搜索 roster、阻断 Alert/行内 Notice 两级反馈、排版和高频视觉角色 token 化。这些工作不会阻塞本轮已修复的布局与状态契约。

## 审计口径

### 已明确的设计规范

1. 产品对象和术语以 Provider、Connection、Bot、Managed Bot、Remote-only Bot、Chat、Message、Sync 为准，且应避免“Provider Account”“本地 Bot”“本地 Session”“部署/发布”等替代称呼（`CONTEXT.md:5-36`）。
2. Renderer primitive 采用 Tailwind v4、Radix、CVA、Lucide；token 由本仓库冻结拥有；只维护真实消费的组件；daylight 单主题（`docs/adr/0005-adopt-shadcn-ui-primitives.md:13-24`）。
3. 工作区以 Bot 状态和 Chat 连续性为中心；消息与成果是主层级，Thinking、Tool、Usage 等进入可展开工作记录；动效克制且尊重 reduced motion（`docs/ui/refinement-plan.md:3-16,26-38`）。
4. 视觉 token 的单一来源是 `theme.css`，卡片保持平面、浮层才使用明显阴影；窄窗口主要动作应达到至少 44px（`src/renderer/ui/design-system/theme.css:1-9,104-124`）。

### 代码事实

- 桌面工作区为固定 `292px` sidebar + 弹性主区，`md` 以下隐藏 sidebar、显示 52px mobile header（`src/renderer/app.tsx:157-159,296-326`）。
- Bot 和 Chat 列表使用 `max-w-3xl`，创建 Bot 使用 `max-w-xl`；Chat 详情使用 `max-w-[656px]` 单一阅读列（`src/renderer/features/bots/bots-page.tsx:303-352`，`src/renderer/features/chats/chats-page.tsx:74-101`，`src/renderer/features/chats/chat-detail-page.tsx:32-36`）。
- 颜色以语义 token 为主，surface 分为 shell、raised、overlay、hover、subtle、selected（`src/renderer/ui/design-system/theme.css:14-51,61-102`）。
- Primitive 已统一 focus-visible、disabled 和多数 hover 行为；Select、Dialog、Dropdown、Popover、Tooltip、Collapsible 使用 Radix（例如 `src/renderer/ui/design-system/button.tsx:6-27`，`src/renderer/ui/design-system/select.tsx:22-57`）。

### 设计推断

- `656px` 阅读列与 `560px` 消息最大宽度形成稳定的阅读节奏，属于合理的桌面聊天布局；没有项目内证据支持将其扩到 1440px 一类内容宽度。
- Bot/Chat 的列表式平面 surface 与 Chat 中紧凑 activity card，整体比“管理后台卡片墙”更接近精致化计划目标。
- 下述关于低对比度、点击目标和层级噪声的判断仍需在真实 Electron、系统缩放和窄窗口下验证，不能由静态 class 单独定论。

## 分项审计

### 1. 信息架构与导航

**一致部分**

- 首次/无连接时进入 Connection 管理；正常态以 Chat roster 为主导航，底部入口回到 Bot Library，符合“连接是前置条件，Bot/Chat 是日常工作对象”的层级（`src/renderer/app.tsx:117-157,211-294`）。
- sidebar 行优先显示 Bot 名、Chat 标题与更新时间；Bot Library 主层显示名称、职责描述和远程状态，managed/model 降到次级 metadata，符合计划（`src/renderer/app.tsx:212-244`，`src/renderer/features/bots/bots-page.tsx:351-388`）。
- 技术事件默认收敛为折叠 activity；status/usage 在默认视图中进入 `sr-only`，筛选或搜索时才显式展示，符合“消息与成果优先”（`src/renderer/features/chats/chat-detail-page.tsx:127-201,223-258`）。

**缺口**

- **P2：窄窗口缺少明确的已有 Chat 导航。** `md` 以下整个 sidebar 被隐藏，mobile header 只有“回 Bot 列表、新建 Chat、管理连接”；从 Chat 详情返回只能到当前 Bot 的 Chat 列表，跨 Bot 恢复历史 Chat 需要先回 Bot Library 再逐级进入（`src/renderer/app.tsx:157-159,296-326`）。这削弱计划所要求的“Chat 连续性”。建议在 mobile header 增加打开 roster 的 sheet/dialog，复用现有搜索与 selected 状态，而不是新增产品对象。
- **P3：Connection 管理同时承担 onboarding 和日常设置，但标题始终为 Connection。** 外层叙事“连接你的远程 Bot”，内层标题“Connection”，已连接列表和新增表单同屏，首次使用清晰，日常设置略显重（`src/renderer/app.tsx:133-154`，`src/renderer/features/connections/connections-page.tsx:76-127`）。建议只调整信息层级：已连接项优先，添加表单可折叠；不改变领域术语。

### 2. 布局宽度与间距

**一致部分**

- Chat timeline、Alert、composer 共用 `CHAT_READING_LANE`，消除了不同模块各自计算左右边距的问题（`src/renderer/features/chats/chat-detail-page.tsx:32-36,455-505`）。
- 外层 `px-5`、列表页 `sm:px-8`，连接页在 `md` 以下切为单列，说明窄窗口已有基础适配（`src/renderer/app.tsx:144`，`src/renderer/features/bots/bots-page.tsx:303`，`src/renderer/features/chats/chats-page.tsx:74`）。
- 列表页都使用 `max-w-3xl`，标题与列表共轴（`src/renderer/features/bots/bots-page.tsx:304,352`，`src/renderer/features/chats/chats-page.tsx:92,101`）。

**缺口**

- **P1：mobile header 与 `h-full` 子页面存在高度模型冲突。** 主区固定 `h-screen`，在 `md` 以下先渲染 52px header，再渲染各自 `h-full` 的 Chats/ChatDetail 页面；父级又是 `overflow-hidden`。两者总高度超过 viewport，底部 composer 或页面内容存在被裁掉 52px 的高风险（`src/renderer/app.tsx:296-327`，`src/renderer/features/chats/chats-page.tsx:64`，`src/renderer/features/chats/chat-detail-page.tsx:375`）。建议把主区改为 `flex h-screen flex-col`，mobile header `shrink-0`，内容包裹层 `min-h-0 flex-1`；桌面/移动共用这一高度契约。必须在真实 Electron 窄窗口验证 composer 可见、滚动容器唯一。
- **P3：间距尺度大量使用一次性任意值。** 例如 `gap-[5px]`、`px-[18px]`、`gap-[13px]`、`py-[7px]`，虽能实现当前稿，但难形成可预测节奏（`src/renderer/app.tsx:159-181,266-285`，`src/renderer/features/chats/new-chat-panel.tsx:42-75`）。建议先盘点高频值，只有复用三处以上的间距再沉淀 token；无需一次性重写全部 class。

### 3. 颜色、surface、圆角与阴影

**一致部分**

- shell 使用 `surface`，主工作区使用 `surface-raised`，交互 hover/selected 使用专门 surface token；层次语义清楚（`src/renderer/ui/design-system/theme.css:44-51,95-102`，`src/renderer/app.tsx:130,157-158,296`）。
- Card 默认仅使用轻量 `--shadow-card`，Dropdown/Popover/Tooltip 同样消费统一 shadow token（`src/renderer/ui/design-system/theme.css:117-119`，`src/renderer/ui/design-system/card.tsx:6-15`，`src/renderer/ui/design-system/dropdown-menu.tsx:8-23`）。
- 消息、assistant surface、user surface 均有语义 token，尽管当前 user message 实际选择高反差 foreground surface（`src/renderer/ui/design-system/theme.css:39-49,89-101`，`src/renderer/features/chats/chat-detail-page.tsx:115-120`）。

**缺口**

- **P2：已定义 message token，但消息实现绕过它们。** `--message-user` 与 `--message-assistant` 已冻结，实际消息却使用 `bg-foreground` 与 `bg-surface-subtle`（`src/renderer/ui/design-system/theme.css:39-42,89-93`，`src/renderer/features/chats/chat-detail-page.tsx:115-120`）。这使 token 失去权威。应二选一：消息改为消费 message token；或经视觉确认后删除无效 token，并在规范中记录高反差 user bubble 决策。
- **P2：错误 surface 语言分裂。** Alert destructive 是实心红底白字，而 timeline tool/error 是浅红 `destructive/5`，managed bot 的错误又是白色 popover + 红字（`src/renderer/ui/design-system/alert.tsx:6-15`，`src/renderer/features/chats/chat-detail-page.tsx:181-200,259-272`，`src/renderer/features/bots/bots-page.tsx:217-223`）。建议定义“阻断错误 Alert”和“行内错误 Notice”两级语义，避免 Feature 自行拼三套错误外观。
- **P3：圆角和阴影出现未命名的视觉层级。** token 只有 6/8/10/14px 与 card shadow，但消息用 16px、Dialog 用 18px 和独立 46px 阴影、artifact 用独立 24px 阴影（`src/renderer/ui/design-system/theme.css:53-57,104-119`，`src/renderer/ui/design-system/dialog.tsx:17-23`，`src/renderer/features/chats/chat-detail-page.tsx:202-220`）。如果这些是有意的 bubble/dialog/artifact 角色，应命名为角色 token；否则收敛至现有 scale。

### 4. 排版与术语

**一致部分**

- 全局字体、14/21px 基准和页面/章节/正文/控件/辅助/说明角色已有定义（`src/renderer/ui/design-system/theme.css:58,124,148-203`）。
- 产品核心术语多数保留英文专名并正确组合中文说明，例如 Bot、Chat、Connection、Provider、Sync，没有引入被禁止的“本地 Bot/Session”等身份（`src/renderer/features/bots/bots-page.tsx:269-309`，`src/renderer/features/connections/connections-page.tsx:29-31,79-82`）。

**缺口**

- **P2：排版角色没有成为真正的单一来源。** Feature 广泛使用 `text-[13px]`、`text-[10px]`、`font-[550]`、`font-[450]` 等局部值，而 `typography` 只零星用于 loading/empty 文案（`src/renderer/ui/design-system/theme.css:168-203`，`src/renderer/app.tsx:230-241,279-281`，`src/renderer/features/chats/new-chat-panel.tsx:62-82`）。建议先把 topbar、列表主副文案、metadata、activity label 映射到 5–6 个明确角色，再处理微调。
- **P2：9–10px metadata 低于已定义最小 caption 11px。** EventMeta、INPUT/PERMISSION label、artifact metadata、status/usage 采用 9–10px（`src/renderer/features/chats/chat-detail-page.tsx:88-95,161-174,212-216,223-258`），sidebar Bot 数量也是 10px（`src/renderer/app.tsx:279-282`）。建议最小可见文本统一为 caption 11/16px；仅 `sr-only` 内容不受此限制。
- **P3：创建 Bot 的“Instructions”与实际 `description` 字段语义不完全一致。** 表单把 `description` 标为 “Instructions（可选）”，列表又把它当职责描述展示（`src/renderer/features/bots/bots-page.tsx:72-90,117-145,367-372`）。这是产品文案风险：如果 Provider 侧确实把 description 当 instruction，需要接口/领域文档佐证；否则应改为“职责描述”或拆字段，不能只靠 UI 命名改变语义。

### 5. 控件、交互状态与反馈

**一致部分**

- Button 用 CVA 管理 variant/size，Input/Textarea/Select 共享 ring、border、disabled token；Radix 组件提供键盘与焦点基础（`src/renderer/ui/design-system/button.tsx:6-27`，`src/renderer/ui/design-system/input.tsx:14-23`，`src/renderer/ui/design-system/select.tsx:22-57`）。
- sidebar、Bot/Chat row 和新建 Chat 选项均有 hover 与 focus-visible；selected Chat 有独立 surface（`src/renderer/app.tsx:211-244`，`src/renderer/features/bots/bots-page.tsx:351-382`，`src/renderer/features/chats/new-chat-panel.tsx:52-85`）。
- 发送失败、加载失败、创建失败均保留就地反馈与重试；refresh 有 pending/spin 表示（`src/renderer/features/chats/chat-detail-page.tsx:476-497`，`src/renderer/ui/design-system/refresh-action.tsx:13-42`）。

**缺口**

- **P2：Button 的 pending 禁用契约实现不完整。** 注释与测试声明 pending 应禁用，但实现为 `disabled={disabled ?? pending}`；调用方显式传 `disabled={false}` 时，pending 不再禁用（`src/renderer/ui/design-system/button.tsx:33-56`，`src/renderer/ui/design-system/primitives.test.tsx:50-67`）。composer 正好同时传入 `disabled={draft.trim().length === 0}` 与 `pending={sending}`，发送中且 draft 非空时视觉上仍可点，虽然 `submit()` 自身会拦截，状态表达仍不一致（`src/renderer/features/chats/chat-detail-page.tsx:332-335,520-529`）。应改为 `disabled={disabled || pending}` 并补组合测试。
- **P2：Connection Provider 使用原生 select，绕过已接受的 Radix Select primitive。** 这会造成高度、focus、菜单 surface 和键盘表现与 sidebar/filter Select 不一致（`src/renderer/features/connections/connections-page.tsx:128-142` 对比 `src/renderer/ui/design-system/select.tsx:22-57`）。建议直接复用 `Select`，这是 ADR-0005 已明确允许且期望的消费方式。
- **P2：加载与流式状态对辅助技术不够明确。** 多处“加载中…”只是普通 `<p>`，streaming reply 和发送进度没有 `role=status`/受控 `aria-live`，只有 NewChat 列表容器声明 `aria-live=polite`（`src/renderer/features/bots/bots-page.tsx:332`，`src/renderer/features/chats/chats-page.tsx:75`，`src/renderer/features/chats/chat-detail-page.tsx:441-474`，`src/renderer/features/chats/new-chat-panel.tsx:52`）。建议建立 Status/Loading primitive 或统一约定；流式正文不要每个 token 播报，可只播报“正在回复/回复完成”。

### 6. 响应式与可访问性

**一致部分**

- Connection 双列布局在 `md` 以下变单列；sidebar 在窄窗口切换为 mobile header；Dialog 宽高使用 viewport 上限（`src/renderer/app.tsx:144,157-159,296-326`，`src/renderer/ui/design-system/dialog.tsx:17-23`）。
- 大多数 icon button 有 `aria-label`，装饰图标使用 `aria-hidden`；Field label 通过 `htmlFor` 关联输入；错误使用 `role=alert`（例如 `src/renderer/app.tsx:170-178,284-292`，`src/renderer/ui/design-system/field.tsx:14-31`，`src/renderer/ui/design-system/alert.tsx:40-50`）。
- reduced motion 在全局覆盖 animation/transition，头像动效另有显式降级（`src/renderer/ui/design-system/theme.css:205-213`，`src/renderer/ui/bot-avatar/bot-avatar.css:26-40`）。

**缺口**

- **P2：部分关键点击目标低于项目自己的窄窗口 44px 目标。** mobile header 中 icon Button 使用 32px，Chat 返回键也是 32px；虽然 header 有空间，但实际 target 未扩大（`src/renderer/ui/design-system/theme.css:111-115`，`src/renderer/ui/design-system/button.tsx:17-21`，`src/renderer/app.tsx:296-325`，`src/renderer/features/chats/chat-detail-page.tsx:375-394`）。建议为 mobile context 提供 `size=lg-icon`（44px）或在 header 局部扩大 hit area，桌面仍可保留 32px。
- **P2：低对比度文本有可读性风险。** 时间与 metadata 多处使用 `text-foreground/40`，sidebar 副标题使用 `/50`，在 `#fbfbfb/#fcfcfc` 上可能低于正文对比要求（`src/renderer/app.tsx:230-241`，`src/renderer/features/bots/bots-page.tsx:367-380`，`src/renderer/features/chats/chats-page.tsx:112-121`）。静态代码无法确认最终合成色，需用实际渲染做 WCAG 对比测量；若不足，统一改用 `muted-foreground` 或新增经过测量的 tertiary token。

## 测试覆盖评价

现有 primitive 测试覆盖 pending、disabled、Radix Select、Dialog 定位、Tooltip 焦点、Alert role 与 Field label 关联，是良好基础（`src/renderer/ui/design-system/primitives.test.tsx:50-285`）。New Chat 和 Bot creation 也有行为测试，但当前设计一致性仍缺以下回归保护：

1. `Button pending + disabled={false}` 必须禁用。
2. mobile shell 的 header + content 总高度不超过 viewport，Chat composer 可见。
3. Chat timeline、Alert、composer 始终共享同一 reading lane。
4. keyboard-only 流程：sidebar → Bot → Chat → 工作记录 popover → composer → 返回。
5. reduced-motion 下不运行 entry/pulse/smooth scroll；当前 CSS 禁用动画，但 `scrollIntoView({ behavior: "smooth" })` 仍由 JS 指定（`src/renderer/features/chats/chat-detail-page.tsx:367-372`）。
6. 状态播报：loading、sending、send error、stream complete。

## 可执行改进顺序

### 第一批：修正结构与状态契约（P1/P2，先做）

1. 修复 mobile shell 高度：主区改为 column flex，mobile header 固定，页面容器 `min-h-0 flex-1`；真实 Electron 验证窄窗口滚动与 composer。
2. 修复 Button 为 `disabled || pending`，增加组合测试；复核所有 pending 调用方。
3. 将 Connection 原生 select 替换为 Design System Select。
4. 为 mobile icon actions 提供至少 44px hit target。

### 第二批：收敛语义视觉（P2）

5. 决定并记录 message token 的真实用法，删除“定义但不消费”的状态。
6. 建立阻断 Alert / 行内 Notice 两级错误反馈，替代三套 feature 私有样式。
7. 将可见 9–10px 文本提升到 caption 11/16；测量 tertiary text 的真实对比度。
8. 为 loading/sending/completion 建立统一 status 语义，避免流式 token 过度播报。

### 第三批：增强连续性并清理细节（P2/P3）

9. 为窄窗口增加 roster surface，保留跨 Bot Chat 的连续导航与搜索。
10. 把页面常用文字映射到固定 typography role；盘点高频任意间距、圆角和阴影，只有稳定角色才新增 token。
11. 明确 `description` 与 Instructions 的领域含义后统一文案。
12. 补 keyboard、viewport、reduced-motion 和 status announcement 回归测试。

## 验收建议

完成第一、二批后，按计划中的真实 Electron 验证矩阵复核 Bot Library、Bot 菜单、Chat 列表、Chat 详情、新建 Chat，并额外固定以下视口：桌面宽屏、1024×700、窄窗口约 640×600。检查：

- sidebar/移动 roster 是否都能恢复已有 Chat；
- topbar、滚动区、composer 是否没有双滚动或裁切；
- 键盘焦点是否可见且顺序符合视觉顺序；
- loading/sending/error 是否同时具备视觉反馈和辅助技术反馈；
- reduced motion 下是否取消 CSS 动画和 JS smooth scroll；
- 文字对比、11px 最小字号和 44px 移动点击目标是否达标。

最终执行项目既定验证：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:arch`、`pnpm build`（`docs/ui/refinement-plan.md:40-48`）。
