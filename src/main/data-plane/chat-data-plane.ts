/**
 * ChatDataPlane：数据面组装点。
 * 根据 Connection 解析凭据、按 Provider 构造 Adapter/Catalog，
 * 并把 connectionId 绑定到返回的 ref（Adapter 内部不感知 Connection）。
 * Chat/Message 不落任何本地文件；所有数据即时来自 Provider。
 */

import type { BotView, ChatArtifactView, ChatDetailView, ChatView, CollaborationRosterView, ConnectionId, CreateDeploymentInput, DeploymentRunView, DeploymentView, MessageAttachment, SendResult, UpdateDeploymentInput, UploadFileInput, UploadedFileView } from "@shared/models";
import { hostError } from "@shared/errors";
import type { AdapterChatAccess, AdapterChatView, ChatAdapter, ChatEventListener } from "./chat-adapter";
import type {
  AdapterDeploymentView,
  DeploymentAdapter,
} from "./deployment-adapter";
import type { ResolvedConnection } from "../connections/connection-verifier";
import {
  API_KEY_SCOPE_METADATA_KEY,
  DEPLOYMENT_EXPIRES_AT_METADATA_KEY,
  SESSION_SHARED_METADATA_KEY,
  apiKeyScopeId,
  classifyApiKeyScope,
} from "../api-key-scope";

export type { ChatAdapter, ChatEventListener } from "./chat-adapter";

/** 按调用构造 Adapter 的工厂；凭据只存在于本次调用闭包内。 */
export type ChatAdapterFactory = (connection: ResolvedConnection) => ChatAdapter;

/** 远程 Agent 目录只读 seam（Bot 列表）。 */
export interface BotCatalogView {
  agentId: string;
  name: string;
  description?: string;
  model?: string;
  remoteStatus?: string;
  shared?: boolean;
  /** Main-only Provider metadata projection; removed before producing BotView. */
  keyScopeMarker?: string;
  managed: boolean;
  collaboration?: CollaborationRosterView;
}

/** Provider 目录 seam：Bot 只读列表。 */
export interface BotCatalog {
  listBots(): Promise<BotCatalogView[]>;
}

export type BotCatalogFactory = (connection: ResolvedConnection) => BotCatalog;

/** 按调用构造 DeploymentAdapter 的工厂；Provider 无定时任务能力时不注册。 */
export type DeploymentAdapterFactory = (connection: ResolvedConnection) => DeploymentAdapter;

/** Deployment 的归属范围，供 Run Session 继承（Main-only）。 */
interface DeploymentScope {
  keyScopeMarker?: string;
  shared: boolean;
}

export interface ChatDataPlaneOptions {
  chatAdapters: Record<string, ChatAdapterFactory>;
  botCatalogs: Record<string, BotCatalogFactory>;
  deploymentAdapters?: Record<string, DeploymentAdapterFactory>;
  resolveCredential: (connectionId: ConnectionId) => Promise<ResolvedConnection>;
  resolveManagedEnvironmentId?: (
    connectionId: ConnectionId,
    agentId: string,
  ) => Promise<string | null>;
  /** 返回 Connection 当前绑定的默认运行环境 ID；未设置时返回 null。 */
  resolveDefaultEnvironmentId?: (connectionId: ConnectionId) => Promise<string | null>;
}

export class ChatDataPlane {
  readonly #chatAdapters: Record<string, ChatAdapterFactory>;
  readonly #botCatalogs: Record<string, BotCatalogFactory>;
  readonly #deploymentAdapters: Record<string, DeploymentAdapterFactory>;
  readonly #resolveCredential: ChatDataPlaneOptions["resolveCredential"];
  readonly #resolveManagedEnvironmentId: NonNullable<
    ChatDataPlaneOptions["resolveManagedEnvironmentId"]
  >;
  readonly #resolveDefaultEnvironmentId: NonNullable<
    ChatDataPlaneOptions["resolveDefaultEnvironmentId"]
  >;

