# CloudAgentBot Agent 规则

本文件适用于当前独立仓库的全部工作。执行和验收不依赖父目录的文档、workspace 或源码。

## 权威顺序

执行本目录工作时按以下顺序解决冲突：

1. `CONTEXT.md`：产品对象、身份与事实权威；
2. `docs/adr/`：已接受且难以撤销的决策；
3. `docs/architecture.md`：进程、Module、依赖方向和范围；
4. `docs/repository-layout.md`：源码和测试放置；
5. `docs/local-storage.md`：本地文件、原子写和恢复规则；
6. `docs/interfaces.md`：跨层与内部 Interface；
7. `docs/validation.md`：验收矩阵与真实 Cloud 规则。

历史实现只作为历史教训，不是本规范。不得从历史实现复制 Background、Kernel、Operation、Projection、SQLite 产品模型或跨进程协议。

## 执行方式

实施前完整读取本文件和 `CONTEXT.md`，按上述权威顺序解决冲突。所有产品代码、配置和测试写入本目录。

遇到以下情况必须停止并记录阻塞，不自行改变架构：

- 需要从 OpenAgentPack 的 `internal` 路径导入代码；
- 需要新增本地 Chat、Message、Turn 或发送 Operation 持久化；
- 需要恢复 Background、SQLite、Projection/Event replay 或通用 Provider capability；
- 除 `phase=new` 的首次创建外，`agents.state.json` 缺失时只能通过重新 `apply` 才能继续；
- 第二个 Provider 尚无真实数据面合同却要求抽象其行为；
- 实现需要改变 Bot/Chat 的远程身份规则。

## UI 实现规范

涉及 Renderer UI、Design Token、Primitive 或 Feature 页面样式时，遵守以下细则：

1. **优先使用 shadcn/ui 官方组件**。当 `ui/design-system` 缺少所需 Primitive 时，优先通过 shadcn CLI（`npx shadcn add <component>`）或等效方式引入官方实现；只有在官方组件无法满足冻结视觉或行为需求时，才允许基于 `@radix-ui/react-*` + Tailwind + CVA 自研，并记录原因。
2. **所有视觉样式使用 Tailwind CSS v4 工具类**。禁止手写 `.css` 文件或内联 `<style>` 添加样式；冻结 token 统一来自 `src/renderer/ui/design-system/theme.css`，业务代码不得引入新的颜色、间距、圆角、阴影等设计常量。
3. **业务 Feature 不得自行拼装复杂交互组件**。弹窗、表单、菜单、下拉等必须由 `ui/design-system/index.ts` 公开的统一 Primitive 组合；破坏性/不可逆操作（删除、清空、归档等）必须使用 AlertDialog 语义组件，不得使用普通 Dialog。
4. **新 Primitive 进入 design-system 的门槛**：必须有至少一个真实 Feature 调用方才添加；只为准需求预建组件库是过度设计。
5. **修改 Primitive 后必须运行**：`pnpm typecheck`、`pnpm lint`、`pnpm test src/renderer/ui/design-system`，并检查相关 Feature 测试。

这些细则与 ADR-0005（采用 shadcn/ui 模式）一致，是对其执行方式的约束：shadcn/ui 模式指复制/使用官方组件实现，而非仅模仿其技术栈自行发明。

## 文档与工作记录

新增或大幅修改的项目文档使用中文；标识符、命令、路径、Schema 字段和必要的上游原文保留原语言。现行规则写入上述权威文档；长期 Provider 证据放在 `docs/research/`，实际验收结果放在 `docs/validation-records/`。临时探针、补丁、截图和个人计划放入忽略的 `.scratch/`，不作为现行规范的依赖。

## 风险驱动验证与代码规模

新增或修改测试前，明确它保护的用户流程、业务不变量、模块/进程/Provider 合同、恢复路径或历史缺陷；通过公开 Interface 或可观察结果验证。选择最少的代表性成功、拒绝、边界和失败场景；删除已失效、依赖实现步骤或与其他层重复的测试。类型保证、简单透传和框架默认行为无需独立测试。

测试归属与保真：

- Provider HTTP/SSE 合同优先由 Adapter 调用真实 Client、替换网络响应的测试保护；底层重复用例的独有断言先迁移到该边界。静默流与显式 `done` 是不同场景，不能用发送 `done` 的 mock 证明自然断流或首帧前订阅完成。
- 负向断言先证明目标路径可达：权限测试必须显示被限制的资源，异步 UI 测试必须等初始化与事件处理完成。文件失败测试应实际触发所声称的失败阶段，并验证恢复结果。
- 冻结视觉与历史布局缺陷属于独立合同；删除 class 断言前必须有等价证明。Portal 脱离容器不证明弹窗定位，样式字符串互不相同不证明语义颜色正确。

修改前后检查目标文件及同目录测试规模。生产源码超过 800 行、测试或脚本超过 1000 行时，评估职责拆分；新增独立职责应先拆出，局部修复可保留结构但应记录理由。自动生成文件、lockfile、vendored code 和构建产物不计入。按变化原因拆分，不按行数机械切文件。

完整本地门禁为 `pnpm gate`；真实 Cloud 测试另行显式启用，命令和平台范围见 `docs/validation.md`。打包因 Electron 下载超时失败时，可使用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm package` 重试，再执行打包验收。

## Cloud 验证

真实 Cloud 测试可使用仓库现有 `.env`，不得输出、修改或提交凭据。资源必须使用唯一前缀和测试 metadata；测试完成后删除临时 Session 与 Agent。Provider 因引用关系拒绝删除 Environment 时，按 Provider 正式协议归档，并在验证记录中明确说明。
