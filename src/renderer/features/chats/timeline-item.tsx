import type { ChatTimelineItemView, MessageFileAttachmentView } from "@shared/models";
import appLogoUrl from "@shared/assets/app.png";
import {
  Box,
  Brain,
  Bug,
  Check,
  Download,
  Eye,
  FileOutput,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  CopyAction,
} from "../../ui/design-system";
import { cn } from "../../lib/utils";
import { AttachmentTypeIcon, attachmentTypeLabel } from "./attachments";
import { ChatContent } from "./chat-content";

function formatTime(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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

function EventMeta({ item }: { item: ChatTimelineItemView }) {
  const time = formatTime(item.occurredAt);
  if (!item.threadId && !time) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 type-caption font-normal text-muted-foreground">
      {item.threadId ? (
        <span className="hidden group-data-[state=open]/work:inline" title={item.threadId}>
          Thread {item.threadId}
        </span>
      ) : null}
      {time ? <time dateTime={item.occurredAt}>{time}</time> : null}
    </span>
  );
}

function WorkItem({
  item,
  icon,
  label,
  tone = "neutral",
  children,
}: {
  item: ChatTimelineItemView;
  icon: React.ReactNode;
  label: React.ReactNode;
  tone?: "neutral" | "danger";
  children: React.ReactNode;
}) {
  return (
    <Collapsible
      className={cn("group/work relative w-full", tone === "danger" && "text-destructive")}
      data-event-type={item.rawType}
      data-timeline-track="work"
    >
      <CollapsibleTrigger className="min-h-[28px] rounded-[var(--radius-md)] px-2 py-1.5 type-supporting hover:bg-surface-hover [&>svg:first-child]:order-last [&>svg:first-child]:ml-auto">
        <span className={cn("text-muted-foreground", tone === "danger" && "text-destructive")}>
          {icon}
        </span>
        <span className="min-w-0 truncate font-medium text-foreground/75">{label}</span>
        <EventMeta item={item} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-[360px] overflow-auto px-8 py-2 pr-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// 用户气泡是近黑高对比表面：在作用域内反转语义 token，让内联代码、引用、表格边框
// 与表头等 Markdown 元素随气泡前景（白字）渲染，而不是沿用页面级深色。
const USER_BUBBLE_INVERTED = [
  "[--foreground:var(--message-user-foreground)]",
  "[--muted-foreground:color-mix(in_srgb,var(--message-user-foreground)_72%,transparent)]",
  "[--border:color-mix(in_srgb,var(--message-user-foreground)_24%,transparent)]",
  "[--surface-subtle:color-mix(in_srgb,var(--message-user-foreground)_10%,transparent)]",
].join(" ");

function MessageActions({ content }: { content: string }) {
  return (
    <div
      className={cn(
        "flex min-h-6 justify-end transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/message:opacity-100 [@media(hover:hover)]:group-hover/message:opacity-100",
      )}
      data-message-actions
    >
      <CopyAction value={content} label="复制消息" className="size-6" />
    </div>
  );
}

function CopyableDetail({
  value,
  label,
  children,
}: {
  value: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative pr-9">
      {children}
      <CopyAction value={value} label={label} className="absolute top-0 right-0" />
    </div>
  );
}

function isPreviewableArtifact(item: Extract<ChatTimelineItemView, { kind: "artifact" }>): boolean {
  const contentType = (item.contentType ?? "").toLowerCase().split(";")[0];
  return (
    ["text/html", "text/markdown", "text/x-markdown", "application/markdown", "image/svg+xml"].includes(contentType) ||
    /\.(html?|markdown?|png|jpe?g|gif|webp|svg)$/i.test(item.filename)
  );
}

function attachmentLabel(kind: MessageFileAttachmentView["kind"]): string {
  return kind === "image" ? "图片" : kind === "video" ? "视频" : "文件";
}

function MessageAttachments({
  attachments,
  align,
}: {
  attachments: MessageFileAttachmentView[];
  align: "start" | "end";
}) {
  if (attachments.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", align === "end" ? "justify-end" : "")}>
      {attachments.map((attachment, index) => {
        const label = attachment.filename || attachmentLabel(attachment.kind);
        return (
          <span
            key={`${attachment.fileId}:${index}`}
            className="inline-flex max-w-[220px] items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-card px-2 py-1 type-caption text-foreground"
            title={label}
          >
            <AttachmentTypeIcon filename={label} kind={attachment.kind} />
            <span className="min-w-0 truncate">{label}</span>
            {attachment.filename ? (
              <span className="shrink-0 text-muted-foreground">
                {attachmentTypeLabel(attachment.filename)}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

export function TimelineItem({
  item,
  quietOperational = false,
  streaming = false,
  onPreviewArtifact,
  onDownloadArtifact,
}: {
  item: ChatTimelineItemView;
  quietOperational?: boolean;
  streaming?: boolean;
  onPreviewArtifact?: (item: Extract<ChatTimelineItemView, { kind: "artifact" }>) => void;
  onDownloadArtifact?: (item: Extract<ChatTimelineItemView, { kind: "artifact" }>) => void;
}) {
  if (item.kind === "message") {
    const attachments = item.attachments ?? [];
    if (item.role === "user") {
      return (
        <article
          className="group/message flex w-full flex-col items-end gap-1.5"
          data-message-role="user"
          data-event-type={item.rawType}
        >
          {attachments.length > 0 ? (
            <MessageAttachments attachments={attachments} align="end" />
          ) : null}
          {item.content ? (
            <div
              className={cn(
                USER_BUBBLE_INVERTED,
                "max-w-[min(560px,92%)] rounded-[var(--radius-xl)] bg-message-user px-3 py-2 text-message-user-foreground",
              )}
              data-message-content
            >
              <ChatContent content={item.content} />
            </div>
          ) : null}
          {item.content ? <MessageActions content={item.content} /> : null}
        </article>
      );
    }
    return (
      <article
        className="group/message flex w-full items-start gap-2.5 py-1"
        data-message-role="assistant"
        data-event-type={item.rawType}
      >
        <img
          className="size-[20px] shrink-0 rounded-full object-contain"
          src={appLogoUrl}
          alt=""
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          {attachments.length > 0 ? (
            <MessageAttachments attachments={attachments} align="start" />
          ) : null}
          {item.content ? <ChatContent content={item.content} /> : null}
          {streaming ? (
            <span
              className="inline-block h-[14px] w-0.5 animate-pulse rounded-full bg-foreground/45 align-middle"
              data-streaming-cursor
              aria-hidden="true"
            />
          ) : item.content ? (
            <MessageActions content={item.content} />
          ) : null}
        </div>
      </article>
    );
  }

  if (item.kind === "thinking")
    return (
      <WorkItem item={item} icon={<Brain className="size-[12px]" />} label="已思考">
        <CopyableDetail value={item.content} label="复制思考内容">
          <ChatContent
            content={item.content || "（无公开内容）"}
            className="type-supporting text-muted-foreground"
          />
        </CopyableDetail>
      </WorkItem>
    );

  if (item.kind === "delegation") {
    const who = item.agentName || "协作成员";
    const label =
      item.action === "created"
        ? `创建协作子任务 · ${who}`
        : item.action === "sent"
          ? `发送跨线程消息 · 目标 ${who}`
          : `收到跨线程消息 · 来源 ${who}`;
    return (
      <WorkItem item={item} icon={<UsersRound className="size-[12px]" />} label={label}>
        <p className="m-0 type-supporting text-muted-foreground">
          {item.content || "Provider 已记录此协作事件。"}
        </p>
      </WorkItem>
    );
  }

  if (item.kind === "tool-call")
    return (
      <WorkItem
        item={item}
        icon={<Wrench className="size-[12px]" />}
        label={`调用 ${item.serverName ? `${item.serverName} / ` : ""}${item.name}`}
      >
        <div className="space-y-3">
          <CopyableDetail value={jsonText(item.input) || "{}"} label="复制工具输入">
            <strong className="type-caption font-medium tracking-wide text-muted-foreground">
              输入
            </strong>
            <pre className="mt-1 mb-0 whitespace-pre-wrap break-words font-mono type-caption">
              {jsonText(item.input) || "{}"}
            </pre>
          </CopyableDetail>
          {item.permission !== undefined ? (
            <div>
              <strong className="type-caption font-medium tracking-wide text-muted-foreground">
                权限
              </strong>
              <pre className="mt-1 mb-0 whitespace-pre-wrap break-words font-mono type-caption">
                {jsonText(item.permission)}
              </pre>
            </div>
          ) : null}
        </div>
      </WorkItem>
    );

  if (item.kind === "tool-result")
    return (
      <WorkItem
        item={item}
        icon={item.isError ? <X className="size-[12px]" /> : <Check className="size-[12px]" />}
        label={item.isError ? "工具执行失败" : "已完成"}
        tone={item.isError ? "danger" : "neutral"}
      >
        <CopyableDetail value={item.content} label="复制工具输出">
          <pre className="m-0 whitespace-pre-wrap break-words font-mono type-caption text-foreground/80">
            {item.content || "（无输出）"}
          </pre>
        </CopyableDetail>
      </WorkItem>
    );

  if (item.kind === "artifact")
    return (
      <article
        className="flex w-full max-w-[620px] flex-wrap items-center gap-x-3 gap-y-2 self-start rounded-[var(--radius-xl)] border border-border bg-card p-3"
        data-event-type={item.rawType}
      >
        <div className="grid size-[32px] shrink-0 place-items-center rounded-[var(--radius-lg)] bg-secondary text-muted-foreground">
          <FileOutput className="size-[14px]" aria-hidden="true" />
        </div>
        <div className="min-w-[160px] flex-1 basis-[220px]">
          <strong
            className="line-clamp-2 type-control font-semibold break-all"
            title={item.filename}
          >
            {item.filename}
          </strong>
          <small className="block type-caption text-muted-foreground">
            {item.contentType ?? "文件"}
            {item.size !== undefined ? ` · ${Math.max(1, Math.round(item.size / 1024))} KB` : ""}
          </small>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <EventMeta item={item} />
          {isPreviewableArtifact(item) ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onPreviewArtifact?.(item)}
              disabled={item.fileId.length === 0}
            >
              <Eye className="size-[14px]" aria-hidden="true" />
              预览
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDownloadArtifact?.(item)}
            disabled={item.fileId.length === 0}
          >
            <Download className="size-[14px]" aria-hidden="true" />
            下载
          </Button>
        </div>
      </article>
    );

  if (item.kind === "status" || item.kind === "usage") {
    const label =
      item.kind === "status"
        ? `${item.scope === "thread" ? "Thread" : "Session"} ${item.status}${item.stopReason ? ` · ${item.stopReason}` : ""}`
        : `模型调用${item.credits !== undefined ? ` · ${item.credits} credits` : ""}${item.isError ? " · 失败" : " · 完成"}`;
    return (
      <div
        className={cn(
          "mx-auto items-center gap-2 type-caption text-muted-foreground",
          quietOperational ? "sr-only" : "flex",
        )}
        data-event-type={item.rawType}
      >
        <Box className="size-[12px]" aria-hidden="true" />
        <span>{label}</span>
        <EventMeta item={item} />
      </div>
    );
  }

  if (item.kind === "error")
    return (
      <article
        className="flex max-w-[92%] items-start gap-2 rounded-[var(--radius-md)] border border-destructive/25 bg-destructive/5 px-3 py-2.5 type-supporting"
        data-event-type={item.rawType}
      >
        <Bug className="mt-0.5 size-[12px] shrink-0 text-destructive" aria-hidden="true" />
        <div>
          <strong className="font-semibold">运行出错</strong>
          <p className="mt-1 mb-0 text-foreground/80">{item.message}</p>
        </div>
        <EventMeta item={item} />
      </article>
    );

  return null;
}
