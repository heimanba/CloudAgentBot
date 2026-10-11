import { safeStorage, shell } from "electron";
import { join } from "node:path";
import { EncryptedFileCredentialStore } from "./credentials/credential-store";
import { ConnectionStore } from "./connections/connection-store";
import { ConnectionManager } from "./connections/connection-manager";
import { createQoderVerifier } from "./connections/qoder-verifier";
import { createBailianVerifier } from "./connections/bailian-verifier";
import { BailianConsoleLogin } from "./connections/bailian-console-login";
import { ChatDataPlane } from "./data-plane/chat-data-plane";
import { createQoderChatAdapter } from "./data-plane/providers/qoder/qoder-chat-adapter";
import { createQoderBotCatalog } from "./data-plane/providers/qoder/qoder-bot-catalog";
import { createBailianChatAdapter } from "./data-plane/providers/bailian/bailian-chat-adapter";
import { createBailianBotCatalog } from "./data-plane/providers/bailian/bailian-bot-catalog";
import { createBailianDeploymentAdapter } from "./data-plane/providers/bailian/bailian-deployment-adapter";
import { createQoderDeploymentAdapter } from "./data-plane/providers/qoder/qoder-deployment-adapter";
import { ManagedBotStore } from "./control-plane/managed-bot-store";
import { ScopeLock } from "./control-plane/scope-lock";
import { BotControlPlane } from "./control-plane/bot-control-plane";
import { EnvironmentControlPlane } from "./control-plane/environment-control-plane";
import { QoderSkillMarketplace } from "./control-plane/qoder-skill-marketplace";
import { SkillCatalog } from "./control-plane/skill-catalog";
import { BailianMcpCatalog } from "./control-plane/bailian-mcp-catalog";

/** Main 进程装配结果。 */
export interface Composition {
  connectionManager: ConnectionManager;
  bailianConsoleLogin: BailianConsoleLogin;
  chatDataPlane: ChatDataPlane;
  managedBotStore: ManagedBotStore;
  botControlPlane: BotControlPlane;
  skillCatalog: SkillCatalog;
  bailianMcpCatalog: BailianMcpCatalog;
}

/**
 * Main 进程装配根。
 * Stage 02 组装 Connection 域；Stage 04 加入数据面只读域；
 * Stage 06 加入 Managed Bot 本地存储与 scope 单写锁；
 * Stage 07 加入 BotControlPlane（创建/同步 managed Bot）；
 * Connection 共享 Environment 加入 EnvironmentControlPlane。
 */
export function createComposition(userDataDir: string): Composition {
  const v2Dir = join(userDataDir, "v2");
  const credentialStore = new EncryptedFileCredentialStore(
    join(v2Dir, "credentials.enc"),
    safeStorage,
  );
  const connectionStore = new ConnectionStore(join(v2Dir, "connections.json"));
  const managedBotStore = new ManagedBotStore(join(v2Dir, "managed-bots"));
  const environmentControlPlane = new EnvironmentControlPlane();
  const connectionManager: ConnectionManager = new ConnectionManager({
    connectionStore,
    credentialStore,
    verifiers: { qoder: createQoderVerifier(), bailian: createBailianVerifier() },
    countManagedScopes: async (connectionId) =>
      (await managedBotStore.listScopes(connectionId)).length,
    removeManagedScopes: (connectionId) => managedBotStore.removeConnectionData(connectionId),
    setupEnvironment: async (connectionId, environmentId) => {
      const resolved = await connectionManager.resolveCredential(connectionId);
      return environmentControlPlane.setup(
        {
          id: connectionId,
          provider: resolved.provider,
          credential: resolved.credential,
          ...(resolved.workspaceId ? { workspaceId: resolved.workspaceId } : {}),
        },
        environmentId,
      );
    },
  });
  const bailianConsoleLogin = new BailianConsoleLogin({
    openExternal: (url) => shell.openExternal(url),
  });
  const chatDataPlane = new ChatDataPlane({
    chatAdapters: { qoder: createQoderChatAdapter, bailian: createBailianChatAdapter },
    botCatalogs: { qoder: createQoderBotCatalog, bailian: createBailianBotCatalog },
    deploymentAdapters: {
      bailian: createBailianDeploymentAdapter,
      qoder: createQoderDeploymentAdapter,
    },
    resolveCredential: (connectionId) => connectionManager.resolveCredential(connectionId),
    resolveManagedEnvironmentId: (connectionId, agentId) =>
      managedBotStore.findManagedEnvironmentId(connectionId, agentId),
    resolveDefaultEnvironmentId: (connectionId) =>
      connectionManager.getDefaultEnvironmentId(connectionId),
  });
  const botControlPlane = new BotControlPlane({
    store: managedBotStore,
    lock: new ScopeLock(),
    resolveCredential: (connectionId) => connectionManager.resolveCredential(connectionId),
    resolveDefaultEnvironmentId: (connectionId) =>
      connectionManager.getDefaultEnvironmentId(connectionId),
  });
  const qoderSkillMarketplace = new QoderSkillMarketplace();
  const skillCatalog = new SkillCatalog(
    (connectionId) => connectionManager.resolveCredential(connectionId),
    (connectionId) => botControlPlane.listSkills(connectionId),
    qoderSkillMarketplace,
  );
  const bailianMcpCatalog = new BailianMcpCatalog();
  return {
    connectionManager,
    bailianConsoleLogin,
    chatDataPlane,
    managedBotStore,
    botControlPlane,
    skillCatalog,
    bailianMcpCatalog,
  };
}
