# 统一 Skill 选择交互开发计划

## 目标

让 Qoder 与 Bailian 在 Bot 创建、编辑场景中提供一致的 Skill 选择心智模型：用户都从“我的 Skills”和“技能广场”浏览、搜索并添加 Skill，再通过“确认选择”形成 Bot 的完整 Skill 引用集合。Provider 的获取、安装和版本规则由 Main 隐藏，Renderer 不根据 Provider 编排不同流程。

本计划修正当前把“技能广场”等同于“Qoder 下载并安装”的建模。Bailian 的 `official` Skill 是技能广场候选，可直接形成带具体版本的 Agent Skill 引用；Qoder 的市场 Skill 必须先安装为 custom Skill，再使用安装接口返回的 Skill ID 形成引用。

## 用户流程

1. 用户在创建或编辑 Managed Bot 时打开“选择 Skills”。
2. 两个 Provider 都展示同样的“我的 Skills”和“技能广场”两个 Tab，以及一致的搜索、列表、选择计数、取消和确认操作。
3. “我的 Skills”展示当前 Connection 下已经由用户拥有或安装、且可挂载的 Skill；已经选中但当前目录中不可用的引用仍保留并标记“当前不可用”。
4. “技能广场”展示当前 Provider 可添加的 Skill；已经添加或选中的候选显示稳定状态，避免重复操作。
5. 用户在技能广场点击统一主动作“添加”：
   - Qoder 在 Main 内下载并安装市场包，使用 Provider 返回的 custom Skill ID 加入当前草稿选择；
   - Bailian 在 Main 内把 active official Skill 转换为带具体版本的引用，不产生上传或安装写操作，并加入当前草稿选择。
6. 添加过程中保留表单字段、已选 Skill 和搜索结果；失败时在弹窗内显示稳定错误并允许重试。
7. 用户点击“确认选择”后才把草稿集合写回创建/编辑表单；取消关闭不改变表单中的既有集合。
8. 创建或“保存并同步”继续以完整 `skills` 集合写入 `agents.yaml` 并 Sync；清空集合继续表达解除全部绑定。

## 交互合同

- 页面结构、Tab 名称、搜索位置、卡片/列表布局、添加动作、加载反馈和错误恢复对两个 Provider 一致。
- 用户动作统一称“添加”；过程反馈允许准确反映远程行为：Qoder 显示“正在安装…”，Bailian 显示“正在添加…”。
- “添加”只改变选择器草稿，不隐式提交 Bot 表单。
- Qoder 安装成功后，市场候选与新 custom Skill 的关联由 Main 返回的结果表达，Renderer 不按名称猜测 Provider 身份；兼容旧数据时可保留现有 marketplace metadata 匹配作为降级路径。
- Bailian 只展示 `status=active` 且有 `latest_version` 的 official Skill；添加结果必须固定该具体版本，不能提交 `latest` 或无版本引用。
- 最大选择数仍为 20；达到上限时禁止新增，但允许取消已有选择。
- 市场读取或添加失败不得清空 Bot 表单、选择器草稿或已经加载的另一 Tab 数据。
- 创建页与编辑页复用同一选择器和同一数据 Hook，不复制 Provider 判断。

## Module 与 Interface 设计

### Renderer 使用的 DesktopHost Interface

以用户意图命名，替换当前暴露 Qoder 实现细节的 `listMarketplaceSkills` / `installMarketplaceSkill`：

```ts
interface SkillCatalogEntry {
  catalogId: string;
  name: string;
  description?: string;
  version?: string;
  author?: string;
  installCount?: number;
  addedRef?: BotSkillRef;
}

interface DesktopHostBots {
  listSkills(connectionId: ConnectionId): Promise<BotSkillOption[]>;
  listSkillCatalog(connectionId: ConnectionId, query?: string): Promise<SkillCatalogEntry[]>;
  addSkillFromCatalog(connectionId: ConnectionId, catalogId: string): Promise<BotSkillOption>;
}
```

Interface 语义：

