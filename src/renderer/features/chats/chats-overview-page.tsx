import { useMemo, useState } from "react";
import type { BotView, ChatView, HostError } from "@shared/models";
import { MessageSquare, Plus, Search } from "lucide-react";
import type { UseChatRosterResult } from "./use-chat-roster";
import { compareChatItems } from "../../shell/chat-navigation-model";
import { ChatNavigationRow } from "../../shell/chat-navigation-row";
import { Alert, Button, ConfirmDialog, Input, RefreshAction } from "../../ui/design-system";
import { chatDisplayTitle } from "./chat-display-title";

const RECENT_GROUP_SIZE = 8;
const PAGE_SIZE = 50;

function ChatsOverviewSkeleton() {
  return (
    <div
      className="mx-auto grid w-full min-w-0 max-w-[704px] gap-1"
      aria-label="正在加载全部 Chats"
      role="status"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex min-h-[56px] items-center gap-3 px-2.5 py-2">
          <span className="size-[32px] shrink-0 animate-pulse rounded-full bg-surface-subtle" />
          <span className="grid flex-1 gap-2">
            <span className="h-3 w-2/3 animate-pulse rounded-[var(--radius-sm)] bg-surface-subtle" />
            <span className="h-3 w-1/3 animate-pulse rounded-[var(--radius-sm)] bg-surface-subtle" />
          </span>
        </div>
      ))}
      <span className="sr-only">正在加载 Chats…</span>
    </div>
  );
}

export interface ChatsOverviewPageProps {
  bots?: BotView[];
  provider?: string;
  roster: UseChatRosterResult;
  archiving: boolean;
  deleting: boolean;
  archiveError: HostError | null;
  deleteError: HostError | null;
  onOpenNewChat(): void;
  onOpenChat: Parameters<typeof ChatNavigationRow>[0]["onOpen"];
  onEditBot: Parameters<typeof ChatNavigationRow>[0]["onEditBot"];
  onArchiveChat(chat: ChatView): void;
  onDeleteChat(chat: ChatView): void;
}

