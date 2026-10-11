import { useEffect, useRef, useState } from "react";
import type { BotRef, BotView, ChatView, ConnectionId, HostError, MessageAttachment } from "@shared/models";
import { isHostError } from "@shared/errors";
import { getDesktopHost } from "../desktop-host";
import { useConnections, type UseConnectionsResult } from "../features/connections/use-connections";
import { useBots } from "../features/bots/use-bots";
import { useChatRoster } from "../features/chats/use-chat-roster";
import {
  useChatArchive,
  useChatDelete,
  useChatDetail,
  useChatSend,
  useChatSharing,
  useChats,
} from "../features/chats/use-chats";
import { useChatWatch } from "../features/chats/use-chat-watch";
import { getProviderDisplayName } from "../ui/provider-brand/provider-brand";
import { botConsoleUrl } from "../features/bots/bot-console-url";
import { chatKey } from "./chat-navigation-model";

const LAST_CONNECTION_STORAGE_KEY = "openagentbot:last-connection-id:v1";

export type WorkspaceLocation =
  | { area: "chats"; page: "overview" }
  | { area: "chats"; page: "new" }
  | { area: "chats"; page: "detail"; bot: BotView; chat: ChatView }
  | { area: "bots"; page: "list" }
  | { area: "bots"; page: "templates" }
  | { area: "bots"; page: "detail"; bot: BotView; justCreated?: boolean }
  | { area: "bots"; page: "edit"; botRef: BotRef }
  // 定时任务总览是独立的跨 Bot 页面，不属于 chats/bots 两个区域的对象树。
  | { area: "deployments"; page: "list" };