- `listSkills` 返回“我的 Skills”中可挂载的条目：Bailian 使用 custom 目录；Qoder 保留现有 Provider 已安装目录合同，避免移除已经可挂载的 official 或历史条目。具体来源映射由 Main 决定，Renderer 不解释 `source`。
- `listSkillCatalog` 返回技能广场候选；`addedRef` 表示该候选已有可直接使用的引用，可用于显示“已添加”或直接选择。
- `addSkillFromCatalog` 无论 Provider 底层是否发生远程安装，都返回最终可写入 `agents.yaml` 的 `BotSkillOption`。Renderer 不接触下载 URL、上传包、Provider source、workspace 或 credential。
- 保留 `BotSkillRef` 作为持久声明引用，不把 catalog identity 写入 `agents.yaml`。

实现时先用调用方测试检验上述类型是否足够；若 `addedRef` 无法稳定表达 Qoder 的已安装关联，再扩展单一字段，不引入通用 capability matrix 或 Provider 特有联合类型。

### Main SkillCatalog Module

新增 Main 内部 `SkillCatalog` Module，Interface 与 DesktopHost 的两项 catalog 操作一致，内部根据已解析 Connection 选择 Adapter：

```ts
interface SkillCatalogAdapter {
  list(query?: string): Promise<SkillCatalogEntry[]>;
  add(catalogId: string): Promise<BotSkillOption>;
}
```

- `QoderSkillCatalogAdapter` 复用现有 `QoderSkillMarketplace` 的公开目录、ZIP 下载和 Cloud Skill 上传实现；成功结果必须使用 Provider 返回的 custom Skill ID。
- `BailianSkillCatalogAdapter` 经 OpenAgentPack 公共 `listSkills(..., { provider: "bailian", source: "official" })` 列出 official Skill；`add` 重新确认候选仍为 active 且存在具体版本，然后返回 official `BotSkillOption`，不执行虚假的安装远程写入。
- Adapter 接收单次调用所需的 credential/workspace 作用域，不长期持有原始凭据，不向 Renderer 返回 Provider wire 数据。
- `BotControlPlane.listSkills` 收敛为“我的 Skills”目录读取，避免再把 Bailian official Skill 混入“已安装”。Bot 创建、更新、Project Document 和 Sync 流程保持不变。

这个 seam 已有两个真实 Adapter，隐藏的正是两种已经验证的 Provider 行为；不扩展为动态 Provider capability、插件发现或通用市场生命周期系统。

## 分阶段实施

### 阶段 1：修正规范与回归信号

1. 更新 `docs/architecture.md`：把 Qoder 专属市场段落改为 Provider-neutral SkillCatalog Module，并分别记录两个 Adapter 的行为。
2. 更新 `docs/interfaces.md`：定义新的 view model、DesktopHost Interface、错误语义及 Bailian 固定版本约束。
3. 更新 `docs/validation.md`：把“百炼不展示技能市场入口”改为两个 Provider 统一双 Tab 流程，并增加底层行为断言。
4. 如该 Interface 被接受为难以撤销的架构决策，新增 ADR；若只是既有 BotControlPlane 的局部深化，则在上述权威文档中记录，不为计划本身预建 ADR。
5. 先修改/新增 Renderer 测试，使 Bailian 缺少“技能广场”Tab 的现状产生明确失败；该测试是本工作的主反馈循环。

阶段完成信号：同一参数化行为测试分别以 `provider=qoder` 和 `provider=bailian` 运行，现有实现仅 Bailian 用例失败，且失败原因精确为缺少统一市场交互。

### 阶段 2：建立 Provider-neutral Main Interface

1. 在 `src/shared/models.ts` 增加 `SkillCatalogEntry`，命名只表达产品概念。
2. 在 `src/shared/desktop-host-contract.ts`、`src/preload/index.ts`、`src/main/bootstrap.ts` 和 `src/main/desktop-host.ts` 替换两项 marketplace 方法。
3. Main 输入校验覆盖 Connection ID、可选 query 和非空 catalog ID；错误继续映射到现有 `HostErrorCode`。
4. 更新 IPC/Host 合同测试，证明非法输入在任何 Provider 调用前失败，且响应不泄露凭据或 Provider 原文。
5. 暂时允许 Main 内部适配现有 Qoder 实现，但 Renderer 不再调用旧方法；确认没有双 Interface 长期共存后删除旧名称。

