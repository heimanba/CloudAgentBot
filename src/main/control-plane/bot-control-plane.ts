/**
 * BotControlPlane：Managed Bot 的创建、更新与同步编排。
 *
 * 流程（create）：
 *   scope lock → 构建 agents.yaml → createScope（phase=new，先写 project 再写 manifest）
 *   → transitionPhase(new→applying)（任何 Provider mutation 之前持久化）
 *   → resolveProjectConfigFromObject + syncProjectResourcesWithStateBackend（直接 SDK，无 CLI）
 *   → 成功且 state 已记录远程 agentId → transitionPhase(applying→managed) + writePairBackup
 *
 * 流程（update，Stage 08）：
 *   scope lock → assertWritable（state 缺失 fail-closed，任何 Provider mutation 前失败）
 *   → 原子写完整新版 agents.yaml → 同一 Sync 路径 → 成功则 writePairBackup。
 *   Provider 失败时本地新版配置保留（期望配置权威），用户可再次 Sync。
 *   重试作用于 state 指向的同一远程 Agent（state 提供 remote_id），不创建新 Agent。
 *   phase 不变（managed 保持 managed）；Provider 身份 = projectName + 资源逻辑名，
 *   重命名（逻辑名变化）由 SDK reconcile 处理，不属本阶段输入。
 *
 * 流程（sync，手动恢复/重新同步）：
 *   scope lock → assertWritable（state 缺失 fail-closed，任何 Provider mutation 前失败）
 *   → 读回 agents.yaml（Sync 不修改 Project Document）→ 同一 Sync 路径
 *   → 成功则 writePairBackup。
 *
 * 边界：
 * - 凭据只在单次 SDK 调用闭包内以 providers override 注入；agents.yaml 不含凭据。
 * - agents.state.json 只由 LocalFileStateBackend 写入；本 Module 仅在 Sync 后
 *   经 stateBackend.read 公共只读入口取远程 agentId，不修改 state 内容。
 * - remote-only 接管、plan 预览、启动/页面/网络恢复时的自动 Sync 均不实现。
 * - 创建失败时本地资料保留（phase 停在 new/applying），不删除 scope；
 *   是否重复创建了远程 Agent 由完整性矩阵在后续进入时判断，不自动清理。
 */

import { randomBytes } from "node:crypto";
import {
  archiveCloudAgent,
  createProjectRuntime,
  listSkills,
  listProviderModelsForContext,
  readProjectRuntime,
  resolveProjectConfigFromObject,
  syncProjectResourcesWithStateBackend,
  StateManager,
} from "@openagentpack/sdk";
import type {
  BotConfigurationView,
  BotModelOption,
  BotMcpBinding,
  BotRef,
  BotSkillOption,
  BotSkillRef,
  BotView,
  ConnectionId,
  CreateBotInput,
  UpdateBotInput,
} from "@shared/models";
import { hostError } from "@shared/errors";
import { availableBuiltinTools } from "@shared/builtin-tools";
import type { ManagedBotManifest, ManagedBotStore } from "./managed-bot-store";
import {
  buildProjectDocument,
  mergeEditableAgentDocument,
  mergeAgentKeyScope,
  mergeAgentShared,
  parseProjectYaml,
  readAgentShared,
  readEditableAgentDocument,
} from "./project-document";
import { createManagedStateBackend } from "./state-backend";
import type { ScopeLock } from "./scope-lock";
import type { ResolvedConnection } from "../connections/connection-verifier";
import { toControlPlaneError } from "./control-plane-errors";
import { API_KEY_SCOPE_METADATA_KEY, apiKeyScopeId } from "../api-key-scope";

export interface BotControlPlaneOptions {
  store: ManagedBotStore;
  /** 同一 scope 的控制面写操作单写锁。 */
  lock: ScopeLock;
  resolveCredential: (connectionId: ConnectionId) => Promise<ResolvedConnection>;
  /** 返回 Connection 当前绑定的默认运行环境 ID；未设置时返回 null。 */
  resolveDefaultEnvironmentId: (connectionId: ConnectionId) => Promise<string | null>;
}

