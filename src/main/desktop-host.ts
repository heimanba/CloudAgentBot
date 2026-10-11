import type { DesktopHost } from "@shared/desktop-host-contract";
import type { BotView, ConnectionId } from "@shared/models";
import type { ConnectionManager } from "./connections/connection-manager";
import type { ChatDataPlane } from "./data-plane/chat-data-plane";
import type { BotControlPlane } from "./control-plane/bot-control-plane";
import type { ManagedBotStore } from "./control-plane/managed-bot-store";
import type { SkillCatalog } from "./control-plane/skill-catalog";
import type { BailianConsoleLogin } from "./connections/bailian-console-login";
import type { BailianMcpCatalog } from "./control-plane/bailian-mcp-catalog";

export interface DesktopHostOptions {
  version: string;
  writeClipboardText(text: string): void;
  toggleWindowMaximize?(): void;
  connectionManager: ConnectionManager;
  bailianConsoleLogin: Pick<BailianConsoleLogin, "start" | "cancel">;
  chatDataPlane: ChatDataPlane;
  botControlPlane: BotControlPlane;
  managedBotStore: ManagedBotStore;
  skillCatalog?: SkillCatalog;
  bailianMcpCatalog?: Pick<BailianMcpCatalog, "list" | "listTools">;
}

/**
 * DesktopHost 是 Renderer 使用 Main 的唯一 Interface。
 * Stage 04 接线 bots.list/get 与 chats.list/get；Stage 05 接线 chats.create/send/subscribe；
 * Stage 07 接线 bots.create/sync；Stage 08 接线 bots.update。
 *
 * bots.list 在数据面远程列表基础上与本地 managed scopes 做内存 join：
 * state 中记录 remote_id 的 scope 把对应 Bot 标为 managed（覆盖 Provider metadata
 * 启发式）；metadata 判定为 managed 但本地无完整资料的标 remote-only。
 *
 * chats.subscribe 的 listener 是 Main 进程内函数；Renderer 的回调无法跨 IPC 传递，
 * 由 bootstrap 用 webContents.send 把每个事件桥到 Renderer 持有的 channel。
 */
