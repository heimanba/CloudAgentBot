import { useState } from "react";
import type { BotRef, BotView, ChatView, HostError } from "@shared/models";
import {
  Alert,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  RefreshAction,
  typography,
} from "../../ui/design-system";
import { BotAvatar } from "../../ui/bot-avatar/bot-avatar";
import { getProviderDisplayName, ProviderBadge } from "../../ui/provider-brand/provider-brand";
import { Archive, ArrowLeft, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { chatDisplayTitle } from "./chat-display-title";
import { CollaborationBadge } from "../../ui/collaboration-badge";
import { CollaborationCoordinators, CollaborationMembers, coordinatorsForMember } from "../../ui/collaboration-members";
import { BotShareAction } from "../bots/bot-share-action";
import { useBotConfiguration } from "../bots/use-bot-configuration";
import { DeploymentSection } from "../deployments/deployment-section";

function errorText(error: HostError): string {
  switch (error.code) {
    case "not-connected":
      return "凭据已断开，请重新连接。";
    case "authentication":
      return "凭据无效，请到「管理连接」更新凭证。";
    case "unavailable":
      return "服务暂时不可用，请稍后重试。";
    case "conflict":
      return "此连接尚未设置运行环境，请到连接设置中完成配置。";
    default:
      return "加载失败。";
  }
}

function formatUpdatedAt(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export interface ChatsPageProps {
  botName: string;
  bot?: BotView;
  bots?: BotView[];
  justCreated?: boolean;
  botRef?: BotRef;
  provider?: string;
  chats: ChatView[];
  loading: boolean;
  error: HostError | null;
  creating: boolean;
  createError: HostError | null;
  archiving: boolean;
  archiveError: HostError | null;
  deleting: boolean;
  deleteError: HostError | null;
  onReload(): void;
  botsLoading?: boolean;
  botsError?: HostError | null;
  onOpenChat(chat: ChatView): void;
  onCreateChat(): void;
  onCompleteSetup?(): void;
  onArchiveChat(chat: ChatView): void;
  onDeleteChat(chat: ChatView): void;
  onEditBot?(): void;
  onSetShared?(shared: boolean): Promise<HostError | null>;
  onOpenBot?(bot: BotView): void;
  onBack(): void;
  /** 凭据变更时自增，定时任务区块据此丢弃旧 Key 范围数据并重读。 */
  deploymentsEpoch?: number;
}

/** 一个 Bot 下的 Chat 列表：浏览远程 Session，并可新建 Chat。 */
export function ChatsPage({
  botName,
  bot,
  bots = [],
  justCreated = false,
  botRef,
  provider,
  chats,
  loading,
  error,
  creating,
  createError,
  archiving,
  archiveError,
  deleting,
  deleteError,
  onReload,
  botsLoading = false,
  botsError = null,
  onOpenChat,
  onCreateChat,
  onCompleteSetup,
  onArchiveChat,
  onDeleteChat,
  onEditBot,
  onSetShared,
  onOpenBot,
  onBack,
  deploymentsEpoch = 0,
}: ChatsPageProps) {
  const [pendingDelete, setPendingDelete] = useState<ChatView | null>(null);
  const anyBusy = archiving || deleting;
  const configuration = useBotConfiguration(bot?.management === "managed" ? bot.ref : null);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="app-chat-topbar flex h-[60px] shrink-0 items-center gap-2 border-b border-border px-[18px]">
        <Button
          size="icon"
          variant="ghost"
          className="max-md:size-[44px]"
          aria-label="返回 Bot 列表"
          onClick={onBack}
        >
          <ArrowLeft className="size-[14px]" />
        </Button>
        <span className="relative shrink-0">
          <BotAvatar name={botName} botRef={botRef} size="compact" decorative />
          <ProviderBadge
            provider={provider}
            className="pointer-events-none absolute -right-1 -bottom-1 size-[14px]"
          />
        </span>
        <strong className="min-w-0 flex-1 truncate type-control font-semibold">
          {botName}
          {provider ? (
            <span className="sr-only">，Provider：{getProviderDisplayName(provider)}</span>
          ) : null}
        </strong>
        <CollaborationBadge roster={bot?.collaboration} />
        <div className="flex shrink-0 items-center gap-1">
          {bot?.management === "managed" && onSetShared ? (
            <BotShareAction disabled={botsLoading || botsError !== null} bot={bot} onSetShared={(_ref, shared) => onSetShared(shared)} />
          ) : null}
          {onEditBot ? (
            <Button
              size="icon"
              variant="ghost"
              className="max-md:size-[44px]"
              aria-label="编辑 Bot 配置"
              onClick={onEditBot}
            >
              <Pencil className="size-[14px]" aria-hidden="true" />
            </Button>
          ) : null}
          <RefreshAction label="刷新助手和任务" refreshing={loading || botsLoading} onRefresh={onReload} />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto bg-background px-5 py-7 sm:px-8">
        {botsError ? (
          <div className="mx-auto flex max-w-[672px] items-start gap-2.5">
            <Alert variant="destructive" title="助手列表未更新">
              {botsError.message}
              <span className="block">{errorText(botsError)}</span>
            </Alert>
            <Button size="sm" variant="outline" onClick={onReload}>
              重试
            </Button>
          </div>
        ) : null}
        {bot?.description?.trim() ? <p className="mx-auto mb-3 max-w-[672px] break-words type-supporting text-muted-foreground">{bot.description}</p> : null}
        {configuration.config?.hasPendingChanges ? (
          <div className="mx-auto mb-3 max-w-[704px] rounded-[var(--radius-lg)] border border-border bg-card px-3 py-2 type-supporting text-muted-foreground">
            本地协作配置待同步；当前远程配置仍以列表事实为准。
            {configuration.config.memberAgentIds.length > 0 ? (
              <ul className="mt-1 list-none space-y-1 pl-0">
                {configuration.config.memberAgentIds.map((id) => (
                  <li key={id}>{bots.find((entry) => entry.ref.agentId === id && entry.ref.connectionId === bot?.ref.connectionId)?.name ?? `当前列表不可见 · ${id.slice(-8)}`}</li>
                ))}
              </ul>
            ) : <span> 待同步后将清空协作成员。</span>}
          </div>
        ) : null}
        {bot?.collaboration?.memberAgentIds.length ? (
          <div className="mx-auto mb-5 max-w-[704px]">
            <CollaborationMembers roster={bot.collaboration} bots={bots} connectionId={bot.ref.connectionId} onOpenBot={onOpenBot} />
          </div>
        ) : null}
        {bot && coordinatorsForMember(bot, bots).length > 0 ? (
          <div className="mx-auto mb-5 max-w-[704px]">
            <CollaborationCoordinators member={bot} bots={bots} onOpenBot={onOpenBot} />
          </div>
        ) : null}
        {loading && chats.length === 0 ? (
          <p className={typography.body} role="status">
            加载中…
          </p>
        ) : null}
        {!loading && chats.length === 0 ? (
          <div className="mx-auto flex min-h-[360px] max-w-[504px] flex-col items-center justify-center py-12 text-center motion-safe:animate-[surface-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]">
            <BotAvatar name={botName} botRef={botRef} size="hero" />
            <h1 className="mt-4 mb-0 break-words type-page-title">
              {justCreated ? `${botName} 已创建` : `使用 ${botName} 开始任务`}
            </h1>
            <p className="mt-1.5 mb-5 max-w-[390px] type-body text-muted-foreground">
              {justCreated
                ? "现在可以开始任务，也可以先完善工作指令和能力配置。"
                : bot?.collaboration?.memberAgentIds.length
                  ? `任务由 ${botName} 处理，并可按需委派给协作成员。`
                  : `任务由 ${botName} 处理。每个任务都有独立的上下文和消息历史。`}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => onCreateChat()} pending={creating}>
                {creating ? "创建中…" : "开始任务"}
              </Button>
              {justCreated && onCompleteSetup ? (
                <Button variant="secondary" onClick={onCompleteSetup} disabled={creating}>
                  完善配置
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {chats.length > 0 ? (
          <>
            <div className="mx-auto mb-5 flex max-w-[672px] items-center justify-between gap-6 motion-safe:animate-[surface-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]">
              <div>
                <h1 className="m-0 type-page-title">Chat</h1>
                <p className="mt-0.5 mb-0 type-supporting text-muted-foreground">
                  {botName} 的远程会话
                </p>
              </div>
              <Button size="sm" onClick={() => onCreateChat()} pending={creating}>
                {!creating ? <Plus className="size-[14px]" aria-hidden="true" /> : null}
                {creating ? "创建中…" : "开始任务"}
              </Button>
            </div>
            <ul className="mx-auto max-w-[672px] list-none border-y border-border p-0">
              {chats.map((chat, index) => (
                <li
                  key={chat.ref.sessionId}
                  className="border-b border-border last:border-b-0 motion-safe:animate-[entry-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]"
                  style={{ animationDelay: `${Math.min(index * 24, 96)}ms` }}
                >
                  <div className="flex min-h-[64px] w-full items-center gap-3 px-2 py-3 transition-[color,background-color] hover:bg-muted/70">
                    <button
                      className="min-w-0 flex-1 rounded-[var(--radius-sm)] text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20"
                      onClick={() => onOpenChat(chat)}
                    >
                      <span className="block truncate type-body font-medium">
                        {chatDisplayTitle(chat)}
                      </span>
                      <span className="flex items-center gap-2">
                        <CollaborationBadge roster={chat.collaboration} label="协作任务" />
                        {chat.shared ? (
                          <span className="shrink-0 rounded-[var(--radius-sm)] bg-surface-subtle px-1 py-0.5 type-caption text-muted-foreground">
                            已共享
                          </span>
                        ) : null}
                      </span>
                      <small className="mt-0.5 block truncate type-supporting text-muted-foreground">
                        {chat.keyScope === "ungrouped" ? "未分组历史 · " : chat.keyScope === "current" ? "当前 API Key · " : ""}
                        {chat.remoteStatus || "远程 Chat"}
                      </small>
                    </button>
                    {chat.updatedAt ? (
                      <time className="shrink-0 type-supporting text-muted-foreground">
                        {formatUpdatedAt(chat.updatedAt)}
                      </time>
                    ) : null}
                    {chat.keyScope === "current" ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={anyBusy}
                            aria-label={`管理 ${chatDisplayTitle(chat)}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal
                              className="size-[14px] stroke-[1.75] text-muted-foreground"
                              aria-hidden="true"
                            />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => onArchiveChat(chat)} disabled={anyBusy}>
                            <Archive aria-hidden="true" />
                            归档
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setPendingDelete(chat)}
                            disabled={anyBusy}
                            className="text-destructive data-[highlighted]:text-destructive"
                          >
                            <Trash2 aria-hidden="true" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {createError !== null ? (
          <div className="mb-4">
            <Alert variant="destructive" title="创建失败">
              {errorText(createError)}
            </Alert>
            <div className="mt-2">
              <Button size="sm" onClick={() => onCreateChat()} pending={creating}>
                {creating ? "重试中…" : "重试"}
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2.5 mt-4 mb-3 [&>[role=alert]]:min-w-0 [&>[role=alert]]:flex-1">
            <Alert variant="destructive" title="错误">
              {errorText(error)}
            </Alert>
            <Button size="sm" variant="outline" onClick={onReload}>
              重试
            </Button>
          </div>
        ) : null}

        {archiveError ? (
          <div className="flex items-start gap-2.5 mt-4 mb-3 [&>[role=alert]]:min-w-0 [&>[role=alert]]:flex-1">
            <Alert variant="destructive" title="归档失败">
              {errorText(archiveError)}
            </Alert>
          </div>
        ) : null}

        {deleteError ? (
          <div className="flex items-start gap-2.5 mt-4 mb-3 [&>[role=alert]]:min-w-0 [&>[role=alert]]:flex-1">
            <Alert variant="destructive" title="删除失败">
              {errorText(deleteError)}
            </Alert>
          </div>
        ) : null}

        {botRef ? (
          <div className="mx-auto max-w-[672px]">
            <DeploymentSection
              botRef={botRef}
              bot={bot}
              provider={provider}
              reloadEpoch={deploymentsEpoch}
              onOpenChat={onOpenChat}
            />
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="删除 Chat"
        description={
          pendingDelete !== null
            ? `删除 “${pendingDelete.title}” 后，其远程 Session 和历史将无法恢复。`
            : undefined
        }
        confirmLabel="删除"
        confirmVariant="destructive"
        pending={deleting}
        disabled={pendingDelete === null}
        onConfirm={() => {
          if (pendingDelete !== null) {
            onDeleteChat(pendingDelete);
            setPendingDelete(null);
          }
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