/** state 中 agent 资源的 address.type 标记（SDK 公共 ResourceState 形状）。 */
const AGENT_RESOURCE_TYPE = "agent";

/**
 * 百炼没有 Managed Agents 动态模型枚举合同（models-runtime 返回
 * supportsDynamicListing=false）。候选 = 当前模型 + 真机验证列表。
 * 2026-09-20 探针：以下 14 个模型经 agentstudio apply 创建成功并原样落库
 * （qwen 系 / deepseek / glm 旗舰与 flash 变体，及 auto/performance/balanced/
 * economy 路由档）；`qwen3-max` 返回 AGENT_010 模型不存在，不得加入。
 */
const BAILIAN_VERIFIED_MODELS = [
  "qwen3.8-max",
  "qwen3.8-flash",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
  "qwen3.6-flash",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "glm-5.2",
  "glm-5.1",
  "auto",
  "performance",
  "balanced",
  "economy",
] as const;

export class BotControlPlane {
  readonly #store: ManagedBotStore;
  readonly #lock: ScopeLock;
  readonly #resolveCredential: BotControlPlaneOptions["resolveCredential"];
  readonly #resolveDefaultEnvironmentId: BotControlPlaneOptions["resolveDefaultEnvironmentId"];

  constructor(options: BotControlPlaneOptions) {
    this.#store = options.store;
    this.#lock = options.lock;
    this.#resolveCredential = options.resolveCredential;
    this.#resolveDefaultEnvironmentId = options.resolveDefaultEnvironmentId;
  }

