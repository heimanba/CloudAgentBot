# 开源就绪检查记录

日期：2026-10-03。源码基线：`0df6f9e18e50311aae30dfc8502e17b0f4fa0789`。先进行只读调研，再按“尽量简单”的原则实施开源基础配置。未修改产品代码或依赖，未提交、推送、改写历史或改变仓库可见性。

## 初始调研检查

- `pnpm typecheck`、`pnpm lint`、`pnpm test:arch` 通过。Lint 存在 React version settings 警告，没有失败。
- `OPENAGENTBOT_LIVE=0 pnpm test`：66 个测试文件通过，12 个跳过；676 项测试通过，17 项跳过。
- `pnpm format:check` 失败，报告 111 个文件需要格式整理。本次没有批量格式化。
- 本轮未重跑完整 `pnpm gate`、打包或 Cloud 验收。此前独立目录验证中，冻结安装与完整 gate 通过：676 项测试通过、17 项 Cloud 用例跳过，包含 macOS arm64 打包、打包 smoke 和连接删除验收；未执行真实 Cloud 验证。

## 依赖扫描

首次直接扫描被机器配置的 registry 阻断；改用公共 npm registry 后，直接在当前目录执行仍读到了父工作区依赖。两份结果均不作为本项目漏洞计数依据。

有效扫描方法：在系统临时目录仅复制当前 `package.json` 和 `pnpm-lock.yaml`，不带父 workspace、node_modules 或 `.env`，执行 `pnpm audit --registry=https://registry.npmjs.org --json`，随后删除临时目录。该命令未安装或更新依赖。

有效结果：7 条 high，0 条 critical/moderate/low；退出码 1。属于依赖数据库命中，未证明本应用有 7 个可利用漏洞。

| 依赖路径                                                                    | 命中                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron`，锁定 39.8.10                                                    | [GHSA-hq2x-r82h-9wj4](https://github.com/electron/electron/security/advisories/GHSA-hq2x-r82h-9wj4)、[GHSA-gr2m-v5gq-v685](https://github.com/advisories/GHSA-gr2m-v5gq-v685)、[GHSA-j84w-jfhq-vhvj](https://github.com/advisories/GHSA-j84w-jfhq-vhvj)、[GHSA-9qh4-3jw8-366w](https://github.com/advisories/GHSA-9qh4-3jw8-366w) |
| `electron > extract-zip`                                                    | [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)、[GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3)                                                                                                                                                                                |
| `electron > @electron/get > got > cacheable-request > http-cache-semantics` | [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)                                                                                                                                                                                                                                                          |

例如第一条 Electron 公告要求不可信 iframe 带 `allow-scripts allow-popups`；当前 artifact iframe 使用空 `sandbox`，主窗口拒绝新建窗口，不能仅凭版本命中就宣称该场景可利用。其余项仍需逐条核验调用面。安装期依赖与安装包内 Electron 运行时需分别处理；不能因 Electron 写在 devDependencies 就忽略它。

原始 JSON 保存在本地忽略的 `.scratch/open-source-readiness/`，不作为规范依赖；复验应重新运行独立扫描。扫描结果随 advisory 数据库变化。

## 最小方案实施结果

- 新增 `.github/workflows/ci.yml`：一个 `macos-15` job 执行现有 `pnpm gate`，面向 PR 与 main push。固定 Action commit、Node.js 22.23.2 和项目声明的 pnpm 10.33.0，公共 npm registry、冻结锁文件；只读权限、取消过期任务、30 分钟超时，关闭真实 Cloud 与自动签名发现。不新增发布流水线或平台矩阵。
- README 补充项目边界、Provider 准备、贡献方法和真实首次启动截图。截图来自隔离 userData 的打包应用，没有真实账号或聊天数据。
- 新增 SECURITY.md，使用目标仓库 `modelstudioai/OpenAgentBot` 的私密报告链接，并说明入口不可用时如何请求私密联系方式；入口尚未验证可用。
- 新增 THIRD_PARTY_NOTICES.txt，保留 shadcn/ui 的 MIT 声明。它不是正式二进制发行的完整依赖许可清单。
- 作者确认应用 Logo、托盘图标及 Provider SVG 为自行创作。按作者授权删除当前树中的 `docs/ui/grok.png` 与 `docs/ui/grok-new-bot.png`；删除不移除历史中的图片。

## 实施后验证

| 验证                                                                         | 结果                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 当前工作区 `OPENAGENTBOT_LIVE=0 CSC_IDENTITY_AUTO_DISCOVERY=false pnpm gate` | 通过：676 项测试通过、17 项 Cloud 测试跳过；架构检查、构建、macOS arm64 打包、打包 smoke 和 4 项连接删除 Electron/IPC 验收通过                                    |
| 独立临时目录安装                                                             | 仅复制当前拟提交源码，不含父 workspace、node_modules、构建产物或 .env；空用户及全局 npm 配置，公共 registry、新 pnpm store；`pnpm install --frozen-lockfile` 通过 |
| 独立临时目录完整 gate                                                        | 同样通过，676 项测试通过、17 项跳过，包含打包 smoke 和连接删除验收                                                                                                |
| Workflow 静态检查                                                            | actionlint 1.7.12 通过；所用 Action tag 与 commit 已通过 GitHub API 核对                                                                                          |

两次 gate 均未执行真实 Cloud 测试。独立目录验证后只增加或整理文档、素材与许可声明，没有再修改产品、依赖或验收脚本。本地结果不代替 GitHub runner、fork PR 或 required check 的实际验收。原始日志和工具保存在忽略的 `.scratch/open-source-implementation/`。

## 一次性内容检查

Gitleaks 8.30.1 以完全脱敏输出执行：

- 当前拟公开内容快照：扫描时共 328 个文件，0 条凭据命中。
- 本地现有 heads、tags、remotes 可达历史：共 81 个 commit，0 条凭据命中。命令使用 `--log-opts='--branches --tags --remotes'`；未抓取服务器上的其他分支，未包含内部工具 refs。结论仅覆盖已扫描范围。

补充检查了历史图片、临时探针资料结构、内部地址和本机路径。查看的 4 张连接删除测试截图为 E2E 虚构数据；当前文本未发现匹配检查规则的内部 registry/GitLab 地址或具体本机用户路径。自动扫描没有命中不等于所有内容适合公开。

**直接发布完整历史仍需处理**：旧提交保留第三方 Grok 参考图片、内部地址/机器路径及测试资源标识。部分历史 JSON 仅检查了摘要和结构，未完成所有原始响应逐字段人工审查。当前删除图片不会清除这些旧版本。本轮没有自行改写历史；首发应明确采用清理后的历史或仅以审核后的当前树创建公开首个提交，避免直接 mirror 推送全部 refs。

## 远端与后续范围

目标仓库为 [modelstudioai/OpenAgentBot](https://github.com/modelstudioai/OpenAgentBot)。本机 gh 未登录；公开 API 和已连接 GitHub 工具均返回 404，无法判断仓库不存在还是当前身份不可访问。尚未配置或核验 GitHub 私密漏洞报告、分支保护及 required check。

远端接入时按顺序完成：确认拟公开历史范围；上传审核内容并跑通 CI；验证无 Provider 凭据的 fork PR；将 `gate` 设为 main 的必需检查；开启并验证私密漏洞报告入口。当前不能宣称 GitHub 接入验收完成。

Electron 升级与上述依赖告警保持独立维护项，正式分发安装包前完成。Linux 实机安全存储、签名与公证、安装升级验收仍不在本批范围内；既有 111 文件格式差异没有批量修正。
