# ADR-0005：Renderer Primitive 采用 shadcn/ui 模式（Tailwind + Radix + CVA）

状态：已接受

取代 Stage 05 期间在实施规范与 `theme.css` 头注释中冻结的 "不引入 Tailwind/shadcn/Base UI" 决策。

## 背景

`src/renderer/ui/design-system/` 最初是手写的最小 Primitive 集合（原生元素 + `ds-*` class + `primitives.css`）。视觉 token 已从历史实现 `.scratch/shadcn-daylight-cutover/design/target-system.md` 冻结移植，但组件实现没有使用 shadcn/ui 的标准栈（Tailwind CSS、Radix UI、class-variance-authority）。

## 决策

Renderer 的 Design System 改用 shadcn/ui 模式：

- **样式层**：Tailwind CSS v4，冻结的 daylight token 通过 `@theme inline` 映射为 Tailwind 主题变量；`primitives.css` 删除，控件视觉由 Tailwind 工具类承担。
- **组件层**：Primitive 组件用 class-variance-authority 组织 variant，交互组件（首个为 `Select`）基于 `@radix-ui/react-*`，图标用 `lucide-react`。
- **API 稳定**：`ui/design-system/index.ts` 的公开导出名与 Props 保持不变，Feature 层不因实现切换而改写；`Select` 因从原生 `<select>` 升级为 Radix 下拉，其消费方（`app.tsx` 连接选择器）按新 API 调整，这是唯一允许传导到 Feature 的接口变化。
- **范围不变**：仍只维护当前页面真实消费的组件集合（Button、Input、Textarea、Select、Field、Alert、Card、typography）；没有真实调用方的组件不进入 Design System。daylight 单主题、不做暗色与皮肤系统的约束不变。

## 理由

- 统一采用社区验证过的可访问性实现（Radix 的焦点管理、键盘导航、aria 模式），替代手写原生包装。
- CVA variant 系统替代字符串拼接 class，消除 `ds-button--${variant}` 这类实现耦合（现有测试确实钉在了拼接出的 class 名上）。
- token 仍由本客户端冻结拥有，Tailwind 只是消费方式，视觉结果不变。

## 后果

- `package.json` 新增 `tailwindcss`、`@tailwindcss/vite`、`@radix-ui/react-select`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react` 依赖。
- `scripts/check-architecture.mjs` 的依赖方向守卫不变：Renderer 仍不得 import Node/Electron/OpenAgentPack；Tailwind/Radix 属于渲染层依赖，不触及该边界。
- `primitives.test.tsx` 中钉在 `ds-*` class 名上的断言属于实现耦合，随实现重钉到用户可观察行为（disabled、aria-busy、role、variant 语义）。
