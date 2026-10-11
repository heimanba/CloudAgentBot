# Chat 内容渲染调研

日期：2026-09-18  
范围：`src/renderer/features/chats/chat-detail-page.tsx` 的内容层；不改变 Provider、Bot、Chat 身份与远程事实权威，不引入本地 Chat/Message/Turn 持久化。

## 结论

当前界面“突兀”的根因不主要是颜色或圆角，而是信息架构：回答、思考、工具输入、工具输出和运行状态都作为同级时间线 item 出现。用户看到的是 Provider event 日志，而不是由这些 event 组成的一轮工作。

推荐把默认视图收敛为三层：

1. **对话层**：user prompt 与 assistant answer，是唯一的主视觉层；assistant 使用 Markdown 文档排版而非气泡中的纯文本。
2. **工作过程层**：reasoning、tool invocation、status 合并为一条紧凑、可折叠的“工作过程”，默认只显示用户能理解的动作摘要和最终状态。
3. **结果与异常层**：artifact 是一等结果卡；错误就地附着到失败的工具或当前回复，只有 Session 级失败才成为独立告警。

这不是隐藏 Provider 事实。完整事件仍可通过现有“工作记录”搜索/筛选查看；默认视图只是建立清楚的阅读优先级。

## 一手来源观察

### 1. 消息应按有类型的 part 渲染，而不是统一字符串

Vercel AI SDK 的官方 UI 文档明确推荐用 `message.parts` 而不是单个 `content` 渲染，因为 text、tool invocation、tool result、file 等需要不同的 UI。其工具模型还把一次调用建模为同一个 part 的状态演进：tool call 先出现，执行后成为 tool result，而不是两个互不相关的消息。[AI SDK Chatbot](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot)、[AI SDK Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)

AI SDK 的 stream protocol 也为 tool input delta、input available、output available、step finish 和 message finish 定义了不同事件。这说明高质量 UI 需要稳定 identity 和阶段状态，不能仅凭“事件到达了”决定外观。[AI SDK Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)

**对本项目的含义**：`ChatTimelineItemView` 已经是判别联合，方向正确；问题在 Renderer 把 union 各分支平铺成同级卡片。应先形成 display model（answer block / work group / artifact / session error），再渲染。

### 2. Reasoning 是次级披露，并随流式生命周期变化

