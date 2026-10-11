import { useState } from "react";
import type { BotView, ChatView, ConnectionId, ConnectionView } from "@shared/models";
import { Check, ChevronsUpDown, Plus, Settings } from "lucide-react";
import type { UseChatRosterResult } from "../features/chats/use-chat-roster";
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/design-system";
import { getProviderDisplayName, ProviderBadge } from "../ui/provider-brand/provider-brand";
import { ChatNavigationContent } from "./chat-navigation-content";
import type { WorkspaceArea } from "./chat-navigation-content";

export interface AppSidebarProps {
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
  /** 当前 Connection 的完整 Bot 列表；供任务历史与协作关系解析使用，不代表工作区助手数量。 */
  bots: BotView[];
  /** Bot 列表查询进行中：此时 roster 的空态没有意义，必须抑制，避免切换 Connection 时闪"还没有 Chat"。 */
  botsLoading: boolean;
  chatRoster: UseChatRosterResult;
  searchQuery: string;
  archiving: boolean;
  deleting: boolean;
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
  onOpenBotList(): void;
  onOpenTeamTemplates(): void;
  onOpenDeployments(): void;
  onOpenNewChat(): void;
  onOpenAllChats(): void;
  onCreateBot(): void;
  onOpenConnections(): void;
}

export function AppSidebar({
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
  onOpenBotList,
  onOpenTeamTemplates,
  onOpenDeployments,
  onOpenNewChat,
  onOpenAllChats,
  onCreateBot,
  onOpenConnections,
}: AppSidebarProps) {
  const [pendingDeleteRosterChat, setPendingDeleteRosterChat] = useState<ChatView | null>(null);
  const anyBusy = archiving || deleting;

  return (
    <aside
      className="flex h-full min-w-0 flex-col overflow-hidden border-r border-border bg-surface max-md:hidden"
      aria-label="工作区导航"
    >
      <div className="app-sidebar-titlebar flex min-h-[42px] items-center justify-end py-[5px] pl-[18px] pr-[14px]">
        <button className="sr-only" type="button" onClick={onOpenBotList}>
          返回 Bot 列表
        </button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="新任务"
          title="新任务"
          onClick={onOpenNewChat}
        >
          <Plus className="size-[14px]" aria-hidden="true" />
        </Button>
      </div>
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
        onOpenBotList={onOpenBotList}
        onOpenTeamTemplates={onOpenTeamTemplates}
        onOpenDeployments={onOpenDeployments}
        onSearchQueryChange={onSearchQueryChange}
        onOpenChat={onOpenChat}
        onOpenBot={onOpenBot}
        onEditBot={onEditBot}
        onSetChatShared={onSetChatShared}
        onArchiveChat={onArchiveChat}
        onDeleteChat={setPendingDeleteRosterChat}
        onCreateChat={onCreateChat}
        onOpenAllChats={onOpenAllChats}
        onCreateBot={onCreateBot}
      />
      <div className="min-h-[68px] px-3 pb-2.5 pt-[7px]">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-[var(--radius-lg)] border-0 bg-transparent px-1 py-1.5 text-left text-inherit transition-[background-color,box-shadow] duration-[var(--duration-fast)] hover:bg-surface-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20"
              type="button"
              aria-label={`切换 Connection，当前：${activeConnection?.displayName || "CloudAgentBot"}，Provider：${activeProviderName}`}
            >
              <span className="relative grid size-[38px] shrink-0 place-items-center rounded-full bg-muted type-control font-semibold text-muted-foreground">
                <span aria-hidden="true">
                  {Array.from(activeConnection?.displayName || "CloudAgentBot")[0]?.toUpperCase()}
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
                onSelect={() => onSelectConnection(connection.id)}
              >
                <ProviderBadge provider={connection.provider} />
                <span className="grid min-w-0 flex-1 gap-px">
                  <strong className="truncate font-medium">{connection.displayName}</strong>
                  <small className="truncate type-caption text-muted-foreground">
                    {getProviderDisplayName(connection.provider)} ·{" "}
                    {connection.credentialStored
                      ? connection.environmentReady
                        ? "可用于创建"
                        : "需要设置运行环境"
                      : "凭据已断开"}
                  </small>
                </span>
                {connection.id === selectedConnectionId ? (
                  <Check aria-label="当前 Connection" />
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              className="mt-1 border-t border-border pt-2"
              onSelect={onOpenConnections}
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

      <ConfirmDialog
        open={pendingDeleteRosterChat !== null}
        onOpenChange={(open) => !open && setPendingDeleteRosterChat(null)}
        title="删除 Chat"
        description={
          pendingDeleteRosterChat !== null
            ? `删除 “${pendingDeleteRosterChat.title}” 后，其远程 Session 和历史将无法恢复。`
            : undefined
        }
        confirmLabel="删除"
        confirmVariant="destructive"
        pending={deleting}
        disabled={pendingDeleteRosterChat === null}
        onConfirm={() => {
          if (pendingDeleteRosterChat !== null) {
            onDeleteChat(pendingDeleteRosterChat);
          }
          setPendingDeleteRosterChat(null);
        }}
        onCancel={() => setPendingDeleteRosterChat(null)}
      />
    </aside>
  );
}
