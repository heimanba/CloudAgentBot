import { useRef, useState } from "react";
import type { BotView, HostError, MessageAttachment } from "@shared/models";
import { ArrowUp, ChevronsUpDown, Plus, Search, X } from "lucide-react";
import { BotAvatar } from "../../ui/bot-avatar/bot-avatar";
import { CollaborationBadge } from "../../ui/collaboration-badge";
import {
  Alert,
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RefreshAction,
  Textarea,
} from "../../ui/design-system";
import { rankNewChatBots, type NewChatBotScope } from "./new-chat-candidates";
import { AttachButton, AttachmentChips, useAttachments } from "./attachments";
import type { ChatRosterItem } from "./use-chat-roster";

const TASK_EXAMPLES = [
  "整理一份会议纪要，并列出待办事项",
  "根据已有资料拟定项目计划",
  "分析一个问题并给出可执行建议",
];

function errorText(error: HostError): string {
  switch (error.code) {
    case "not-connected":
      return "凭据已断开，请重新连接。";
    case "authentication":
      return "凭据无效，请到「管理连接」更新凭证。";
    case "unavailable":
      return "服务暂时不可用，请稍后重试。";
    default:
      return "加载失败。";
  }
}

export interface NewTaskPageProps {
  bots: BotView[];
  roster: ChatRosterItem[];
  loading: boolean;
  botsError?: HostError | null;
  selectedBotUnavailable?: boolean;
  onReloadBots?(): void;
  draft: string;
  selectedBot: BotView | null;
  connectionId: string | null;
  provider?: string;
  creating: boolean;
  error: HostError | null;
  onDraftChange(value: string): void;
  onSelectBot(bot: BotView): void;
  onClearBot(): void;
  onCreateBot(): void;
  onSend(attachments?: MessageAttachment[]): void;
}

