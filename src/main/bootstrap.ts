import { app, clipboard, ipcMain } from "electron";
import { hostError, ipcErr, ipcOk, toHostError } from "@shared/errors";
import type { IpcResult } from "@shared/errors";
import {
  parseBotRef,
  parseChatRef,
  parseConnectInput,
  parseConnectionId,
  parseCreateBotInput,
  parseCreateDeploymentInput,
  parseDeploymentRef,
  parseMessageAttachments,
  parseOptionalEnvironmentId,
  parseReconnectInput,
  parseUpdateConnectionInput,
  parseSendMessageText,
  parseSubscriptionId,
  parseUpdateBotInput,
  parseUpdateDeploymentInput,
  parseUploadFileInput,
} from "@shared/validation";
import { createComposition } from "./composition";
import { createDesktopHost } from "./desktop-host";
import { installDesktopShell } from "./shell/desktop-shell";
import { createAppTray } from "./tray/app-tray";
import { createMainWindow, installPermissionGuard } from "./windows/main-window";
import appIconPath from "../shared/assets/app.png?asset";

/**
 * 把 Main 侧 Promise 结果包装为 IPC 信封：
 * 成功与失败都走返回值通道，错误码可结构化克隆到 Renderer；
 * 未知异常收敛为 unavailable，不回传敏感消息。
 */
async function invoke<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return ipcOk(await fn());
  } catch (error) {
    return ipcErr(toHostError(error));
  }
}