export function createDesktopHost(options: DesktopHostOptions): DesktopHost {
  // 与本地 managed scopes 内存 join：state 记录 remote_id 的 scope 决定管理状态。
  // managed / interrupted-resumable（state 已落地，允许写）显示为 managed；
  // 其他本地资料不完整但 state 存有 agentId 的 scope 显示为 state-missing；
  // 本地无 scope 记录的一律 remote-only（不按名称认领）。
  //
  // 当当前 state 缺失/损坏时，仅通过成功 Sync 留下的配对 backup 只读反查历史
  // agentId 关联：命中 backup 的远程 Agent 仍标 state-missing（诊断可见、写关闭）；
  // backup 也缺失时不猜测归属，保持 remote-only。backup 绝不恢复、复制或进入 SDK。
  const listBotsWithManagement = async (connectionId: ConnectionId): Promise<BotView[]> => {
    const bots = await options.chatDataPlane.listBots(connectionId);
    const managed = await options.managedBotStore.listManagedAgents(connectionId).catch(() => []);
    const byAgentId = new Map(managed.map((m) => [m.agentId, m.integrity]));
    // 当前 state 不可用但配对 backup 存有历史 agentId 关联的 scope。
    // 仅在前者未命中时填充，不覆盖当前 state 的判定结果。
    const backupOnly = await options.managedBotStore
      .listBackupManagedAgents(connectionId)
      .catch(() => []);
    for (const entry of backupOnly) {
      if (!byAgentId.has(entry.agentId)) byAgentId.set(entry.agentId, entry.integrity);
    }
    return bots.map((b) => {
      const integrity = byAgentId.get(b.ref.agentId);
      // 远程归属标记属于其他 API Key 范围时（例如本机更换过凭据），本地管理资料
      // 不再赋予 Managed 身份：归属以远程标记为准，其他范围的 Bot 不进入本机管理视图。
      const management =
        integrity === undefined || b.keyScope === "other"
          ? "remote-only"
          : integrity === "managed" || integrity === "interrupted-resumable"
            ? "managed"
            : "state-missing";
      return { ...b, management };
    });
  };

  return {
    app: {
      version: () => Promise.resolve(options.version),
      copyText: (text) => Promise.resolve(options.writeClipboardText(text)),
      toggleWindowMaximize: options.toggleWindowMaximize
        ? () => {
            options.toggleWindowMaximize?.();
            return Promise.resolve();
          }
        : undefined,
    },
    connections: {
      list: () => options.connectionManager.list(),
      connect: (input) => options.connectionManager.connect(input),
      connectBailianConsole: async () => {
        const credentials = await options.bailianConsoleLogin.start();
        return options.connectionManager.connect({
          provider: "bailian",
          displayName: "Bailian",
          credential: credentials.apiKey,
          workspaceId: credentials.workspaceId,
        });
      },
      reconnectBailianConsole: async (connectionId) => {
        const target = (await options.connectionManager.list()).find(
          (connection) => connection.id === connectionId,
        );
        if (target?.provider !== "bailian") {
          throw { code: "invalid-input", message: "console login requires a bailian connection" };
        }
        const credentials = await options.bailianConsoleLogin.start();
        if (credentials.workspaceId === target.workspaceId) {
          return options.connectionManager.reconnect({
            connectionId,
            credential: credentials.apiKey,
          });
        }
        return options.connectionManager.update({
          connectionId,
          displayName: target.displayName,
          workspaceId: credentials.workspaceId,
          credential: credentials.apiKey,
        });
      },
      cancelBailianConsoleLogin: () => {
        options.bailianConsoleLogin.cancel();
        return Promise.resolve();
      },
      reconnect: (input) => options.connectionManager.reconnect(input),
      update: (input) => options.connectionManager.update(input),
      verify: (connectionId) => options.connectionManager.verify(connectionId),
      disconnect: (connectionId) => options.connectionManager.disconnect(connectionId),
      remove: (connectionId, removeOptions) =>
        options.connectionManager.remove(connectionId, removeOptions),
      setupEnvironment: async (connectionId, environmentId) => {
        const result = await options.connectionManager.setupEnvironment(
          connectionId,
          environmentId,
        );
        // 剥离 environmentId：Renderer 只需知道 ready 或候选列表，不持有远程 ID。
        if (result.status === "ready") return { status: "ready" as const };
        return result;
      },
    },
    bots: {
      list: (connectionId) => listBotsWithManagement(connectionId),
      listSkills: (connectionId) => options.botControlPlane.listSkills(connectionId),
      listSkillCatalog: (connectionId, query) =>
        options.skillCatalog?.list(connectionId, query) ?? Promise.resolve([]),
      addSkillFromCatalog: (connectionId, catalogId) =>
        options.skillCatalog?.add(connectionId, catalogId) ??
        Promise.reject({ code: "unavailable", message: "skill catalog is unavailable" }),
      listMcpCatalog: (query) =>
        options.bailianMcpCatalog?.list(query) ??
        Promise.reject({ code: "unavailable", message: "MCP catalog is unavailable" }),
      listMcpTools: (serverCode) =>
        options.bailianMcpCatalog?.listTools(serverCode) ??
        Promise.reject({ code: "unavailable", message: "MCP catalog is unavailable" }),
      get: async (ref) => {
        const bots = await listBotsWithManagement(ref.connectionId);
        const bot = bots.find((b) => b.ref.agentId === ref.agentId);
        if (bot === undefined) {
          return Promise.reject({ code: "not-found", message: `bot not found: ${ref.agentId}` });
        }
        return bot;
      },
      getConfiguration: (ref) => options.botControlPlane.getConfiguration(ref),
      create: (connectionId, input) => options.botControlPlane.create(connectionId, input),
      update: (ref, input) => options.botControlPlane.update(ref, input),
      sync: (ref) => options.botControlPlane.sync(ref),
      setShared: (ref, shared) => options.botControlPlane.setShared(ref, shared),
      archive: (ref) => options.botControlPlane.archive(ref),
    },
    chats: {
      list: (bot) => options.chatDataPlane.listChats(bot.connectionId, bot.agentId),
      create: (bot) => options.chatDataPlane.createChat(bot.connectionId, bot.agentId),
      get: (ref) => options.chatDataPlane.getChat(ref.connectionId, ref.sessionId),
      uploadFile: (connectionId, input) => options.chatDataPlane.uploadFile(connectionId, input),
      send: (ref, text, attachments) =>
        options.chatDataPlane.sendMessage(ref.connectionId, ref.sessionId, text, attachments),
      setShared: (ref, shared) =>
        options.chatDataPlane.setChatShared(ref.connectionId, ref.sessionId, shared),
      archive: (ref) => options.chatDataPlane.archiveChat(ref.connectionId, ref.sessionId),
      delete: (ref) => options.chatDataPlane.deleteChat(ref.connectionId, ref.sessionId),
      getArtifact: (ref, fileId, artifactOptions) =>
        options.chatDataPlane.getArtifact(ref.connectionId, ref.sessionId, fileId, artifactOptions),
      subscribe: (ref, listener) => {
        // fire-and-forget：subscribe 立即 resolve，不等 SSE 首帧（Qoder SSE 是静默流）。
        // 连接级错误（401、网络失败、session 不存在）经 error 事件上抛，不 reject。
        // 取消只停本地订阅，不影响远程运行。
        let cancelled = false;
        let adapterUnsub: (() => void) | undefined;
        return options.chatDataPlane
          .subscribe(ref.connectionId, ref.sessionId, (event) => {
            if (!cancelled) listener(event);
          })
          .then((unsub) => {
            if (cancelled) {
              unsub();
              return () => {};
            }
            adapterUnsub = unsub;
            return () => {
              cancelled = true;
              adapterUnsub?.();
            };
          });
      },
    },
    deployments: {
      list: (connectionId, agentId) =>
        options.chatDataPlane.listDeployments(connectionId, agentId),
      get: (ref) =>
        options.chatDataPlane.getDeployment(ref.connectionId, ref.agentId, ref.deploymentId),
      create: (connectionId, input) => options.chatDataPlane.createDeployment(connectionId, input),
      update: (ref, input) =>
        options.chatDataPlane.updateDeployment(ref.connectionId, ref.agentId, ref.deploymentId, input),
      setShared: (ref, shared) =>
        options.chatDataPlane.setDeploymentShared(ref.connectionId, ref.agentId, ref.deploymentId, shared),
      pause: (ref) =>
        options.chatDataPlane.pauseDeployment(ref.connectionId, ref.agentId, ref.deploymentId),
      unpause: (ref) =>
        options.chatDataPlane.unpauseDeployment(ref.connectionId, ref.agentId, ref.deploymentId),
      archive: (ref) =>
        options.chatDataPlane.archiveDeployment(ref.connectionId, ref.agentId, ref.deploymentId),
      run: (ref) =>
        options.chatDataPlane.runDeployment(ref.connectionId, ref.agentId, ref.deploymentId),
      listRuns: (ref) =>
        options.chatDataPlane.listDeploymentRuns(ref.connectionId, ref.agentId, ref.deploymentId),
    },
  };
}