  /**
   * 创建 Managed Bot：写本地 IaC 文件后直接 Sync 创建远程 Agent。
   * 成功返回 managed BotView（含远程 agentId）；失败抛稳定 HostError，本地资料保留。
   */
  async create(connectionId: ConnectionId, input: CreateBotInput): Promise<BotView> {
    const connection = await this.#resolveCredential(connectionId);
    if (connection.provider !== "qoder" && connection.provider !== "bailian") {
      throw hostError("invalid-input", `unsupported provider: ${connection.provider}`);
    }
    // Managed Bot 创建要求 Connection 已完成共享 Environment 设置（interfaces.md 前置条件）。
    const defaultEnvironmentId = await this.#resolveDefaultEnvironmentId(connectionId);
    if (defaultEnvironmentId === null) {
      throw hostError("conflict", "connection environment is not configured");
    }
    // 百炼无动态模型枚举合同：创建输入 fail-closed 限制在真机验证列表内
    // （Sync 严格性只能事后拒绝，创建前置校验避免留下 phase=applying 残骸）。
    if (
      connection.provider === "bailian" &&
      input.model !== undefined &&
      !(BAILIAN_VERIFIED_MODELS as readonly string[]).includes(input.model)
    ) {
      throw hostError("invalid-input", `unsupported bailian model: ${input.model}`);
    }
    assertProviderSkillRefs(connection.provider, input.skills ?? []);
    assertProviderMcpBindings(connection.provider, input.mcpServers ?? []);
    assertProviderBuiltinTools(connection.provider, input.builtinTools);
    // projectName 是 IaC 管理身份：稳定、不随 Bot 显示名修改，且在同 Connection
    // 下唯一（Qoder managed identity = agents.project + agents.resource 精确匹配）。
    const projectName = `openagentbot-${randomBytes(6).toString("hex")}`;
    const projectYaml = buildProjectDocument({
      ...input,
      metadata: {
        ...(input.metadata ?? {}),
        [API_KEY_SCOPE_METADATA_KEY]: apiKeyScopeId(connection.provider, connection.credential),
      },
      projectName,
      provider: connection.provider,
      environmentId: defaultEnvironmentId,
    });

    const created = await this.#store.createScope({
      connectionId,
      provider: connection.provider,
      projectName,
      projectYaml,
    });
    const dir = this.#store.scopeDir(connectionId, created.scope);

    return this.#lock.runExclusive(created.scope, async () => {
      // 首次 Provider mutation 前必须持久化 phase=applying（完整性矩阵首次创建门禁）。
      const applying = await this.#store.transitionPhase(dir, created, "applying");
      const agentId = await this.#syncScope(dir, applying);
      await this.#store.transitionPhase(dir, applying, "managed");
      await this.#store.writePairBackup(dir);
      return {
        ref: { connectionId, agentId },
        name: input.name,
        description: input.description,
        management: "managed",
        keyScope: "current",
        collaboration: { memberAgentIds: input.memberAgentIds ?? [] },
      };
    });
  }

  /** 列出当前 Connection 可挂载的自定义与官方 Skill；目录差异和分页由 SDK 吸收。 */
  async listSkills(connectionId: ConnectionId): Promise<BotSkillOption[]> {
    const connection = await this.#resolveCredential(connectionId);
    if (connection.provider !== "qoder" && connection.provider !== "bailian") {
      throw hostError("invalid-input", `unsupported provider: ${connection.provider}`);
    }
    try {
      const providerConfig: Record<string, unknown> = { api_key: connection.credential };
      if (connection.workspaceId !== undefined)
        providerConfig.workspace_id = connection.workspaceId;
      const loaded = await resolveProjectConfigFromObject(
        {
          version: "1",
          providers: { [connection.provider]: {} },
          defaults: { provider: connection.provider },
        },
        { basePath: ".", projectName: "openagentbot-skill-catalog" },
      );
      const runtime = createProjectRuntime({
        projectName: loaded.projectName,
        config: loaded.config,
        state: StateManager.initialize(":memory:"),
        providers: { [connection.provider]: providerConfig },
      });
      const custom = await listSkills(runtime, {
        provider: connection.provider,
        source: "custom",
      });
      // Bailian official Skill 属于技能广场；Qoder 保留既有已安装目录合同。
      const official =
        connection.provider === "qoder"
          ? await listSkills(runtime, { provider: connection.provider, source: "official" })
          : [];
      const seen = new Set<string>();
      return [...custom, ...official].flatMap((skill) => {
        if (skill.status !== "active") return [];
        if (connection.provider === "bailian" && !skill.latest_version) return [];
        const key = `${skill.source}:${skill.id}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [
          {
            type: skill.source,
            skillId: skill.id,
            ...(connection.provider === "bailian" && skill.latest_version
              ? { version: skill.latest_version }
              : {}),
            name: skill.name || skill.id,
            ...(skill.description ? { description: skill.description } : {}),
            ...(skill.latest_version ? { latestVersion: skill.latest_version } : {}),
            ...(skill.updated_at ? { updatedAt: skill.updated_at } : {}),
            ...(connection.provider === "qoder" && readMarketplaceSkillId(skill.attributes)
              ? { marketplaceSkillId: readMarketplaceSkillId(skill.attributes) }
              : {}),
          },
        ];
      });
    } catch (error) {
      throw toControlPlaneError(error, "list skills");
    }
  }

  /**
   * 手动 Sync：对管理该远程 Agent 的 scope 当前 agents.yaml 直接 apply。
   * 除 phase=new 首次创建外，state 缺失/损坏在任何 Provider mutation 前 fail-closed。
   *
   * 定位顺序：当前 state 反查 → 当前 state 不可用时配对 backup 只读反查。
   * backup 只用于把旧 BotRef 定位到 scope；进入锁后 assertWritable 仍按当前
   * 完整性 fail-closed（managed-state-missing），backup 绝不进入 SDK 输入。
   * 两处都找不到时返回 not-found（remote-only / 非本机管理）。
   * Sync 不修改 Project Document。
   */
  async sync(ref: BotRef): Promise<BotView> {
    const snapshot =
      (await this.#store.findScopeByAgentId(ref.connectionId, ref.agentId)) ??
      (await this.#store.findScopeByBackupAgentId(ref.connectionId, ref.agentId));
    if (snapshot === null || snapshot.manifest === null) {
      throw hostError("not-found", `no managed scope for agent: ${ref.agentId}`);
    }
    const scope = snapshot.scope;
    return this.#lock.runExclusive(scope, async () => {
      // 锁内重新 fail-closed（findScopeByAgentId 后 state 可能已变化）。
      const current = await this.#store.assertWritable(ref.connectionId, scope);
      const manifest = current.manifest;
      if (manifest === null) {
        throw hostError("managed-state-missing", `managed scope ${scope} has no usable manifest`);
      }
      const dir = this.#store.scopeDir(ref.connectionId, scope);
      const agentId = await this.#syncScope(dir, manifest);
      await this.#store.writePairBackup(dir);
      return {
        ref: { connectionId: ref.connectionId, agentId },
        name: manifest.projectName,
        management: "managed",
        keyScope: "current",
      };
    });
  }

  /** 设置 Managed Bot 的共享标记，原子保存期望配置后复用既有 Sync。 */
  async setShared(ref: BotRef, shared: boolean): Promise<BotView> {
    const snapshot =
      (await this.#store.findScopeByAgentId(ref.connectionId, ref.agentId)) ??
      (await this.#store.findScopeByBackupAgentId(ref.connectionId, ref.agentId));
    if (snapshot === null || snapshot.manifest === null) {
      throw hostError("not-found", `no managed scope for agent: ${ref.agentId}`);
    }
    const scope = snapshot.scope;
    return this.#lock.runExclusive(scope, async () => {
      const current = await this.#store.assertWritable(ref.connectionId, scope);
      const manifest = current.manifest;
      if (manifest === null) {
        throw hostError("managed-state-missing", `managed scope ${scope} has no usable manifest`);
      }
      const dir = this.#store.scopeDir(ref.connectionId, scope);
      const existingYaml = await this.#store.readProject(dir);
      if (existingYaml === null) {
        throw hostError("managed-state-missing", `managed scope ${scope} is missing agents.yaml`);
      }
      if (manifest.provider !== "bailian" && manifest.provider !== "qoder") {
        throw hostError("invalid-input", `sharing metadata is not supported for provider: ${manifest.provider}`);
      }
      const projectYaml = mergeAgentShared(existingYaml, shared, manifest.provider, scope);
      await this.#store.writeProject(dir, projectYaml);
      const agentId = await this.#syncScope(dir, manifest);
      await this.#store.writePairBackup(dir);
      const configuration = readEditableAgentDocument(projectYaml, scope).configuration;
      return {
        ref: { connectionId: ref.connectionId, agentId },
        name: configuration.name,
        description: configuration.description,
        model: configuration.model,
        management: "managed",
        shared: readAgentShared(projectYaml, scope),
        keyScope: "current",
        collaboration: { memberAgentIds: configuration.memberAgentIds },
      };
    });
  }

  /**
   * 读取 Managed Bot 的期望配置（agents.yaml 四字段）与同步状态。
   * - 只对管理完整性通过的 Managed Bot 返回：Remote-only 报 not-found，
   *   state 缺失/损坏报 managed-state-missing（同 update/sync 的 fail-closed）。
   * - 配置读取与 pending 派生进入同一 scope 锁（避免与进行中的 update 观察到
   *   Project 写入与 backup 更新之间的不一致组合）；模型网络枚举在锁外执行。
   * - 模型候选：Qoder 动态枚举 enabled 模型，百炼用当前值 + 真机验证列表；
   *   两者都保证当前模型在列表第一项；Qoder 枚举失败降级为仅当前模型。
   */
  async getConfiguration(ref: BotRef): Promise<BotConfigurationView> {
    const snapshot =
      (await this.#store.findScopeByAgentId(ref.connectionId, ref.agentId)) ??
      (await this.#store.findScopeByBackupAgentId(ref.connectionId, ref.agentId));
    if (snapshot === null || snapshot.manifest === null) {
      throw hostError("not-found", `no managed scope for agent: ${ref.agentId}`);
    }
    const scope = snapshot.scope;

    // 锁内：fail-closed + 读配置 + pending 派生（本地操作，不含模型网络请求）。
    const locked = await this.#lock.runExclusive(scope, async () => {
      const current = await this.#store.assertWritable(ref.connectionId, scope);
      const manifest = current.manifest;
      if (manifest === null) {
        throw hostError("managed-state-missing", `managed scope ${scope} has no usable manifest`);
      }
      const dir = this.#store.scopeDir(ref.connectionId, scope);
      const projectYaml = await this.#store.readProject(dir);
      if (projectYaml === null) {
        throw hostError("managed-state-missing", `managed scope ${scope} is missing agents.yaml`);
      }
      const parsed = readEditableAgentDocument(projectYaml, scope);
      const pending = await this.#store.hasPendingProject(dir, projectYaml);
      if (pending === null) {
        // 完整性通过但配对 backup 缺失：无法派生同步状态，按完整性规则拒绝，不猜测。
        throw hostError(
          "managed-state-missing",
          `managed scope ${scope} is missing its paired backup; cannot derive sync status`,
        );
      }
      return { configuration: parsed.configuration, hasPendingChanges: pending, manifest };
    });

    // 锁外：模型候选（Qoder 枚举是网络请求，不应占锁）。
    const models = await this.#modelOptions(locked.manifest, locked.configuration.model);
    return {
      ref,
      ...locked.configuration,
      provider: locked.manifest.provider,
      models,
      hasPendingChanges: locked.hasPendingChanges,
      supportsMcpConfiguration: locked.manifest.provider === "bailian",
    };
  }

  /**
   * 更新 Managed Bot 的期望配置：完整四字段合并进 agents.yaml，原子写后直接 Sync。
   * - state 缺失/损坏在任何 Provider mutation 前 fail-closed（同 sync）。
   * - 定位顺序同 sync：当前 state → 配对 backup 只读反查；进入锁后 assertWritable
   *   按当前完整性 fail-closed（managed-state-missing），backup 绝不进入 SDK 输入。
   * - 只替换 name/description/instructions/model 与成员 roster；逻辑资源 key、projectName、
   *   Environment 身份与未开放 YAML 字段全部保留（mergeEditableAgentDocument）。
   * - roster 自引用（ref.agentId）在写文件与 Provider mutation 前 invalid-input。
   * - Sync 失败后本地新版期望配置保留、配对 backup 不更新（hasPendingChanges=true）；
   *   再次 update/sync 作用于 state 指向的同一远程 Agent，不会创建新 Agent。
   * - Sync 不修改 Project Document；成功后更新配对备份。phase 不变。
   */
  async update(ref: BotRef, input: UpdateBotInput): Promise<BotView> {
    const snapshot =
      (await this.#store.findScopeByAgentId(ref.connectionId, ref.agentId)) ??
      (await this.#store.findScopeByBackupAgentId(ref.connectionId, ref.agentId));
    if (snapshot === null || snapshot.manifest === null) {
      throw hostError("not-found", `no managed scope for agent: ${ref.agentId}`);
    }
    const scope = snapshot.scope;
    return this.#lock.runExclusive(scope, async () => {
      const current = await this.#store.assertWritable(ref.connectionId, scope);
      const manifest = current.manifest;
      if (manifest === null) {
        throw hostError("managed-state-missing", `managed scope ${scope} has no usable manifest`);
      }
      // 自引用是本地数组校验：在任何文件写入或 Provider mutation 之前拒绝。
      if (input.memberAgentIds.includes(ref.agentId)) {
        throw hostError("invalid-input", "a bot cannot include itself as a collaboration member");
      }
      const dir = this.#store.scopeDir(ref.connectionId, scope);
      const existingYaml = await this.#store.readProject(dir);
      if (existingYaml === null) {
        throw hostError("managed-state-missing", `managed scope ${scope} is missing agents.yaml`);
      }
      assertProviderSkillRefs(
        manifest.provider,
        input.skills ?? readEditableAgentDocument(existingYaml, scope).configuration.skills ?? [],
      );
      assertProviderMcpBindings(
        manifest.provider,
        input.mcpServers ??
          readEditableAgentDocument(existingYaml, scope).configuration.mcpServers ??
          [],
      );
      assertProviderBuiltinTools(manifest.provider, input.builtinTools);
      const merged = mergeEditableAgentDocument(existingYaml, input, scope);
      // 先保存完整本地期望配置（原子写），再让同一远程 Agent 收敛。
      await this.#store.writeProject(dir, merged.yaml);

      const agentId = await this.#syncScope(dir, manifest);
      await this.#store.writePairBackup(dir);
      return {
        ref: { connectionId: ref.connectionId, agentId },
        name: merged.configuration.name,
        description: merged.configuration.description,
        model: merged.configuration.model,
        management: "managed",
        keyScope: "current",
        collaboration: { memberAgentIds: merged.configuration.memberAgentIds },
      };
    });
  }

  /**
   * 归档 Managed Bot：对 Provider 执行远程 Agent 软归档，返回 void。
   *
   * 门禁（任何 Provider mutation 之前 fail-closed）：
   * - 无匹配 scope / Remote-only：not-found（只用当前 state 定位，不经 backup）；
   * - manifest、state 缺失或损坏：managed-state-missing；
   * - Connection 与 manifest 的 Provider 不一致：conflict。
   *
   * 成功与失败都不写任何本地文件：managed scope（Project Document、state、
   * manifest、配对 backup）原样保留。锁内从当前 state 复核 agentId 与 scope，
   * 防止首次定位与真正 mutation 之间的并发或外部文件变化。
   */
  async archive(ref: BotRef): Promise<void> {
    // 定位顺序与 sync/update 一致：当前 state 反查 → 当前 state 不可用时配对 backup
    // 只读反查。backup 只用于定位 scope；进入锁后 assertWritable 按当前完整性
    // fail-closed（state 缺失/损坏 → managed-state-missing），backup 绝不进入 SDK 输入。
    const snapshot =
      (await this.#store.findScopeByAgentId(ref.connectionId, ref.agentId)) ??
      (await this.#store.findScopeByBackupAgentId(ref.connectionId, ref.agentId));
    if (snapshot === null || snapshot.manifest === null) {
      throw hostError("not-found", `no managed scope for agent: ${ref.agentId}`);
    }
    const scope = snapshot.scope;
    await this.#lock.runExclusive(scope, async () => {
      // 锁内复核（fail-closed）：state 在定位后可能已变化。
      const current = await this.#store.assertWritable(ref.connectionId, scope);
      const manifest = current.manifest;
      if (manifest === null) {
        throw hostError("managed-state-missing", `managed scope ${scope} has no usable manifest`);
      }
      // 再次确认当前 state 仍把该 agentId 定位到同一 scope。
      const relocated = await this.#store.findScopeByAgentId(ref.connectionId, ref.agentId);
      if (relocated === null || relocated.scope !== scope) {
        throw hostError(
          "managed-state-missing",
          `managed scope ${scope} no longer manages agent: ${ref.agentId}`,
        );
      }
      const dir = this.#store.scopeDir(ref.connectionId, scope);
      const projectYaml = await this.#store.readProject(dir);
      if (projectYaml === null) {
        throw hostError("managed-state-missing", `managed scope ${scope} is missing agents.yaml`);
      }
      const connection = await this.#resolveCredential(ref.connectionId);
      if (connection.provider !== manifest.provider) {
        throw hostError("conflict", `connection provider changed for scope ${scope}`);
      }
      const rawConfig = parseProjectYaml(projectYaml, scope);
      const loaded = await resolveProjectConfigFromObject(rawConfig, {
        basePath: dir,
        projectName: manifest.projectName,
      });
      try {
        await readProjectRuntime(
          {
            projectName: manifest.projectName,
            config: loaded.config,
            stateBackend: createManagedStateBackend(dir),
            stateScope: { projectId: manifest.projectName },
            // 凭据仅在本次调用注入；不写入 Project Document、state 或日志。
            providers:
              connection.provider === "bailian"
                ? {
                    bailian: {
                      api_key: connection.credential,
                      workspace_id: connection.workspaceId,
                    },
                  }
                : { qoder: { api_key: connection.credential } },
          },
          (runtime) => archiveCloudAgent(runtime, ref.agentId, { provider: connection.provider }),
        );
      } catch (error) {
        throw toControlPlaneError(error, `archive agent ${ref.agentId}`);
      }
    });
  }

  /**
   * 模型候选：当前模型固定第一项，去重。
   * - 百炼：当前值 + 真机验证列表（无动态枚举合同，不伪装动态）。
   * - Qoder：经 OpenAgentPack 公共 listProviderModelsForContext 动态枚举
   *   enabled 模型；枚举失败降级为仅当前模型，不让配置页整体失败。
   */
  async #modelOptions(
    manifest: ManagedBotManifest,
    currentModel: string,
  ): Promise<BotModelOption[]> {
    const seen = new Set<string>([currentModel]);
    const options: BotModelOption[] = [{ value: currentModel, label: currentModel }];
    const push = (value: string, label: string) => {
      if (value.length === 0 || seen.has(value)) return;
      seen.add(value);
      options.push({ value, label });
    };

    if (manifest.provider === "bailian") {
      for (const model of BAILIAN_VERIFIED_MODELS) push(model, model);
      return options;
    }
    if (manifest.provider !== "qoder") {
      return options;
    }

    try {
      const connection = await this.#resolveCredential(manifest.connectionId);
      const dir = this.#store.scopeDir(manifest.connectionId, manifest.scope);
      const projectYaml = await this.#store.readProject(dir);
      if (projectYaml === null) return options;
      const rawConfig = parseProjectYaml(projectYaml, manifest.scope);
      const loaded = await resolveProjectConfigFromObject(rawConfig, {
        basePath: dir,
        projectName: manifest.projectName,
      });
      const listings = await readProjectRuntime(
        {
          projectName: manifest.projectName,
          config: loaded.config,
          stateBackend: createManagedStateBackend(dir),
          stateScope: { projectId: manifest.projectName },
          providers:
            connection.provider === "bailian"
              ? {
                  bailian: { api_key: connection.credential, workspace_id: connection.workspaceId },
                }
              : { qoder: { api_key: connection.credential } },
        },
        (runtime) => listProviderModelsForContext(runtime.providers, "qoder"),
      );
      const listing = listings[0];
      if (listing === undefined || !listing.supportsDynamicListing) return options;
      for (const model of listing.models) {
        if (model.is_enabled) push(model.id, model.display_name);
      }
      return options;
    } catch {
      // 枚举失败降级为仅当前模型：不新增跨层错误类型，不阻止编辑其他字段。
      return options;
    }
  }

  /**
   * 对单个 scope 执行一次 SDK Sync（语义等价 apply -f agents.yaml）。
   * 返回 state 记录的远程 agentId。调用方必须已持有该 scope 的锁。
   * manifest 提供 connectionId/projectName/scope；当前 phase 由调用方负责流转。
   */
  async #syncScope(dir: string, manifest: ManagedBotManifest): Promise<string> {
    const existingYaml = await this.#store.readProject(dir);
    if (existingYaml === null) {
      throw hostError(
        "managed-state-missing",
        `managed scope ${manifest.scope} is missing agents.yaml`,
      );
    }
    const connection = await this.#resolveCredential(manifest.connectionId);
    if (connection.provider !== manifest.provider) {
      throw hostError("conflict", `connection provider changed for scope ${manifest.scope}`);
    }

    const keyScopeId = apiKeyScopeId(connection.provider, connection.credential);
    const projectYaml = mergeAgentKeyScope(existingYaml, keyScopeId, manifest.scope);
    if (projectYaml !== existingYaml) await this.#store.writeProject(dir, projectYaml);

    const rawConfig = parseProjectYaml(projectYaml, manifest.scope);
    const loaded = await resolveProjectConfigFromObject(rawConfig, {
      basePath: dir,
      projectName: manifest.projectName,
    });
    const stateBackend = createManagedStateBackend(dir);
    const stateScope = { projectId: manifest.projectName };

    try {
      const result = await syncProjectResourcesWithStateBackend(
        {
          projectName: manifest.projectName,
          config: loaded.config,
          stateBackend,
          stateScope,
          // 凭据仅在本次调用注入，覆盖 agents.yaml 中的空 provider 占位块。
          providers: {
            [connection.provider]:
              connection.provider === "bailian"
                ? { api_key: connection.credential, workspace_id: connection.workspaceId }
                : { api_key: connection.credential },
          },
        },
        { policy: "force" },
      );
      // SDK 会把 Provider 资源执行错误放进结果，而不一定 reject。
      // 只有所有资源都成功收敛，调用方才能更新配对 backup。
      const failed = result.execution?.results.find((item) => item.status !== "success");
      if (failed !== undefined || result.execution?.partial) {
        throw failed?.error ?? new Error("project sync was partial");
      }
    } catch (error) {
      throw toControlPlaneError(error, `sync scope ${manifest.scope}`);
    }

    // Sync 成功后 state 已由 LocalFileStateBackend 落盘；经公共只读入口取 agentId。
    const agentId = await stateBackend.read(stateScope, (state) => {
      const agent = state.listResources().find((r) => r.address.type === AGENT_RESOURCE_TYPE);
      return agent?.remote_id ?? undefined;
    });
    if (agentId === undefined || agentId === null) {
      // 远程 mutation 已发生但 state 未记录 agent：结果不明。phase 保持 applying，
      // 由完整性矩阵在后续进入时分类（interrupted-resumable/unknown）。
      throw hostError(
        "sync-incomplete",
        `sync of scope ${manifest.scope} finished without recording a remote agent id`,
      );
    }
    return agentId;
  }
}

function readMarketplaceSkillId(
  attributes: Record<string, unknown> | undefined,
): string | undefined {
  const metadata = attributes?.metadata;
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const value = (metadata as Record<string, unknown>).marketplace_skill_id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function assertProviderSkillRefs(provider: string, skills: BotSkillRef[]): void {
  if (provider === "bailian" && skills.some((skill) => !skill.version)) {
    throw hostError("invalid-input", "bailian skill bindings require a concrete version");
  }
}

function assertProviderMcpBindings(provider: string, bindings: BotMcpBinding[]): void {
  if (provider !== "bailian" && bindings.length > 0) {
    throw hostError("invalid-input", "MCP bindings are currently supported only for bailian");
  }
  if (bindings.some((binding) => binding.permissionPolicy !== "always_allow")) {
    throw hostError(
      "invalid-input",
      "the current OpenAgentPack Bailian contract does not support MCP approval policies",
    );
  }
}

function assertProviderBuiltinTools(provider: string, tools: string[] | undefined): void {
  if (tools === undefined) return;
  const available = new Set(availableBuiltinTools(provider));
  if (tools.some((tool) => !available.has(tool))) {
    throw hostError("invalid-input", `unsupported ${provider} builtin tool`);
  }
}