export async function bootstrap(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const desktopShell = installDesktopShell({
    app,
    createWindow: createMainWindow,
    createTray: createAppTray,
  });

  await app.whenReady();

  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(appIconPath);
  }

  installPermissionGuard();

  const composition = createComposition(app.getPath("userData"));
  const host = createDesktopHost({
    version: app.getVersion(),
    writeClipboardText: (text) => clipboard.writeText(text),
    toggleWindowMaximize: () => desktopShell.toggleMainWindowMaximize(),
    connectionManager: composition.connectionManager,
    bailianConsoleLogin: composition.bailianConsoleLogin,
    chatDataPlane: composition.chatDataPlane,
    botControlPlane: composition.botControlPlane,
    managedBotStore: composition.managedBotStore,
    skillCatalog: composition.skillCatalog,
    bailianMcpCatalog: composition.bailianMcpCatalog,
  });

  ipcMain.handle("app:version", () => invoke(() => host.app.version()));
  ipcMain.handle("app:toggle-window-maximize", () =>
    invoke(() => host.app.toggleWindowMaximize?.() ?? Promise.resolve()),
  );
  ipcMain.handle("app:copy-text", (_event, text: unknown) =>
    invoke(() => {
      if (typeof text !== "string") {
        throw hostError("invalid-input", "copy text must be a string");
      }
      return host.app.copyText(text);
    }),
  );
  ipcMain.handle("connections:list", () => invoke(() => host.connections.list()));
  ipcMain.handle("connections:connect", (_event, input: unknown) =>
    invoke(() => {
      const parsed = parseConnectInput(input);
      if (parsed === null) {
        throw hostError(
          "invalid-input",
          "connect input must be {provider, displayName, credential}",
        );
      }
      return host.connections.connect(parsed);
    }),
  );
  ipcMain.handle("connections:connect-bailian-console", () =>
    invoke(() => host.connections.connectBailianConsole()),
  );
  ipcMain.handle("connections:reconnect-bailian-console", (_event, connectionId: unknown) =>
    invoke(() => {
      const parsed = parseConnectionId(connectionId);
      if (parsed === null) throw hostError("invalid-input", "invalid connection id");
      return host.connections.reconnectBailianConsole(parsed);
    }),
  );
  ipcMain.handle("connections:cancel-bailian-console-login", () =>
    invoke(() => host.connections.cancelBailianConsoleLogin()),
  );
  ipcMain.handle("connections:reconnect", (_event, input: unknown) =>
    invoke(() => {
      const parsed = parseReconnectInput(input);
      if (parsed === null) {
        throw hostError("invalid-input", "reconnect input must be {connectionId, credential}");
      }
      return host.connections.reconnect(parsed);
    }),
  );
  ipcMain.handle("connections:update", (_event, input: unknown) =>
    invoke(() => {
      const parsed = parseUpdateConnectionInput(input);
      if (!parsed) throw hostError("invalid-input", "invalid connection update");
      return host.connections.update(parsed);
    }),
  );
  ipcMain.handle("connections:verify", (_event, connectionId: unknown) =>
    invoke(() => {
      const parsed = parseConnectionId(connectionId);
      if (!parsed) throw hostError("invalid-input", "connectionId must be a non-empty string");
      return host.connections.verify(parsed);
    }),
  );

  ipcMain.handle("connections:disconnect", (_event, connectionId: unknown) =>
    invoke(() => {
      const parsed = parseConnectionId(connectionId);
      if (parsed === null) {
        throw hostError("invalid-input", "connectionId must be a non-empty string");
      }
      return host.connections.disconnect(parsed);
    }),
  );
  ipcMain.handle("connections:remove", (_event, connectionId: unknown, options: unknown) =>
    invoke(() => {
      const parsed = parseConnectionId(connectionId);
      if (!parsed) throw hostError("invalid-input", "connectionId must be a non-empty string");
      const candidate = options as { removeManagedBotData?: unknown } | null;
      if (typeof candidate !== "object" || typeof candidate?.removeManagedBotData !== "boolean") {
        throw hostError("invalid-input", "remove requires {removeManagedBotData: boolean}");
      }
      return host.connections.remove(parsed, {
        removeManagedBotData: candidate.removeManagedBotData,
      });
    }),
  );
  ipcMain.handle(
    "connections:setup-environment",
    (_event, connectionId: unknown, environmentId: unknown) =>
      invoke(() => {
        const parsedConnectionId = parseConnectionId(connectionId);
        const parsedEnvironmentId = parseOptionalEnvironmentId(environmentId);
        if (parsedConnectionId === null || parsedEnvironmentId === null) {
          throw hostError(
            "invalid-input",
            "setupEnvironment requires {connectionId, environmentId?}",
          );
        }
        return host.connections.setupEnvironment(parsedConnectionId, parsedEnvironmentId);
      }),
  );
  ipcMain.handle("bots:list-mcp-catalog", (_event, query: unknown) =>
    invoke(() => {
      if (query !== undefined && typeof query !== "string") {
        throw hostError("invalid-input", "listMcpCatalog requires {query?}");
      }
      return host.bots.listMcpCatalog!(query as string | undefined);
    }),
  );
  ipcMain.handle("bots:list-mcp-tools", (_event, serverCode: unknown) =>
    invoke(() => {
      if (typeof serverCode !== "string" || serverCode.trim().length === 0) {
        throw hostError("invalid-input", "listMcpTools requires {serverCode}");
      }
      return host.bots.listMcpTools!(serverCode.trim());
    }),
  );

  ipcMain.handle("bots:list", (_event, connectionId: unknown) =>
    invoke(() => {
      const parsed = parseConnectionId(connectionId);
      if (parsed === null) {
        throw hostError("invalid-input", "connectionId must be a non-empty string");
      }
      return host.bots.list(parsed);
    }),
  );
  ipcMain.handle("bots:list-skills", (_event, connectionId: unknown) =>
    invoke(() => {
      const parsed = parseConnectionId(connectionId);
      if (parsed === null) {
        throw hostError("invalid-input", "connectionId must be a non-empty string");
      }
      return host.bots.listSkills(parsed);
    }),
  );
  ipcMain.handle("bots:list-skill-catalog", (_event, connectionId: unknown, query: unknown) =>
    invoke(() => {
      const parsed = parseConnectionId(connectionId);
      if (parsed === null || (query !== undefined && typeof query !== "string")) {
        throw hostError("invalid-input", "listSkillCatalog requires {connectionId, query?}");
      }
      return host.bots.listSkillCatalog(parsed, query as string | undefined);
    }),
  );
  ipcMain.handle(
    "bots:add-skill-from-catalog",
    (_event, connectionId: unknown, catalogId: unknown) =>
      invoke(() => {
        const parsed = parseConnectionId(connectionId);
        if (parsed === null || typeof catalogId !== "string" || catalogId.trim().length === 0) {
          throw hostError(
            "invalid-input",
            "addSkillFromCatalog requires {connectionId, catalogId}",
          );
        }
        return host.bots.addSkillFromCatalog(parsed, catalogId);
      }),
  );
  ipcMain.handle("bots:get", (_event, ref: unknown) =>
    invoke(() => {
      const parsed = parseBotRef(ref);
      if (parsed === null) {
        throw hostError("invalid-input", "bot ref must be {connectionId, agentId}");
      }
      return host.bots.get(parsed);
    }),
  );
  ipcMain.handle("bots:get-configuration", (_event, ref: unknown) =>
    invoke(() => {
      const parsed = parseBotRef(ref);
      if (parsed === null) {
        throw hostError("invalid-input", "bot ref must be {connectionId, agentId}");
      }
      return host.bots.getConfiguration(parsed);
    }),
  );
  ipcMain.handle("bots:create", (_event, connectionId: unknown, input: unknown) =>
    invoke(() => {
      const parsedId = parseConnectionId(connectionId);
      const parsedInput = parseCreateBotInput(input);
      if (parsedId === null || parsedInput === null) {
        throw hostError(
          "invalid-input",
          "create requires {connectionId, {name, description?, model?, skills}}",
        );
      }
      return host.bots.create(parsedId, parsedInput);
    }),
  );
  ipcMain.handle("bots:update", (_event, ref: unknown, input: unknown) =>
    invoke(() => {
      const parsedRef = parseBotRef(ref);
      const parsedInput = parseUpdateBotInput(input);
      if (parsedRef === null || parsedInput === null) {
        throw hostError(
          "invalid-input",
          "update requires {ref, {name, description, instructions, model, skills}}",
        );
      }
      return host.bots.update(parsedRef, parsedInput);
    }),
  );
  ipcMain.handle("bots:sync", (_event, ref: unknown) =>
    invoke(() => {
      const parsed = parseBotRef(ref);
      if (parsed === null) {
        throw hostError("invalid-input", "bot ref must be {connectionId, agentId}");
      }
      return host.bots.sync(parsed);
    }),
  );
  ipcMain.handle("bots:set-shared", (_event, ref: unknown, shared: unknown) =>
    invoke(() => {
      const parsed = parseBotRef(ref);
      if (parsed === null || typeof shared !== "boolean") {
        throw hostError("invalid-input", "share requires a bot ref and boolean state");
      }
      return host.bots.setShared(parsed, shared);
    }),
  );
  ipcMain.handle("bots:archive", (_event, ref: unknown) =>
    invoke(() => {
      const parsed = parseBotRef(ref);
      if (parsed === null) {
        throw hostError("invalid-input", "bot ref must be {connectionId, agentId}");
      }
      return host.bots.archive(parsed);
    }),
  );

  ipcMain.handle("chats:list", (_event, bot: unknown) =>
    invoke(() => {
      const parsed = parseBotRef(bot);
      if (parsed === null) {
        throw hostError("invalid-input", "bot ref must be {connectionId, agentId}");
      }
      return host.chats.list(parsed);
    }),
  );
  ipcMain.handle("chats:get", (_event, ref: unknown) =>
    invoke(() => {
      const parsed = parseChatRef(ref);
      if (parsed === null) {
        throw hostError("invalid-input", "chat ref must be {connectionId, agentId, sessionId}");
      }
      return host.chats.get(parsed);
    }),
  );
  ipcMain.handle("chats:create", (_event, bot: unknown) =>
    invoke(() => {
      const parsed = parseBotRef(bot);
      if (parsed === null) {
        throw hostError("invalid-input", "bot ref must be {connectionId, agentId}");
      }
      return host.chats.create(parsed);
    }),
  );
  ipcMain.handle("chats:upload-file", (_event, connectionId: unknown, input: unknown) =>
    invoke(() => {
      const parsedConnectionId = parseConnectionId(connectionId);
      const parsedInput = parseUploadFileInput(input);
      if (parsedConnectionId === null || parsedInput === null) {
        throw hostError("invalid-input", "upload requires connectionId and {filename, mimeType, bytes}");
      }
      return host.chats.uploadFile(parsedConnectionId, parsedInput);
    }),
  );
  ipcMain.handle("chats:send", (_event, ref: unknown, text: unknown, attachments: unknown) =>
    invoke(() => {
      const parsedRef = parseChatRef(ref);
      const parsedText = parseSendMessageText(text);
      const parsedAttachments = parseMessageAttachments(attachments);
      if (parsedRef === null || parsedText === null || parsedAttachments === null) {
        throw hostError("invalid-input", "send requires chat ref, text, and valid attachments");
      }
      if (parsedText.trim().length === 0 && parsedAttachments.length === 0) {
        throw hostError("invalid-input", "send requires text or at least one attachment");
      }
      return host.chats.send(parsedRef, parsedText, parsedAttachments);
    }),
  );
  ipcMain.handle("chats:set-shared", (_event, ref: unknown, shared: unknown) =>
    invoke(() => {
      const parsed = parseChatRef(ref);
      if (parsed === null || typeof shared !== "boolean") {
        throw hostError("invalid-input", "share requires a chat ref and boolean state");
      }
      return host.chats.setShared(parsed, shared);
    }),
  );
  ipcMain.handle("chats:archive", (_event, ref: unknown) =>
    invoke(() => {
      const parsed = parseChatRef(ref);
      if (parsed === null) {
        throw hostError("invalid-input", "chat ref must be {connectionId, agentId, sessionId}");
      }
      return host.chats.archive(parsed);
    }),
  );
  ipcMain.handle("chats:delete", (_event, ref: unknown) =>
    invoke(() => {
      const parsed = parseChatRef(ref);
      if (parsed === null) {
        throw hostError("invalid-input", "chat ref must be {connectionId, agentId, sessionId}");
      }
      return host.chats.delete(parsed);
    }),
  );
  ipcMain.handle("chats:get-artifact", (_event, ref: unknown, fileId: unknown, options: unknown) =>
    invoke(() => {
      const parsedRef = parseChatRef(ref);
      const parsedFileId = typeof fileId === "string" && fileId.length > 0 ? fileId : null;
      const includeContent =
        typeof options === "object" &&
        options !== null &&
        (options as Record<string, unknown>).includeContent === true;
      if (parsedRef === null || parsedFileId === null) {
        throw hostError("invalid-input", "artifact requires chat ref and non-empty file id");
      }
      return host.chats.getArtifact(parsedRef, parsedFileId, { includeContent });
    }),
  );

  // SSE 订阅：Main 侧持有 subId → unsubscribe。事件经 webContents.send 推到
  // Renderer 监听的 `chats:event:{subId}` channel；错误码经信封式事件载荷传递。
  const chatSubscriptions = new Map<string, () => void>();
  ipcMain.handle("chats:subscribe", (event, subId: unknown, ref: unknown) =>
    invoke(async () => {
      const parsedSubId = parseSubscriptionId(subId);
      const parsedRef = parseChatRef(ref);
      if (parsedSubId === null || parsedRef === null) {
        throw hostError("invalid-input", "subscribe requires {subId, chat ref}");
      }
      const sender = event.sender;
      // 握手：await 订阅建立，SSE 连接确认后才向 Renderer resolve。
      const unsubscribe = await host.chats.subscribe(parsedRef, (chatEvent) => {
        if (!sender.isDestroyed()) {
          sender.send(`chats:event:${parsedSubId}`, chatEvent);
        }
      });
      chatSubscriptions.set(parsedSubId, unsubscribe);
      // Renderer 销毁时清理其全部订阅，避免悬挂的 SSE 流。
      sender.once("destroyed", () => {
        for (const [id, unsub] of chatSubscriptions) {
          unsub();
          chatSubscriptions.delete(id);
        }
      });
    }),
  );
  ipcMain.handle("chats:unsubscribe", (_event, subId: unknown) =>
    invoke(() => {
      const parsed = parseSubscriptionId(subId);
      if (parsed === null) {
        throw hostError("invalid-input", "subscriptionId must be a non-empty string");
      }
      chatSubscriptions.get(parsed)?.();
      chatSubscriptions.delete(parsed);
      return Promise.resolve();
    }),
  );

  const parseDeploymentRefOrThrow = (value: unknown) => {
    const parsed = parseDeploymentRef(value);
    if (parsed === null) {
      throw hostError(
        "invalid-input",
        "deployment ref must be {connectionId, agentId, deploymentId}",
      );
    }
    return parsed;
  };
  ipcMain.handle("deployments:list", (_event, connectionId: unknown, agentId: unknown) =>
    invoke(() => {
      const parsedConnectionId = parseConnectionId(connectionId);
      if (
        parsedConnectionId === null ||
        (agentId !== undefined && (typeof agentId !== "string" || agentId.length === 0))
      ) {
        throw hostError("invalid-input", "deployments:list requires connectionId");
      }
      return host.deployments.list(
        parsedConnectionId,
        typeof agentId === "string" ? agentId : undefined,
      );
    }),
  );
  ipcMain.handle("deployments:get", (_event, ref: unknown) =>
    invoke(() => host.deployments.get(parseDeploymentRefOrThrow(ref))),
  );
  ipcMain.handle("deployments:create", (_event, connectionId: unknown, input: unknown) =>
    invoke(() => {
      const parsedConnectionId = parseConnectionId(connectionId);
      const parsedInput = parseCreateDeploymentInput(input);
      if (parsedConnectionId === null || parsedInput === null) {
        throw hostError("invalid-input", "create deployment requires connectionId and input");
      }
      return host.deployments.create(parsedConnectionId, parsedInput);
    }),
  );
  ipcMain.handle("deployments:update", (_event, ref: unknown, input: unknown) =>
    invoke(() => {
      const parsedInput = parseUpdateDeploymentInput(input);
      if (parsedInput === null) {
        throw hostError("invalid-input", "update deployment requires a non-empty input");
      }
      return host.deployments.update(parseDeploymentRefOrThrow(ref), parsedInput);
    }),
  );
  ipcMain.handle("deployments:set-shared", (_event, ref: unknown, shared: unknown) =>
    invoke(() => {
      if (typeof shared !== "boolean") {
        throw hostError("invalid-input", "shared must be a boolean");
      }
      return host.deployments.setShared(parseDeploymentRefOrThrow(ref), shared);
    }),
  );
  ipcMain.handle("deployments:pause", (_event, ref: unknown) =>
    invoke(() => host.deployments.pause(parseDeploymentRefOrThrow(ref))),
  );
  ipcMain.handle("deployments:unpause", (_event, ref: unknown) =>
    invoke(() => host.deployments.unpause(parseDeploymentRefOrThrow(ref))),
  );
  ipcMain.handle("deployments:archive", (_event, ref: unknown) =>
    invoke(() => host.deployments.archive(parseDeploymentRefOrThrow(ref))),
  );
  ipcMain.handle("deployments:run", (_event, ref: unknown) =>
    invoke(() => host.deployments.run(parseDeploymentRefOrThrow(ref))),
  );
  ipcMain.handle("deployments:list-runs", (_event, ref: unknown) =>
    invoke(() => host.deployments.listRuns(parseDeploymentRefOrThrow(ref))),
  );

  desktopShell.start();
}