  constructor(options: ChatDataPlaneOptions) {
    this.#chatAdapters = options.chatAdapters;
    this.#botCatalogs = options.botCatalogs;
    this.#deploymentAdapters = options.deploymentAdapters ?? {};
    this.#resolveCredential = options.resolveCredential;
    this.#resolveManagedEnvironmentId =
      options.resolveManagedEnvironmentId ?? (() => Promise.resolve(null));
    this.#resolveDefaultEnvironmentId =
      options.resolveDefaultEnvironmentId ?? (() => Promise.resolve(null));
  }

  async listBots(connectionId: ConnectionId): Promise<BotView[]> {
    const connection = await this.#resolveCredential(connectionId);
    const { provider } = connection;
    const factory = this.#botCatalogs[provider];
    if (factory === undefined) {
      throw hostError("invalid-input", `unsupported provider: ${provider}`);
    }
    const bots = await factory(connection).listBots();
    const currentScopeId = apiKeyScopeId(connection.provider, connection.credential);
    return bots.map((b) => {
      const keyScope = classifyApiKeyScope(b.keyScopeMarker, currentScopeId);
      return {
        ref: { connectionId, agentId: b.agentId },
        name: b.name,
        description: b.description,
        model: b.model,
        remoteStatus: b.remoteStatus,
        ...(b.shared === true ? { shared: true } : {}),
        keyScope,
        management: b.managed ? "managed" : "remote-only",
        ...(b.collaboration ? { collaboration: b.collaboration } : {}),
      };
    });
  }

  async listChats(connectionId: ConnectionId, agentId: string): Promise<ChatView[]> {
    const { adapter, currentScopeId, connection } = await this.#chatContext(connectionId);
    const chats = await adapter.listChats(agentId);
    // 同一 Deployment 的多个 Run Session 共享一次归属解析。
    const deploymentScopes = new Map<string, Promise<DeploymentScope | null>>();
    const readable: ChatView[] = [];
    for (const c of chats) {
      const inherited = await this.#inheritDeploymentScope(connection, c, deploymentScopes);
      const scoped = this.#publicChat(inherited, currentScopeId);
      if (!this.#canRead(scoped.keyScope ?? "ungrouped", scoped.shared === true)) continue;
      readable.push({ ...scoped, ref: { connectionId, agentId, sessionId: c.ref.sessionId } });
    }
    return readable;
  }

  async getChat(connectionId: ConnectionId, sessionId: string): Promise<ChatDetailView> {
    const { adapter, currentScopeId, connection } = await this.#chatContext(connectionId);
    await this.#assertReadableSession(adapter, sessionId, currentScopeId, connection);
    const detail = await adapter.getChat(sessionId);
    const inherited = await this.#inheritDeploymentScope(
      connection,
      detail.chat,
      new Map(),
    );
    const chat = this.#publicChat(inherited, currentScopeId);
    this.#assertReadable(chat.keyScope ?? "ungrouped", chat.shared === true);
    return {
      ...detail,
      chat: {
        ...chat,
        ref: { connectionId, agentId: detail.chat.ref.agentId, sessionId },
      },
    };
  }

