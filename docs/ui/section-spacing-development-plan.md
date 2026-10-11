# Renderer Section 内部间距收敛计划

## 1. 目标与完成定义

在不改变本产品信息架构、页面宽度、业务流程和 Design Token 的前提下，收敛 Renderer 中同一视觉角色的内部间距，并删除会制造第二套间距规则的不可达 UI。

本计划只处理已经通过源码结构和实际布局计算确认的问题，不以“所有数值相同”为目标。完成后应满足：

- 同一表单内，相邻一级内容块使用一致的垂直间距；
- section 标题、说明、内容和操作区形成可复用的层级节奏；
- Connection 设置只保留当前 onboarding/settings 两套真实入口，不再维护不可达的旧布局；
- Bot 创建与编辑的相同结构保持逐项一致；
- 不为一次性间距新增 Design Token 或无真实调用方的 Primitive；
- 桌面与窄窗口的内容不发生裁切、横向溢出或密度突变。

## 2. 复核结论

### 2.1 确认需要修复

#### A. Bot 创建与编辑标题区存在重复的外部间距控制

`CreateBotForm` 与 `BotSettingsForm` 原先都使用：

```text
form gap-6
  header mb-1 pb-6
  field
```

真实窗口复核进一步确认：问题不只是 `mb-1`，而是 header、字段、Alert 和 actions 全部处于同一个扁平 `gap-6` 中，header 又使用 `pb-6`，导致分隔线前后和各字段之间都消费同一档大间距，表单被纵向拉散。由于项目根字号为 14px，当前 Tailwind rem spacing 的 `gap-6` 真实计算值约为 21px。

最终修复应建立三层结构：表单根、字段组和操作区。表单根与字段组使用 `gap-5`，header 使用 `pb-5`；创建和编辑保持同构。

涉及文件：

- `src/renderer/features/bots/bots-page.tsx`
- `src/renderer/features/bots/bot-settings-form.tsx`

#### B. ConnectionsPage 保留不可达的第三套布局

`mode` 类型和默认值只允许 `onboarding | settings`，函数已分别在两个分支返回；其后的最终 `return` 不可达。该旧布局维护另一套 `gap-4/gap-5/pt-4/pt-5` 组合，会干扰审计、增加修改遗漏风险，也让同一产品页面看似存在三套 section 节奏。

应删除不可达分支及仅被该分支消费的状态、处理函数和 import；如果 TypeScript 控制流或测试暴露真实调用路径，则停止删除并先修正 mode 合同，不得把第三种模式隐式恢复。

涉及文件：

- `src/renderer/features/connections/connections-page.tsx`
- `src/renderer/features/connections/connections-page.test.tsx`

#### C. 缺少针对间距结构的稳定验收口径

当前测试覆盖行为和语义，但没有明确保护“创建/编辑表单结构一致”“Dialog 三段横向共轴”“Connection 详情 section 使用同一标题—内容关系”。后续改动仍容易重新引入局部 margin 叠加。

不建议直接断言完整 Tailwind class 字符串。应对少量关键容器增加稳定的 `data-*` 结构标记，并在组件测试中断言：

- Bot 创建/编辑的表单根、标题区、字段组、操作区结构一致；
- Skill Dialog 的 header/body/footer 使用同一横向 gutter；
- Connection 设置的常规、环境、凭据、危险操作都位于同一个 section stack 中。

真实像素值继续由 Electron 视觉验收确认，避免 happy-dom 测试伪装成布局测试。

### 2.2 复核后确认不是问题

以下实现保持不变：

- Connection 详情的普通 section 使用 `gap-5`，标题到内容使用 `mb-3`，卡片使用 `p-4`；层级一致。
- “危险操作”使用 border 和更大的前置留白；这是破坏性操作的有意隔离，不应压缩成普通 section。
- Skill Dialog body 的 `py-3` 与列表项自身 `py-3.5` 共同形成首尾留白，不存在内容贴边；不改为 `py-4`。
- Chat timeline 使用 `gap-4`，反馈区使用 `mb-3`，两者分别表达消息节奏与反馈节奏；不强行合并为同一数值。
- Card 的 `p-4`、Field 的 `gap-2`、按钮组的 `gap-2` 已形成稳定 Primitive 级基线。
- topbar 的 `[5px]`、`[18px]` 属于固定 52px 工具栏的光学校准，本计划不把它们纳入内容 section 的间距整改。

## 3. 间距口径

本轮采用现有 Tailwind scale，不新增 theme token：

| 角色 | 口径 | 适用范围 |
| --- | --- | --- |
| 页面 gutter | `px-5`，宽屏 `px-8` | Bot、Chat 内容页 |
| 页面垂直留白 | `py-8`，宽屏可用 `py-10` | 独立表单页 |
| 一级内容块 | `gap-5` | 创建/编辑表单 |
| 设置 section | `gap-5` | Connection 详情 |
| section 标题到内容 | `mb-3` | Connection 常规 section |
| 卡片内部 | `p-4` | 设置卡片、普通内容卡片 |
| 字段内部 | `gap-2` | `Field` 的 label/control/description |
| 紧密内容组 | `gap-3` | 卡片行、列表项、局部表单组 |
| 按钮组 | `gap-2` | footer、行内操作 |

