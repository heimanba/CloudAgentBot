import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BotRef,
  BotView,
  ChatDetailView,
  ChatTimelineItemView,
  HostError,
  MessageAttachment,
} from "@shared/models";
import { getDesktopHost } from "../../desktop-host";
import {
  Alert,
  Button,
  ConfirmDialog,
  CopyAction,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Popover,
  RefreshAction,
  PopoverContent,
  PopoverTrigger,
  Select,
  Textarea,
  typography,
} from "../../ui/design-system";
import { BotAvatar } from "../../ui/bot-avatar/bot-avatar";
import { getProviderDisplayName, ProviderBadge } from "../../ui/provider-brand/provider-brand";
import { cn } from "../../lib/utils";
import { TimelineItem } from "./timeline-item";
import { ArtifactWorkspace } from "./artifact-workspace";
import { deriveTimelineNodes, mergePersistedAndLiveTimeline } from "./chat-timeline-model";
import { chatDisplayTitle } from "./chat-display-title";
import { WorkGroup } from "./work-group";
import { deriveChatAnchors } from "./chat-anchors";
import { useAttachments, AttachmentChips, AttachButton } from "./attachments";
import { CollaborationMemberList } from "../../ui/collaboration-members";
import { SessionCollaborationAvatars } from "../../ui/session-collaboration-avatars";
import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowUpRight,
  ArrowUp,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";

/**
 * Chat 时间线、反馈信息和输入框共用同一条阅读列。
 * 保持单一宽度来源，避免宽屏下出现彼此错位的多套左右边距。
 */
const CHAT_READING_LANE = "mx-auto w-full max-w-[672px]";

function errorText(error: HostError): string {
  switch (error.code) {
    case "not-connected":
      return "凭据已断开，请重新连接。";
    case "authentication":
      return "凭据无效。";
    case "not-found":
      return "这项任务不存在或已被删除。";
    case "unavailable":
      return "服务暂时不可用，请稍后重试。";
    default:
      return "加载失败。";
  }
}