  /**
   * 创建远程 Session。环境解析顺序：managed OAP state 中的 Environment remote ID
   * → Connection 绑定的默认共享环境。两者都缺失时抛 conflict（不携带候选列表）。
   */
  async createChat(connectionId: ConnectionId, agentId: string): Promise<ChatView> {
    const connection = await this.#resolveCredential(connectionId);
    const currentScopeId = apiKeyScopeId(connection.provider, connection.credential);
    const catalogFactory = this.#botCatalogs[connection.provider];
    if (catalogFactory === undefined) throw hostError("invalid-input", `unsupported provider: ${connection.provider}`);
    const catalog = catalogFactory(connection);
    const bots = await catalog.listBots();
    const bot = bots.find((b) => b.agentId === agentId);
    if (bot === undefined) {
      throw hostError("not-found", `bot not found: ${agentId}`);
    }
    if (classifyApiKeyScope(bot.keyScopeMarker, currentScopeId) === "other" && bot.shared !== true) {
      throw hostError("not-found", `bot not found: ${agentId}`);
    }
    const managedEnvironmentId = await this.#resolveManagedEnvironmentId(connectionId, agentId);
    const resolvedEnvId =
      managedEnvironmentId ?? (await this.#resolveDefaultEnvironmentId(connectionId));
    if (resolvedEnvId === null) {
      throw hostError("conflict", "connection environment is not configured");
    }
    const chatFactory = this.#chatAdapters[connection.provider];
    if (chatFactory === undefined) throw hostError("invalid-input", `unsupported provider: ${connection.provider}`);
    const adapter = chatFactory(connection);
    const chat = await adapter.createChat(agentId, resolvedEnvId, undefined, {
      [API_KEY_SCOPE_METADATA_KEY]: currentScopeId,
    });
    const scopedChat = this.#publicChat(chat, currentScopeId);
    this.#assertCurrentScope(scopedChat.keyScope ?? "ungrouped");
    return {
      ...scopedChat,
      ref: { connectionId, agentId, sessionId: chat.ref.sessionId },
    };
  }

  async uploadFile(connectionId: ConnectionId, input: UploadFileInput): Promise<UploadedFileView> {
    const { adapter } = await this.#chatContext(connectionId);
    if (adapter.uploadFile === undefined) {
      throw hostError("invalid-input", "provider does not support file upload");
    }
    return adapter.uploadFile(input);
  }

  async sendMessage(
    connectionId: ConnectionId,
    sessionId: string,
    text: string,
    attachments?: MessageAttachment[],
  ): Promise<SendResult> {
    const { adapter, currentScopeId, connection } = await this.#chatContext(connectionId);
    await this.#assertReadableSession(adapter, sessionId, currentScopeId, connection);
    return adapter.sendMessage(sessionId, text, attachments);
  }

  /**
   * 订阅 SSE。listener 收到的事件已绑定 connectionId 与 sessionId 无关的 view 字段；
   * 本层把 adapter 中立事件原样转发（事件不含 ref，路由由调用方持有）。
   */
  async subscribe(
    connectionId: ConnectionId,
    sessionId: string,
    listener: ChatEventListener,
  ): Promise<() => void> {
    const { adapter, currentScopeId, connection } = await this.#chatContext(connectionId);
    await this.#assertReadableSession(adapter, sessionId, currentScopeId, connection);
    return adapter.subscribe(sessionId, listener);
  }

  async setChatShared(
    connectionId: ConnectionId,
    sessionId: string,
    shared: boolean,
  ): Promise<ChatView> {
    const { adapter, currentScopeId, connection } = await this.#chatContext(connectionId);
    if (adapter.setChatShared === undefined) {
      throw hostError("invalid-input", "provider does not support chat sharing");
    }
    await this.#assertOwnedSession(adapter, sessionId, currentScopeId, connection);
    const chat = this.#publicChat(
      await adapter.setChatShared(sessionId, shared, currentScopeId),
      currentScopeId,
    );
    this.#assertCurrentScope(chat.keyScope ?? "ungrouped");
    return {
      ...chat,
      ref: { connectionId, agentId: chat.ref.agentId, sessionId },
    };
  }

  async archiveChat(connectionId: ConnectionId, sessionId: string): Promise<void> {
    const { adapter, currentScopeId, connection } = await this.#chatContext(connectionId);
    await this.#assertOwnedSession(adapter, sessionId, currentScopeId, connection);
    await adapter.archiveChat(sessionId);
  }

  async deleteChat(connectionId: ConnectionId, sessionId: string): Promise<void> {
    const { adapter, currentScopeId, connection } = await this.#chatContext(connectionId);
    await this.#assertOwnedSession(adapter, sessionId, currentScopeId, connection);
    await adapter.deleteChat(sessionId);
  }

  async getArtifact(
    connectionId: ConnectionId,
    sessionId: string,
    fileId: string,
    options?: { includeContent?: boolean },
  ): Promise<ChatArtifactView> {
    const { adapter, currentScopeId, connection } = await this.#chatContext(connectionId);
    await this.#assertReadableSession(adapter, sessionId, currentScopeId, connection);
    if (adapter.getArtifact === undefined) {
      throw hostError("invalid-input", "provider does not support artifacts");
    }
    const artifact = await adapter.getArtifact(sessionId, fileId, options);
    return { ...artifact, ref: { connectionId, agentId: artifact.ref.agentId, sessionId } };
  }

