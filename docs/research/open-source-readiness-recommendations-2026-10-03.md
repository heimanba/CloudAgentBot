# OpenAgentBot 最小开源准备建议

日期：2026-10-03。源码基线：`0df6f9e18e50311aae30dfc8502e17b0f4fa0789`。本文按“先尽量简单、控制维护成本”的原则修订，替代此前五批完整工程化方案。本文是待实施建议，不替代现行规范。

检查结果见 [验证记录](../validation-records/open-source-readiness-2026-10-03.md)。本文保留尚未完成的开源准备事项。

## 对原计划的判断

原计划覆盖面足够，但把成熟桌面产品的长期维护体系过早带入了首次开源。对当前单 package、小规模维护的仓库，多个 CI job、独立安全流水线、完整社区模板、自动发布与跨平台矩阵会增加维护面，却不一定帮助第一个外部用户跑起来。

收敛原则：复用已有命令与文档；优先一次性检查而非新增持续运行的系统；用实际故障、用户和维护者需求决定何时加机制。简单不等于忽略已确认的凭据、授权或运行时问题。

保持现有产品架构、依赖管理方式和本地 `pnpm gate`。不新增 workspace、抽象层或与开源准备无关的重构。

## 现在只做三件事

### 1. 检查准备公开的内容

这是一次性公开准备，不要求先建设安全平台。

- 扫描准备公开的源码及实际拟推送的 Git 历史；人工看历史中的 `.scratch` 响应、补丁与截图。当前删除文件不会消除历史内容。
- 若发现真实凭据，先撤销/轮换，再处理公开内容。扫描报告留在本地，必要结论以脱敏记录保存。
- 核对复制组件、Logo、图片的来源并保留必要许可/署名。已有 Apache-2.0 LICENSE 保留；无需先做许可证生成器或另建素材登记系统，按实际需要补简短第三方声明即可。
- 默认保留历史，不在开源准备中顺手重写；若要以干净快照建立新公开仓库，单独明确该选择。

