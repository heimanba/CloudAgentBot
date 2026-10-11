# 目录与放置规则

CloudAgentBot 是单 package Electron 应用。目录按运行位置划分，Main 内再按控制面、数据面和本地资产的变化原因组织；首版不建立 workspace package。

```text
V2/
  package.json
  electron.vite.config.ts
  tsconfig.json
  src/
    main/
      bootstrap.ts
      composition.ts
      desktop-host.ts
      shell/
        desktop-shell.ts
      tray/
        app-tray.ts
        assets/
      windows/
      ipc/
      credentials/
        credential-store.ts
        electron-safe-storage.ts
      connections/
        connection-manager.ts
        connection-store.ts
      control-plane/
        bot-control-plane.ts
        managed-bot-store.ts
        project-document.ts
        scope-lock.ts
        openagentpack-adapter.ts
      data-plane/
        chat-data-plane.ts
        chat-adapter.ts
        providers/
          qoder/
            qoder-chat-adapter.ts
            qoder-client.ts
            qoder-http.ts
            qoder-sse.ts
            qoder-wire.ts
            qoder-mapper.ts
            qoder-errors.ts
      providers/
        provider-definition.ts
        qoder.ts
    preload/
      index.ts
      desktop-host.ts
    renderer/
      bootstrap.tsx
      app.tsx
      desktop-host.ts
      shell/
      features/
        connections/
        bots/
        chats/
        deployments/
      ui/
      test-support/
        mount.tsx
    shared/
      desktop-host-contract.ts
      models.ts
      schemas.ts
      errors.ts
  tests/
    integration/
    acceptance/
    live/
  docs/
    adr/
```

## 放置规则

- Electron import 只出现在 `main/`、`preload/` 和测试宿主。
- Main 桌面生命周期集中在 `main/shell/`；系统托盘与专用图标只放在 `main/tray/`。
- Renderer 页面、查询缓存和临时流式状态放在 `renderer/features/`。
- 跨 preload 的 view model、输入 Schema 和稳定错误放在 `shared/`；它们不包含 Node、OpenAgentPack 或 Provider wire 类型。
- 凭据持久化只在 `main/credentials/`，Connection 只引用 credential key。
- `agents.yaml` 构建、scope 锁和 Managed Bot 文件规则只在 `main/control-plane/`。
- Managed Bot Project Document 的构建、读取、合并与 multiagent YAML 校验只在现有的 `main/control-plane/project-document.ts`；不新增 roster、directory 或 service Module，也不新增第二份 YAML 解释代码。
- Bot 表单与协作成员选择器放在 `renderer/features/bots/`；成员候选复用已有 `bots.list` 结果，不在 Renderer 新增目录请求或缓存。
- Qoder 与 Bailian 的 Session HTTP/SSE、wire 校验和映射只在各自 `main/data-plane/providers/` 目录；数据面不得依赖 OpenAgentPack。
- Provider 静态装配登记 Qoder 与 Bailian，不建立动态发现。
- Unit Test 与实现同目录；真实 Electron seam 放 `tests/integration/`；packaged 用户流程放 `tests/acceptance/`；使用真实账号且会创建资源的测试放 `tests/live/`。
- Renderer 组件测试统一通过 `renderer/test-support/` 的共享挂载入口（含 TooltipProvider，与生产 bootstrap 一致）渲染，测试文件不自行 `createRoot`；纯逻辑测试不需要挂载。

## 建包门槛

只有代码需要独立发布、被两个生产应用使用或必须形成独立构建产物时才创建 package。测试 double、未来 Provider、目录整洁或“可能复用”不满足门槛。

Qoder 原生 Client 由 Main 数据面直接拥有，不创建独立 package。只有出现第二个真实生产调用方并证明独立发布能提高 leverage 时，才重新评估建包。
