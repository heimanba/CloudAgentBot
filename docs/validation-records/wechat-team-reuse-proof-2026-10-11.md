# 公众号文章能力实测与截图（2026-10-11）

## 范围与方法

针对 `docs/wechat-openagentbot-team-reuse.md` 中的能力声明，通过 computer use 操作当前仓库真实 Electron 开发版，连接真实百炼。输入均为虚构样例，未使用 UI 假数据、网络 mock 或拼接截图。截图为原始客户端捕获，以下编号对应 `docs/images/wechat-proof-20261011/`。

维护端实际通过模板创建、编辑、保存同步、Skill 与 MCP 选择、消息发送、附件上传和共享开关完成操作。Session 为满足测试 metadata 要求，通过百炼正式 API 预创建；打开 Session 后的消息、工具执行与结果展示均通过真实产品 UI 完成。不能将这条路径写为「新任务表单创建 Session 的完整 UI 验收」。现有 live 用例另行覆盖产品创建路径。

接收端使用同一 Mac 上的独立 Electron 客户端和独立 userData，只复制 Connection 元数据与加密凭据，没有复制 Managed Bot 资料。启动包装只设置应用名和 userData，加载同一份生产 Main、Preload 与 Renderer；没有替换 DesktopHost 或 Provider。早期启动尝试因复制方式及应用名导致 ICU 或安全存储失败；最终使用保留符号链接的 Electron 副本，并在启动前显式设置 userData，真实目录和续问成功后才记为通过。

## 能力结果

