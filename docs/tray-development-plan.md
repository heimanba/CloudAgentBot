# 系统托盘开发计划

> 实施复核：结合当前工程后，首版保留 DesktopShell 深 Module，但不再新增独立 `window-activation.ts`，窗口激活策略直接隐藏在 DesktopShell Interface 后；当前打包目标只有 macOS/Linux，因此使用一份可缩放的单色 PNG，由 electron-vite `?asset` 入包并在运行时补充 1x/2x representation。Windows ICO 留到正式增加 Windows target 时交付，避免宣称未经验证的平台能力。

## 1. 目标与交付定义

为 CloudAgentBot 增加可发布的系统托盘能力，同时保持现有 Renderer + Electron Main 两进程拓扑，不新增 Background、跨层业务 Interface 或本地 Chat 持久化。

首版交付后的用户行为固定为：

1. 应用启动后创建唯一托盘图标和唯一主窗口。
2. 用户点击主窗口关闭按钮时，窗口隐藏但应用继续运行。
3. 点击托盘图标或菜单“打开 CloudAgentBot”时，恢复、显示并聚焦同一个主窗口。
4. 托盘菜单“退出”才真正退出应用。
5. 重复启动应用时不创建第二个进程或第二个托盘图标，而是唤起已有主窗口。
6. 窗口隐藏期间 Renderer 不销毁，当前页面和 SSE 订阅继续存在。

完成标准不是“开发环境能看到图标”，而是目标平台打包产物中的图标、关闭隐藏、恢复、单实例和退出流程均通过验证。

## 2. 架构约束

### 2.1 必须保持

- 托盘属于 Electron Main 的桌面外壳能力。
- Renderer、Preload、`DesktopHost`、shared model 和 Provider Adapter 不感知托盘。
- 托盘不直接调用 Connection、Bot、Chat 或 OpenAgentPack。
- 不增加本地 Chat、Message、Turn 或发送 Operation 持久化。
- 不复制 OpenMausBot 的 server、updater、Cua、deep link 或延迟退出协调。
- 应用只有一个主窗口和一个托盘实例；两者由同一个生命周期 Module 持有。

### 2.2 明确非目标

- 托盘菜单列出 Bot / Chat、直接发送消息或执行 Sync。
- 根据 Provider wire event 动态生成菜单。
- 开机自启动。
- 系统通知、未读数字、Windows balloon 或 macOS 状态栏标题。
- 隐藏窗口后暂停网络、销毁 Renderer 或恢复 SSE。
- 自动更新与签名发布流程。

这些能力只有在出现独立产品需求后再设计，不能借托盘首版顺带引入。

## 3. Module 与 Interface 设计

### 3.1 DesktopShell Module

新增 `src/main/shell/desktop-shell.ts`，作为托盘、主窗口和应用生命周期的深 Module。它隐藏以下实现复杂度：

- `mainWindow`、`tray`、`isQuitting` 和待处理第二实例激活状态；
- 主窗口首次创建、重新创建、恢复、显示和聚焦；
- 普通 close 转 hide；
- 显式 quit 放行真实关闭；
- `activate`、`second-instance`、`before-quit` 与 `window-all-closed` 的协作；
- 托盘和窗口事件解绑。

建议 Interface：

```ts
interface DesktopShell {
  start(): void;
}

function createDesktopShell(options: DesktopShellOptions): DesktopShell;
```

`bootstrap.ts` 只需要创建 Module 并调用 `start()`；托盘点击、macOS activate 和第二实例在 Module 内部调用同一个 `showMainWindow()`。测试通过原生事件和托盘 action 穿过 Interface，不直接读取内部状态。

`DesktopShellOptions` 接受依赖而不是在测试中加载真实 Electron：

```ts
interface DesktopShellOptions {
  app: Pick<App, "on" | "quit">;
  createWindow(): BrowserWindow;
  createTray(actions: { open(): void; quit(): void }): Tray;
}
```

实现时可用最小结构类型替代完整 Electron 类型，以避免 fake 必须实现无关方法。不要为了测试引入通用事件总线或 Electron Adapter 层；这里只保留真实变化点需要的内部 seam。

### 3.2 AppTray Module

新增 `src/main/tray/app-tray.ts`，Interface 保持为一个创建函数：

```ts
interface TrayActions {
  open(): void;
  quit(): void;
}

function createAppTray(actions: TrayActions): Tray;
```

实现职责：

- 选择当前平台的图标；
- 用 `nativeImage` 加载并校验图标非空；
- macOS 设置 Template Image；
- 创建并长期返回 `Tray` 强引用；
- 设置 tooltip；
- 创建“打开 CloudAgentBot”“退出”两项菜单；
- 托盘 click 调用 `open()`；菜单项复用相同回调。