  /**
   * Deployment（定时任务）。可见性与 Bot 一致：current 与未分组可见，
   * 其他 Key 范围仅共享可见；写操作（update/pause/unpause/archive/setShared）
   * 仅限 current 与未分组；手动触发对可见者开放（与共享 Bot 可跨 Key 建 Session 一致）。
   */
  async listDeployments(connectionId: ConnectionId, agentId?: string): Promise<DeploymentView[]> {
    const { adapter, currentScopeId } = await this.#deploymentContext(connectionId);
    const deployments = await adapter.listDeployments(agentId);
    return deployments.flatMap((d) => {
      const view = this.#publicDeployment(d, currentScopeId, connectionId);
      if (!this.#canViewDeployment(view.keyScope ?? "ungrouped", view.shared === true)) return [];
      return [view];
    });
  }

  async getDeployment(
    connectionId: ConnectionId,
    agentId: string,
    deploymentId: string,
  ): Promise<DeploymentView> {
    const { adapter, currentScopeId } = await this.#deploymentContext(connectionId);
    const view = this.#publicDeployment(
      await adapter.getDeployment(deploymentId),
      currentScopeId,
      connectionId,
    );
    if (!this.#canViewDeployment(view.keyScope ?? "ungrouped", view.shared === true)) {
      throw hostError("not-found", "deployment not found");
    }
    return view;
  }

  /**
   * 创建 Deployment。Bot 可见性与环境解析顺序与 createChat 一致：
   * managed OAP state 中的 Environment → Connection 默认环境，两者缺失抛 conflict。
   * metadata 携带归属标记（与到期日期、可选共享标记）。
   */
  async createDeployment(
    connectionId: ConnectionId,
    input: CreateDeploymentInput,
  ): Promise<DeploymentView> {
    const connection = await this.#resolveCredential(connectionId);
    const currentScopeId = apiKeyScopeId(connection.provider, connection.credential);
    const catalogFactory = this.#botCatalogs[connection.provider];
    if (catalogFactory === undefined) {
      throw hostError("invalid-input", `unsupported provider: ${connection.provider}`);
    }
    const bots = await catalogFactory(connection).listBots();
    const bot = bots.find((b) => b.agentId === input.agentId);
    if (bot === undefined) {
      throw hostError("not-found", `bot not found: ${input.agentId}`);
    }
    if (classifyApiKeyScope(bot.keyScopeMarker, currentScopeId) === "other" && bot.shared !== true) {
      throw hostError("not-found", `bot not found: ${input.agentId}`);
    }
    const managedEnvironmentId = await this.#resolveManagedEnvironmentId(
      connectionId,
      input.agentId,
    );
    const resolvedEnvId =
      managedEnvironmentId ?? (await this.#resolveDefaultEnvironmentId(connectionId));
    if (resolvedEnvId === null) {
      throw hostError("conflict", "connection environment is not configured");
    }
    const adapter = this.#deploymentAdapters[connection.provider]?.(connection);
    if (adapter === undefined) {
      throw hostError("unavailable", `provider does not support deployments: ${connection.provider}`);
    }
    const metadata: Record<string, string> = { [API_KEY_SCOPE_METADATA_KEY]: currentScopeId };
    if (input.expiresAt !== undefined) {
      metadata[DEPLOYMENT_EXPIRES_AT_METADATA_KEY] = input.expiresAt;
    }
    if (input.shared === true) metadata[SESSION_SHARED_METADATA_KEY] = "true";
    const created = await adapter.createDeployment({
      agentId: input.agentId,
      environmentId: resolvedEnvId,
      name: input.name,
      prompt: input.prompt,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
      metadata,
    });
    const view = this.#publicDeployment(created, currentScopeId, connectionId);
    this.#assertCurrentScope(view.keyScope ?? "ungrouped");
    return view;
  }