/** 任务草稿只在 Renderer 内存中；选择 Bot 本身不会创建远程 Chat。 */
export function NewTaskPage({
  bots,
  roster,
  loading,
  botsError = null,
  selectedBotUnavailable = false,
  onReloadBots,
  draft,
  selectedBot,
  connectionId,
  provider,
  creating,
  error,
  onDraftChange,
  onSelectBot,
  onClearBot,
  onCreateBot,
  onSend,
}: NewTaskPageProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidateScope, setCandidateScope] = useState<NewChatBotScope>("team-shared");
  const taskInputRef = useRef<HTMLTextAreaElement>(null);
  const focusTaskAfterSelection = useRef(false);
  const mentionRange = useRef<{ start: number; end: number } | null>(null);
  const attachments = useAttachments(connectionId, provider);
  const busy = creating || attachments.uploading;
  const candidates = rankNewChatBots(bots, roster, query, candidateScope);
  const canSend = draft.trim().length > 0 && selectedBot !== null && !busy && !loading && !botsError && !selectedBotUnavailable;
  const sendHint = loading ? "正在刷新助手，完成后即可发送任务。"
    : botsError ? "刷新助手列表后再发送任务。"
    : selectedBotUnavailable ? "重新选择助手后即可发送任务。"
    : !selectedBot
    ? !loading && !botsError && bots.length === 0
      ? "创建助手后即可发送任务。"
      : "选择助手后即可发送任务。"
    : !draft.trim()
      ? "描述任务后即可发送。"
    : null;


  const updateMention = (value: string, caret: number) => {
    const prefix = value.slice(0, caret);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(prefix);
    if (!match) {
      if (mentionRange.current) setPickerOpen(false);
      mentionRange.current = null;
      return;
    }
    mentionRange.current = { start: caret - match[1].length - 1, end: caret };
    setQuery(match[1]);
    setPickerOpen(true);
  };

  const selectBot = (bot: BotView) => {
    const range = mentionRange.current;
    if (range) {
      const next = `${draft.slice(0, range.start)}${draft.slice(range.end)}`;
      onDraftChange(next);
      requestAnimationFrame(() => {
        taskInputRef.current?.focus();
        taskInputRef.current?.setSelectionRange(range.start, range.start);
      });
    } else {
      focusTaskAfterSelection.current = true;
    }
    mentionRange.current = null;
    onSelectBot(bot);
    setPickerOpen(false);
    setCandidateScope("team-shared");
    setQuery("");
  };

  const submit = async () => {
    if (!canSend) return;
    const uploaded = await attachments.uploadAll();
    if (uploaded === null) {
      taskInputRef.current?.focus();
      return;
    }
    onSend(uploaded);
  };

  return (
    <section className="flex h-full flex-col bg-surface-raised">
      <header className="app-chat-topbar flex min-h-[60px] shrink-0 items-center gap-3 border-b border-border px-5 type-control font-semibold">
        <span className="shrink-0">新任务</span>
        <div
          className="min-w-0 flex-1 self-stretch [-webkit-app-region:drag]"
          data-slot="window-drag-region"
          aria-hidden="true"
        />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-8 sm:pb-16">
        <div className="w-full max-w-[672px]">
          <h1 className="m-0 type-page-title">你想完成什么？</h1>
          <p className="mt-2 type-body text-muted-foreground">从一件具体任务开始。</p>
          {botsError ? (
            <div className="mt-4 flex items-start gap-2.5">
              <Alert variant="destructive" title="助手列表未更新">
                {botsError.message}
                <span className="block">{errorText(botsError)}</span>
              </Alert>
              {onReloadBots ? (
                <Button size="sm" variant="outline" onClick={onReloadBots}>
                  重试
                </Button>
              ) : null}
            </div>
          ) : null}
          {selectedBotUnavailable ? <Alert title="所选助手当前不可用">请重新选择助手。任务内容已保留。</Alert> : null}
          <div className="mt-6 rounded-[var(--radius-xl)] border border-border bg-card p-3 transition-colors focus-within:border-foreground/35">
            {selectedBot ? (
              <div className="mb-2 flex items-center" aria-label={`已选择助手：${selectedBot.name}`}>
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-md)] bg-surface-subtle px-2 py-1 type-supporting">
                  <BotAvatar name={selectedBot.name} botRef={selectedBot.ref} size="tiny" decorative />
                  <span className="truncate">{selectedBot.name}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-4 shrink-0"
                    disabled={busy}
                    aria-label={`移除助手 ${selectedBot.name}`}
                    onClick={() => {
                      onClearBot();
                      taskInputRef.current?.focus();
                    }}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </Button>
                </span>
              </div>
            ) : null}
            {selectedBot?.description?.trim() ? <p className="mb-2 break-words type-supporting text-muted-foreground">{selectedBot.description}</p> : null}
            <Textarea
              ref={taskInputRef}
              autoFocus
              aria-label="任务内容"
              variant="bare"
              className="min-h-[92px] resize-none"
              placeholder="描述你要完成的任务…"
              value={draft}
              disabled={busy}
              onChange={(event) => {
                onDraftChange(event.target.value);
                updateMention(event.target.value, event.target.selectionStart);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Backspace" &&
                  selectedBot &&
                  !event.nativeEvent.isComposing &&
                  event.currentTarget.selectionStart === 0 &&
                  event.currentTarget.selectionEnd === 0
                ) {
                  onClearBot();
                  return;
                }
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  pickerOpen &&
                  mentionRange.current
                ) {
                  event.preventDefault();
                  if (candidates[0]) selectBot(candidates[0]);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (canSend) void submit();
                  else if (draft.trim() && !selectedBot) {
                    if (!loading && !botsError && bots.length === 0) onCreateBot();
                    else setPickerOpen(true);
                  }
                }
              }}
            />
            <AttachmentChips
              items={attachments.items}
              onRemove={attachments.remove}
              disabled={busy}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1">
                {!loading && !botsError && bots.length === 0 && selectedBot === null ? (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={onCreateBot}>
                    <Plus className="size-[14px]" aria-hidden="true" />
                    创建助手
                  </Button>
                ) : (
                  <Popover
                    open={pickerOpen}
                    onOpenChange={(open) => {
                      setPickerOpen(open);
                      if (!open) {
                        mentionRange.current = null;
                        setQuery("");
                        setCandidateScope("team-shared");
                      }
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        className="max-w-[min(240px,calc(100vw-180px))]"
                        aria-label={
                          selectedBot ? `更换执行助手，当前：${selectedBot.name}` : "选择执行助手"
                        }
                      >
                        <span className="min-w-0 truncate">
                          {selectedBot
                            ? "更换助手"
                            : loading
                              ? "正在加载助手…"
                              : "选择助手"}
                        </span>
                        <ChevronsUpDown
                          className="size-[14px] shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      side="top"
                      sideOffset={8}
                      collisionPadding={8}
                      className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(400px,calc(100vw-48px))] flex-col overflow-hidden p-2"
                      onOpenAutoFocus={(event) => {
                        if (mentionRange.current) event.preventDefault();
                      }}
                      onCloseAutoFocus={(event) => {
                        if (!focusTaskAfterSelection.current) return;
                        event.preventDefault();
                        focusTaskAfterSelection.current = false;
                        taskInputRef.current?.focus();
                      }}
                    >
                      <div className="mb-2 flex shrink-0 gap-1" role="group" aria-label="助手范围">
                        {([
                          ["team-shared", "团队共享"],
                          ["managed", "我的助手"],
                        ] as const).map(([scope, label]) => (
                          <Button
                            key={scope}
                            type="button"
                            size="sm"
                            variant={candidateScope === scope ? "secondary" : "ghost"}
                            aria-pressed={candidateScope === scope}
                            onClick={() => setCandidateScope(scope)}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                      {candidateScope === "all-available" ? (
                        <p className="shrink-0 px-2 type-caption text-muted-foreground" role="status">
                          正在浏览 Provider 资源。未分组资源没有当前团队的归属标记；选择仅用于执行任务，不会接管配置或开启共享。
                        </p>
                      ) : null}
                      <label className="mb-2 flex h-[var(--control-lg)] shrink-0 items-center gap-2 rounded-[var(--radius-md)] bg-surface-subtle px-3">
                        <Search
                          className="size-[16px] shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <Input
                          variant="bare"
                          aria-label="搜索助手"
                          placeholder="搜索助手"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                      </label>
                      <div className="min-h-0 max-h-[240px] overflow-y-auto overscroll-contain" role="group" aria-label="可选助手">
                        {candidates.map((bot) => (
                          <button
                            key={`${bot.ref.connectionId}/${bot.ref.agentId}`}
                            type="button"
                            className="flex min-h-[44px] w-full items-center gap-2 rounded-[var(--radius-md)] px-2 text-left type-supporting hover:bg-surface-hover"
                            onClick={() => selectBot(bot)}
                          >
                            <BotAvatar name={bot.name} botRef={bot.ref} size="compact" decorative />
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate">{bot.name}</span>
                                {candidateScope === "team-shared" ? <span className="shrink-0 rounded-[var(--radius-sm)] bg-surface-subtle px-1 py-0.5 type-caption text-muted-foreground">团队共享</span> : null}
                                {candidateScope !== "team-shared" && bot.keyScope === "ungrouped" ? <span className="shrink-0 rounded-[var(--radius-sm)] bg-surface-subtle px-1 py-0.5 type-caption text-muted-foreground">未分组</span> : null}
                                {candidateScope !== "team-shared" && bot.shared ? <span className="shrink-0 rounded-[var(--radius-sm)] bg-surface-subtle px-1 py-0.5 type-caption text-muted-foreground">团队共享</span> : null}
                              </span>
                              <span className="block truncate type-caption text-muted-foreground">
                                {bot.description?.trim() || "暂无能力描述"}
                              </span>
                            </span>
                            <CollaborationBadge roster={bot.collaboration} />
                          </button>
                        ))}
                        {!loading && !botsError && candidates.length === 0 ? (
                          <p className="px-2 type-supporting text-muted-foreground">
                            {query
                              ? "没有匹配的助手"
                              : candidateScope === "team-shared"
                                ? "还没有团队共享助手。可以创建助手，或切换到“我的助手”。"
                                : candidateScope === "managed"
                                  ? "还没有本机管理的助手，可以创建一个。"
                                  : "没有可浏览的 Provider 资源。"}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 w-full shrink-0 justify-start"
                        aria-pressed={candidateScope === "all-available"}
                        onClick={() => setCandidateScope("all-available")}
                      >
                        浏览 Provider 资源
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 w-full shrink-0 justify-start border-t border-border"
                        onClick={() => {
                          setPickerOpen(false);
                          setCandidateScope("team-shared");
                          setQuery("");
                          onCreateBot();
                        }}
                      >
                        <Plus className="size-[14px]" aria-hidden="true" />
                        创建助手
                      </Button>
                    </PopoverContent>
                  </Popover>
                )}
                {onReloadBots ? <RefreshAction label="刷新助手列表" refreshing={loading || creating} onRefresh={onReloadBots} /> : null}
                <AttachButton
                  onFiles={attachments.addFiles}
                  provider={provider}
                  disabled={busy || connectionId === null}
                  className="text-muted-foreground"
                />
              </div>
              <Button
                size="icon"
                className="rounded-full"
                aria-label={attachments.uploading ? "正在上传附件" : creating ? "正在开始任务" : "发送任务"}
                disabled={!canSend}
                pending={busy}
                onClick={() => void submit()}
              >
                {!busy ? <ArrowUp className="size-[16px]" aria-hidden="true" /> : null}
              </Button>
            </div>
          </div>
          {selectedBot?.collaboration?.memberAgentIds.length ? (
            <p className="mt-2 type-caption text-muted-foreground">
              与 {selectedBot.name} 对话；它可按需委派给 {selectedBot.collaboration.memberAgentIds.length} 位协作成员。
            </p>
          ) : null}
          <div
            className={`mt-4 flex flex-wrap gap-2 ${draft.trim() ? "invisible" : ""}`}
            aria-label="任务示例"
            aria-hidden={Boolean(draft.trim())}
          >
              {TASK_EXAMPLES.map((example) => (
                <Button
                  key={example}
                  variant="ghost"
                  size="sm"
                  className="h-auto whitespace-normal py-2 text-left font-normal text-muted-foreground"
                  disabled={busy || Boolean(draft.trim())}
                  onClick={() => {
                    onDraftChange(example);
                    taskInputRef.current?.focus();
                  }}
                >
                  {example}
                </Button>
              ))}
          </div>
          {sendHint && !busy ? (
            <p className="mt-2 type-caption text-muted-foreground" role="status">
              {sendHint}
            </p>
          ) : null}
          {busy ? (
            <p className="mt-2 type-caption text-muted-foreground" role="status">
              {attachments.uploading ? "正在上传附件…" : "正在创建任务并准备发送…"}
            </p>
          ) : null}
          {error ? (
            <div className="mt-4">
              <Alert variant="destructive" title="无法开始任务">
                {error.code === "conflict"
                  ? "请检查当前连接和运行环境后重试。"
                  : "创建 Chat 失败。任务内容已保留，请重试。"}
              </Alert>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
