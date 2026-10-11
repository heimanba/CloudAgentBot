import { useMemo, useState } from "react";
import type { BotView, ChatView } from "@shared/models";
import { ArrowLeft, CalendarClock, Copy, LayoutTemplate, List, Plus, Search, Settings2 } from "lucide-react";
import type { UseChatRosterResult } from "../features/chats/use-chat-roster";
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Input } from "../ui/design-system";
import { cn } from "../lib/utils";
import { chatKey, deriveWorkspaceNavigationModel } from "./chat-navigation-model";
import { ChatNavigationRow } from "./chat-navigation-row";
import { BotAvatar } from "../ui/bot-avatar/bot-avatar";
import { deriveCollaborationNavigation, type CollaborationGroupRow } from "./collaboration-navigation-model";
import { supportsDeployments } from "../features/deployments/deployment-support";

export type WorkspaceArea = "chats" | "bots" | "deployments";

const SKELETON_WIDTHS = ["w-2/3", "w-3/5", "w-1/2", "w-2/5", "w-1/3"] as const;

function RosterSkeleton() {
  return (
    <div className="grid gap-1 px-1" aria-hidden="true" data-testid="roster-skeleton">
      {SKELETON_WIDTHS.map((width, index) => (
        <div key={index} className="flex min-h-[52px] items-center gap-3 px-2.5 py-2">
          <span className="size-[32px] shrink-0 animate-pulse rounded-full bg-surface-subtle" />
          <span
            className={cn(
              "h-[12px] animate-pulse rounded-[var(--radius-sm)] bg-surface-subtle",
              width,
            )}
          />
        </div>
      ))}
    </div>
  );
}

export interface ChatNavigationContentProps {
  area: WorkspaceArea;
  provider?: string;
  bots: BotView[];
  botsLoading: boolean;
  chatRoster: UseChatRosterResult;
  selectedBot: BotView | null;
  justCreatedBot?: boolean;
  selectedChat: ChatView | null;
  allChatsSelected: boolean;
  searchQuery: string;
  busy: boolean;
  onAreaChange(area: WorkspaceArea): void;
  onOpenBotList(): void;
  onOpenTeamTemplates(): void;
  onOpenDeployments(): void;
  onSearchQueryChange(value: string): void;
  onOpenChat(bot: BotView, chat: ChatView): void;
  onOpenBot(bot: BotView): void;
  onEditBot(bot: BotView): void;
  onSetChatShared?: Parameters<typeof ChatNavigationRow>[0]["onSetChatShared"];
  onArchiveChat(chat: ChatView): void;
  onDeleteChat(chat: ChatView): void;
  onCreateChat(bot: BotView): void;
  onOpenAllChats(): void;
  onCreateBot(): void;
}