  /**
   * 更新 Deployment。到期日期经 metadata 保存，百炼 metadata 更新是整体替换，
   * 因此携带到期变更时先读出旧 metadata 合并后再提交（read-merge-write）。
   */
  async updateDeployment(
    connectionId: ConnectionId,
    agentId: string,
    deploymentId: string,
    input: UpdateDeploymentInput,
  ): Promise<DeploymentView> {
    const { adapter, currentScopeId } = await this.#deploymentContext(connectionId);
    const current = await adapter.getDeployment(deploymentId);
    this.#assertDeploymentWritable(current, currentScopeId);
    const update: Parameters<DeploymentAdapter["updateDeployment"]>[1] = {};
    if (input.name !== undefined) update.name = input.name;
    if (input.prompt !== undefined) update.prompt = input.prompt;
    if (input.description !== undefined) update.description = input.description;
    if (input.schedule !== undefined) update.schedule = input.schedule;
    if (input.expiresAt !== undefined) {
      const metadata = { ...current.metadata };
      if (input.expiresAt === null) {
        delete metadata[DEPLOYMENT_EXPIRES_AT_METADATA_KEY];
      } else {
        metadata[DEPLOYMENT_EXPIRES_AT_METADATA_KEY] = input.expiresAt;
      }
      update.metadata = metadata;
    }
    const updated = await adapter.updateDeployment(deploymentId, update);
    return this.#publicDeployment(updated, currentScopeId, connectionId);
  }

  async setDeploymentShared(
    connectionId: ConnectionId,
    agentId: string,
    deploymentId: string,
    shared: boolean,
  ): Promise<DeploymentView> {
    const { adapter, currentScopeId } = await this.#deploymentContext(connectionId);
    const current = await adapter.getDeployment(deploymentId);
    this.#assertDeploymentWritable(current, currentScopeId);
    const metadata = { ...current.metadata };
    if (shared) {
      metadata[SESSION_SHARED_METADATA_KEY] = "true";
    } else {
      delete metadata[SESSION_SHARED_METADATA_KEY];
    }
    const updated = await adapter.updateDeployment(deploymentId, { metadata });
    return this.#publicDeployment(updated, currentScopeId, connectionId);
  }

  async pauseDeployment(
    connectionId: ConnectionId,
    agentId: string,
    deploymentId: string,
  ): Promise<DeploymentView> {
    const { adapter, currentScopeId } = await this.#deploymentContext(connectionId);
    const current = await adapter.getDeployment(deploymentId);
    this.#assertDeploymentWritable(current, currentScopeId);
    const updated = await adapter.pauseDeployment(deploymentId);
    return this.#publicDeployment(updated, currentScopeId, connectionId);
  }

  async unpauseDeployment(
    connectionId: ConnectionId,
    agentId: string,
    deploymentId: string,
  ): Promise<DeploymentView> {
    const { adapter, currentScopeId } = await this.#deploymentContext(connectionId);
    const current = await adapter.getDeployment(deploymentId);
    this.#assertDeploymentWritable(current, currentScopeId);
    const updated = await adapter.unpauseDeployment(deploymentId);
    return this.#publicDeployment(updated, currentScopeId, connectionId);
  }

  async archiveDeployment(
    connectionId: ConnectionId,
    agentId: string,
    deploymentId: string,
  ): Promise<void> {
    const { adapter, currentScopeId } = await this.#deploymentContext(connectionId);
    const current = await adapter.getDeployment(deploymentId);
    this.#assertDeploymentWritable(current, currentScopeId);
    await adapter.archiveDeployment(deploymentId);
  }

  async runDeployment(
    connectionId: ConnectionId,
    agentId: string,
    deploymentId: string,
  ): Promise<DeploymentRunView> {
    const { adapter, currentScopeId } = await this.#deploymentContext(connectionId);
    const current = await adapter.getDeployment(deploymentId);
    const keyScope = classifyApiKeyScope(current.keyScopeMarker, currentScopeId);
    if (!this.#canViewDeployment(keyScope, current.shared)) {
      throw hostError("not-found", "deployment not found");
    }
    return adapter.runDeployment(deploymentId);
  }