| 能力声明                                     | 本轮结果                         | 证据与限制                                                                                                                                                                                                                                   |
| -------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新任务入口                                   | 页面已打开并截图                 | [17](../images/wechat-proof-20261011/17-new-task.png)；本轮执行会话由 API 预创建，不能用入口截图证明完整创建链路                                                                                                                             |
| 工程模板新建成员与协调者                     | 通过                             | [01](../images/wechat-proof-20261011/01-template.png)、[02](../images/wechat-proof-20261011/02-created.png)；实际创建 3 位成员和 1 位协调者，云端 roster 与页面一致                                                                          |
| 工程、营销、跟进、SEO 模板可选               | 入口通过                         | [18](../images/wechat-proof-20261011/18-template-options.png)；只运行工程模板，其他模板没有业务效果验收                                                                                                                                      |
| 模板引用已有成员                             | 通过                             | [14](../images/wechat-proof-20261011/14-reuse-members.png)、[15](../images/wechat-proof-20261011/15-reuse-created.png)；只新增协调者，引用同一组 3 个远程成员 ID；读回确认成员 version 和 system 均未改写                                    |
| 编辑与保存同步名称、描述、指令、模型配置     | 部分通过                         | [16](../images/wechat-proof-20261011/16-synced-configuration.png)；实际修改描述、指令、Skill、工具与 MCP，保存后重开读回；本轮没有切换模型或修改显示名，不将字段存在当作编辑行为证明                                                         |
| 从技能广场选择并执行 Skill                   | 通过                             | [08](../images/wechat-proof-20261011/08-skill-selected.png)、[10](../images/wechat-proof-20261011/10-skill-mcp-run.png)；选择 stop-slop 1.0，远程 Agent 含 official Skill 引用，事件包含 activate_skill 及 Skill 内容返回                    |
| 选择并执行官方 MCP 工具                      | 通过                             | [09](../images/wechat-proof-20261011/09-mcp-selected.png)、[10](../images/wechat-proof-20261011/10-skill-mcp-run.png)；CodeInterpreter 的 execute_code 实际执行，返回 Success、200、isError=false，统计为待办 3、缺截止日期 2、缺负责人 1    |
| 流式回复与工具工作记录                       | 通过                             | [03](../images/wechat-proof-20261011/03-running.png)、[10](../images/wechat-proof-20261011/10-skill-mcp-run.png)；发送后观察到增量执行与工具记录，终态 idle/end_turn                                                                         |
| 上传附件并利用其内容续问                     | 通过                             | [11](../images/wechat-proof-20261011/11-attachment-result.png)；通过系统文件选择器上传虚构 TXT，返回唯一标记 OAB-ATTACH-1011，正确补全李四截止日期与王五负责人，剩余缺失字段保留待确认                                                       |
| 多助手真实委派与汇总                         | 通过，输出需人工评审             | [05](../images/wechat-proof-20261011/05-delegation.png)、[06](../images/wechat-proof-20261011/06-result.png)；完整分页读取 129 条远程事件，其中 thread_created 3、thread_message_sent 11、thread_message_received 10；不是用模型自述证明委派 |
| 助手共享开关                                 | 通过                             | [07](../images/wechat-proof-20261011/07-bot-shared.png)；真实开启，并在接收端发现                                                                                                                                                            |
| 接收端不导入本机 IaC 资料也能发现助手        | 通过                             | [12](../images/wechat-proof-20261011/12-receiver-directory.png)；我的助手为 0，团队共享中存在测试协调者；本轮相同 API Key                                                                                                                    |
| 任务共享开关                                 | 通过                             | [04](../images/wechat-proof-20261011/04-session-shared.png)；真实开启；本轮没有独立验证跨 Key 范围的共享访问                                                                                                                                 |
| 隔离客户端读取历史并继续任务                 | 通过                             | [13](../images/wechat-proof-20261011/13-receiver-continued.png)；接收端从既有汇总中引用 Pixel 两条建议，返回 RECEIVER-CONTINUE-1011；同 Key 本身允许读历史，不能据此证明共享标记对跨 Key 访问的作用                                          |
| 新 Session 使用更新配置、旧 Session 保留快照 | live 合同通过，未补 UI 对照截图  | 两家 Provider 的现有 bot-edit-session-version live 用例本轮重新通过；不能把配置表单提示当作行为截图                                                                                                                                          |
| 生成并标记文件                               | 云端通过，桌面打开未通过         | write 返回 bytes_written=620，mark_artifacts 返回 marked 中一个 file_id、failed=[]；桌面时间线没有产物卡片，未完成文件打开或预览                                                                                                             |
| 不同 API Key 的助手共享                      | 本轮未复测                       | 当前只有一条百炼连接；[历史跨 Key 记录](bot-sharing-cross-key-fix-2026-09-29.md)是历史证据，不能标为本轮截图证明；该历史记录也不证明本轮跨 Key 任务共享                                                                                      |
| Qoder 的对应 UI 流程                         | 本轮未截图                       | Qoder 真实 Cloud 合同用例已重新通过，不能等同于本轮 Qoder UI 逐项验收                                                                                                                                                                        |
| 定时任务                                     | 百炼 live 合同通过，未做 UI 截图 | 现有 bailian-deployment live 用例本轮通过；未新增到公众号文章的已截图示例                                                                                                                                                                    |

## 实际协作观察

工程任务要求 Lin、Pixel、Rigel 分别给出会议待办页面的数据校验规则、交互建议和验收场景。Provider 确实创建了 3 个 child Thread 并记录双向消息，最终表格包含三位成员建议。

过程中协调者曾指出两位成员的完成状态没有包含具体内容，并追问后收齐结果。成员还对「此前建议」的来源表达了不确定性。最终表格中的「截止日期不能早于今日」等规则只是模型建议，尚未经过业务评审，不能宣称正确性或已经实现。一次真实完成证明该路径可运行，不证明任意工程任务都能稳定自主完成。

## 自动化验收

本轮实际执行：

```sh
OPENAGENTBOT_LIVE=1 pnpm test:live
```