这个 Module 不持有窗口，不知道 `isQuitting`，也不导入任何业务 Module。删除它后，托盘资源和原生菜单复杂度应集中消失，而不是散回 `bootstrap.ts`。

### 3.3 窗口激活策略

新增 `src/main/windows/window-activation.ts`，参考 OpenMausBot 已验证的顺序：

```text
窗口不存在或已销毁 → 创建并绑定生命周期
窗口最小化          → restore
窗口隐藏            → show
最后                → focus
```

该策略供托盘、macOS activate 和第二实例共同使用。本客户端只操作明确持有的 `mainWindow`，不从 `BrowserWindow.getAllWindows()` 猜测目标。

## 4. 生命周期状态机

```text
starting
  ├─ 单实例锁失败 ───────────────> exit
  └─ app ready
       ├─ 创建主窗口
       ├─ 创建托盘
       └─ running-visible

running-visible
  ├─ 普通 window.close ─────────> running-hidden
  ├─ 显式 quit ─────────────────> quitting
  └─ OS shutdown / app quit ────> quitting

running-hidden
  ├─ tray click/open ───────────> running-visible
  ├─ app activate ──────────────> running-visible
  ├─ second-instance ───────────> running-visible
  └─ 显式 quit ─────────────────> quitting

quitting
  ├─ isQuitting = true
  ├─ 窗口 close 不再 preventDefault
  ├─ 销毁 tray
  └─ app quit
```

关键不变量：

- `isQuitting=false` 时，主窗口 `close` 必须 `preventDefault()` 并 `hide()`。
- `requestQuit()` 必须先设置 `isQuitting=true`，再调用 `app.quit()`。
- `before-quit` 也设置 `isQuitting=true`，覆盖 Dock、系统菜单和操作系统发起的退出。
- `window-all-closed` 不再调用 `app.quit()`；正常情况下 close-to-hide 甚至不会销毁主窗口。
- `closed` 后必须清空 `mainWindow`；后续打开动作可以安全重建。
- `tray` 必须由 `DesktopShell` 持有强引用，退出时销毁并清空。
- `start()` 应幂等，避免重复创建窗口或托盘；Module 与 Electron Main 同生命周期，不增加当前没有调用方的 dispose Interface。

## 5. 单实例策略

在任何窗口或托盘创建之前调用 `app.requestSingleInstanceLock()`：

1. 获取失败：立即退出当前进程，不继续 `app.whenReady()` 装配。
2. 获取成功：注册 `second-instance`。
3. 主窗口已经就绪：直接调用 `showMainWindow()`。
4. ready 前收到激活：记录一次 pending activation，在 `DesktopShell.start()` 后消费。

本客户端当前没有 deep link，不复制 OpenMausBot 的命令行 URL 分发。首版忽略第二实例参数，只负责唤起现有窗口。

单实例锁应在 `src/main/index.ts` 或 `bootstrap()` 最早的同步阶段取得。最终选择以“失败实例不会注册 IPC、创建 Composition、窗口或托盘”为验收条件。

## 6. 图标与打包资源

### 6.1 资源清单

建议新增：

```text
src/main/tray/assets/
  trayTemplate.png       # macOS 16×16，单色 + alpha
  trayTemplate@2x.png    # macOS 32×32，Retina
  tray.ico               # Windows，多尺寸 ICO
  tray.png               # Linux，透明 PNG
```

应用安装图标和托盘图标分别维护。不能直接复制 OpenMausBot 品牌图标，也不能把彩色应用图标机械缩小后当 macOS Template Image。

### 6.2 构建策略

优先通过 electron-vite 的 `?asset` 从 Main 导入图标，使资源进入 Main 构建输出并得到可运行路径。加载后：

1. `nativeImage.createFromPath(path)`；
2. 断言 `isEmpty() === false`，资源缺失时启动失败并输出不含敏感数据的明确错误；
3. macOS 调用 `setTemplateImage(true)`，不依赖打包后文件名仍以 `Template` 结尾；
4. 将 `NativeImage` 传给 `new Tray(image)`。

如果 electron-vite 实际构建结果不能稳定保留 ICO 或 `@2x` 配对，则改为 `electron-builder.yml` 的显式 `extraResources`，通过 `process.resourcesPath` 解析。不能同时保留两套含糊的资源查找回退。

### 6.3 发布平台

- macOS：验证浅色/深色菜单栏和 Retina；Template Image 不显示彩色底块。
- Windows：使用多尺寸 ICO，验证 100%、150%、200% DPI；正式增加 Windows target 时纳入 gate。
- Linux：验证至少一个 StatusNotifierItem 环境；核心打开动作不能依赖固定左右键语义。

当前 builder 只产出 macOS 与 Linux `dir`，因此首个实施 PR 至少要完成这两个平台的资源路径；Windows 资源和测试可准备，但不能宣称已发布验证。