阶段完成信号：类型检查通过；DesktopHost 合同测试覆盖 list/add 成功和稳定错误；生产 Renderer 中不再出现 `listMarketplaceSkills`、`installMarketplaceSkill`。

### 阶段 3：实现两个 SkillCatalog Adapter

1. 把现有 `QoderSkillMarketplace` 收敛为 `QoderSkillCatalogAdapter`，保留现有 HTTP 合同测试，并增加 `SkillCatalogEntry` 映射、已安装关联和最终引用测试。
2. 新增 `BailianSkillCatalogAdapter`：
   - list 只请求 `source=official`；
   - 只返回 active 且有具体最新版本的候选；
   - add 根据 `catalogId` 重新读取/确认远程事实，防止使用过期或不可挂载版本；
   - 返回 `{ type: "official", skillId, version }`。
3. 调整 `BotControlPlane.listSkills` 的目录定义，使“我的 Skills”不再混入 Bailian 广场候选；为已有 Bot 当前引用保留选择器的 unavailable 回显能力。
4. 在 Composition 中按 Connection 构造或选择 Adapter；不得让 Renderer 传 Provider 名称决定实现。
5. 对认证、权限、限流、404、网络异常、非法响应进行现有 HostError 分类映射。

阶段完成信号：两个 Adapter 通过同一组 Interface 合同测试；Qoder 额外通过下载安装测试，Bailian 额外通过“无安装写操作、固定具体版本”测试。

### 阶段 4：统一 Renderer 状态流

1. 把 `useSkillMarketplace` 重命名并深化为 `useSkillCatalog`，统一管理 loaded/loading/options/error/addingId；Connection 改变时丢弃旧请求结果，避免跨账号候选串线。
2. `BotSkillSelector` 固定渲染“我的 Skills”和“技能广场”，删除 `marketplace?` 是否存在所驱动的 UI 分支。
3. 创建/编辑表单不再传 `provider === "qoder"`，只传 catalog 状态与动作。
4. 技能广场主动作统一显示“添加”；由 Main 返回的最终 `BotSkillOption` 加入 `newlyAdded` 与草稿选择。
5. 使用 `addedRef` 精确显示“已添加”“已选择”，避免仅靠名称匹配；名称匹配只作为旧 Qoder metadata 缺失时的兼容降级，并以测试约束误匹配风险。
6. 保留 Dialog 草稿提交语义、20 项上限、搜索、空状态、不可用当前引用和失败保留状态。
7. 若现有 design-system Primitive 足够，复用现有 Dialog、Button、Checkbox、Alert、Input；不新增只为本需求预建的 Primitive，不新增 CSS 文件或设计常量。

阶段完成信号：同一参数化 Renderer 测试对两个 Provider 断言相同的 Tab、搜索、添加、确认、取消和错误恢复；测试只在过程提示上允许“安装/添加”差异。

### 阶段 5：端到端控制面验证

1. 创建页测试：分别从两个 Provider 的技能广场添加候选，确认 `CreateBotInput.skills` 是最终 Provider 引用，而不是 catalog ID。
2. 编辑页测试：初始化已有 custom/official 引用，增删后提交完整集合；清空后提交 `skills: []`。
3. Project Document 测试：Bailian official 引用写入具体 `version`；Qoder 写入安装后的 custom Skill ID，不写 marketplace ID。
4. 更新/Sync 测试：添加失败不写 Project Document；只有用户提交表单才触发创建或更新 Sync。
5. 回归当前 Skill 列表失败、市场失败、安装失败、选择上限、当前引用不可用和 Connection 切换场景。

阶段完成信号：Renderer 到 DesktopHost 的测试证明统一交互，BotControlPlane 测试证明 Provider 正确引用进入同一 IaC/Sync 路径。

### 阶段 6：真实 Cloud 验证

使用仓库现有 `.env`，不输出、修改或提交凭据；所有资源使用唯一前缀和测试 metadata。