export function ChatNavigationContent(props: ChatNavigationContentProps) {
  const {
    area,
    provider,
    bots,
    botsLoading,
    chatRoster,
    selectedChat,
    allChatsSelected,
    searchQuery,
    busy,
    onAreaChange,
    onOpenBotList,
    onOpenTeamTemplates,
    onOpenDeployments,
    onCreateBot,
    onSearchQueryChange,
    onOpenChat,
    onEditBot,
    onSetChatShared,
    onArchiveChat,
    onDeleteChat,
    onOpenAllChats,
  } = props;
  const model = useMemo(
    () =>
      deriveWorkspaceNavigationModel({
        bots,
        items: chatRoster.items,
        botStatusByKey: chatRoster.botStatusByKey,
        chatQuery: area !== "bots" ? searchQuery : "",
        botQuery: area === "bots" ? searchQuery : "",
      }),
    [area, bots, chatRoster.items, chatRoster.botStatusByKey, searchQuery],
  );
  const searching = searchQuery.trim() !== "";
  const collaboration = useMemo(() => deriveCollaborationNavigation(bots), [bots]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const showSkeleton =
    (botsLoading || chatRoster.loading) &&
    model.allChats.length === 0 &&
    model.botRows.length === 0;

  const changeArea = (next: WorkspaceArea) => {
    onSearchQueryChange("");
    onAreaChange(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {area === "bots" ? (
        <Button
          variant="ghost"
          className="mx-3 mb-2 justify-start"
          onClick={() => changeArea("chats")}
        >
          <ArrowLeft className="size-[14px]" aria-hidden="true" />
          返回任务
        </Button>
      ) : null}
      {area !== "bots" ? <div className="grid gap-2 px-4 pb-3.5">
        <div className="flex h-[var(--control-md)] items-center gap-2 rounded-[var(--radius-md)] border border-transparent bg-surface-subtle px-3 text-muted-foreground focus-within:border-border focus-within:bg-card">
          <Search className="size-[14px] shrink-0" aria-hidden="true" />
          <Input
            variant="bare"
            className="min-w-0"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="搜索任务"
            aria-label="搜索任务"
          />
        </div>
      </div> : null}

      <nav
        className="flex-1 overflow-y-auto px-2 pb-4"
        aria-label={area !== "bots" ? "任务导航" : "Bots 导航"}
      >
        {area !== "bots" && showSkeleton ? <RosterSkeleton /> : null}
        {area !== "bots" ? (
          <ChatsMode
            bots={bots}
            provider={provider}
            items={searching ? model.chatSearchResults : model.recentChats}
            searching={searching}
            selectedChat={selectedChat}
            allChatsSelected={allChatsSelected}
                        busy={busy}
            onOpenChat={onOpenChat}
            onEditBot={onEditBot}
            onSetChatShared={onSetChatShared}
            onArchiveChat={onArchiveChat}
            onDeleteChat={onDeleteChat}
            onOpenAllChats={onOpenAllChats}
          />
        ) : (
          <section aria-label="Bots 导航" className="px-2 pt-2">
            {collaboration.groups.length > 0 ? (
              <div>
                <div className="px-3 pb-2 type-caption text-muted-foreground">协作组 · {collaboration.groups.length}</div>
                {collaboration.groups.map((group) => {
                  const key = `${group.coordinator.ref.connectionId}/${group.coordinator.ref.agentId}`;
                  return (
                    <CollaborationGroup
                      key={key}
                      group={group}
                      open={expandedGroups[key] ?? collaboration.groups.length === 1}
                      onOpenChange={(open) => setExpandedGroups((current) => ({ ...current, [key]: open }))}
                      onEditBot={onEditBot}
                    />
                  );
                })}
              </div>
            ) : null}
            <div className="mt-5 flex items-center justify-between px-3 pb-2">
              <span className="type-caption text-muted-foreground">独立助手 · {collaboration.standaloneManagedBots.length}</span>
              <Button size="icon" variant="ghost" className="size-7" aria-label="新建 Bot" onClick={onCreateBot}>
                <Plus className="size-[14px]" aria-hidden="true" />
              </Button>
            </div>
            {collaboration.standaloneManagedBots.map((bot) => (
              <button
                key={bot.ref.agentId}
                type="button"
                className="flex min-h-14 w-full items-center gap-2.5 rounded-[var(--radius-lg)] px-2.5 text-left hover:bg-surface-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20"
                onClick={() => onEditBot(bot)}
                aria-label={`编辑 ${bot.name} 的配置`}
              >
                <BotAvatar name={bot.name} botRef={bot.ref} size="compact" decorative />
                <BotNavLabel bot={bot} />
              </button>
            ))}
          </section>
        )}
        {chatRoster.refreshing ? (
          <p className="mx-3 type-caption text-muted-foreground">正在刷新…</p>
        ) : null}
        {chatRoster.error ? (
          <Button
            variant="secondary"
            size="sm"
            className="mx-2 my-2 w-[calc(100%-16px)]"
            onClick={chatRoster.reload}
          >
            部分 Chat 未加载 · 重试
          </Button>
        ) : null}
      </nav>
      {area === "bots" ? (
        <div className="border-t border-border px-3 pb-2 pt-2">
          <Button variant="ghost" className="w-full justify-start font-normal text-muted-foreground" onClick={onOpenBotList}>
            <List className="size-[14px]" aria-hidden="true" />
            管理助手
          </Button>
          {supportsDeployments(provider) ? (
            <Button
              variant="ghost"
              className="w-full justify-start font-normal text-muted-foreground"
              onClick={onOpenDeployments}
            >
              <CalendarClock className="size-[14px]" aria-hidden="true" />
              定时任务
            </Button>
          ) : null}
        </div>
      ) : null}
      {area !== "bots" ? (
        <div className="grid border-t border-border px-3 pb-2 pt-2">
          <Button variant="ghost" className="justify-start font-normal text-muted-foreground" onClick={() => changeArea("bots")}>
            <Settings2 className="size-[14px]" aria-hidden="true" />
            管理助手
          </Button>
          <Button variant="ghost" className="justify-start font-normal text-muted-foreground" onClick={onOpenTeamTemplates}>
            <LayoutTemplate className="size-[14px]" aria-hidden="true" />
            协作模板
          </Button>
          {supportsDeployments(provider) ? (
            <Button
              variant="ghost"
              className={cn(
                "justify-start font-normal",
                area === "deployments" ? "bg-secondary text-foreground" : "text-muted-foreground",
              )}
              onClick={onOpenDeployments}
              aria-current={area === "deployments" ? "page" : undefined}
            >
              <CalendarClock className="size-[14px]" aria-hidden="true" />
              定时任务
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BotNavLabel({ bot }: { bot: BotView }) {
  return (
    <span className="grid min-w-0 flex-1 gap-0.5">
      <strong className="truncate type-supporting font-medium">{bot.name}</strong>
      <span className="truncate type-caption text-muted-foreground">{bot.description || (bot.management === "managed" ? "本机管理" : "仅远程")}</span>
    </span>
  );
}

function CollaborationGroup({ group, open, onOpenChange, onEditBot }: {
  group: CollaborationGroupRow;
  open: boolean;
  onOpenChange(open: boolean): void;
  onEditBot(bot: BotView): void;
}) {
  const coordinator = group.coordinator;
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="flex items-center rounded-[var(--radius-lg)] hover:bg-surface-hover">
        <CollapsibleTrigger className="w-auto shrink-0 px-2 py-2" aria-label={`${open ? "收起" : "展开"} ${coordinator.name} 的协作成员`} />
        <button type="button" className="flex min-h-14 min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20" onClick={() => onEditBot(coordinator)} aria-label={`编辑 ${coordinator.name} 的配置`}>
          <BotAvatar name={coordinator.name} botRef={coordinator.ref} size="compact" decorative />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <strong className="truncate type-supporting font-medium">{coordinator.name}</strong>
            <span className="truncate type-caption text-muted-foreground">协调者 · {group.members.length} 位成员</span>
          </span>
        </button>
      </div>
      <CollapsibleContent className="ml-5 border-l border-border pl-2">
        {group.members.map(({ bot, agentId }) => bot ? (
          <div key={agentId} className="flex items-center rounded-[var(--radius-lg)] hover:bg-surface-hover">
            <button type="button" className="flex min-h-14 min-w-0 flex-1 items-center gap-2.5 px-2 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20" onClick={() => onEditBot(bot)} aria-label={`${bot.management === "remote-only" ? "在控制台配置" : "编辑"} ${bot.name}`}>
              <BotAvatar name={bot.name} botRef={bot.ref} size="compact" decorative />
              <span className="grid min-w-0 flex-1 gap-0.5"><span className="flex min-w-0 items-center gap-1"><strong className="min-w-0 truncate type-supporting font-medium">{bot.name}</strong><span className="shrink-0 rounded-[var(--radius-sm)] bg-surface-subtle px-1 type-caption text-muted-foreground">{bot.management === "managed" ? "本机" : bot.management === "remote-only" ? "远程" : "需恢复"}</span></span><span className="truncate type-caption text-muted-foreground">{bot.description || "无职责描述"}</span></span>
            </button>
          </div>
        ) : (
          <div key={agentId} className="flex min-h-12 items-center gap-2 px-2 type-caption text-muted-foreground">
            <span className="min-w-0 flex-1 truncate" title={agentId}>当前列表不可见 · ID 尾号 {agentId.slice(-8)}</span>
            <Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label={`复制不可见成员的远程 ID ${agentId}`} onClick={() => void navigator.clipboard.writeText(agentId)}><Copy className="size-[14px]" aria-hidden="true" /></Button>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ChatsMode({
  bots,
  provider,
  items,
  searching,
  selectedChat,
  allChatsSelected,
  busy,
  onOpenChat,
  onEditBot,
  onSetChatShared,
  onArchiveChat,
  onDeleteChat,
  onOpenAllChats,
}: {
  bots: BotView[];
  provider?: string;
  items: UseChatRosterResult["items"];
  searching: boolean;
  selectedChat: ChatView | null;
  allChatsSelected: boolean;
  busy: boolean;
  onOpenChat(bot: BotView, chat: ChatView): void;
  onEditBot(bot: BotView): void;
  onSetChatShared?: Parameters<typeof ChatNavigationRow>[0]["onSetChatShared"];
  onArchiveChat(chat: ChatView): void;
  onDeleteChat(chat: ChatView): void;
  onOpenAllChats(): void;
}) {
  return (
    <section aria-label={searching ? "任务搜索结果" : "最近任务"}>
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <span className="type-caption font-normal text-muted-foreground">
          {searching ? "搜索结果" : "最近任务"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="px-2 type-caption font-normal text-muted-foreground"
          aria-label="查看全部任务"
          aria-current={allChatsSelected ? "page" : undefined}
          onClick={onOpenAllChats}
        >
          查看全部
        </Button>
      </div>
      {items.map(({ bot, chat }) => (
        <ChatNavigationRow
          key={chatKey(chat.ref)}
          bot={bot}
          bots={bots}
          provider={provider}
          chat={chat}
          selected={selectedChat !== null && chatKey(selectedChat.ref) === chatKey(chat.ref)}
          busy={busy}
          showAvatar
          onOpen={onOpenChat}
          onEditBot={onEditBot}
          onSetChatShared={onSetChatShared}
          onArchiveChat={onArchiveChat}
          onDeleteChat={onDeleteChat}
        />
      ))}
      {items.length === 0 ? (
        <p className="mx-3 my-8 text-center type-supporting text-muted-foreground">
          {searching ? "没有匹配的任务" : "还没有任务"}
        </p>
      ) : null}

    </section>
  );
}