function jsonText(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function searchableText(item: ChatTimelineItemView): string {
  if (item.kind === "delegation")
    return `${item.rawType} ${item.agentName ?? ""} ${item.content ?? ""}`;
  if (item.kind === "message" || item.kind === "thinking") return `${item.rawType} ${item.content}`;
  if (item.kind === "tool-call")
    return `${item.rawType} ${item.name} ${item.serverName ?? ""} ${jsonText(item.input)}`;
  if (item.kind === "tool-result") return `${item.rawType} ${item.content}`;
  if (item.kind === "artifact") return `${item.rawType} ${item.filename} ${item.fileId}`;
  if (item.kind === "status") return `${item.rawType} ${item.status} ${item.stopReason ?? ""}`;
  if (item.kind === "usage") return `${item.rawType} ${item.credits ?? ""}`;
  if (item.kind === "error") return `${item.rawType} ${item.message}`;
  return item.rawType;
}

export interface ChatDetailPageProps {
  initialDraft?: string;
  botName?: string;
  botRef?: BotRef;
  bots?: BotView[];
  provider?: string;
  detail: ChatDetailView | null;
  loading: boolean;
  error: HostError | null;
  sending: boolean;
  streamingText: string;
  liveEvents?: ChatTimelineItemView[];
  sendError: HostError | null;
  archiving: boolean;
  archiveError: HostError | null;
  deleting: boolean;
  deleteError: HostError | null;
  onSend(text: string, attachments?: MessageAttachment[]): boolean | void | Promise<boolean | void>;
  onReload(): void;
  onArchiveChat(): void;
  onDeleteChat(): void;
  onEditBot?(): void;
  onOpenBot?(bot: BotView): void;
  onBack(): void;
  onOpenArtifact?(artifact: Extract<ChatTimelineItemView, { kind: "artifact" }>): void;
}

export function ChatDetailPage({
  initialDraft,
  botName,
  botRef,
  bots = [],
  provider,
  detail,
  loading,
  error,
  sending,
  streamingText,
  liveEvents = [],
  sendError,
  archiving,
  archiveError,
  deleting,
  deleteError,
  onSend,
  onReload,
  onArchiveChat,
  onDeleteChat,
  onEditBot,
  onOpenBot,
  onBack,
  onOpenArtifact,
}: ChatDetailPageProps) {
  const [draft, setDraft] = useState(initialDraft ?? "");
  const connectionId = botRef?.connectionId ?? detail?.chat.ref.connectionId ?? null;
  const attachments = useAttachments(connectionId, provider);
  const clearAttachments = attachments.clear;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [anchorOpen, setAnchorOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [previewArtifact, setPreviewArtifact] = useState<Extract<
    ChatTimelineItemView,
    { kind: "artifact" }
  > | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [artifactError, setArtifactError] = useState<HostError | null>(null);
  const ownsChat = detail?.chat.keyScope === "current";
  const shared = detail?.chat.shared === true;
  const anyBusy = archiving || deleting;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const coordinatorBot = botRef
    ? bots.find(
        (item) =>
          item.ref.connectionId === botRef.connectionId && item.ref.agentId === botRef.agentId,
      )
    : undefined;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "36px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  }, [draft]);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if ((text.length === 0 && attachments.items.length === 0) || sending || attachments.uploading)
      return;
    const uploaded = await attachments.uploadAll();
    if (uploaded === null) {
      textareaRef.current?.focus();
      return;
    }
    const accepted = await onSend(text, uploaded);
    if (accepted === false) {
      textareaRef.current?.focus();
      return;
    }
    setDraft("");
    clearAttachments();
  }, [draft, sending, onSend, attachments, clearAttachments]);
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void submit();
      }
    },
    [submit],
  );

  const events = useMemo(() => {
    const persisted = detail?.events.length
      ? detail.events
      : (detail?.messages ?? []).map((message): ChatTimelineItemView => ({
          id: message.id,
          rawType: `${message.role === "user" ? "user" : "agent"}.message`,
          kind: "message",
          role: message.role,
          content: message.content,
          ...(message.attachments ? { attachments: message.attachments } : {}),
          ...(message.createdAt ? { occurredAt: message.createdAt } : {}),
        }));
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return mergePersistedAndLiveTimeline(persisted, liveEvents, !sending && !loading).filter(
      (item) => {
        if (item.kind === "unknown") return false;
        if (filter !== "all" && item.kind !== filter) return false;
        return (
          normalizedQuery === "" ||
          searchableText(item).toLocaleLowerCase().includes(normalizedQuery)
        );
      },
    );
  }, [detail, liveEvents, loading, query, filter, sending]);
  const nodes = useMemo(() => deriveTimelineNodes(events), [events]);
  const anchors = useMemo(() => deriveChatAnchors(events), [events]);

  useEffect(() => {
    console.log("[CloudAgentBot][rendered-messages]", {
      chatRef: detail?.chat.ref ?? null,
      persistedMessages: detail?.messages ?? [],
      persistedEvents: detail?.events ?? [],
      liveEvents,
      renderedMessages: events.filter((item) => item.kind === "message"),
    });
  }, [detail, events, liveEvents]);

  const chatRef = detail?.chat.ref;
  const downloadArtifact = useCallback(
    async (item: Extract<ChatTimelineItemView, { kind: "artifact" }>) => {
      if (!chatRef) return;
      try {
        const artifact = await getDesktopHost().chats.getArtifact(chatRef, item.fileId);
        setArtifactError(null);
        window.open(artifact.downloadUrl, "_blank", "noopener,noreferrer");
      } catch (cause) {
        setArtifactError(
          cause && typeof cause === "object" && "code" in cause
            ? (cause as HostError)
            : { code: "unavailable", message: "artifact unavailable" },
        );
      }
    },
    [chatRef],
  );
  const openArtifact = useCallback(
    (item: Extract<ChatTimelineItemView, { kind: "artifact" }>) => {
      if (onOpenArtifact !== undefined) {
        onOpenArtifact(item);
        return;
      }
      setPreviewArtifact(item);
      setPreviewOpen(true);
    },
    [onOpenArtifact],
  );
  const jumpTo = useCallback((id: string) => {
    const target = Array.from(
      timelineContainerRef.current?.querySelectorAll<HTMLElement>("[data-timeline-event-id]") ?? [],
    ).find((element) => element.dataset.timelineEventId === id);
    target?.scrollIntoView({ block: "center", behavior: "instant" });
    target?.setAttribute("tabindex", "-1");
    target?.focus();
    setAnchorOpen(false);
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    timelineEndRef.current?.scrollIntoView?.({
      block: "end",
      behavior: !reduceMotion && (sending || streamingText) ? "smooth" : "auto",
    });
  }, [events.length, sending, streamingText]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="app-chat-topbar grid min-h-[60px] shrink-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-[18px] max-md:grid-cols-[auto_auto_minmax(0,1fr)] max-md:py-2">
        <Button
          size="icon"
          variant="ghost"
          className="max-md:size-[44px]"
          aria-label="返回新任务"
          onClick={onBack}
        >
          <ArrowLeft className="size-[14px]" />
        </Button>
        {botName && botRef ? (
          detail?.chat.collaboration?.memberAgentIds.length ? (
            <SessionCollaborationAvatars
              botName={botName}
              botRef={botRef}
              roster={detail.chat.collaboration}
              bots={bots}
              provider={provider}
              onOpenBot={onOpenBot}
              onShowMore={() => setMemberOpen(true)}
            />
          ) : (
            <span className="relative shrink-0">
              <BotAvatar name={botName} botRef={botRef} size="compact" decorative />
              <ProviderBadge
                provider={provider}
                className="pointer-events-none absolute -right-1 -bottom-1 size-[14px]"
              />
            </span>
          )
        ) : (
          <span />
        )}
        <div className="flex min-w-0 flex-col">
          <strong
            className="block min-w-0 truncate type-control font-semibold"
            title={detail?.chat.title}
          >
            {detail ? chatDisplayTitle(detail.chat) : "任务"}
          </strong>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate type-caption text-muted-foreground">
            <span className="min-w-0 shrink truncate">
              由「
              {coordinatorBot && onOpenBot ? (
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-0.5 font-medium text-foreground underline underline-offset-2 hover:text-primary focus-visible:rounded-[var(--radius-sm)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`查看 ${botName} 的 Bot 详情`}
                  onClick={() => onOpenBot(coordinatorBot)}
                >
                  {botName}
                  <ArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
                </button>
              ) : (
                botName || "助手"
              )}
              」处理
            </span>
            {detail?.chat.collaboration?.memberAgentIds.length && botRef ? (
              <Popover open={memberOpen} onOpenChange={setMemberOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="shrink-0 rounded-[var(--radius-sm)] font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20"
                    aria-label={`查看创建此任务时的协作成员，${detail.chat.collaboration.memberAgentIds.length} 位`}
                  >
                    协作成员 {detail.chat.collaboration.memberAgentIds.length} 位
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(320px,calc(100vw-32px))] p-4">
                  <p className="mb-2 mt-0 type-supporting font-semibold">创建此任务时的协作成员</p>
                  {coordinatorBot && onOpenBot ? (
                    <button
                      type="button"
                      className="mb-2 flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-1 text-left type-supporting text-foreground hover:bg-surface-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onOpenBot(coordinatorBot)}
                    >
                      <BotAvatar
                        name={coordinatorBot.name}
                        botRef={coordinatorBot.ref}
                        size="mini"
                        decorative
                      />
                      <span className="min-w-0 flex-1 truncate">协调者：{coordinatorBot.name}</span>
                      <span className="inline-flex shrink-0 items-center gap-0.5 type-caption text-muted-foreground">
                        Bot 详情
                        <ArrowUpRight className="size-3" aria-hidden="true" />
                      </span>
                    </button>
                  ) : null}
                  <CollaborationMemberList
                    roster={detail.chat.collaboration}
                    bots={bots}
                    connectionId={botRef.connectionId}
                    snapshot
                    onOpenBot={onOpenBot}
                  />
                </PopoverContent>
              </Popover>
            ) : null}
            {shared ? (
              <span className="shrink-0 rounded-[var(--radius-sm)] bg-surface-subtle px-1 py-0.5 type-caption text-muted-foreground">
                已共享
              </span>
            ) : null}
            {provider ? (
              <span className="sr-only">，Provider：{getProviderDisplayName(provider)}</span>
            ) : null}
          </span>
        </div>
        {/* §3.3.1：窄窗口工具另起一行，优先保留任务与助手身份。 */}
        <div className="flex items-center gap-1 max-md:col-span-3 max-md:justify-end">
          <RefreshAction label="刷新任务" refreshing={loading} onRefresh={onReload} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="max-md:size-[44px]"
                disabled={anyBusy}
                aria-label="管理任务"
              >
                <MoreHorizontal
                  className="size-[14px] stroke-[1.75] text-muted-foreground"
                  aria-hidden="true"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[320px]">
              {detail ? (
                <div
                  className="mb-1 flex items-center gap-2 border-b border-border/80 px-2.5 pb-2"
                  role="group"
                  aria-label="Session 信息"
                >
                  <div className="min-w-0 flex-1">
                    <div className="type-caption text-muted-foreground">Session ID</div>
                    <div className="break-all font-mono type-caption text-foreground">
                      {detail.chat.ref.sessionId}
                    </div>
                    {detail.chat.title && detail.chat.title !== detail.chat.ref.sessionId ? (
                      <div
                        className="mt-1 truncate type-caption text-muted-foreground"
                        title={detail.chat.title}
                      >
                        远程标题：{detail.chat.title}
                      </div>
                    ) : null}
                  </div>
                  <CopyAction
                    value={detail.chat.ref.sessionId}
                    label="复制 Session ID"
                    className="shrink-0"
                  />
                </div>
              ) : null}
              {onEditBot ? (
                <DropdownMenuItem onSelect={onEditBot} disabled={anyBusy}>
                  <Pencil aria-hidden="true" />
                  编辑 Bot 配置
                </DropdownMenuItem>
              ) : null}
              {ownsChat ? (
                <>
                  <DropdownMenuItem onSelect={onArchiveChat} disabled={anyBusy}>
                    <Archive aria-hidden="true" />
                    归档
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setShowDeleteDialog(true)}
                    disabled={anyBusy}
                    className="text-destructive data-[highlighted]:text-destructive"
                  >
                    <Trash2 aria-hidden="true" />
                    删除
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="打开工作记录工具">
                <Activity className="size-[14px]" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="grid w-[min(420px,calc(100vw-48px))] grid-cols-[140px_minmax(0,1fr)] gap-2 p-3"
            >
              <Select
                aria-label="筛选事件"
                value={filter}
                onValueChange={setFilter}
                options={[
                  { value: "all", label: "所有记录" },
                  { value: "message", label: "消息" },
                  { value: "thinking", label: "思考" },
                  { value: "delegation", label: "协作" },
                  { value: "tool-call", label: "工具调用" },
                  { value: "tool-result", label: "工具结果" },
                  { value: "artifact", label: "产物" },
                  { value: "status", label: "状态" },
                  { value: "usage", label: "用量" },
                  { value: "error", label: "错误" },
                ]}
              />
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-[14px] -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  className="pl-8"
                  aria-label="搜索事件"
                  placeholder="搜索工作记录"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </PopoverContent>
          </Popover>
          <Popover open={anchorOpen} onOpenChange={setAnchorOpen}>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="跳转到消息、错误或产物">
                <Search className="size-[14px]" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="max-h-[min(420px,60vh)] w-[min(360px,calc(100vw-48px))] overflow-y-auto p-2"
            >
              {anchors.length === 0 ? (
                <p className="px-2 type-supporting text-muted-foreground">暂无可跳转的记录</p>
              ) : null}
              {[...anchors].reverse().map((anchor) => (
                <button
                  key={anchor.id}
                  type="button"
                  className="block w-full truncate rounded-[var(--radius-md)] px-2 py-2 text-left type-supporting hover:bg-surface-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20"
                  onClick={() => jumpTo(anchor.id)}
                >
                  <span className="mr-2 text-muted-foreground">
                    {anchor.kind === "failure"
                      ? "错误"
                      : anchor.kind === "artifact"
                        ? "产物"
                        : anchor.kind === "user"
                          ? "我"
                          : "助手"}
                  </span>
                  {anchor.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto bg-surface-raised px-5 pb-12 pt-2">
        {loading && detail === null ? (
          <p className={typography.body} role="status">
            加载中…
          </p>
        ) : null}
        {!loading && detail && events.length === 0 ? (
          <div className="flex min-h-0 flex-col items-center justify-center pt-[clamp(76px,18vh,150px)] text-center">
            <h1 className="m-0 type-page-title">
              {query.trim() || filter !== "all" ? "暂无匹配记录" : "开始新的对话"}
            </h1>
            <p className="mb-5 mt-[5px] max-w-[390px] type-body text-muted-foreground">
              {query.trim() || filter !== "all"
                ? "调整工作记录的搜索或筛选条件。"
                : `向 ${botName || "助手"} 发送第一条消息。`}
            </p>
          </div>
        ) : null}
        <div
          ref={timelineContainerRef}
          className={cn(CHAT_READING_LANE, "flex flex-col gap-2")}
          data-chat-reading-lane
        >
          {nodes.map((node) =>
            node.kind === "work-group" ? (
              <WorkGroup
                key={`${node.key}:${filter}:${query.trim()}`}
                items={node.items}
                defaultOpen={filter !== "all" || query.trim() !== ""}
              />
            ) : (
              <div key={node.key} data-timeline-event-id={node.item.id}>
                <TimelineItem
                  item={node.item}
                  onPreviewArtifact={openArtifact}
                  onDownloadArtifact={(item) => void downloadArtifact(item)}
                />
              </div>
            ),
          )}
          {streamingText.length > 0 ? (
            <div data-testid="streaming-reply" aria-live="off">
              <TimelineItem
                item={{
                  id: "streaming-assistant",
                  rawType: "agent.message",
                  kind: "message",
                  role: "assistant",
                  content: streamingText,
                }}
                streaming
              />
            </div>
          ) : null}
          <div ref={timelineEndRef} aria-hidden="true" />
        </div>
        {sendError ? (
          <div className={cn(CHAT_READING_LANE, "mb-3")}>
            <Alert variant="destructive" title="发送失败">
              {errorText(sendError)} 内容仍保留在输入框，可重新发送。
            </Alert>
          </div>
        ) : null}
        {error ? (
          <div
            className={cn(
              CHAT_READING_LANE,
              "mb-3 flex items-start gap-2.5 [&>[role=alert]]:min-w-0 [&>[role=alert]]:flex-1",
            )}
          >
            <Alert variant="destructive" title="错误">
              {errorText(error)}
            </Alert>
            <Button size="sm" variant="outline" onClick={onReload}>
              重试
            </Button>
          </div>
        ) : null}
        {archiveError ? (
          <div className={cn(CHAT_READING_LANE, "mb-3")}>
            <Alert variant="destructive" title="归档失败">
              {errorText(archiveError)}
            </Alert>
          </div>
        ) : null}
        {deleteError ? (
          <div className={cn(CHAT_READING_LANE, "mb-3")}>
            <Alert variant="destructive" title="删除失败">
              {errorText(deleteError)}
            </Alert>
          </div>
        ) : null}
        {artifactError ? (
          <div className={cn(CHAT_READING_LANE, "mb-3")}>
            <Alert variant="destructive" title="产物操作失败">
              {errorText(artifactError)}
            </Alert>
          </div>
        ) : null}
      </div>
      <div className="shrink-0 bg-gradient-to-b from-transparent via-surface-raised to-surface-raised px-5 pt-2 pb-3">
        {attachments.uploading || sending ? (
          <p
            className={cn(CHAT_READING_LANE, "mb-2 type-caption text-muted-foreground")}
            role="status"
            aria-live="polite"
          >
            {attachments.uploading ? "正在上传附件…" : "正在发送消息并等待助手回复…"}
          </p>
        ) : null}
        <div
          className={cn(
            CHAT_READING_LANE,
            "min-h-[var(--composer-min)] rounded-[var(--radius-xl)] border border-border/80 bg-card p-1.5 pl-4 shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-[var(--duration-fast)] focus-within:border-foreground/35",
          )}
        >
          <AttachmentChips
            items={attachments.items}
            onRemove={attachments.remove}
            disabled={sending || attachments.uploading}
          />
          <div className="flex items-end gap-2">
            <AttachButton
              onFiles={attachments.addFiles}
              provider={provider}
              disabled={sending || attachments.uploading || connectionId === null}
              className="size-[36px] shrink-0 rounded-full text-muted-foreground max-md:size-[var(--control-lg)]"
            />
            <div className="min-w-0 flex-1">
              <Textarea
                ref={textareaRef}
                value={draft}
                variant="bare"
                className="max-h-[132px] min-h-[36px] py-2.5 placeholder:text-muted-foreground"
                placeholder={`给 ${botName || "助手"} 发送消息…`}
                disabled={sending || attachments.uploading}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />
            </div>
            <Button
              className="size-[36px] shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/85 disabled:bg-muted disabled:text-muted-foreground max-md:size-[var(--control-lg)]"
              size="icon"
              onClick={() => void submit()}
              disabled={draft.trim().length === 0 && attachments.items.length === 0}
              pending={sending || attachments.uploading}
              aria-label={attachments.uploading ? "上传中" : sending ? "发送中" : "发送"}
            >
              {sending || attachments.uploading ? (
                ""
              ) : (
                <ArrowUp className="size-[14px]" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={(open) => !open && setShowDeleteDialog(false)}
        title="删除任务"
        description={`删除“${detail?.chat.title}”后，其远程对话和历史将无法恢复。`}
        confirmLabel="删除"
        confirmVariant="destructive"
        pending={deleting}
        onConfirm={() => {
          onDeleteChat();
          setShowDeleteDialog(false);
        }}
        onCancel={() => setShowDeleteDialog(false)}
      />
      {onOpenArtifact === undefined && previewArtifact && chatRef ? (
        <ArtifactWorkspace
          artifact={previewArtifact}
          chatRef={chatRef}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  );
}