AI Elements 官方 Reasoning 组件的默认交互是：reasoning 流式生成时自动展开，生成完成后自动收起；多个 reasoning part 还建议合并，避免出现多个重复的 “Thinking...” 指示器。[AI Elements Reasoning](https://elements.ai-sdk.dev/components/reasoning)

OpenAI Responses API 区分 reasoning summary 与 reasoning content，并把 summary 描述为用于理解、调试的摘要。UI 不应把任意 Provider `thinking` 都断言为完整、忠实的内部思维链。[OpenAI Responses streaming reference](https://platform.openai.com/docs/api-reference/responses-streaming/response/refusal?lang=python)

**对本项目的含义**：

- 历史 reasoning 默认收起，标签用中性的“工作思路”或“查看思考记录”；只有 Provider 明确保证是 summary 时才叫“思考摘要”。
- 流式 reasoning 可暂时展开并显示“正在思考”，首个 assistant text 出现或运行结束后收起。
- 正文使用与 Markdown 相同的可读排版，但更弱的颜色与字号；不要用 11px monospace `pre`，它会把自然语言表现成调试日志。
- 同一轮连续 reasoning 合并为一个 disclosure，避免每段各占一张卡。

### 3. Tool 是一个有生命周期的 invocation

AI Elements 官方 Tool 组件将状态明确分为 Pending、Running、Awaiting Approval、Responded、Completed、Error、Denied，并在一个可折叠容器里组合 header、input、output 与 error；状态由 badge 和图标表达。[AI Elements Tool](https://elements.ai-sdk.dev/components/tool)

其参考实现把 tool name、状态标记、参数与输出组合在一个 Collapsible 中，而不是将调用与结果分开。[Vercel chatbot `tool.tsx`](https://github.com/vercel/chatbot/blob/main/components/ai-elements/tool.tsx)

**对本项目的含义**：

- 将 `tool-call` 与对应 `tool-result` 合成一行 invocation：`搜索文件 · 完成`、`运行命令 · 失败`。
- 折叠态只展示动词化名称、状态、耗时（若以后合同提供）；不展示 server name、raw type、thread ID。
- 展开态分“参数”和“结果”，按值的形态选择 JSON viewer、代码/终端块或普通文本；空对象/空输出不必渲染一个大 `pre`。
- Running 使用低干扰 spinner；Completed 使用静态 check；Error 使用红色状态文字和错误摘要，但避免整卡铺红。
- 当前合同是实现阻点：`tool-result` 有 `toolUseId`，`tool-call` 没有 call ID（`src/shared/models.ts`）。应给 `tool-call` 增加 Provider-neutral `toolUseId?` 并在 Qoder/Bailian adapter 映射，Renderer 才能可靠配对。无法配对时才退回相邻顺序启发式，且只在 display model 内使用，不写本地状态。

### 4. Assistant answer 应是文档，user prompt 才适合气泡

AI Elements 的 Message 组件把 assistant response 作为 Markdown 内容，并专门支持消息 action 与 branch；Code Block 组件则提供语法高亮、语言/文件标题和复制动作。[AI Elements Message](https://elements.ai-sdk.dev/components/message)、[AI Elements Code Block](https://elements.ai-sdk.dev/components/code-block)

`react-markdown` 官方说明其默认不使用 `dangerouslySetInnerHTML`、会过滤危险 URL，且允许把 Markdown element 映射成应用自己的 React component；若引入不受信插件或 raw HTML，官方建议再使用 `rehype-sanitize`。[react-markdown README](https://github.com/remarkjs/react-markdown/blob/main/readme.md)、[rehype-sanitize README](https://github.com/rehypejs/rehype-sanitize/blob/main/readme.md)

**对本项目的含义**：

- user message 保留右侧有底色的紧凑气泡，支持换行和长单词折行。
- assistant message 改为左对齐、无大面积气泡背景的 `prose` 文档块；支持段落、标题、列表、引用、链接、inline code、fenced code、表格。
- fenced code 使用独立 header（语言 + 复制），横向滚动只发生在代码块内部；正文和表格不得撑破 320px 视口。
- 外部链接显示真实 host、使用安全 URL transform，并通过 Electron shell 的受控入口打开；禁止 raw HTML、`javascript:`、内联 event handler。
- 第一阶段可选 `react-markdown + remark-gfm`，保持 `skipHtml`；只有业务明确需要 HTML 时才引入 `rehype-raw`，并必须在最后一个不安全转换之后执行 `rehype-sanitize`。

### 5. 流式渲染必须保持版面、滚动和辅助技术稳定

AI Elements Conversation 的正式模式包含“贴底时自动滚动”和“用户离开底部时出现返回底部按钮”，而不是每个 token 都强制 `scrollIntoView`。[AI Elements Conversation](https://elements.ai-sdk.dev/components/conversation)

W3C WCAG 2.2 对动态状态的要求是：不移动焦点也能被辅助技术识别；进度可用 `role=status` 或 `role=log`，错误在确有紧急性时使用 alert。W3C 也提醒 live region 太多会让读屏体验过度聒噪。[WCAG 2.2 Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages)、[ARIA22](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA22)

**对本项目的含义**：

- 流式正文和历史正文必须复用同一个 `AssistantMessageContent`，避免完成瞬间从纯文本气泡跳成 Markdown 文档。
- 允许 Markdown 在流式中渐进解析，但对未闭合 fenced code 做稳定降级；昂贵语法高亮可在 block 闭合或 stream done 后执行。
- 当前 effect 依赖 `streamingText`，每个 token 都 smooth scroll，会与用户向上阅读竞争。改成“只有仍贴底时跟随”；离底后停止自动滚动并显示“回到最新”。
- token 容器维持 `aria-live="off"` 是合理的；用预先存在的单一 `role="status" aria-live="polite"` 只播报“Bot 正在回复 / 回复完成 / 回复失败”，不要逐 token 播报。
- cursor 不应是回答内容的一部分；用装饰性伪元素或 sibling，并尊重 `prefers-reduced-motion`。

## 当前实现审计

| 现状                                                | 体验问题                                                         | 优先修复                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| message 一律 `whitespace-pre-wrap` 纯文本气泡       | assistant 的列表、代码、表格和链接失去结构，长回答像大块聊天气泡 | 抽取 `UserMessage` / `AssistantMessage`，后者安全渲染 Markdown      |
| thinking/tool call/tool result 共用相似灰卡和 `pre` | 自然语言、参数、结果缺少语义差异；卡片密度高，打断回答           | reasoning 降级为 disclosure；tool call/result 合并为 invocation     |
| tool call 标题固定“正在使用”                        | 历史里已完成的调用仍显示进行时                                   | 从配对后的 invocation 状态生成标题                                  |
| tool result 独立显示“工具执行完成”                  | 看不到是哪个工具，也不清楚与哪次调用对应                         | 保留 call ID 并组合 input/result/error                              |
| status/usage 默认 `sr-only`                         | 降噪正确，但用户也失去本轮是否仍运行的视觉线索                   | 在 work group header 聚合一个可见运行状态；原始 status 留在工作记录 |
| `streamingText` 单独复制一套纯文本样式              | 完成时视觉重排；不能预览 Markdown                                | 复用 assistant content renderer，并传 `streaming` 状态              |
| 每个 token 触发 smooth `scrollIntoView`             | 用户无法稳定向上阅读，长流式会连续动画                           | sticky-bottom 状态 + 回到底部按钮                                   |
| `EventMeta` 隐藏 raw type，但仍直接展示 thread/time | 操作事件细节挤占主线；时间精确到秒噪声大                         | 默认只在 hover/focus 或展开态显示时间；raw 元数据仅工作记录模式     |
| 单个 `TimelineItem` 承担所有类型                    | 分支已长、样式重复，难以单测不同格式                             | display-model selector + 小型语义组件                               |

## 推荐的 Renderer 结构

不建议直接继续扩展 `TimelineItem`。可以在 Renderer 内增加纯派生层，不改变远程事实权威：

```text
ChatTimelineItemView[]
  -> buildChatDisplayBlocks(items)
       MessageBlock(user | assistant)
       WorkBlock(reasoning[], toolInvocations[], status)
       ArtifactBlock
       SessionErrorBlock
  -> semantic renderers
       UserMessage
       AssistantMessageContent
       WorkDisclosure
       ToolInvocation
       ArtifactCard
       SessionNotice
```

`buildChatDisplayBlocks` 必须是确定性的纯函数。建议按 `threadId` 分组；没有 `threadId` 时以相邻 user/assistant 消息边界切轮。它只决定表现，不产生本地持久身份，不吞掉原始事件。

### 格式呈现矩阵

| 内容               | 默认态                       | 展开/交互态                        | 流式态                                              |
| ------------------ | ---------------------------- | ---------------------------------- | --------------------------------------------------- |
| user text          | 右侧紧凑气泡，纯文本换行     | 可选择/复制                        | 发送期间保持原文，不做乐观重复插入                  |
| assistant Markdown | 左侧无底色文档排版           | code copy、受控 link、表格横向容器 | 同组件渐进渲染，末尾轻量 cursor                     |
| reasoning          | 单行“已思考”或“工作思路”     | 可读文本，默认收起                 | 展开“正在思考”，回答开始后收起                      |
| tool invocation    | 单行 icon + 动词 + 状态      | 参数/输出分区；长内容限高          | Pending/Running 原位更新，不追加新卡                |
| artifact           | 文件名、类型、大小的一等卡   | 预览/打开/保存能力可后续接入       | skeleton 或生成中状态（合同支持后）                 |
| usage/status       | 聚合进 work header 或隐藏    | 工作记录中查看原始明细             | 单一状态提示，不逐事件播报                          |
| error              | 贴近失败对象；一句可行动摘要 | 技术详情折叠；重试放在可重试边界   | `role=status` 或必要时 `alert`，不抖动整个 timeline |

## 实施顺序

### P0：先建立视觉层级（不要求修改 Provider）

1. 拆出 `UserMessage`、`AssistantMessageContent`、`ReasoningDisclosure`、`ToolEvent`、`ArtifactCard`、`SessionNotice`。
2. assistant 历史与 streaming 共用 Markdown renderer；增加 paragraph/list/link/inline code/fenced code/table 的组件映射和窄屏规则。
3. reasoning 改为自然语言 disclosure，历史默认收起；status/usage 保持工作记录可查。
4. 实现 sticky-bottom 判断和“回到最新”按钮，停止逐 token 强制平滑滚动。

### P1：恢复工具调用语义

1. 给 `tool-call` view model 增加 `toolUseId?`，两个 Provider adapter 在可用时映射。
2. 新增 `buildChatDisplayBlocks` / `pairToolInvocations` 纯函数，以 ID 配对调用与结果。
3. 将 invocation 原位从 running 更新到 completed/error；参数与结果按类型渲染。
4. 连续工具调用和 reasoning 收进同一轮 `WorkDisclosure`，默认显示例如“完成 3 个步骤”。

### P2：精致化与能力增强

1. 为已完成的 user/assistant Message 提供跟随消息对齐方向的操作栏；桌面端在
   hover/focus-within 时渐显，不支持 hover 的设备保持可见。复制原始文本或 Markdown，
   不拼入时间、Thread ID 等展示元数据；流式回复完成前不提供整条复制。
2. fenced code block 使用独立的右上角复制动作，只复制代码正文；thinking、tool input 与
   tool output 的复制动作放在展开内容内部。status、usage、artifact 与独立 error 不提供
   含义不清的通用复制动作。
3. 复制动作由 Design System `CopyAction` 统一处理 Clipboard API、Tooltip、键盘焦点、
   `Copy → Check` 成功反馈和失败状态；Feature 只决定复制内容与对齐位置。成功不弹全局
   Toast，避免连续复制时打断阅读。
4. code block 语法高亮延后到 stream 完成。
5. artifact 根据 content type 使用文件类型图标，只有在 Host 提供正式操作后才增加打开/下载按钮。
6. 如果 Provider 合同未来提供 duration、approval state、structured output，再扩展稳定 view model；不要从第二个 Provider 尚未拥有的行为提前抽象通用 capability。

## 验收与测试建议

### 组件测试

- Markdown：标题、嵌套列表、引用、inline code、闭合/未闭合 fenced code、超长 URL、表格、恶意 HTML、`javascript:` URL。
- Tool：pending/running/completed/error、空 input、空 output、JSON、纯文本、多行 shell 输出、相同工具并发调用的 ID 配对。
- Reasoning：streaming 自动展开、done 自动收起、用户手动展开后不被无关更新抢状态。
- Error：tool error 附着于 invocation；session error 独立；发送错误保留草稿和 focus。

### 行为测试

- 用户贴底时新 token 跟随；用户上滚后不被拉回；点击“回到最新”恢复跟随。
- streaming 完成并由历史远程事件校准时，不重复 answer/tool，不改变滚动锚点。
- 筛选工作记录仍能检索 raw type、tool input/result、reasoning 和 error；默认对话不展示 raw type。
- keyboard-only 可依次操作 reasoning/tool disclosure、code copy、链接、回到底部和 composer。
- Message 复制保留原始 Markdown 与换行；代码块、thinking、tool input/output 只复制各自内容，
  不包含按钮文案、时间或 Thread ID。
- 复制成功后按钮可访问名称短暂变为“已复制”，失败时就地表达“复制失败”；触屏环境不依赖
  hover 才能发现复制动作。
- `prefers-reduced-motion` 下无 cursor pulse、entry animation 和 smooth scroll。

### 视口与视觉

- 320px 宽不出现页面级横向滚动；只有 code/table/output 内部允许横向滚动。
- 约 640×600 窗口中 topbar、timeline、composer 同时可用。
- 长 answer 仍保持约 60–75 个拉丁字符的舒适行长；中文阅读列不超过当前 656px 契约。
- 失败态以状态和文字表达，不只依赖红/绿色。

## 不建议做的事

- 不把所有 Provider raw payload 送进 Renderer 做“万能 JSON 卡片”。
- 不把 reasoning 当作可信、完整的思维链，也不默认永久展开。
- 不用数组相邻位置作为 tool 配对的长期合同；它只能是旧数据的降级路径。
- 不为了 Markdown 开启不受控 HTML，也不在 Electron Renderer 用 `dangerouslySetInnerHTML`。
- 不让每个 status、usage、delta 都成为可见 timeline 行或 live-region announcement。
- 不在此次 UI 工作中引入本地 Chat/Message/Turn/Operation 持久化，或改变 Bot/Chat 远程身份规则。
