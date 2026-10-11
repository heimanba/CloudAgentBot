# CloudAgentBot 产品愿景与客户价值

## 客户问题

员工在日常工作中逐渐积累了有效的 AI 使用经验，但这些经验常停留在个人提示词、临时配置或个人账号里，难以沉淀为同事可以直接使用和持续改进的 Bot。企业还需要在组织层面了解 Bot 的配置与运行情况，并把合适的 Bot 提供给相应团队。

## 产品定位

CloudAgentBot 是面向团队的开源 Bot 工作区，帮助员工把有效的 AI 使用经验沉淀为 Bot，方便地创建、使用和共享；企业管理员则通过 Console 对组织中的 Bot 进行管理、观测与分发。

员工工作区与管理员 Console 是共同承载产品体验的不同入口。产品价值不要求所有能力都由 CloudAgentBot 桌面端实现：Bot 的创建、日常使用与分享体验由 CloudAgentBot 推动；组织级管理、运行观测和分发可由 Provider Console 等管理入口承载，并由 CloudAgentBot 与这些能力配合。

## 客户价值

- **能力沉淀**：员工把有效的 AI 使用方式整理成可复用、可维护的 Bot。
- **创建与使用**：员工能方便地创建 Bot，并在工作中持续使用和改进。
- **共享复用**：员工能方便地把自己创建的 Bot 分享给同事；同事打开新任务时优先看到团队共享 Bot，并能直接复用。共享标记让团队共识的 Bot 从 Provider 可见 Agent 中被识别出来。
- **组织管控**：企业管理员在 Console 中管理组织 Bot 及其配置，并按组织需要分发给团队或成员。
- **运行观测**：企业管理员通过 Console 了解 Bot 的运行和使用情况，为后续管理与改进提供依据。

## 愿景

让有效的 AI 使用经验不再停留于个人：员工可以轻松创建、使用并共享 Bot，企业管理员可以在 Console 中管理、观测和分发这些能力，使 Bot 能在团队中持续复用和改进。

## 当前产品边界

V2 当前是远程 Bot 桌面客户端，支持连接 Qoder、百炼等 Provider，创建和使用远程 Bot，并以配置即代码管理本机受管 Bot。当前实现支持在同一 Connection 下选择 Bot 作为协作成员，也提供预置协作模板；这属于协作配置，不等同于员工将自己创建的 Bot 分享给其他员工。员工可以在自己管理的 Bot 对话页开启共享标记；共享发现与 API Key 分组能力正在完善：计划以同 Provider 的同一连接凭据作为 CloudAgentBot 内的发现分组，不建立 CloudAgentBot 账号或 ACL。共享 Bot 的选择器优先入口默认突出团队共享，个人管理 Bot 可单独选择；明确属于其他 Key 分组的资源从普通使用视图隐藏，未分组的历史 Provider 资源保留兼容入口。该分组不改变 Provider 授权，也不能阻止用户通过 Provider 自身 API 访问其有权访问的资源。

组织管理和运行观测可由 Provider Console 提供，不要求全部进入 CloudAgentBot 桌面端。例如，Qoder Cloud Agents Console 已提供企业空间与运行观测能力；这些 Provider 能力不代表 CloudAgentBot 已实现 Bot 的员工间分享，也不代表 CloudAgentBot 已拥有自己的组织权限与管理控制面。具体可用范围取决于 Provider 的 Console、组织权限和资源模型。

## 参考

- [Qoder Cloud Agents：个人与企业空间](https://docs.qoder.com/cloud-agents/personal-and-enterprise-spaces)
- [Qoder Cloud Agents：Console 更新记录与观测总览](https://docs.qoder.com/release-notes/cloud-agents)