允许因为语义或光学校准偏离上述口径，但偏离必须局部、可解释，不通过新增全局 token 固化。

## 4. 实施批次

### 批次一：删除无语义偏差

1. 删除 Bot 创建、编辑表单标题区的 `mb-1`。
2. 将表单根从扁平 `gap-6` 收敛为 `gap-5`。
3. 建立独立字段组并使用 `gap-5`，把 Alert 保留在字段组内。
4. 将 header 内部分隔留白从 `pb-6` 收敛为 `pb-5`。
5. 对照两份表单，确保 header、字段组、Alert、actions 的结构一致；不修改字段内容或业务行为。

验收：标题区、字段组和操作区边界清晰；标题到字段组、字段之间和字段组到 actions 均由 `gap-5` 控制。

### 批次二：删除 Connection 不可达布局

1. 证明 `mode` 的所有生产调用只传入 `onboarding` 或 `settings`。
2. 删除两个已返回分支之后的旧 JSX。
3. 使用 TypeScript、ESLint 和测试定位并删除仅由旧 JSX 消费的变量、回调与 import。
4. 保留 onboarding 和 settings 的现有间距，不在清理过程中重新设计页面。

验收：ConnectionsPage 只有两条可达渲染路径；行为测试继续覆盖添加、更新、验证、断开、环境设置和删除确认。

### 批次三：加入低脆弱度的结构保护

1. 仅在测试无法稳定定位时，为关键布局容器增加语义化 `data-*` 标记。
2. 增加 Bot 创建/编辑结构一致性测试。
3. 增加 Connection settings section stack 测试。
4. 保留现有 Skill Dialog 测试，并补充 header/body/footer 共轴的结构检查；不快照完整 className。

验收：测试能发现重复 margin、缺失 section wrapper 或 Dialog 某一段脱离统一 gutter，但不会因为无关颜色或动效 class 调整失败。

### 批次四：真实 Electron 视觉验收

固定检查以下场景：

1. 创建 Bot：空表单、Skill 已选择、错误 Alert 出现；
2. 编辑 Bot：加载、正常表单、pending changes、保存失败；
3. Connection onboarding：首次添加、待补凭据、选择 Environment；
4. Connection settings：常规、Environment 展开、凭据成功提示、危险操作；
5. Skill Dialog：已安装和技能市场两个 tab，空态、长描述和两列卡片；
6. Chat detail：普通消息、连续错误反馈、composer 多行输入。

视口至少覆盖：

- 桌面默认窗口；
- `1024×700`；
- 约 `640×600` 的窄窗口。

检查标准：

- 同级内容块的视觉间距没有无语义的 4–8px 跳变；
- 标题、正文、卡片和 footer 左右共轴；
- 动态插入 Alert、Environment 列表或验证成功提示后，不出现双倍 margin；
- 无横向溢出、底部裁切或双滚动；
- 危险操作仍明显与普通设置分离。

## 5. 验证命令

按 UI 规范运行：

```bash
pnpm typecheck
pnpm lint
pnpm test src/renderer/features/bots
pnpm test src/renderer/features/connections
pnpm test src/renderer/ui/design-system
pnpm build
```

若修改了任何 Design System Primitive，再额外检查其全部真实 Feature 调用方。本计划预期不需要修改 Primitive。

## 6. 非目标与停止条件

本轮不处理：

- 页面宽度、字体、颜色、圆角、阴影或导航结构重设计；
- 把所有任意值替换成 token；
- 新建通用 Section、Stack 或 FormLayout Primitive；
- 改变 Connection、Bot、Chat 的业务流程；
- 以测试便利为由引入截图测试框架或浏览器运行时依赖。

如果真实 Electron 走查表明某个“保留不变”项造成明显错位，先记录截图、视口和计算后的间距，再单独调整；不得依据主观感觉批量重写所有 spacing class。

## 7. 实施记录（2026-09-20）

已完成：

- 删除 Bot 创建、编辑标题区重复的 `mb-1`，并在真实窗口复核后将扁平 `gap-6/pb-6` 改为分层 `gap-5/pb-5`；
- 删除 Bot 创建、编辑标题区的内部 `border-b`，以留白表达标题与字段分组；
- 真实页面复核后删除内层表单卡片的边框、背景、圆角、阴影和 padding：Bot 页面 section 本身已经提供页面边界，内层仅保留 `max-width` 布局约束，避免 section 套 section；
- 删除 `ConnectionsPage` 两个有效 mode 分支之后的不可达旧布局及无用变量/import；
- 为 Bot 表单、Connection section stack、Skill Dialog 三段增加局部结构标记；
- 增加对应的结构回归断言；
- 通过 typecheck、lint、Bots/Connections/Design System 测试和生产构建；
- 使用真实开发窗口复现并检查 Bot 创建页面，确认修复后标题区、字段组和 actions 的视觉节奏收紧且共轴；
- 使用独立 Electron 构建产物检查 onboarding：默认窗口和模拟 `640×600` viewport 均无横向溢出或页面高度溢出，Dialog 保持在 viewport 内。

Bot 创建页面已使用具备真实本地数据的开发窗口完成视觉走查。Bot 编辑、Connection 设置和 Chat 动态状态继续由结构测试与现有 Feature 测试覆盖。
