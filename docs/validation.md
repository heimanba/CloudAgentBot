# 验收与验证

## 本地执行入口

在仓库根目录运行 `pnpm gate`，依次执行类型检查、Lint、测试、架构检查、构建打包、packaged smoke 与连接删除的真实 Electron/IPC 验收。需要可运行桌面应用的环境；当前验收脚本支持 macOS arm64 与 Linux 应用目录。纯代码检查可分别运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:arch`。

`pnpm test:connection-removal` 会先构建，再以隔离 userData 验证删除范围刷新、冲突后二次确认、读取失败恢复和磁盘删除结果；使用虚构凭据并屏蔽网络，不访问真实 Provider。`node scripts/visual-a11y.mjs` 在已有打包产物上检查布局、焦点与对比度。

### GitHub CI

`.github/workflows/ci.yml` 在 PR 和 `main` push 时运行唯一的 `gate` job：macOS 15 arm64、Node.js 22.23.2、`package.json` 指定的 pnpm，先通过公共 npm registry 执行 `pnpm install --frozen-lockfile`，再执行 `pnpm gate`。

CI 显式设置 `OPENAGENTBOT_LIVE=0`，不注入 Provider、发布或签名凭据；外部 fork PR 使用相同离线门禁。工作流只读仓库内容，取消同一 PR 的旧运行，30 分钟超时。CI 构建不是正式签名发行包。

首次在目标 GitHub 仓库实际跑通后，将 `gate` 设为必需检查，并验证一次外部 fork PR。仅在本地通过 gate 或工作流语法检查，不算完成 GitHub runner 验收。现有全量格式检查暂不加入门禁；Linux/Windows/Intel 不属于当前 CI 平台承诺。

### 显式启用 Cloud 验证

默认测试不访问 Cloud。需要时将 `.env.example` 复制为当前仓库根目录的 `.env` 并填写测试凭据，或注入同名环境变量；显式环境变量优先。测试不读取父目录 `.env`。Qoder 需要 `QODER_PAT`，百炼需要 `DASHSCOPE_API_KEY` 与 `BAILIAN_WORKSPACE_ID`，跨 Provider 场景需要三者。

```bash
OPENAGENTBOT_LIVE=1 pnpm test:live
OPENAGENTBOT_LIVE=1 pnpm live:packaged
```

第二条命令要求已有打包产物，仅运行 Qoder 打包用户流程；两家协作 UI 的入口见 `tests/live/*-multi-agent-collaboration.live.test.ts`。Cloud 测试会创建远程资源，必须遵守下文的隔离与清理规则。启用开关只从进程环境读取，写入 `.env` 不会让默认 `pnpm test` 自动执行 Cloud 调用。

## 架构验收

- 构建产物只有 Renderer、Preload 和 Electron Main，没有 Background 子进程。
- Renderer 只通过 DesktopHost 使用特权能力。
- Main 是本地文件与凭据的唯一访问者。
- BotControlPlane 只依赖 OpenAgentPack 公共 Interface。
- ChatDataPlane 只依赖 Provider 原生 Client Adapter。
- 除 `src/main/control-plane/` 外，生产源码不导入任何 `@openagentpack/sdk` 入口；Qoder 数据面由 自有。
- Chat、Message、Turn、Operation、Projection 和 SQLite 不出现在 持久化路径。
- 生产 Adapter 只有 Qoder 与 Bailian，没有通用 capability/admission/plugin 机制。
- 每个 Project Document 仍恰好包含一个本地 agent declaration；协作成员只以外部 `{ agent_id }` 引用出现。
- 没有新增 roster store、成员清单、Connection 级 roster lock、跨 scope transaction 或后台 reconciler；成员候选复用 `bots.list`，没有成员专用目录 Interface 或新增 DesktopHost 方法。
- 控制面只从 `@openagentpack/sdk` 包根导入，不导入 `internal`，也不用 Provider 原生控制面补 roster 洞。
- Qoder 与 Bailian 的 `BotCatalog.listBots` 都返回完整当前 Agent 列表；Qoder 分页 cursor 不前进时 fail closed。
- `@openagentpack/sdk` 使用 npm 固定版本并由本目录锁文件锁定；安装与打包不依赖本地 OpenAgentPack 工作区。升级时通过类型检查、控制面合同测试和打包 smoke 验证公共 Interface 兼容性。

## 存储验收

- `agents.yaml` 原子写入并能被 OpenAgentPack直接 Sync。
- `agents.state.json` 只由 LocalFileStateBackend 写入。
- 同一 scope 的两个并发 update 最多一个进入 SDK写路径。
- 成功 Sync 后 project/state 配对备份一致存在。
- 除 `phase=new` 的首次创建外，state 缺失时 update 与 Sync 在任何 Provider mutation 前失败。
- 缓存清理、断开 Connection 和 Renderer 重载不删除 managed scope。
- credential 不出现在文件明文、日志、IPC payload、Project Document 或测试快照。
- 协作 roster 只存在于 `agents.yaml` 与配对 backup 文本；不新增 roster 文件、索引或数据库，成员不出现在 `agents.state.json`。
- 普通 Project Document 不产生 `multiagent`；协作 Project Document 只产生外部 `{ agent_id }` 引用；清空数组删除整个键；非 roster 的未知 YAML 字段在读取-合并往返中不丢失；logical、mixed、empty、duplicate 与未知 type 的 multiagent 形状 fail closed。
- 先写 `agents.yaml` 再 Sync：解析或写盘失败不调用 Provider；Sync 失败保留新版 `agents.yaml` 且 backup 不变，重新打开配置页显示 pending 并从本地期望配置读出 roster；retry 直接应用当前 Project Document，成功后 pending 消失。
- 归档当前 coordinator 只归档当前 Agent，不触碰成员。

## 用户流程验收

### Bot 共享

- 新建任务选择器默认展示 Provider 授权可见、带精确共享标记的 Bot（包括其他 Key 创建的 Bot）；提供“我的助手”范围；次级“浏览 Provider 资源”入口包含共享、当前 Key 与未分组 Bot，不显示明确属于其他 Key 且未共享的资源。默认范围为空或搜索无结果时不自动扩大范围，选择完成或关闭后再次打开恢复团队共享。
- Bot 管理列表将「共享 / 已共享」作为 Managed Bot 的直接可见操作。点击仅打开共享面板，面板中说明 Provider 授权下跨 Key 的共享发现与仍按 Key 分组的历史范围，并明确开启或取消；同步中禁用提交，失败在面板中提示且不乐观显示成功。列表不常驻重复说明、Managed 标签、ID 或共享状态标签。
- Managed Bot 的 Chat/Bot 详情页可开启或取消共享；Remote-only 与 state-missing Bot 不展示开关。
- 共享状态保存在 Project Document `metadata.openagentbot_shared`；CloudAgentBot API Key 分组标记保存在 `metadata.openagentbot_key_scope`。共享有效条件为 Provider 返回该 Bot 且共享值精确等于 `"true"`，不要求 Key scope 匹配。
- 连接区域不展示完整 Provider 目录数量。Bot 管理列表的“工作区全部”计入共享、当前 Key 或本机持有管理/恢复资料的 Bot；未分组且未共享的 Remote-only 仅在更多菜单的“浏览 Provider 资源”模式展示，并说明浏览不代表归属或接管。清除搜索保持当前范围。
- Bot 管理列表用 Tabs 区分“我的助手”“团队共享”和“全部”；角色通过独立筛选收窄当前范围，ID 复制收进更多菜单；团队共享包含自己共享与跨 Key 接收的 Bot，计数与新任务选择器的共享范围一致；无本机 Managed Bot 时管理页默认团队共享，用户显式切换后保持所选范围；Provider 可见的共享 Remote-only Bot 只允许创建/使用 Chat，不提供管理动作。未标记旧 Bot 标为未分组；无 Key 标记但带精确共享标记的 Bot 也可发现，不推断其 Session 归属。
- 同一 Provider 的同一凭据跨设备得到同一 scope；不同凭据得到不同 scope，不把 Workspace 或 Connection ID 用作分组。Bot 身份仍是 `Connection + remoteAgentId`。
- 开关只改变 CloudAgentBot 内的发现标记，不授予 Provider 权限、不分享 Chat 历史、不改变 Bot/Chat 远程身份或账单。
- 开启/关闭只修改共享保留 metadata 键，完整保留其他 metadata 和未知 YAML 字段；百炼取消时移除该键，Qoder 取消时写空字符串（其 Agent 更新会保留被省略的键，且 SDK 公共合同只接受字符串）。保存后经现有 scope lock、原子 Project 写入、OpenAgentPack Sync 与配对备份路径。
- Sync 失败时保留本地期望状态与旧成功备份；不显示共享已成功，用户可用既有重试同步收敛。

### Session API Key 分组

- Qoder 新建 Session 在 Provider metadata 中写入当前 `openagentbot_key_scope`；创建、列表和详情可读回，同 Key 跨设备归入同一应用分组。创建响应没有返回匹配 scope 时，Main 不把 Session 加入当前 roster。
- 百炼真实 API 接受并在 Session 详情中保留创建请求中的 metadata，但列表省略 metadata；Adapter 对列表项按 Session ID 请求详情补齐 scope，再由 Main 过滤。Provider 中既有未分组 Session 保持不变且不展示，不增加本地 Session owner 存储。
- Chat 列表只显示当前 Key scope 匹配的 Session；其他 Key 与未分组 Session 均隐藏。Main 在详情、发送、订阅、归档、删除和读取产物前重新核对可读回的 Session metadata；非当前 Key Session 返回统一 not-found。
- Bot 共享不自动分享已有 Session。应用内分组不改变 Provider API 授权，直接调用 Provider API 的访问仍由 Provider 决定。

- Main 不向 Renderer 传递原始凭据或 scope 指纹，不将 Chat/Message/Session 复制到本地持久化。

### Session 共享交互

- 已共享任务显示低强调的状态标签；所有者另有固定分享图标入口，未共享时提示“共享任务”，已共享时提示“管理共享”。他人共享任务只有状态，不提供共享管理按钮。
- 面板明确区分“尚未共享”和“已共享给团队”，开启或取消必须由用户明确点击；打开面板不写入远端，失败保留提示与重试入口。
- 桌面悬停或聚焦显示分享入口，触屏常显；面板打开时入口保持显示并隐藏任务 Tooltip，关闭后归还焦点。

### 通用用户流程

1. 添加 Qoder 或 Bailian Connection 后自动完成运行环境设置；环境设置成功（ready）后能列出远程 Agent 并进入工作区。
   1d. Bailian 默认可从系统浏览器完成国内站北京地域登录：新增和重新连接均打开 Console，回调 API Key 与 Workspace 只进入 Main，真实 AgentStudio 验证成功后才写安全存储；Renderer、IPC、日志和 Connection 元数据均不包含 Key。取消、超时、错误 state、重复 callback、非北京地域与验证失败均不产生或改写 Connection，并始终保留手动 API Key 入口。重连返回不同 Workspace 时清除旧环境绑定。
   1a. 凭据验证成功但环境设置失败时，Connection 已保存并出现在列表中，状态为「需要设置」；用户可以从连接详情重新发起设置，不丢失连接。
   1b. Provider 返回多个未归档 Environment 时，用户从候选列表中显式选择一个完成设置；选择前的 Connection 没有 `defaultEnvironmentId`。
   1c. Workspace ID 变更需要新凭据，验证通过后原子保存新凭据并清除旧 `defaultEnvironmentId`；任何一步失败都回滚，Connection 保持原配置与绑定。
   1e. 需要用户选择运行环境时，候选中名称精确为 `Agents/base` 的环境默认选中；不存在时不自动选择其他环境。
2. 只有 `environmentReady` 的 Connection 能创建 Bot 或 Chat；`environmentReady` 为 false 的 Connection 在 Renderer 被引导到连接设置，在 Main 以 `conflict` 拒绝。
3. remote-only Agent 可以创建/打开 Chat，但没有配置更新入口。
4. 创建 Bot 会写本地 IaC 文件并创建一个远程 Agent。
5. 修改 managed Bot 会先保存本地期望配置，再让同一远程 Agent 收敛。
6. Sync 失败后本地期望配置保留，用户可以再次 Sync。
   6a. Managed Bot 的配置表单可编辑名称、描述、Instructions 和模型；保存提交完整四字段，先原子写 `agents.yaml` 再 Sync，远程 Agent ID 不变。
   6b. 编辑保存失败后表单保留全部输入；Sync 失败时再次打开表单显示 `hasPendingChanges` 提示（本地配置尚未同步）。
   6c. 更新后的配置只保证用于新建 Chat；已有 Chat 保持创建时的 Agent 快照（由 live 合同测试证明）。
   6d. 创建与编辑 Managed Bot 可关联或移除当前 Connection 下已有的 active Skill；选择结果以完整 `skills` 集合写入 `agents.yaml` 后 Sync。百炼固定具体版本，Qoder 使用 Provider 当前绑定合同；清空集合会解除最后一个绑定。
   6e. Qoder 与百炼创建、编辑页均展示“我的 Skills”和“技能广场”，共享搜索、添加、草稿选择与确认交互。Qoder 添加后使用安装接口返回的 custom Skill ID；百炼添加 official Skill 时直接形成带具体版本的引用。目录或添加失败不丢失表单与已选 Skill。
   6f. 百炼创建、编辑 Managed Bot 可免登录搜索 MCP 广场、选择 official MCP 并勾选工具；匿名目录请求不得携带 Connection 凭据或 Cookie。保存把完整选择成对写入 `mcp_servers` 与 `tools.mcp`，移除最后一个绑定写入空集合。Qoder 不展示入口。
   6g. 两个 Provider 的创建、编辑页通过与 Skill、MCP 一致的选择弹窗配置内置工具：取消不写回，确认且选择变化后才更新表单；未操作时沿用 Provider 默认或现有声明，修改后以完整 `tools.builtin` 集合同步。百炼的 `web_search`、`web_fetch`、`mark_artifacts` 默认关闭，用户可勾选并由 SDK 映射写入远程；Main 在写盘前拒绝当前 Provider 不支持的工具名。清空集合时应真正禁用全部内置工具，编辑不得丢失已有 MCP 声明。
7. 打开 Bot 能列出远程 Session，打开 Chat 能用 Event cursor 读取完整历史，并展示消息、工具调用/结果、产物、状态、错误与模型用量。
8. 发送纯文本后能看到文本增量和实时事件，并在 idle 后由远程历史校准最终对话时间线。
9. 关闭/重载 Renderer 后重新查询远程数据，不依赖本地 Chat 状态恢复。
10. 关闭主窗口后应用保留在系统托盘；托盘打开、macOS activate 和第二实例启动都恢复同一个主窗口。
11. 只有托盘“退出”或系统退出流程终止应用；显式退出后托盘消失且本地 SSE 订阅被清理。
12. “删除本地连接”明确区分本地与远程影响；存在 Managed Bot 本地资料时展示数量，只有破坏性二次确认后才删除连接、凭据与对应 IaC 资料，Provider 中的 Bot、Chat 和消息保持不变。
13. Managed Bot 可从 Bot 管理页归档：确认弹窗说明列表移除与资料保留语义，确认后经 Provider 软归档；成功后 Bot 从默认列表与 Chat roster 消失，本地 IaC 资料（Project Document、state、manifest、配对 backup）原样保留；失败时弹窗保持、显示稳定错误并可重试。Remote-only 与 state-missing Bot 没有归档入口，Main 侧同样在任何远程 mutation 前 fail-closed。
    13a. 归档后的远程事实：默认 Agent 列表不再返回该 Agent（`include_archived=true` 仍可查到，仅作测试证据）；已有 Chat 保留，为该 Agent 创建新 Chat 被 Provider 拒绝；Environment、Connection 与 credential 不受影响；已归档 scope 仍计入删除本地连接时的 managed scope 数量。
    13b. 归档不引入本地归档状态、后台重试或恢复入口；应用重启后不自动重试归档，也不展示已归档 Agent。
14. Workspace 导航（桌面与窄窗口共享同一内容模型）：
    14a. 导航使用互斥的 `Chats / Bots` 模式，启动、Chat 返回与切换 Connection 后默认进入 Chats 的新任务输入页；「全部任务」只由用户显式打开。模式只存在 Renderer 内存，不持久化。
    14b. Chats 模式至多显示最近 8 个 Chat，并在分组标题旁提供轻量的「查看全部」入口，保留当前页的可访问性语义，数量只在总览页显示；主内容区按最近/更早分组浏览完整 roster，并以每批 50 条的「加载更多」避免一次渲染超大列表。Bot 不在该模式形成资源树。Chat 以标题为主信息、所属 Bot 为副信息。
    14c. Bots 模式只显示 Bot、管理类型和可靠的 Chat 数量；Bot 不展开 Chat 子树。Managed Bot 提供编辑与新建 Chat，Remote-only Bot 只提供新建 Chat。
    14d. Chat 与 Bot 分别执行模式内搜索：Chat 匹配 Chat 标题或所属 Bot 名；Bot 匹配名称或描述，不产生混合结果。
    14e. Chat 详情以 Chat 标题为一级标题，并持续显示「与某 Bot 的 Chat」；两个属于同一 Bot 的 Chat 仍能从标题明确区分。
    14f. 全局「新建 Chat」先明确要求选择 Bot；创建成功后进入 Chats/detail。创建 Bot 成功后进入 Bots/detail。
    14g. 首次加载展示骨架与「已检查 Bot / 总 Bot」进度；每个 Bot 返回后增量显示已发现 Chat；后台刷新保留已有列表；单个 Bot 拉取失败保留缓存、计入失败数并提供「部分 Chat 未加载 · 重试」，未知数量不显示为 0。
    14h. 窄窗口（<768px）通过 44px 导航按钮打开 Sheet；切换 Chats/Bots 不关闭，打开 Chat/Bot、新建、编辑或切换 Connection 后关闭；Escape/overlay 关闭并归还焦点。
15. 协作 Bot（成员只做外部引用，当前 Bot 仍是普通 Bot）：
    15a. 创建或编辑 Managed Bot 时可从当前 Connection 的已有 Bot 中选择零到二十个协作成员；成员为空时行为与普通 Bot 完全一致，且创建时沿用固定缺省 Instructions；roster 非空时创建写入协调版缺省 Instructions（不含成员 ID 或显示名），编辑 roster 不改写用户已有 Instructions。
    15b. 非空成员写为 `multiagent.type=coordinator` 与外部 `{ agent_id }` 引用；空数组时 Project Document 中完全不存在 `multiagent` 键，且 Sync 成功后远程 roster 被清除而不是保留旧成员。
    15c. 协作成员使用表单内嵌、原位展开的选择器：默认只显示已选成员 Chip 与「添加成员」，点击后在原位置展开搜索与候选列表，不使用 Dialog/Popover，也不使用双栏工作台。候选来自现有 `bots.list`，编辑时排除当前 Bot，达到 20 项后禁用未选项；保持选择顺序，但不提供拖拽排序或优先级。
    15d. 已配置但当前列表未返回的成员显示「当前列表不可见」的已选条目并默认保留，只有用户显式移除才清除；候选加载失败时就地报错并可重试，保留全部已选 ID 且不推断单个成员的删除、归档或权限状态。
    15e. roster 参与 unchanged 判断，顺序变化视为变更；保存失败保留成员选择与全部输入；清空 roster 后提交 `[]`。
    15f. update 输入包含当前 Agent 自己时，Main 在任何文件写入与 Provider mutation 之前以 `invalid-input` 拒绝。
    15g. roster 变更不改变当前 Bot 的远程 Agent ID、逻辑资源 key、scope、manifest 与 Environment；成员 Agent 不被更新、归档或删除。
    15h. Chat 路径不变：消息仍只发送给所选 Bot 的 Session；新任务输入框输入 `@` 展示助手候选，选择后在输入区显示可移除的助手名称标签（不带 `@`），草稿正文不包含触发文本，发送时不发送标签。配置页说明「在消息中点名成员会影响协调者的选择，但不保证精确路由。」；不新增成员名称消歧、fan-out 或客户端结果汇总。后续只读 child Thread 工作记录遵循第 15i 条。
    15i. Bot 列表只用 Provider 当前 roster 标识协作；Session 列表/详情只用各自 Agent 快照标识创建时成员，不以当前 Bot roster 回填。Thread 工作记录只呈现 Provider 已证实的委派事件；Thread 数不当作成员人数。Qoder 子 Thread idle 不得触发整个 Session 的 done；成员消息不成为独立聊天气泡，Thread 不在本地持久化。

## 代表性故障

- 无效凭据：远程调用被拒绝，凭据不泄露。
- 网络不可用：UI 提供重试，不自动重复发送 Message。
- SSE 断开：使用内存 Event ID 有限续传；游标失效或无法续传时重新读取远程历史，不自动重发用户消息。
- Project Document 写失败：不调用 Provider。
- state 缺失/损坏：控制面 fail closed，数据面仍可使用远程 Agent。
- 首次创建门禁：只有 `phase=new` 可以在无 state 时调用 Provider；调用前必须持久化 `phase=applying`。
- update 使用旧 state：允许对同一 Agent 重复配置写入并最终收敛，不允许创建新 Agent。
- 同 scope 并发：第二个写操作等待或明确冲突。
- 托盘图标缺失/损坏：启动明确失败，不发布不可见托盘。
- 重复启动：失败实例不创建窗口、托盘、IPC 或业务 Composition，已有实例被唤起。
- Connection 未完成环境设置：创建 Bot/Chat 在任何远端写入前以 `conflict` 拒绝，错误消息不携带 Provider 正文。
- 环境设置失败：不删除 Connection、不写 `defaultEnvironmentId`、不删除已创建的远端 Environment。
- Workspace 变更中途失败：凭据与绑定保持变更前的值，没有半更新状态。
- 成员远程无效（不存在、已归档、无权限或被并发修改）：Sync 失败并沿用现有保守失败语义，本地期望配置与 roster 保留、可重试；不引入远程 preflight、回滚猜测或删除补偿，不向 Renderer 透传完整 Provider 响应。
- update 自引用成员：在写文件和任何 Provider mutation 之前失败。
- Qoder Agent 分页 cursor 不前进：`bots.list` fail closed，不返回部分列表，也不进入死循环。

## 真实 Cloud smoke

使用唯一资源前缀与 metadata，依次验证：

```text
Connection 验证
  -> 生产 EnvironmentControlPlane.setup 建立或选中共享 Environment
  -> 两个 Connection/Bot 指向同一 Environment remote ID
  -> OpenAgentPack 创建/更新 Agent（外部引用该 Environment）
  -> 修改 agents.yaml 并直接 Sync
  -> 再次 Sync 收敛
  -> 原生 Client 创建 Session
  -> 发送 Message
  -> SSE 到 idle
  -> 重读远程历史包含最终回复
  -> 删除临时 Session/Agent
  -> 删除或按 Provider 协议归档 Environment
```

smoke 必须断言清理结果；资源无法物理删除时记录 Provider 原因和归档证据。

### 协作 Bot smoke（Qoder 与 Bailian 各一次）

```text
创建两个带唯一前缀的临时成员 Agent
  -> 创建 coordinator 并以 external { agent_id } 引用成员
  -> 断言当前 scope state 只记录 coordinator，不记录成员
  -> coordinator instructions 要求把本次探针强制委派给唯一 worker，并原样返回 worker 生成的唯一 marker
  -> 创建新 Chat 并发送普通用户消息（不依赖 @name）
  -> 断言远端 roster 含目标 agent_id
  -> 观察真实 child Thread 创建与双向 thread message 事件
  -> roster 从两个成员更新为一个，断言远程收敛且 coordinator ID 不变
  -> 清空 roster，断言远程 multiagent 被清除
  -> 断言成员 Agent 未被更新、归档或删除
  -> 归档/删除临时资源，遵循 Provider 正式协议
```

稳定验收只使用强制委派探针：Qoder 在可用时进一步用 Thread API 确认 child Agent ID，百炼以 child `session_thread_id` 与 thread message 事件证明实际协作。模型最终文本、模型声称「已委派」或 marker 本身都不能替代 Thread 事件证据。「普通任务是否主动委派」与「自然语言点名是否影响选择」只作为体验观察记录，不作为确定性 pass/fail 条件。验证记录不含凭据、完整 Provider 响应或用户数据。

## 已有证据

根仓库 `docs/research/v2-control-data-plane-live-validation.md` 已证明：

- 正常 create/update/drift/reconcile/no-op 成立；
- state 丢失后重新 apply 可能重复创建 Agent；
- 旧 state 下 update 会重复写同一 Agent，但可再次收敛；
- Qoder Session 创建、发送、receipt、SSE、历史和按 Agent 列表成立。

实现测试必须保护这些结论，不能用 Fake 推翻真实 Provider 证据。

## 共享与复用增量验收

目录刷新须保护草稿、搜索、范围与有效选择；同步成功但读回失败须与同步失败区分，恢复只重读目录。取消共享验证接收方发现范围变化，不将其当作撤权。真实双客户端流程和两家 Provider 的配置快照证据见 [2026-09-29 验收记录](validation-records/bot-sharing-hardening-2026-09-29.md)。