## 7. 文件级实施清单

### 阶段 A：窗口激活与单实例基础

新增：

- `src/main/windows/window-activation.ts`
- `src/main/windows/window-activation.test.ts`

修改：

- `src/main/index.ts`：在启动早期获取单实例锁；失败实例直接退出。
- `src/main/bootstrap.ts`：注册第二实例激活入口；不引入业务参数解析。

验收：

- 最小化窗口依次执行 restore/show/focus。
- 隐藏窗口执行 show/focus。
- 已可见窗口只聚焦，不创建第二个窗口。
- 已销毁/缺失窗口进入创建路径。
- 第二次启动不会创建新的 Composition、BrowserWindow 或托盘。

### 阶段 B：DesktopShell 生命周期

新增：

- `src/main/shell/desktop-shell.ts`
- `src/main/shell/desktop-shell.test.ts`

修改：

- `src/main/bootstrap.ts`：把 `createMainWindow()`、activate、window-all-closed 和退出处理交给 DesktopShell。
- `src/main/windows/main-window.ts`：保留窗口安全配置，只提供窗口创建；不要加入业务状态。

验收：

- 普通 close 被转换为 hide。
- hide 后调用 show 复用同一个窗口和 Renderer。
- requestQuit 放行 close 并调用 app.quit。
- OS/应用菜单触发 before-quit 时不会被 close guard 阻止。
- destroyed 窗口可以重建且事件只绑定一次。
- `will-quit` 会销毁托盘。

### 阶段 C：托盘与菜单

新增：

- `src/main/tray/app-tray.ts`
- `src/main/tray/app-tray.test.ts`
- `src/main/tray/assets/*`

修改：

- `src/main/bootstrap.ts`：向 DesktopShell 注入 `createAppTray`。
- `electron.vite.config.ts` 或 `electron-builder.yml`：只在构建验证证明需要时补充资源规则。

验收：

- ready 之后只创建一个 Tray。
- click 与“打开 CloudAgentBot”调用同一个 open action。
- “退出”调用 requestQuit，而不是直接操作窗口。
- tooltip 为 `CloudAgentBot`。
- 图标为空时 fail-fast；不发布不可见托盘。
- Linux 如动态重建菜单，重新调用 `setContextMenu()`。

### 阶段 D：验证与文档收口

修改：

- `scripts/smoke-packaged.mjs`：保留现有 UI smoke，并使清理不依赖关闭按钮触发退出。
- 可新增 `scripts/smoke-tray-packaged.mjs`：验证窗口 close 后进程仍存活、重新激活后还是同一实例、最终显式结束测试进程。
- `docs/validation.md`：增加托盘用户流程和代表性故障。
- `docs/architecture.md`：在 Electron Main 中记录 DesktopShell/Tray 的位置；不改变两进程拓扑。
- `docs/repository-layout.md`：记录 `main/shell/`、`main/tray/` 和托盘资产放置规则。
- `README.md`：如果面向用户描述关闭行为，明确“关闭窗口后仍在托盘运行；从托盘退出”。

验收：

- 代码、架构文档、用户说明和 packaged 行为一致。
- 现有 smoke 不因 close-to-hide 永久挂起。
- 不使用远程 Provider 凭据，不创建 Cloud 资源。

## 8. 测试计划

### 8.1 单元测试

`window-activation.test.ts`：

- 可见窗口聚焦；
- 最小化窗口先 restore；
- 隐藏窗口 show；
- 已销毁窗口拒绝复用；
- 调用顺序固定为 restore → show → focus。

`desktop-shell.test.ts`：

- start 只创建一次窗口和托盘；
- close 在非退出状态 preventDefault + hide；
- tray open、activate、second-instance 共用 showMainWindow；
- 窗口 closed 后引用清空，下一次打开重建；
- requestQuit 先切换退出状态再调用 quit；
- before-quit 放行窗口关闭；
- window-all-closed 不退出；
- will-quit 清理托盘。

`app-tray.test.ts`：

- 正确选择平台资源；
- 空图标失败；
- macOS 设置 template；
- 菜单标签、tooltip 和回调正确；
- click/open 复用相同 action；
- quit 菜单不绕过 DesktopShell。

测试优先使用结构化 fake，不加载真实 Electron GUI；不要对私有字段做快照。

### 8.2 静态与构建门禁