完成条件：拟公开范围明确；扫描命中已复核；没有未处置敏感内容或来源不明且仍拟公开的素材。Gitleaks 可用于扫描，但工具零命中不等于人工复核完成。[Gitleaks](https://github.com/gitleaks/gitleaks)

### 2. 一个 workflow、一个 job，直接运行现有 gate

只新增 `.github/workflows/ci.yml`，不先新增 package scripts 或拆多个 workflow。

| 项目     | 建议                                                                    |
| -------- | ----------------------------------------------------------------------- |
| 触发     | `pull_request`、默认分支 `push`                                         |
| runner   | 固定 `macos-15`，与现有 arm64 打包 smoke 一致                           |
| 工具链   | 与现有 engines 相容的 Node 22 版本、packageManager 声明的 pnpm          |
| 安装     | `pnpm install --frozen-lockfile`，不引入本机 registry/父 workspace 配置 |
| 检查     | `OPENAGENTBOT_LIVE=0 pnpm gate`                                         |
| 权限     | `contents: read`，不注入 Provider、签名或发布 secrets                   |
| 执行控制 | 设超时，同一 PR 新提交取消旧运行                                        |

现有 gate 已含 typecheck、lint、test、架构检查、构建、打包、packaged smoke 和连接删除验收。复用它可避免本地与 CI 维护两套检查名单。代价是每次 PR 都要等待打包；当前先接受，实测耗时明显影响贡献时再拆 Linux 快速检查与 macOS 桌面检查。

`macos-15` 的 arm64 架构已按调研日官方表核实；实际接入时再确认可用性。[GitHub runner 表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

保留几项几乎不增加维护成本的安全设置：Actions 固定完整 SHA，checkout 不保留凭据，使用 `pull_request` 而不是用 `pull_request_target` 运行贡献者代码。[GitHub Actions 安全说明](https://docs.github.com/en/actions/reference/security/secure-use)

先让干净 runner 和一个外部 fork PR 跑通，再将唯一 job 设为 required check。没有签名或 Cloud secrets 也必须能运行。初期直接使用 Actions 日志，不建设日志上传/截图平台。

只修接入暴露的必要问题：例如打包启动失败看不到 stderr、超时后子进程未结束、临时目录清理失败。macOS arm64 产物路径先保留，不为尚未支持的平台提前抽象解析器。不得通过关闭 sandbox 或放宽凭据存储换取 CI 通过。

### 3. 补齐一个清楚的用户入口

以现有 README 为主，增补而非再写一套文档：

- 一张本项目真实、脱敏的截图，说明用途和当前成熟度。
- 已验证的平台范围、Node/pnpm 要求、启动命令。
- Provider 前提和凭据获取链接、远程服务费用与数据边界。
- 简短贡献说明：开发、执行 gate、提交 PR；链接已有架构与验收文档。
- 普通问题提 Issue，敏感问题走私密渠道；提醒不要上传 Key、`.env` 或原始用户数据。

若启用 GitHub 私密漏洞报告，补一个很短的 `SECURITY.md` 指向实际渠道即可，不承诺响应 SLA。GitHub 侧先只配置唯一 required check 和可用的私密报告入口；其他安全功能可按平台默认能力开启，无需新写流水线。[私密漏洞报告](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)

首批预计新增 `ci.yml` 和短 `SECURITY.md`，修改 README；第三方声明按审计实际需要补。独立 CONTRIBUTING、privacy、CODEOWNERS、Issue/PR 模板暂不新增。

## 哪些移出首批

| 原建议                                             | 修订决定                       | 何时重新考虑                           |
| -------------------------------------------------- | ------------------------------ | -------------------------------------- |
| Linux quality + macOS desktop + security 三个 job  | 收成一个 macOS gate            | 实测 CI 等待时间过长，或新增验证平台   |
| 111 文件全量格式化及 format 必需检查               | 不阻塞公开，后续独立整理       | 团队要统一启用格式门禁时               |
| 新增 check/test:packaged 等 script                 | 不新增                         | 现有命令出现真实复用困难时             |
| CONTRIBUTING、privacy 独立文档                     | 必要内容先写 README            | README 过长或贡献者重复遇到同类问题时  |
| 完整 Issue/PR 模板、CODEOWNERS、强制多人 review    | 暂不做                         | 出现协作分工或报告质量问题时           |
| 独立 security workflow、CodeQL、自定义漏洞例外系统 | 暂不建设                       | 有可持续处理告警的人力或明确风险需求时 |
| Dependabot 分组策略                                | 暂不定制；可用平台默认安全告警 | 开始规律维护依赖时加简单配置           |
| Linux/Windows/Intel 全平台矩阵                     | 暂不做                         | 明确要支持对应用户且具备验收条件时     |
| release workflow、发布 Environment、自动签名       | 暂不做                         | 发布安装包频繁到人工流程开始出错时     |
| SBOM、attestation、自动许可证生成与应用内展示      | 暂不做                         | 下游确实需要或正式发行规模增长时       |
| 自动更新、Nightly、多频道                          | 暂不做                         | 稳定发布已有用户且手动更新造成困难时   |

格式差异是现有工程整洁问题，不等于不可开源。先保留已有可通过的 gate，避免为了加入格式检查而把首批扩成 111 文件修改。

## 已确认的问题仍单独处理

Electron 锁定 39.8.10，官方时间表列出 39 系列于 2026-05-05 EOL；独立审计有 7 条 high 依赖命中。它们不因计划简化而消失，但也不需要先建设自动扫描体系才能处理。[官方支持时间表](https://releases.electronjs.org/schedule)

建议作为紧接首批的独立维护变更：升级到实施时受支持的稳定版本，重新跑 gate，并逐条复核告警条件。正式分发安装包前完成；若源码先公开，明确当前成熟度并公开跟踪，不能把已知问题悄悄移除。只跑 audit --prod 不够，Electron 虽是 devDependency，其运行时仍随包交付。

此前提出的 IPC sender 校验保留为独立安全加固候选，按真实可达性和风险评估安排，不与“补开源基础设施”捆绑成架构改造；本轮未证明该缺口可被利用。已确认的可利用问题应优先修复。

## 如果首发需要安装包

仅有源码公开需求时，不做这一部分。若首发要提供二进制，也可以先人工发布，无需自动 Release 流水线：

1. 先只发布验证过的 macOS arm64，版本与 tag 对齐；固定应用身份和数据路径。
2. 从确定提交执行完整 gate，再生成待分发包；完成 Electron 升级与告警处置。
3. 面向普通用户的正式 macOS 安装包完成签名、公证和干净机器安装验证；证书暂不具备时可先仅提供源码，不把关闭系统安全检查作为默认安装指导。
4. 随包保留项目与第三方必要声明，提供校验和与简短已知限制说明。
5. 人工创建 GitHub Release 并上传该包。若已有用户数据，补一次旧版本升级后凭据与 IaC 资料保留验证；发布相关 Provider 行为仍按现有 docs/validation.md 执行真实 Cloud 验证，不新增 Cloud workflow。

先复用 electron-builder v26 的现有配置和官方能力，不因最新版文档改变配置体系。人工发布几次后，再依据实际重复步骤决定自动化范围。[v26 mac 配置](https://www.electron.build/v26/docs/mac/)

## 最终执行顺序与完成定义

1. **一次性内容检查**：敏感信息、拟公开历史和第三方来源已复核。
2. **最小工程接入**：一个 CI job 跑现有 gate，干净 runner 与无凭据 fork PR 通过，required check 生效。
3. **最小对外入口**：README 足以理解和运行项目，私密安全报告渠道真实可用。

上述完成即可进入源码公开。Electron 升级作为紧随其后的独立维护项，正式安装包发布前完成。没有增加完整治理体系、全平台支持或自动发布的前置要求。

实施状态：已完成最小 CI 配置、README 与截图、安全报告说明、素材来源记录和必要许可声明；当前工作区与独立目录完整 gate 均通过。已扫描本地现有发布 refs 历史，未命中凭据，但历史图片与内部资料仍需确定公开范围。GitHub 仓库当前不可访问，远端 CI、required check 和私密报告入口尚未验收。详见[实施验收记录](../validation-records/open-source-readiness-2026-10-03.md)。未升级依赖、推送或修改仓库设置。