export function ChatsOverviewPage({
  bots = [],
  provider,
  roster,
  archiving,
  deleting,
  archiveError,
  deleteError,
  onOpenNewChat,
  onOpenChat,
  onEditBot,
  onArchiveChat,
  onDeleteChat,
}: ChatsOverviewPageProps) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [pendingDelete, setPendingDelete] = useState<ChatView | null>(null);
  const normalized = query.trim().toLocaleLowerCase();
  const items = useMemo(
    () =>
      [...roster.items]
        .sort(compareChatItems)
        .filter(
          ({ bot, chat }) =>
            normalized === "" ||
            `${chatDisplayTitle(chat)} ${bot.name}`.toLocaleLowerCase().includes(normalized),
        ),
    [normalized, roster.items],
  );
  const busy = archiving || deleting;
  const visibleItems = items.slice(0, visibleCount);
  const recentItems = normalized === "" ? visibleItems.slice(0, RECENT_GROUP_SIZE) : visibleItems;
  const earlierItems = normalized === "" ? visibleItems.slice(RECENT_GROUP_SIZE) : [];
  const remainingCount = Math.max(0, items.length - visibleItems.length);
  const countLabel =
    roster.loading && roster.items.length === 0 ? "正在加载" : `${items.length} 个`;
  const rosterInProgress = roster.loading || roster.refreshing;

  const renderRows = (rows: typeof items) =>
    rows.map(({ bot, chat }) => (
      <ChatNavigationRow
        key={`${chat.ref.connectionId}/${chat.ref.agentId}/${chat.ref.sessionId}`}
        bot={bot}
        bots={bots}
        provider={provider}
        chat={chat}
        selected={false}
        busy={busy}
        showAvatar
        onOpen={onOpenChat}
        onEditBot={onEditBot}
        onArchiveChat={onArchiveChat}
        onDeleteChat={setPendingDelete}
      />
    ));

  return (
    <section
      className="flex h-full flex-col overflow-hidden bg-surface-raised"
      aria-labelledby="chats-overview-title"
    >
      <header className="app-chat-topbar flex min-h-[64px] shrink-0 items-center justify-between gap-4 border-b border-border px-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <h1 id="chats-overview-title" className="m-0 shrink-0 type-control font-semibold">
            全部任务
          </h1>
          <span className="shrink-0 type-supporting font-medium text-muted-foreground">{countLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <RefreshAction
            label="刷新 Chats"
            refreshing={roster.refreshing || roster.loading}
            onRefresh={roster.reload}
          />
          <Button size="sm" onClick={onOpenNewChat}>
            <Plus className="size-[14px]" aria-hidden="true" />
            新任务
          </Button>
        </div>
      </header>
      <div
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-6 sm:px-8"
        data-testid="chats-overview-scroll-region"
        onScroll={(event) => {
          const { clientHeight, scrollHeight, scrollTop } = event.currentTarget;
          if (remainingCount > 0 && scrollHeight - scrollTop - clientHeight < 240) {
            setVisibleCount((count) => Math.min(items.length, count + PAGE_SIZE));
          }
        }}
      >
        <label className="mx-auto mb-5 flex h-[var(--control-md)] w-full min-w-0 max-w-[704px] items-center gap-2 rounded-[var(--radius-md)] border border-border bg-card px-3 text-muted-foreground">
          <Search className="size-[14px]" aria-hidden="true" />
          <Input
            variant="bare"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            placeholder="搜索任务或助手"
            aria-label="搜索全部 Chats"
          />
        </label>
        {roster.loading && roster.items.length === 0 ? <ChatsOverviewSkeleton /> : null}
        {rosterInProgress ? (
          <p
            className="mx-auto mb-4 w-full min-w-0 max-w-[704px] type-supporting text-muted-foreground"
            role="status"
          >
            正在加载任务：{roster.progress.completedBots} / {roster.progress.totalBots}
            {roster.progress.failedBots > 0 ? ` · ${roster.progress.failedBots} 个失败` : ""}
            {roster.items.length > 0 ? ` · 已发现 ${roster.items.length} 个任务` : ""}
          </p>
        ) : null}
        {!roster.loading && items.length === 0 ? (
          <div className="mx-auto grid min-h-[320px] max-w-[520px] place-items-center text-center text-muted-foreground">
            <div>
              <MessageSquare className="mx-auto mb-3 size-8" aria-hidden="true" />
              <p>{normalized ? "没有匹配的任务" : "还没有任务"}</p>
              {!normalized ? <Button onClick={onOpenNewChat}>新任务</Button> : null}
            </div>
          </div>
        ) : null}
        {items.length > 0 ? (
          <div className="mx-auto grid w-full min-w-0 max-w-[704px] gap-5" aria-label="全部 Chats">
            <section className="min-w-0" aria-labelledby="recent-chats-heading">
              <div className="mb-1 flex items-center justify-between px-2.5">
                <h2
                  id="recent-chats-heading"
                  className="m-0 type-caption font-semibold text-muted-foreground"
                >
                  {normalized ? "搜索结果" : "最近任务"}
                </h2>
                <span className="type-caption text-muted-foreground">按最近活动排序</span>
              </div>
              <div className="grid min-w-0 gap-1">{renderRows(recentItems)}</div>
            </section>
            {earlierItems.length > 0 ? (
              <section className="min-w-0" aria-labelledby="earlier-chats-heading">
                <div className="mb-1 flex items-center justify-between px-2.5">
                  <h2
                    id="earlier-chats-heading"
                    className="m-0 type-caption font-semibold text-muted-foreground"
                  >
                    更早的任务
                  </h2>
                  <span className="type-caption tabular-nums text-muted-foreground">
                    {earlierItems.length} 个
                  </span>
                </div>
                <div className="grid min-w-0 gap-1">{renderRows(earlierItems)}</div>
              </section>
            ) : null}
            {remainingCount > 0 ? (
              <div className="grid justify-items-center gap-1 border-t border-border pt-4">
                <span className="type-caption text-muted-foreground" aria-live="polite">
                  已显示 {visibleItems.length} / {items.length} · 继续向下滚动
                </span>
              </div>
            ) : items.length > PAGE_SIZE ? (
              <div className="pt-4 text-center">
                <span className="type-caption text-muted-foreground" aria-live="polite">
                  已显示全部 {items.length} 个任务
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
        {roster.error ? (
          <Alert variant="destructive" title="部分 Chat 未加载">
            请重试以补齐远程 Chat。
          </Alert>
        ) : null}
        {archiveError ? (
          <Alert variant="destructive" title="归档失败">
            请稍后重试。
          </Alert>
        ) : null}
        {deleteError ? (
          <Alert variant="destructive" title="删除失败">
            请稍后重试。
          </Alert>
        ) : null}
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="删除 Chat"
        description={
          pendingDelete
            ? `删除“${pendingDelete.title}”后，其远程 Session 和历史将无法恢复。`
            : undefined
        }
        confirmLabel="删除"
        confirmVariant="destructive"
        pending={deleting}
        onConfirm={() => {
          if (pendingDelete) onDeleteChat(pendingDelete);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
