import { useState } from "react";
import type { BotView, ChatView, HostError } from "@shared/models";
import { Archive, Pencil, Trash2 } from "lucide-react";
import { BotAvatar } from "../ui/bot-avatar/bot-avatar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/design-system";
import { cn } from "../lib/utils";
import { chatDisplayTitle } from "../features/chats/chat-display-title";
import { CollaborationBadge } from "../ui/collaboration-badge";
import { SessionCollaborationAvatars } from "../ui/session-collaboration-avatars";
import { ChatShareAction } from "../features/chats/chat-share-action";

function formatRosterTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(
    undefined,
    sameDay ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric" },
  ).format(date);
}

export interface ChatNavigationRowProps {
  bot: BotView;
  bots?: BotView[];
  provider?: string;
  chat: ChatView;
  selected: boolean;
  /** 行交互忙碌（归档/删除进行中）时禁用 Context Menu 动作。 */
  busy: boolean;
  /** 是否显示 Bot 头像（最近/搜索显示；Bot 子树内省略，归属已由父级表达）。 */
  showAvatar: boolean;
  onOpen(bot: BotView, chat: ChatView): void;
  onEditBot(bot: BotView): void;
  onSetChatShared?(
    bot: BotView,
    chat: ChatView,
    shared: boolean,
  ): Promise<HostError | null>;
  onArchiveChat(chat: ChatView): void;
  onDeleteChat(chat: ChatView): void;
}

/**
 * 统一的 Chat 行：Chat 标题为主标题，Bot 名称与协作标记为副信息。
 * 在最近活跃、Bot 子树和搜索结果中复用；删除确认由拥有 mutation 状态的上层外壳集中处理。
 */
export function ChatNavigationRow({
  bot,
  bots = [],
  provider,
  chat,
  selected,
  busy,
  showAvatar,
  onOpen,
  onEditBot,
  onSetChatShared,
  onArchiveChat,
  onDeleteChat,
}: ChatNavigationRowProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const hasMenuActions = bot.management === "managed" || chat.keyScope === "current";
  const title = chatDisplayTitle(chat);
  const titleAlreadyContainsTime = !chat.title.trim() || chat.title.trim() === chat.ref.sessionId;
  const memberIds = chat.collaboration?.memberAgentIds ?? [];
  const memberNames = memberIds.slice(0, 3).map((id) => {
    const member = bots.find(
      (item) => item.ref.connectionId === chat.ref.connectionId && item.ref.agentId === id,
    );
    return member?.name ?? `当前列表不可见 · ${id.slice(-8)}`;
  });
  return (
    <Tooltip open={!shareOpen && tooltipOpen} onOpenChange={setTooltipOpen}>
      <ContextMenu>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild disabled={!hasMenuActions}>
            <div
              className={cn(
                "group relative flex min-h-[56px] w-full min-w-0 items-center rounded-[var(--radius-xl)] border-0 bg-transparent px-2.5 py-2 text-inherit transition-[color,background-color,border-color,box-shadow] duration-[var(--duration-fast)] hover:bg-surface-hover",
                selected && "bg-surface-selected",
              )}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-sm)] text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20"
                type="button"
                onClick={() => onOpen(bot, chat)}
                aria-current={selected ? "page" : undefined}
                aria-label={`${bot.name} · ${title}${chat.shared ? " · 已共享" : ""}${memberIds.length ? ` · 协作任务，创建时 ${memberIds.length} 位成员` : ""}`}
                data-chat-navigation-row="true"
              >
                {showAvatar ? (
                  chat.collaboration?.memberAgentIds.length ? (
                    <SessionCollaborationAvatars
                      botName={bot.name}
                      botRef={bot.ref}
                      roster={chat.collaboration}
                      bots={bots}
                      provider={provider}
                    />
                  ) : <BotAvatar name={bot.name} botRef={bot.ref} decorative />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <strong className="min-w-0 flex-1 line-clamp-2 break-words type-control font-normal">
                      {title}
                    </strong>
                    {chat.updatedAt && !titleAlreadyContainsTime ? (
                      <time className="mt-px shrink-0 type-caption text-muted-foreground">
                        {formatRosterTime(chat.updatedAt)}
                      </time>
                    ) : null}
                  </span>
                  <span className="mt-px flex min-w-0 items-center gap-1.5 truncate type-supporting text-muted-foreground">
                    <span className="truncate">{bot.name}</span>
                    <CollaborationBadge roster={chat.collaboration} label="协作任务" />
                    {chat.shared ? (
                      <span className="shrink-0 rounded-[var(--radius-sm)] bg-surface-subtle px-1 py-0.5 type-caption text-muted-foreground"
                        title={chat.keyScope === "other" ? "他人共享，你可以查看并继续任务" : "团队可查看并继续此任务"}>
                        已共享
                      </span>
                    ) : null}
                    {chat.keyScope === "ungrouped" ? (
                      <span className="shrink-0">未分组历史</span>
                    ) : null}
                  </span>
                </span>
              </button>
              {(provider === "bailian" || provider === "qoder") &&
              chat.keyScope === "current" &&
              onSetChatShared ? (
                <ChatShareAction
                  chat={chat}
                  disabled={busy}
                  onOpenChange={(open) => { setShareOpen(open); setTooltipOpen(false); }}
                  onSetShared={(source, shared) => onSetChatShared(bot, source, shared)}
                />
              ) : null}
            </div>
          </ContextMenuTrigger>
        </TooltipTrigger>
        <ContextMenuContent>
          {bot.management === "managed" ? (
            <ContextMenuItem onSelect={() => onEditBot(bot)} disabled={busy}>
              <Pencil aria-hidden="true" />
              编辑 Bot 配置
            </ContextMenuItem>
          ) : null}
          {chat.keyScope === "current" ? (
            <>
              <ContextMenuItem onSelect={() => onArchiveChat(chat)} disabled={busy}>
                <Archive aria-hidden="true" />
                归档
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => onDeleteChat(chat)}
                disabled={busy}
                className="text-destructive data-[highlighted]:text-destructive"
              >
                <Trash2 aria-hidden="true" />
                删除
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
      <TooltipContent
        side="top"
        align="start"
        sideOffset={4}
        className="max-w-[320px] whitespace-normal break-words px-3 py-2"
      >
        <span className="block font-medium">{title}</span>
        <span className="mt-1 block opacity-80">所属 Bot：{bot.name}</span>
        {chat.shared ? <span className="mt-1 block opacity-80">{chat.keyScope === "other" ? "他人共享，你可以查看并继续任务" : "团队可查看并继续此任务"}</span> : null}
        {memberIds.length ? (
          <span className="mt-1 block opacity-80">
            创建时协作成员 {memberIds.length} 位：{memberNames.join("、")}
            {memberIds.length > 3 ? " 等" : ""}
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