function readLastConnectionId(): ConnectionId | null {
  try {
    const value = window.localStorage.getItem(LAST_CONNECTION_STORAGE_KEY)?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

function writeLastConnectionId(connectionId: ConnectionId | null): void {
  try {
    if (connectionId === null) window.localStorage.removeItem(LAST_CONNECTION_STORAGE_KEY);
    else window.localStorage.setItem(LAST_CONNECTION_STORAGE_KEY, connectionId);
  } catch {
    // 最近访问记录是可丢弃偏好；存储不可用时继续使用当前内存状态。
  }
}

export function deriveWorkspaceConnectionState(
  connections: ReturnType<typeof useConnections>["connections"],
  selectedConnectionId: ConnectionId | null,
  loading: boolean,
) {
  const readyConnections = connections.filter(
    (connection) => connection.credentialStored && connection.environmentReady,
  );
  return {
    readyConnections,
    defaultConnectionId: readyConnections[0]?.id ?? null,
    needsConnection: !loading && readyConnections.length === 0,
    activeConnection:
      readyConnections.find((connection) => connection.id === selectedConnectionId) ?? null,
  };
}

export function useWorkspace() {
  const [version, setVersion] = useState<string>("loading…");
  const connectionsApi = useConnections();
  const { connections } = connectionsApi;
  const [selectedConnectionId, setSelectedConnectionId] = useState<ConnectionId | null>(
    readLastConnectionId,
  );
  const [location, setLocation] = useState<WorkspaceLocation>({ area: "chats", page: "new" });
  const [showConnections, setShowConnections] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const creatingChatRef = useRef(false);
  const createChatOperationRef = useRef(0);
  const [createError, setCreateError] = useState<HostError | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [createBotRequest, setCreateBotRequest] = useState(0);
  // 凭据变更 epoch：定时任务区块等非 bots/chats 数据据此丢弃旧 Key 范围数据并重读。
  const [deploymentsEpoch, setDeploymentsEpoch] = useState(0);
  const [taskDraft, setTaskDraft] = useState("");
  const [taskBot, setTaskBot] = useState<BotView | null>(null);
  const [returnToTaskAfterCreate, setReturnToTaskAfterCreate] = useState(false);
  const [firstMessageDraft, setFirstMessageDraft] = useState<{
    chatKey: string;
    text: string;
  } | null>(null);
  const pendingFirstMessage = useRef<{
    chatKey: string;
    text: string;
    attachments?: MessageAttachment[];
  } | null>(null);

  const selectedBotRef = location.page === "detail" ? location.bot : null;
  const selectedChat =
    location.area === "chats" && location.page === "detail" ? location.chat : null;
  const editingBotRef =
    location.area === "bots" && location.page === "edit" ? location.botRef : null;

  const bots = useBots(selectedConnectionId);
  // Detail navigation captures the Bot used to open the page. Prefer the latest
  // provider-backed list entry so metadata changes (such as sharing) are visible
  // immediately after bots.reload() completes.
  const selectedBot = selectedBotRef
    ? (bots.bots.find(
        (bot) =>
          bot.ref.connectionId === selectedBotRef.ref.connectionId &&
          bot.ref.agentId === selectedBotRef.ref.agentId,
      ) ?? selectedBotRef)
    : null;
  const currentTaskBot = taskBot ? bots.bots.find((bot) =>
    bot.ref.connectionId === taskBot.ref.connectionId && bot.ref.agentId === taskBot.ref.agentId,
  ) : null;
  // 只有成功读取目录才能判定选择失效；读取失败保留草稿和原选择。
  const taskBotUnavailable = taskBot !== null && !bots.loading && bots.error === null &&
    (!currentTaskBot || (currentTaskBot.keyScope === "other" && currentTaskBot.shared !== true));
  const taskBotView = currentTaskBot ?? taskBot;
  const chatRoster = useChatRoster(bots.bots);
  const chats = useChats(selectedBot?.ref ?? null);
  const chatDetail = useChatDetail(
    selectedChat?.ref.connectionId ?? null,
    selectedChat?.ref.agentId ?? null,
    selectedChat?.ref.sessionId ?? null,
  );
  const chatSend = useChatSend(selectedChat?.ref ?? null, chatDetail.reload);
  // 被动观看正在运行的会话（如定时任务触发）：发送流程未持有订阅时接管实时事件，
  // 终态后重读历史与列表（sidebar 同步出现新会话/标题更新）。
  const chatWatch = useChatWatch(selectedChat?.ref ?? null, chatDetail.detail, chatSend.sending, () => {
    chatDetail.reload();
    chatRoster.reload();
    chats.reload();
  });
  const chatSharing = useChatSharing();
  const chatArchive = useChatArchive();
  const chatDelete = useChatDelete();

  // 凭据或 Workspace 变更后，API Key 范围随新凭据改变：Bot/Session 的归属、
  // 共享可见性与所有者判断都要按新凭据重取，否则列表与详情停留在旧范围的数据。
  const refreshAfterCredentialChange = (connectionId: ConnectionId) => {
    if (connectionId !== selectedConnectionId) return;
    bots.reload();
    chats.reload();
    // 更换凭据是身份边界：旧范围的乐观条目在新范围永远读不回，用 reset 丢弃而不是保留。
    chatRoster.reset();
    setDeploymentsEpoch((epoch) => epoch + 1);
    // 旧范围打开的会话详情在新范围多半不可读：直接回到新任务页，不展示过期详情的错误态。
    setLocation((current) =>
      current.area === "chats" && current.page === "detail"
        ? { area: "chats", page: "new" }
        : current,
    );
  };
  const connectionsApiWithRefresh: UseConnectionsResult = {
    ...connectionsApi,
    reconnect: async (input) => {
      await connectionsApi.reconnect(input);
      refreshAfterCredentialChange(input.connectionId);
    },
    reconnectBailianConsole: async (connectionId) => {
      await connectionsApi.reconnectBailianConsole(connectionId);
      refreshAfterCredentialChange(connectionId);
    },
    update: async (input) => {
      await connectionsApi.update(input);
      // update 仅在携带新凭据（Workspace 变更）时影响 API Key 范围。
      if (input.credential !== undefined) refreshAfterCredentialChange(input.connectionId);
    },
  };

  useEffect(() => {
    const pending = pendingFirstMessage.current;
    if (!pending || !selectedChat || chatKey(selectedChat.ref) !== pending.chatKey) return;
    pendingFirstMessage.current = null;
    void chatSend.send(pending.text, pending.attachments);
    setFirstMessageDraft(null);
  }, [selectedChat, chatSend]);

  useEffect(() => {
    getDesktopHost()
      .app.version()
      .then(setVersion)
      .catch(() => setVersion("unknown"));
  }, []);

  const { readyConnections, defaultConnectionId, needsConnection, activeConnection } =
    deriveWorkspaceConnectionState(connections, selectedConnectionId, connectionsApi.loading);
  useEffect(() => {
    // 等列表成功加载后再验证持久化选择，避免启动期间把有效偏好误判为失效。
    if (connectionsApi.loading || connectionsApi.listError !== null) return;
    const selectedIsReady = readyConnections.some(
      (connection) => connection.id === selectedConnectionId,
    );
    if (selectedIsReady || selectedConnectionId === defaultConnectionId) return;
    const id = window.setTimeout(() => {
      setSelectedConnectionId(defaultConnectionId);
      writeLastConnectionId(defaultConnectionId);
    }, 0);
    return () => window.clearTimeout(id);
  }, [
    connectionsApi.listError,
    connectionsApi.loading,
    defaultConnectionId,
    readyConnections,
    selectedConnectionId,
  ]);

  const createChat = async (
    bot: BotView | null,
    firstMessage?: string,
    attachments?: MessageAttachment[],
  ) => {
    if (bot === null || creatingChatRef.current) return;
    const operation = ++createChatOperationRef.current;
    creatingChatRef.current = true;
    setCreatingChat(true);
    setCreateError(null);
    if (firstMessage === undefined) {
      setLocation({ area: "chats", page: "new" });
    }
    try {
      const chat = await getDesktopHost().chats.create(bot.ref);
      if (createChatOperationRef.current !== operation) return;
      chats.reload();
      chatRoster.upsert(bot, chat);
      if (firstMessage !== undefined) {
        const text = firstMessage.trim();
        const key = chatKey(chat.ref);
        pendingFirstMessage.current = {
          chatKey: key,
          text,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        };
        setFirstMessageDraft({ chatKey: key, text });
        setTaskDraft("");
      }
      setLocation({ area: "chats", page: "detail", bot, chat });
    } catch (error) {
      if (createChatOperationRef.current !== operation) return;
      const hostError = isHostError(error)
        ? error
        : { code: "unavailable" as const, message: "create chat failed" };
      setCreateError(hostError);
      if (hostError.code === "conflict" && !activeConnection?.environmentReady) {
        setLocation({ area: "chats", page: "new" });
        setShowConnections(true);
      }
    } finally {
      if (createChatOperationRef.current === operation) {
        creatingChatRef.current = false;
        setCreatingChat(false);
      }
    }
  };

  const setChatShared = async (
    bot: BotView,
    source: ChatView,
    shared: boolean,
  ): Promise<HostError | null> => {
    try {
      const chat = await chatSharing.setShared(source.ref, shared);
      setLocation((current) =>
        current.area === "chats" &&
        current.page === "detail" &&
        chatKey(current.chat.ref) === chatKey(chat.ref)
          ? { ...current, chat }
          : current,
      );
      chatRoster.upsert(bot, chat);
      chats.reload();
      chatRoster.reload();
      // 共享只改变 Session metadata，不重读远程历史，避免详情区闪烁与滚动跳动。
      chatDetail.updateChat(chat);
      return null;
    } catch (error) {
      return isHostError(error)
        ? error
        : { code: "unavailable", message: "share chat failed" };
    }
  };

  const archiveChat = async (chat: ChatView) => {
    try {
      await chatArchive.archive(chat.ref);
      chatRoster.remove(chat.ref);
      chats.reload();
      chatRoster.reload();
      if (selectedChat?.ref.sessionId === chat.ref.sessionId) {
        setLocation({ area: "chats", page: "new" });
      }
    } catch {}
  };

  const deleteChat = async (chat: ChatView) => {
    try {
      await chatDelete.deleteChat(chat.ref);
      chatRoster.remove(chat.ref);
      chats.reload();
      chatRoster.reload();
      if (selectedChat?.ref.sessionId === chat.ref.sessionId) {
        setLocation({ area: "chats", page: "new" });
      }
    } catch {}
  };

  return {
    version,
    connectionsApi: connectionsApiWithRefresh,
    connectedConnections: readyConnections,
    incompleteConnectionCount: connections.filter(
      (connection) => !connection.credentialStored || !connection.environmentReady,
    ).length,
    needsConnection,
    activeConnection,
    activeProviderName: getProviderDisplayName(activeConnection?.provider),
    showConnectionManager: showConnections || needsConnection,
    selectedConnectionId,
    location,
    selectedBot,
    selectedChat,
    creatingChat,
    createError,
    searchQuery,
    createBotRequest,
    deploymentsEpoch,
    editingBotRef,
    taskDraft,
    taskBot: taskBotView,
    taskBotUnavailable,
    firstMessageDraft,
    bots,
    chatRoster,
    chats,
    chatDetail,
    chatSend,
    chatWatch,
    chatSharing,
    chatArchive,
    chatDelete,
    openConnections: () => setShowConnections(true),
    closeConnections: () => setShowConnections(false),
    setSearchQuery,
    openNewChat: () => {
      setTaskDraft("");
      setTaskBot(bots.bots.length === 1 && bots.bots[0].management === "managed" ? bots.bots[0] : null);
      setCreateError(null);
      setLocation({ area: "chats", page: "new" });
    },
    startTaskWithBot: (bot: BotView) => {
      setTaskBot(bot);
      setCreateError(null);
      setLocation({ area: "chats", page: "new" });
    },
    setTaskDraft,
    setTaskBot,
    sendNewTask: (attachments?: MessageAttachment[]) => {
      if (!taskBotView || taskBotUnavailable || bots.loading || bots.error || !taskDraft.trim()) return;
      void createChat(taskBotView, taskDraft, attachments);
    },
    selectConnection: (connectionId: ConnectionId | null) => {
      if (connectionId === selectedConnectionId) return;
      // Connection 是 Bot/Chat 身份的一部分。切换时让整个 workspace 的临时交互状态失效，
      // 同时递增操作代次，避免旧 Connection 的异步创建结果回写当前页面。
      createChatOperationRef.current += 1;
      creatingChatRef.current = false;
      setCreatingChat(false);
      setSelectedConnectionId(connectionId);
      writeLastConnectionId(connectionId);
      setLocation(
        (location.area === "chats" && location.page === "new") || returnToTaskAfterCreate
          ? { area: "chats", page: "new" }
          : { area: "chats", page: "new" },
      );
      setCreateError(null);
      setSearchQuery("");
      setCreateBotRequest(0);
      setTaskBot(null);
      setReturnToTaskAfterCreate(false);
      pendingFirstMessage.current = null;
      setFirstMessageDraft(null);
    },
    openBotList: () => {
      // createBotRequest 是一次性导航意图。BotsPage 在 Chat 页面期间会卸载，
      // 若不清除，重新打开普通 Bot 列表会把旧请求再次解释为"新建 Bot"。
      setCreateBotRequest(0);
      setReturnToTaskAfterCreate(false);
      setLocation({ area: "bots", page: "list" });
    },
    openTeamTemplates: () => {
      setCreateBotRequest(0);
      setReturnToTaskAfterCreate(false);
      setSearchQuery("");
      setLocation({ area: "bots", page: "templates" });
    },
    openChatsOverview: () => {
      setLocation({ area: "chats", page: "overview" });
      setCreateError(null);
    },
    openTaskHome: () => {
      setLocation({ area: "chats", page: "new" });
      setCreateError(null);
    },
    openChat: (bot: BotView, chat: ChatView) => {
      setLocation({ area: "chats", page: "detail", bot, chat });
      setCreateError(null);
    },
    openBotChats: (bot: BotView) => {
      setLocation({ area: "bots", page: "detail", bot });
      setCreateError(null);
    },
    openCreatedBot: (bot: BotView) => {
      setSearchQuery("");
      if (returnToTaskAfterCreate) {
        setTaskBot(bot);
        setLocation({ area: "chats", page: "new" });
        setReturnToTaskAfterCreate(false);
      } else {
        setLocation({ area: "bots", page: "detail", bot, justCreated: true });
      }
      setCreateError(null);
    },
    cancelBotCreation: () => {
      if (returnToTaskAfterCreate) {
        setReturnToTaskAfterCreate(false);
        setLocation({ area: "chats", page: "new" });
      }
    },
    backToBots: () => {
      setLocation({ area: "bots", page: "list" });
      setCreateError(null);
    },
    openBotEditor: (ref: BotRef) => {
      const bot = bots.bots.find(
        (candidate) =>
          candidate.ref.connectionId === ref.connectionId && candidate.ref.agentId === ref.agentId,
      );
      if (bot?.management === "remote-only") {
        const provider = connections.find(
          (connection) => connection.id === ref.connectionId,
        )?.provider;
        const url = botConsoleUrl(provider, ref.agentId);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      setCreateBotRequest(0);
      setLocation({ area: "bots", page: "edit", botRef: ref });
    },
    closeBotEditor: () => setLocation({ area: "bots", page: "list" }),
    closeChat: () => setLocation({ area: "chats", page: "new" }),
    openDeployments: () => {
      setLocation({ area: "deployments", page: "list" });
      setCreateError(null);
    },
    createChat,
    setChatShared,
    archiveChat,
    deleteChat,
    openBotCreation: () => {
      setReturnToTaskAfterCreate(location.area === "chats" && location.page === "new");
      setLocation({ area: "bots", page: "list" });
      setCreateBotRequest((value) => value + 1);
    },
  };
}
