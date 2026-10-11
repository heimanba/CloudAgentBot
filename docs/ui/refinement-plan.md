# 交互精致化实施计划

## 目标

在不改变 Provider、Bot、Chat 身份与事实权威的前提下，把 Renderer 从“管理后台列表”调整为以 Bot 工作状态和对话连续性为中心的桌面工作区。

## 设计原则

- 页面结构优先使用现有 shadcn 风格 primitives、Tailwind CSS 与设计 token。
- 静态结构保持克制；只有状态变化、页面进入和流式内容使用短动效。
- Bot 列表优先回答“它是谁、负责什么、现在怎样”，实现属性进入次级层级。
- Chat 默认呈现消息与成果；Thinking、Tool、Usage 等技术事件归入可展开的工作记录。
- 不新增本地 Chat、Message、Turn 或 Operation 持久化，不改变远程身份规则。
- 所有动效尊重 `prefers-reduced-motion`。

## 实施批次

### 1. 基础交互语言

- 补充统一的页面进入、内容进入和状态脉冲动效 token。
- 统一 hover、selected、focus-visible 和 disabled 状态。
- 保持 Electron drag region 与窗口布局 CSS，其余新视觉优先通过 Tailwind 表达。

### 2. Bot Library

- 将 Bot 行改为整卡可点击的两列响应式布局。
- 主层级展示头像、名称、职责描述和远程状态。
- 模型、Managed/Remote-only/State-missing 降级为次级 metadata。
- IaC Sync/编辑继续保留在管理菜单中。
- 新建 Bot 表单使用 Card、Field、Button 等现有 primitives。

### 3. Chat 工作区

- 消息作为时间线主层级。
- 技术事件使用紧凑 activity card，并保持展开查看原始安全 view model 的能力。
- 筛选与搜索收进可展开的“工作记录”工具区。
- 流式回复增加明确的活动状态；发送、失败和刷新继续遵守现有数据面规则。

### 4. Sidebar 与连续性

- 增强当前 Chat 指示、状态摘要、hover/selected/focus 转场。
- 页面切换和新建 Chat Surface 使用轻量进入动效。
- 不引入模拟 macOS 窗口或营销页式装饰。

## 验证

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:arch`
- `pnpm build`
- 在真实 Electron 应用中检查 Bot Library、Bot 菜单、Chat 列表、Chat 详情和新建 Chat。
- 检查窄窗口、键盘 focus、空状态、加载状态和 reduced-motion。

## 设计一致性收敛（2026-09-18）

依据 `docs/ui/design-consistency-audit.md`，后续修复按风险而不是按页面推进。

### 第一批：结构与状态契约

- 主工作区统一为 `header + min-h-0 content` 的纵向高度模型，避免窄窗口底部输入框被裁切。
- `Button` 的 `pending` 必须无条件禁用控件，并覆盖 `disabled={false}` 的组合测试。
- Connection Provider 选择器复用 Design System `Select`，不再维护原生控件的第二套外观。
- 窄窗口 topbar 的主要图标操作使用至少 44px 的点击区域。

### 第二批：视觉与辅助技术语义

- Message 必须消费已冻结的 user/assistant token；可见 metadata 不小于 caption（11/16px）。
- 时间、次级信息统一使用可测量的语义颜色，不使用未经验证的低透明度正文色。
- loading、sending 和 streaming completion 提供克制的 live status；流式 token 本身不逐字播报。
- reduced-motion 同时约束 CSS 动效和 JavaScript smooth scroll。
- Bot 创建表单把 `description` 表述为职责描述，不把它误称为 Instructions。

### 第三批：连续性与复用

- 为窄窗口补充可搜索的 Chat roster surface，恢复跨 Bot 切换连续性。
- 将阻断 Alert 与行内 Notice 明确为两级反馈组件，清理 Feature 私有错误样式。
- 盘点重复三次以上的排版、间距、圆角和阴影角色后再沉淀 token，避免为一次性数值扩张主题。

### 新增验收条件

- 约 640×600 窗口中 topbar、唯一滚动区与 composer 同时可用，无横向溢出或底部裁切。
- Chat timeline、错误反馈和 composer 始终共享同一阅读列。
- keyboard-only 可完成 sidebar → Bot → Chat → 工作记录 → composer → 返回。
- loading/sending/error 有视觉与辅助技术反馈，reduced-motion 下不触发平滑滚动。
- 可见辅助文本不低于 11px；移动主要点击目标不小于 44px。