结果：20 个文件通过，50 项检查通过，耗时 209.74 秒。数量包含 live 支撑工具的单元检查，不把全部 50 项都称为云端任务。真实用例包含两家 Provider 的连接、Bot 创建更新、共享 metadata、Session 快照与委派合同，以及百炼定时任务。未修改产品代码或测试，未将单测通过替代 UI 截图。完整终端日志留在忽略的 `.scratch/wechat-proof-20261011/cloud-tests.log`。

## 文章处理

2026 年 10 月 11 日发布稿复核沿用上述真实运行证据，没有新增 Cloud 执行或宣称复测。人工重新查看技能与 MCP 执行、模板创建、成员引用、成员委派、最终汇总和接收端续问截图，并核对 `.scratch/wechat-proof-20261011/verification-summary.json` 中成员版本与指令未变化的结果。

发布稿将「协作模板」与「Teams 协作」分开：前者说明新建或引用成员、配置起点与独立维护；后者说明协调者实际委派、工作记录及结果汇总。明确 Lin 的工程评审发生在改为会议用途之前，引用已有成员不会恢复模板职责。

删除本轮无 UI 对照截图的配置快照、跨 API Key 复用和跨 Key 任务管理限制声明。保留同 Key、独立接收客户端的事实边界。不增加定时任务、文件打开或预览的宣传。预置的其他模板仅写为入口可选，不宣称业务效果。

文章保留已提供的 6 个 CDN 图片链接，另插入 4 张已有原始截图。CDN 图片对应的本地原图位于 `docs/img/`；新增截图位于 `docs/images/wechat-proof-20261011/`，未上传到外部图床，发布到公众号时需要将这 4 张本地图片导入编辑器。

| 发布稿内容        | 截图来源                               | 已实测范围                                            |
| ----------------- | -------------------------------------- | ----------------------------------------------------- |
| 新任务工作区      | `docs/img/17-new-task.png`             | 入口展示，不证明本轮通过表单创建会话                  |
| 助手配置          | `docs/img/16-synced-configuration.png` | 修改指令、描述、技能与工具后保存同步                  |
| Skill 与 MCP 执行 | `10-skill-mcp-run.png`                 | 技能激活与真实代码执行返回统计                        |
| 附件补充          | `docs/img/11-attachment-result.png`    | 上传 TXT 后利用内容续问                               |
| 共享助手入口      | `docs/img/07-bot-shared.png`           | 共享开关；发现结果另见截图 12，不把开关截图当接收结果 |
| 接收端续问        | `13-receiver-continued.png`            | 同 Key 独立客户端读历史并续问                         |
| 模板创建结果      | `docs/img/02-created.png`              | 创建 3 位成员与 1 位协调者                            |
| 模板引用已有成员  | `14-reuse-members.png`                 | 配置引用；创建结果另见截图 15，API 确认成员未改写     |
| Teams 实际委派    | `05-delegation.png`                    | 创建子任务与跨线程消息，API 确认 3 个 child Thread    |
| 汇总建议          | `docs/img/06-result.png`               | 3 位成员建议收齐，不证明建议正确或页面已经实现        |

## 清理

本轮手工实测创建 5 个 Agent、2 个 Session，没有创建 Environment。Session 删除后分别读回 HTTP 404；5 个 Agent 按百炼正式 archive 协议归档，分别读回 archived_at 确认，不声称物理删除。共享开关只作用于这些虚构测试资源，用户既有 Bot、任务和 Connection 未改写。

测试名称前缀为 `oab-proof-1011-` 和 `oab-reuse-1011-`，创建 Agent 含模板来源与唯一 template_run metadata；两个测试 Session 均带 openagentbot_test_run。原始 Provider 返回和临时启动资料仅留在忽略的 `.scratch/`，本记录不包含凭据或完整 Provider 响应。收尾删除本轮测试的本地 scope 与隔离接收端加密凭据副本；此操作属于验收资源清理，不改变产品正常归档后保留本机 IaC 资料的规则。上传文件及产物的 Provider 独立保留策略本轮未验证，不宣称所有文件资源已物理删除。
