import { contextBridge, ipcRenderer } from "electron";
import type { DesktopHost } from "@shared/desktop-host-contract";
import type { IpcResult } from "@shared/errors";
import type {
  BotConfigurationView,
  BotRef,
  BotSkillOption,
  McpCatalogEntry,
  McpToolOption,
  SkillCatalogEntry,
  BotView,
  ChatDetailView,
  ChatEventView,
  ChatArtifactView,
  ChatRef,
  ChatView,
  ConnectInput,
  ConnectionId,
  ConnectionView,
  CreateBotInput,
  CreateDeploymentInput,
  DeploymentRef,
  DeploymentRunView,
  DeploymentView,
  EnvironmentSetupResult,
  MessageAttachment,
  ReconnectInput,
  RemoveConnectionOptions,
  SendResult,
  UpdateBotInput,
  UpdateDeploymentInput,
  UpdateConnectionInput,
  UploadFileInput,
  UploadedFileView,
} from "@shared/models";

/**
 * Preload 只安装固定方法、还原信封并转发到 Main。
 * 输入形状校验在 Main（唯一信任边界）；这里不复制校验逻辑。
 */
async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw result.error;
  return result.value;
}

type ExposedHost = Pick<DesktopHost, "app" | "connections" | "bots" | "chats" | "deployments">;

