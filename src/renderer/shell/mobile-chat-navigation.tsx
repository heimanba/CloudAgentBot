import { useState } from "react";
import type { BotView, ChatView, ConnectionId, ConnectionView } from "@shared/models";
import { Check, ChevronsUpDown, Settings } from "lucide-react";
import type { UseChatRosterResult } from "../features/chats/use-chat-roster";
import {
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "../ui/design-system";
import { getProviderDisplayName, ProviderBadge } from "../ui/provider-brand/provider-brand";
import { ChatNavigationContent } from "./chat-navigation-content";
import type { WorkspaceArea } from "./chat-navigation-content";

export interface MobileChatNavigationProps {
  connectedConnections: ConnectionView[];
  incompleteConnectionCount: number;
  selectedConnectionId: ConnectionId | null;
  area: WorkspaceArea;
  selectedBot: BotView | null;
  justCreatedBot?: boolean;
  selectedChat: ChatView | null;
  allChatsSelected: boolean;
  activeConnection: ConnectionView | null;
  activeProviderName: string;
  bots: BotView[];
  botsLoading: boolean;
  chatRoster: UseChatRosterResult;
  searchQuery: string;
  archiving: boolean;
  deleting: boolean;
  onClose(): void;
  onSearchQueryChange(value: string): void;
  onAreaChange(area: WorkspaceArea): void;
  onSelectConnection(connectionId: ConnectionId | null): void;
  onOpenChat(bot: BotView, chat: ChatView): void;
  onOpenBot(bot: BotView): void;
  onEditBot(bot: BotView): void;
  onSetChatShared?: Parameters<typeof ChatNavigationContent>[0]["onSetChatShared"];
  onArchiveChat(chat: ChatView): void;
  onDeleteChat(chat: ChatView): void;
  onCreateChat(bot: BotView): void;
  onOpenAllChats(): void;
  onOpenTeamTemplates(): void;
  onOpenDeployments(): void;
  onCreateBot(): void;
  onOpenConnections(): void;
}

/**
 * 窄窗口工作区导航：与桌面 Sidebar 共享 `ChatNavigationContent` 与派生模型。
 * 打开任何目标后关闭 Sheet；归档/删除的确认流程由本外壳集中持有，Sheet 关闭不取消已打开的确认。
 */
export function MobileChatNavigation({
  connectedConnections,
  incompleteConnectionCount,
  selectedConnectionId,
  area,
  selectedBot,
  justCreatedBot,
  selectedChat,
  allChatsSelected,
  activeConnection,
  activeProviderName,
  bots,
  botsLoading,
  chatRoster,
  searchQuery,
  archiving,
  deleting,
  onClose,
  onSearchQueryChange,
  onAreaChange,
  onSelectConnection,
  onOpenChat,
  onOpenBot,
  onEditBot,
  onSetChatShared,
  onArchiveChat,
  onDeleteChat,
  onCreateChat,
  onOpenAllChats,
  onOpenTeamTemplates,
  onOpenDeployments,
  onCreateBot,
  onOpenConnections,
}: MobileChatNavigationProps) {
  const [pendingDeleteChat, setPendingDeleteChat] = useState<ChatView | null>(null);
  const anyBusy = archiving || deleting;

  const close = onClose;

  return (
    <>
      <SheetContent side="left" aria-label="工作区导航">
        <SheetTitle className="sr-only">工作区导航</SheetTitle>
        <SheetDescription className="sr-only">任务列表与助手管理</SheetDescription>
        <div className="flex min-h-0 flex-1 flex-col pt-3">
          <ChatNavigationContent
            area={area}
            provider={activeConnection?.provider}
            bots={bots}
            botsLoading={botsLoading}
            chatRoster={chatRoster}
            selectedBot={selectedBot}
            justCreatedBot={justCreatedBot}
            selectedChat={selectedChat}
            allChatsSelected={allChatsSelected}
            searchQuery={searchQuery}
            busy={anyBusy}
            onAreaChange={onAreaChange}
            onOpenBotList={() => {
              onAreaChange("bots");
              close();
            }}
            onOpenTeamTemplates={() => {
              onOpenTeamTemplates();
              close();
            }}
            onOpenDeployments={() => {
              onOpenDeployments();
              close();
            }}
            onSearchQueryChange={onSearchQueryChange}
            onOpenChat={(bot, chat) => {
              onOpenChat(bot, chat);
              close();
            }}
            onOpenBot={(bot) => {
              onOpenBot(bot);
              close();
            }}
            onEditBot={(bot) => {
              onEditBot(bot);
              close();
            }}
            onSetChatShared={onSetChatShared}
            onArchiveChat={onArchiveChat}
            onDeleteChat={setPendingDeleteChat}
            onCreateChat={(bot) => {
              onCreateChat(bot);
              close();
            }}
            onOpenAllChats={() => {
              onOpenAllChats();
              close();
            }}
            onCreateBot={() => {
              onCreateBot();
              close();
            }}
          />
          <div className="min-h-[68px] border-t border-border px-3 pb-2.5 pt-[7px]">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-[var(--radius-lg)] border-0 bg-transparent px-1 py-1.5 text-left text-inherit transition-[background-color,box-shadow] duration-[var(--duration-fast)] hover:bg-surface-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20"
                  type="button"
                  aria-label={`切换 Connection，当前：${activeConnection?.displayName || "CloudAgentBot"}，Provider：${activeProviderName}`}
                >
                  <span className="relative grid size-[38px] shrink-0 place-items-center rounded-full bg-muted type-control font-semibold text-muted-foreground">
                    <span aria-hidden="true">
                      {Array.from(
                        activeConnection?.displayName || "CloudAgentBot",
                      )[0]?.toUpperCase()}
                    </span>
                    <ProviderBadge
                      provider={activeConnection?.provider}
                      className="pointer-events-none absolute -right-0.5 -bottom-0.5 size-[16px]"
                    />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-px">
                    <strong className="truncate type-supporting font-semibold">
                      {activeConnection?.displayName || "CloudAgentBot"}
                    </strong>
                    <small className="truncate type-supporting text-muted-foreground">
                      {activeProviderName}
                    </small>
                  </span>
                  <ChevronsUpDown
                    className="mr-1 size-[14px] shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-[var(--radix-dropdown-menu-trigger-width)]"
                aria-label="切换 Connection"
              >
                {connectedConnections.map((connection) => (
                  <DropdownMenuItem
                    key={connection.id}
                    className="min-h-[var(--control-md)]"
                    onSelect={() => {
                      onSelectConnection(connection.id);
                      close();
                    }}
                  >
                    <ProviderBadge provider={connection.provider} />
                    <span className="grid min-w-0 flex-1 gap-px">
                      <strong className="truncate font-medium">{connection.displayName}</strong>
                      <small className="truncate type-caption text-muted-foreground">
                        {getProviderDisplayName(connection.provider)}
                      </small>
                    </span>
                    {connection.id === selectedConnectionId ? (
                      <Check aria-label="当前 Connection" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  className="mt-1 border-t border-border pt-2"
                  onSelect={() => {
                    onOpenConnections();
                    close();
                  }}
                >
                  <Settings aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    管理连接…
                    {incompleteConnectionCount > 0 ? (
                      <span className="rounded-full bg-warning px-2 py-0.5 type-caption text-warning-foreground">
                        {incompleteConnectionCount} 个待完成
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </SheetContent>

      <ConfirmDialog
        open={pendingDeleteChat !== null}
        onOpenChange={(next) => !next && setPendingDeleteChat(null)}
        title="删除 Chat"
        description={
          pendingDeleteChat !== null
            ? `删除 “${pendingDeleteChat.title}” 后，其远程 Session 和历史将无法恢复。`
            : undefined
        }
        confirmLabel="删除"
        confirmVariant="destructive"
        pending={deleting}
        disabled={pendingDeleteChat === null}
        onConfirm={() => {
          if (pendingDeleteChat !== null) {
            onDeleteChat(pendingDeleteChat);
          }
          setPendingDeleteChat(null);
        }}
        onCancel={() => setPendingDeleteChat(null)}
      />
    </>
  );
}