每个阶段至少运行：

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm test:arch
pnpm build
```

资源接入后还必须运行：

```text
pnpm package
pnpm smoke:packaged
```

并检查打包目录中实际存在托盘资产，使用 `nativeImage` 打开后非空。

### 8.3 Packaged smoke

自动化可稳定覆盖：

1. 打包应用启动且 CDP 页面可用；
2. 请求关闭主窗口后，进程仍存活；
3. 再次启动相同应用不会产生第二实例；
4. 原实例窗口能够重新显示并继续响应 `desktopHost`；
5. 测试通过显式测试清理或进程信号结束，不把 `win.close()` 当退出手段。

原生托盘点击受桌面环境影响，不强行用脆弱坐标自动化。以下保留为每个平台的发布前人工 smoke：

- 图标存在、清晰、深浅主题正确；
- 左键/平台激活动作能打开窗口；
- 右键菜单可用；
- “打开 CloudAgentBot”恢复同一窗口；
- “退出”移除托盘并终止进程；
- 无孤儿进程、重复托盘或幽灵窗口。

## 9. 故障处理与可观测性

- 图标加载失败：启动阶段 fail-fast，错误只包含资源类别和安全路径，不继续创建空托盘。
- 主窗口创建失败：保留错误日志；不要让托盘“打开”无限创建失败窗口。
- 重复 start：忽略或明确抛出开发期错误，生产中不得创建第二托盘。
- Tray 已销毁：showMainWindow 仍可恢复窗口；退出/重建策略由 DesktopShell 集中处理。
- 单实例锁失败：失败进程立即退出，不执行 IPC 注册或本地存储装配。
- 隐藏期间 SSE 断开：沿用现有有限续传/重读历史规则，不由托盘自动重发 Message。
- 系统强制终止：不承诺收到 before-quit；本客户端没有需要退出时提交的 Chat 持久状态。

日志只记录生命周期状态和错误分类，不记录 credential、Message 正文、Project Document 或 Provider response。

## 10. 提交与评审拆分

建议拆成三个可独立评审的提交或 PR：

1. **窗口激活与单实例**：纯生命周期基础及单元测试，不改变关闭语义。
2. **托盘与 close-to-hide**：DesktopShell、AppTray、专用资产及单元测试；这是用户行为变更点。
3. **打包验证与文档**：packaged smoke、平台资源修正、validation/architecture/repository-layout/README 收口。

第二步不能在没有第三步验证计划的情况下宣称“可发布”。如果必须合并为一个 PR，也应保持这三个 commit 边界，便于定位和回滚。

## 11. 验收清单

功能：

- [ ] 启动后只有一个主窗口和一个托盘图标。
- [ ] 关闭按钮隐藏窗口，不退出进程。
- [ ] 托盘 click 和“打开”恢复同一窗口。
- [ ] 最小化窗口先 restore 再聚焦。
- [ ] 托盘“退出”能完整退出。
- [ ] 第二次启动只唤起已有实例。

架构：

- [ ] 托盘只存在于 Main。
- [ ] DesktopHost、Preload、Renderer、shared Interface 无变化。
- [ ] 托盘 Module 不依赖业务 Module 或 Provider。
- [ ] 没有新增 Background、数据库或本地 Chat 状态。

质量：

- [ ] 单元测试覆盖生命周期状态机与回调顺序。
- [ ] typecheck、lint、unit、architecture、build 全部通过。
- [ ] package 与 packaged smoke 通过。
- [ ] macOS/Linux 目标环境人工 smoke 通过；Windows 仅在正式 target 与实机验证后勾选。
- [ ] 打包产物图标非空且各 DPI/主题可辨识。
- [ ] 现有 Chat/SSE 在 hide/show 后保持连续，显式退出不停止 Provider 已接受的远程运行。

## 12. 主要风险与回滚

### 风险

- 用户误以为关闭窗口等于退出，导致后台网络继续活动。
- 托盘资源在开发环境可用但打包后路径失效。
- close guard 错误拦截 `app.quit()`，造成无法退出。
- 单实例事件早于窗口创建，激活请求丢失。
- packaged smoke 继续依赖窗口关闭结束进程而挂起。
- Linux 桌面环境不展示或改变托盘激活手势。

### 缓解

- 首次关闭或 README 明确说明关闭到托盘；是否增加一次性提示由产品另行决定。
- 图标加载 fail-fast，并以实际打包产物验证。
- `before-quit` 与 requestQuit 双路径设置 `isQuitting`。
- 缓存 ready 前的第二实例激活。
- 测试显式区分 hide 和 quit。
- Linux 核心功能同时放在 context menu，不只依赖 click。

### 回滚

托盘能力应能通过删除 DesktopShell 中的 Tray 注入并恢复原 `window-all-closed` 策略整体回滚，不影响 DesktopHost、业务 Module、本地 IaC 或 Provider 数据面。窗口激活与单实例基础可以保留，因为它们独立提升桌面应用行为。

## 13. 实施前唯一产品确认

本计划默认“关闭按钮 = 隐藏到托盘，窗口隐藏期间 SSE 继续”。如果产品希望“关闭按钮 = 真退出，仅最小化进入托盘”，必须在编码前改写生命周期状态机、用户文案和 packaged smoke；不要在实现过程中临时混合两种语义。