const host: ExposedHost = {
  app: {
    version: () => unwrap(ipcRenderer.invoke("app:version") as Promise<IpcResult<string>>),
    copyText: (text: string) =>
      unwrap(ipcRenderer.invoke("app:copy-text", text) as Promise<IpcResult<void>>),
    toggleWindowMaximize: () =>
      unwrap(
        ipcRenderer.invoke("app:toggle-window-maximize") as Promise<IpcResult<void>>,
      ),
  },
  connections: {
    list: () =>
      unwrap(ipcRenderer.invoke("connections:list") as Promise<IpcResult<ConnectionView[]>>),
    connect: (input: ConnectInput) =>
      unwrap(
        ipcRenderer.invoke("connections:connect", input) as Promise<IpcResult<ConnectionView>>,
      ),
    connectBailianConsole: () =>
      unwrap(
        ipcRenderer.invoke("connections:connect-bailian-console") as Promise<
          IpcResult<ConnectionView>
        >,
      ),
    reconnectBailianConsole: (connectionId: string) =>
      unwrap(
        ipcRenderer.invoke("connections:reconnect-bailian-console", connectionId) as Promise<
          IpcResult<ConnectionView>
        >,
      ),
    cancelBailianConsoleLogin: () =>
      unwrap(
        ipcRenderer.invoke("connections:cancel-bailian-console-login") as Promise<IpcResult<void>>,
      ),
    reconnect: (input: ReconnectInput) =>
      unwrap(
        ipcRenderer.invoke("connections:reconnect", input) as Promise<IpcResult<ConnectionView>>,
      ),
    update: (input: UpdateConnectionInput) =>
      unwrap(ipcRenderer.invoke("connections:update", input) as Promise<IpcResult<ConnectionView>>),
    verify: (connectionId: ConnectionId) =>
      unwrap(ipcRenderer.invoke("connections:verify", connectionId) as Promise<IpcResult<void>>),
    disconnect: (connectionId: ConnectionId) =>
      unwrap(
        ipcRenderer.invoke("connections:disconnect", connectionId) as Promise<IpcResult<void>>,
      ),
    remove: (connectionId: ConnectionId, options: RemoveConnectionOptions) =>
      unwrap(
        ipcRenderer.invoke("connections:remove", connectionId, options) as Promise<IpcResult<void>>,
      ),
    setupEnvironment: (connectionId: ConnectionId, environmentId?: string) =>
      unwrap(
        ipcRenderer.invoke("connections:setup-environment", connectionId, environmentId) as Promise<
          IpcResult<EnvironmentSetupResult>
        >,
      ),
  },
  bots: {
    list: (connectionId: ConnectionId) =>
      unwrap(ipcRenderer.invoke("bots:list", connectionId) as Promise<IpcResult<BotView[]>>),
    listSkills: (connectionId: ConnectionId) =>
      unwrap(
        ipcRenderer.invoke("bots:list-skills", connectionId) as Promise<
          IpcResult<BotSkillOption[]>
        >,
      ),
    listSkillCatalog: (connectionId: ConnectionId, query?: string) =>
      unwrap(
        ipcRenderer.invoke("bots:list-skill-catalog", connectionId, query) as Promise<
          IpcResult<SkillCatalogEntry[]>
        >,
      ),
    addSkillFromCatalog: (connectionId: ConnectionId, catalogId: string) =>
      unwrap(
        ipcRenderer.invoke("bots:add-skill-from-catalog", connectionId, catalogId) as Promise<
          IpcResult<BotSkillOption>
        >,
      ),
    listMcpCatalog: (query?: string) =>
      unwrap(
        ipcRenderer.invoke("bots:list-mcp-catalog", query) as Promise<IpcResult<McpCatalogEntry[]>>,
      ),
    listMcpTools: (serverCode: string) =>
      unwrap(
        ipcRenderer.invoke("bots:list-mcp-tools", serverCode) as Promise<
          IpcResult<McpToolOption[]>
        >,
      ),
    get: (ref: BotRef) =>
      unwrap(ipcRenderer.invoke("bots:get", ref) as Promise<IpcResult<BotView>>),
    getConfiguration: (ref: BotRef) =>
      unwrap(
        ipcRenderer.invoke("bots:get-configuration", ref) as Promise<
          IpcResult<BotConfigurationView>
        >,
      ),
    create: (connectionId: ConnectionId, input: CreateBotInput) =>
      unwrap(ipcRenderer.invoke("bots:create", connectionId, input) as Promise<IpcResult<BotView>>),
    update: (ref: BotRef, input: UpdateBotInput) =>
      unwrap(ipcRenderer.invoke("bots:update", ref, input) as Promise<IpcResult<BotView>>),
    sync: (ref: BotRef) =>
      unwrap(ipcRenderer.invoke("bots:sync", ref) as Promise<IpcResult<BotView>>),
    setShared: (ref: BotRef, shared: boolean) =>
      unwrap(ipcRenderer.invoke("bots:set-shared", ref, shared) as Promise<IpcResult<BotView>>),
    archive: (ref: BotRef) =>
      unwrap(ipcRenderer.invoke("bots:archive", ref) as Promise<IpcResult<void>>),
  },
  chats: {
    list: (bot: BotRef) =>
      unwrap(ipcRenderer.invoke("chats:list", bot) as Promise<IpcResult<ChatView[]>>),
    create: (bot: BotRef) =>
      unwrap(ipcRenderer.invoke("chats:create", bot) as Promise<IpcResult<ChatView>>),
    get: (ref: ChatRef) =>
      unwrap(ipcRenderer.invoke("chats:get", ref) as Promise<IpcResult<ChatDetailView>>),
    uploadFile: (connectionId: ConnectionId, input: UploadFileInput) =>
      unwrap(
        ipcRenderer.invoke("chats:upload-file", connectionId, input) as Promise<
          IpcResult<UploadedFileView>
        >,
      ),
    send: (ref: ChatRef, text: string, attachments?: MessageAttachment[]) =>
      unwrap(
        ipcRenderer.invoke("chats:send", ref, text, attachments) as Promise<IpcResult<SendResult>>,
      ),
    setShared: (ref: ChatRef, shared: boolean) =>
      unwrap(ipcRenderer.invoke("chats:set-shared", ref, shared) as Promise<IpcResult<ChatView>>),
    archive: (ref: ChatRef) =>
      unwrap(ipcRenderer.invoke("chats:archive", ref) as Promise<IpcResult<void>>),
    delete: (ref: ChatRef) =>
      unwrap(ipcRenderer.invoke("chats:delete", ref) as Promise<IpcResult<void>>),
    getArtifact: (ref: ChatRef, fileId: string, options?: { includeContent?: boolean }) =>
      unwrap(
        ipcRenderer.invoke("chats:get-artifact", ref, fileId, options) as Promise<
          IpcResult<ChatArtifactView>
        >,
      ),
    subscribe: async (ref: ChatRef, listener: (event: ChatEventView) => void) => {
      const subId = `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const channel = `chats:event:${subId}`;
      const handler = (_e: Electron.IpcRendererEvent, event: ChatEventView) => listener(event);
      ipcRenderer.on(channel, handler);
      // 握手：Main 在 Provider SSE 建立后才 resolve；失败时 reject。
      await unwrap(ipcRenderer.invoke("chats:subscribe", subId, ref) as Promise<IpcResult<void>>);
      return () => {
        ipcRenderer.removeListener(channel, handler);
        void ipcRenderer.invoke("chats:unsubscribe", subId);
      };
    },
  },
  deployments: {
    list: (connectionId: ConnectionId, agentId?: string) =>
      unwrap(
        ipcRenderer.invoke("deployments:list", connectionId, agentId) as Promise<
          IpcResult<DeploymentView[]>
        >,
      ),
    get: (ref: DeploymentRef) =>
      unwrap(ipcRenderer.invoke("deployments:get", ref) as Promise<IpcResult<DeploymentView>>),
    create: (connectionId: ConnectionId, input: CreateDeploymentInput) =>
      unwrap(
        ipcRenderer.invoke("deployments:create", connectionId, input) as Promise<
          IpcResult<DeploymentView>
        >,
      ),
    update: (ref: DeploymentRef, input: UpdateDeploymentInput) =>
      unwrap(
        ipcRenderer.invoke("deployments:update", ref, input) as Promise<IpcResult<DeploymentView>>,
      ),
    setShared: (ref: DeploymentRef, shared: boolean) =>
      unwrap(
        ipcRenderer.invoke("deployments:set-shared", ref, shared) as Promise<
          IpcResult<DeploymentView>
        >,
      ),
    pause: (ref: DeploymentRef) =>
      unwrap(ipcRenderer.invoke("deployments:pause", ref) as Promise<IpcResult<DeploymentView>>),
    unpause: (ref: DeploymentRef) =>
      unwrap(ipcRenderer.invoke("deployments:unpause", ref) as Promise<IpcResult<DeploymentView>>),
    archive: (ref: DeploymentRef) =>
      unwrap(ipcRenderer.invoke("deployments:archive", ref) as Promise<IpcResult<void>>),
    run: (ref: DeploymentRef) =>
      unwrap(ipcRenderer.invoke("deployments:run", ref) as Promise<IpcResult<DeploymentRunView>>),
    listRuns: (ref: DeploymentRef) =>
      unwrap(
        ipcRenderer.invoke("deployments:list-runs", ref) as Promise<
          IpcResult<DeploymentRunView[]>
        >,
      ),
  },
};

contextBridge.exposeInMainWorld("desktopHost", host);