1. Bailian：列出 official Skill，选择一个 active 且有具体版本的候选，创建临时 Agent，读取远程 Agent 确认 Skill ID 与版本；再移除 Skill 并确认收敛。
2. Qoder：从公开市场选择候选，安装后确认返回 custom Skill ID，用该 ID 创建临时 Agent并读取远程事实；验证重复添加不会重复安装或产生错误选择。
3. 两端分别验证搜索、认证失败映射、市场读取失败不影响“我的 Skills”，以及已有 Chat 不因 Bot Skill 更新而改变快照。
4. 删除临时 Session 与 Agent；Provider 因引用关系拒绝删除 Environment 时按正式协议归档，并记录清理证据。
5. 将实测日期、地域、端点合同、资源 ID 的脱敏证据和清理结果写入验证记录；若真实合同与计划假设冲突，停止实现并先更新权威文档，不在 Renderer 添加例外补丁。

阶段完成信号：两个 Provider 都完成“广场候选 → 添加 → 选择 → Sync → 远程读回”的闭环，且无遗留临时 Agent/Session。

## 测试矩阵

| 层次              | Qoder                      | Bailian                        | 共同断言                           |
| ----------------- | -------------------------- | ------------------------------ | ---------------------------------- |
| Adapter list      | 公共市场映射               | official Skill 映射            | 搜索、active 过滤、稳定错误        |
| Adapter add       | 下载并上传，返回 custom ID | 直接形成 official ID + version | 返回最终 `BotSkillOption`          |
| DesktopHost       | 选择 Qoder Adapter         | 选择 Bailian Adapter           | Renderer 不传 Provider 分支        |
| Renderer          | 添加时显示安装进度         | 添加时显示添加进度             | 双 Tab、草稿、确认、取消、失败保留 |
| Bot create/update | custom 引用                | official 具体版本引用          | 完整集合写入并 Sync                |
| Live Cloud        | 安装后绑定                 | 官方 Skill 直接绑定            | 远程读回与资源清理                 |

## 预计修改位置

- 权威文档：`docs/architecture.md`、`docs/interfaces.md`、`docs/validation.md`，必要时 `docs/adr/`。
- Shared/IPC：`src/shared/models.ts`、`src/shared/desktop-host-contract.ts`、`src/preload/index.ts`、`src/main/bootstrap.ts`。
- Main：`src/main/desktop-host.ts`、`src/main/composition.ts`、`src/main/control-plane/bot-control-plane.ts`、现有 Qoder marketplace Module，以及新增的 SkillCatalog Module/Adapter。
- Renderer：`src/renderer/features/bots/use-skill-marketplace.ts`、`bot-skill-selector.tsx`、`bots-page.tsx`、`bot-settings-form.tsx`。
- 测试：上述 Module 的相邻单元/合同测试、Bot 创建与编辑行为测试，以及 `tests/live/` 下的 Provider 真实合同测试。

最终放置以 `docs/repository-layout.md` 为准；新增 Main 文件应位于 `src/main/control-plane/`，因为 Skill 目录与 Agent 声明都属于控制面，不得放入 Chat data-plane Provider 目录。

## 非目标

- 不编辑、发布、删除或升级 Skill 内容。
- 不建设动态 Provider capability matrix、插件发现或第三个 Provider 的假想行为。
- 不把 catalog identity、下载 URL、安装包或 Provider wire 字段写入 Project Document。
- 不改变 Bot/Chat 远程身份、Environment 绑定或已有 Chat 快照规则。
- 不新增本地 Skill、Chat、Message、Turn、Operation 或市场缓存持久化。
- 不从 OpenAgentPack `internal` 路径导入代码；若公共 Interface 不能完成 Bailian official Skill 合同，停止并记录阻塞。
- 不为了统一文案而伪装远程副作用；底层进度和失败信息仍应准确。

## 完整验证命令

实施完成后至少运行：

```text
pnpm typecheck
pnpm lint
pnpm test src/renderer/features/bots
pnpm test src/main/control-plane
pnpm test
pnpm test:arch
```

如果修改了 design-system Primitive，额外运行：

```text
pnpm test src/renderer/ui/design-system
```

最后检查 diff，确认 Renderer 没有 Provider 分支、生产源码没有 OpenAgentPack `internal` 导入、凭据和 Provider 原始响应没有进入日志或快照。