  async listDeploymentRuns(
    connectionId: ConnectionId,
    agentId: string,
    deploymentId: string,
  ): Promise<DeploymentRunView[]> {
    const { adapter, currentScopeId } = await this.#deploymentContext(connectionId);
    const current = await adapter.getDeployment(deploymentId);
    const keyScope = classifyApiKeyScope(current.keyScopeMarker, currentScopeId);
    if (!this.#canViewDeployment(keyScope, current.shared)) {
      throw hostError("not-found", "deployment not found");
    }
    return adapter.listDeploymentRuns(deploymentId);
  }

  async #chatContext(connectionId: ConnectionId): Promise<{
    adapter: ChatAdapter;
    currentScopeId: string;
    connection: ResolvedConnection;
  }> {
    const connection = await this.#resolveCredential(connectionId);
    const { provider } = connection;
    const factory = this.#chatAdapters[provider];
    if (factory === undefined) {
      throw hostError("invalid-input", `unsupported provider: ${provider}`);
    }
    return {
      adapter: factory(connection),
      currentScopeId: apiKeyScopeId(provider, connection.credential),
      connection,
    };
  }

  async #deploymentContext(connectionId: ConnectionId): Promise<{
    adapter: DeploymentAdapter;
    currentScopeId: string;
  }> {
    const connection = await this.#resolveCredential(connectionId);
    const { provider } = connection;
    const factory = this.#deploymentAdapters[provider];
    if (factory === undefined) {
      throw hostError("unavailable", `provider does not support deployments: ${provider}`);
    }
    return {
      adapter: factory(connection),
      currentScopeId: apiKeyScopeId(provider, connection.credential),
    };
  }

  #publicDeployment(
    deployment: AdapterDeploymentView,
    currentScopeId: string,
    connectionId: ConnectionId,
  ): DeploymentView {
    return {
      ref: {
        connectionId,
        agentId: deployment.agentId,
        deploymentId: deployment.deploymentId,
      },
      name: deployment.name,
      status: deployment.status,
      prompt: deployment.prompt,
      keyScope: classifyApiKeyScope(deployment.keyScopeMarker, currentScopeId),
      ...(deployment.description !== undefined ? { description: deployment.description } : {}),
      ...(deployment.schedule !== undefined ? { schedule: deployment.schedule } : {}),
      ...(deployment.expiresAt !== undefined ? { expiresAt: deployment.expiresAt } : {}),
      ...(deployment.createdAt !== undefined ? { createdAt: deployment.createdAt } : {}),
      ...(deployment.updatedAt !== undefined ? { updatedAt: deployment.updatedAt } : {}),
      ...(deployment.shared ? { shared: true } : {}),
    };
  }

  /** Deployment 可见性与 Bot 一致：current 与未分组可见，其他 Key 范围仅共享可见。 */
  #canViewDeployment(
    keyScope: "current" | "other" | "ungrouped",
    shared: boolean,
  ): boolean {
    return keyScope !== "other" || shared;
  }

  /** 写操作仅限归属当前 Key 范围或未分组（控制台创建）的 Deployment。 */
  #assertDeploymentWritable(
    deployment: AdapterDeploymentView,
    currentScopeId: string,
  ): void {
    if (classifyApiKeyScope(deployment.keyScopeMarker, currentScopeId) === "other") {
      throw hostError("not-found", "deployment not found");
    }
  }

  async #botCatalogFor(connectionId: ConnectionId): Promise<BotCatalog> {
    const connection = await this.#resolveCredential(connectionId);
    const { provider } = connection;
    const factory = this.#botCatalogs[provider];
    if (factory === undefined) {
      throw hostError("invalid-input", `unsupported provider: ${provider}`);
    }
    return factory(connection);
  }

  #publicChat(chat: AdapterChatView, currentScopeId: string): ChatView {
    const { keyScopeMarker, ...view } = chat;
    delete (view as Partial<AdapterChatView>).deploymentId;
    return { ...view, keyScope: classifyApiKeyScope(keyScopeMarker, currentScopeId) };
  }

  #canRead(
    keyScope: "current" | "other" | "ungrouped",
    shared: boolean,
  ): boolean {
    return keyScope === "current" || (keyScope === "other" && shared);
  }

  #assertReadable(keyScope: "current" | "other" | "ungrouped", shared: boolean): void {
    if (!this.#canRead(keyScope, shared)) throw hostError("not-found", "chat not found");
  }

  #assertCurrentScope(keyScope: "current" | "other" | "ungrouped"): void {
    if (keyScope !== "current") throw hostError("not-found", "chat not found");
  }

  async #sessionAccess(
    adapter: ChatAdapter,
    sessionId: string,
    connection: ResolvedConnection,
  ): Promise<AdapterChatAccess> {
    const access =
      adapter.getChatAccess !== undefined
        ? await adapter.getChatAccess(sessionId)
        : await (async () => {
            const keyScopeMarker = await adapter.getKeyScopeMarker(sessionId);
            return {
              ...(keyScopeMarker ? { keyScopeMarker } : {}),
              shared: false,
            };
          })();
    if (access.keyScopeMarker !== undefined || access.deploymentId === undefined) {
      return access;
    }
    const scope = await this.#deploymentScope(connection, access.deploymentId, new Map());
    if (scope === null) return access;
    return {
      ...(scope.keyScopeMarker !== undefined ? { keyScopeMarker: scope.keyScopeMarker } : {}),
      shared: access.shared || scope.shared,
      deploymentId: access.deploymentId,
    };
  }

  /**
   * Deployment Run Session 的归属继承（Qoder 合同：Run Session 不继承 Deployment
   * metadata，仅携带 deployment_id）。无归属标记且关联 Deployment 时，继承该
   * Deployment 的 Key 范围与共享状态；Deployment 查询失败按无继承处理（ungrouped）。
   */
  async #deploymentScope(
    connection: ResolvedConnection,
    deploymentId: string,
    cache: Map<string, Promise<DeploymentScope | null>>,
  ): Promise<DeploymentScope | null> {
    let pending = cache.get(deploymentId);
    if (pending === undefined) {
      pending = (async () => {
        const factory = this.#deploymentAdapters[connection.provider];
        if (factory === undefined) return null;
        try {
          const deployment = await factory(connection).getDeployment(deploymentId);
          return {
            ...(deployment.keyScopeMarker !== undefined
              ? { keyScopeMarker: deployment.keyScopeMarker }
              : {}),
            shared: deployment.shared,
          };
        } catch {
          return null;
        }
      })();
      cache.set(deploymentId, pending);
    }
    return pending;
  }

  async #inheritDeploymentScope(
    connection: ResolvedConnection,
    chat: AdapterChatView,
    cache: Map<string, Promise<DeploymentScope | null>>,
  ): Promise<AdapterChatView> {
    if (chat.keyScopeMarker !== undefined || chat.deploymentId === undefined) return chat;
    const scope = await this.#deploymentScope(connection, chat.deploymentId, cache);
    if (scope === null) return chat;
    return {
      ...chat,
      ...(scope.keyScopeMarker !== undefined ? { keyScopeMarker: scope.keyScopeMarker } : {}),
      ...(chat.shared === true || scope.shared ? { shared: true } : {}),
    };
  }

  async #assertReadableSession(
    adapter: ChatAdapter,
    sessionId: string,
    currentScopeId: string,
    connection: ResolvedConnection,
  ): Promise<void> {
    const access = await this.#sessionAccess(adapter, sessionId, connection);
    this.#assertReadable(
      classifyApiKeyScope(access.keyScopeMarker, currentScopeId),
      access.shared,
    );
  }

  async #assertOwnedSession(
    adapter: ChatAdapter,
    sessionId: string,
    currentScopeId: string,
    connection: ResolvedConnection,
  ): Promise<void> {
    const access = await this.#sessionAccess(adapter, sessionId, connection);
    this.#assertCurrentScope(classifyApiKeyScope(access.keyScopeMarker, currentScopeId));
  }
}
