# 安全问题报告

请通过 GitHub 的 [Report a vulnerability](https://github.com/heimanba/OpenAgentBot/security/advisories/new) 私密报告安全问题，不要在公开 Issue 或 PR 中披露漏洞细节。

如果入口不可用，请在 [Issues](https://github.com/heimanba/OpenAgentBot/issues) 中仅请求维护者提供私密联系方式，不要附上漏洞详情或敏感数据。

报告请包含应用版本或 commit、操作系统与架构、受影响的功能，以及使用虚构数据的最小复现。不要提交 API Key、`.env`、完整 userData、真实聊天或未脱敏的 Provider 响应；已暴露的凭据应先在 Provider 侧撤销或轮换。

项目目前处于早期开发阶段，修复以 `main` 分支为基准，暂不承诺维护历史版本或固定响应时限。当前 Electron 升级和依赖告警处置状态见 [检查记录](docs/validation-records/open-source-readiness-2026-10-03.md)；在完成运行时升级及发行验收前，不将开发构建视为正式安装包。
