import { useState } from "react";
import { Archive, ArrowUpRight, Check, Copy, MoreHorizontal, Pencil, RefreshCw } from "lucide-react";
import type { BotRef, BotView } from "@shared/models";
import type { HostError } from "@shared/models";
import type { BotsPageProps } from "./bots-page";
import type { BotDirectoryRow as DirectoryRow } from "./bot-directory-model";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/design-system";
import { BotAvatar } from "../../ui/bot-avatar/bot-avatar";
import { BotShareAction } from "./bot-share-action";

function ManagedBotActions({
  bot,
  onSave,
  onEdit,
  onRequestArchive,
}: {
  bot: BotView;
  onSave: BotsPageProps["onSave"];
  onEdit(ref: BotRef): void;
  onRequestArchive(bot: BotView): void;
}) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<HostError | null>(null);

  const runSync = async () => {
    setBusy(true);
    setSaveError(null);
    const err = await onSave(bot.ref, "sync");
    setBusy(false);
    if (err !== null) setSaveError(err);
  };

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="max-md:size-[44px]"
            pending={busy}
            aria-label={busy ? `正在重新同步 ${bot.name}` : `管理 ${bot.name}`}
          >
            {busy ? null : (
              <MoreHorizontal
                className="size-[14px] stroke-[1.75] text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEdit(bot.ref)} disabled={busy}>
            <Pencil aria-hidden="true" />
            编辑配置
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void runSync()} disabled={busy}>
            <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden="true" />
            重新同步
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(bot.ref.agentId)}>
            <Copy aria-hidden="true" />复制 ID
          </DropdownMenuItem>
          <div aria-hidden="true" className="my-1 border-t border-border" />
          <DropdownMenuItem
            onSelect={() => onRequestArchive(bot)}
            disabled={busy}
            className="text-destructive focus:text-destructive"
          >
            <Archive aria-hidden="true" />
            归档 Bot…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {saveError ? (
        <span
          role="alert"
          className="absolute top-9 right-0 z-10 w-[196px] rounded-[var(--radius-md)] border border-destructive/25 bg-popover px-3 py-2 type-caption text-destructive shadow-[var(--shadow-card)]"
        >
          {"同步失败，请重试。"}
        </span>
      ) : null}
    </div>
  );
}

export function BotDirectoryRow({ row, onOpenChats, onEdit, onSave, onSetShared, onRequestArchive, sharingDisabled }: {
  row: DirectoryRow;
  sharingDisabled?: boolean;
  onOpenChats(bot: BotView): void;
  onEdit(ref: BotRef): void;
  onSave: BotsPageProps["onSave"];
  onSetShared: BotsPageProps["onSetShared"];
  onRequestArchive(bot: BotView): void;
}) {
  const { bot, memberLabels, coordinators } = row;
  const managed = bot.management === "managed";
  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4">
        <button
          type="button"
          className="flex min-w-0 flex-1 basis-48 items-center gap-3 rounded-[var(--radius-md)] text-left hover:bg-surface-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpenChats(bot)}
          aria-label={`打开 ${bot.name} 的 Chat`}
        >
          <BotAvatar name={bot.name} botRef={bot.ref} size="compact" decorative />
          <span className="min-w-0 flex-1">
            <strong className="block truncate type-body font-medium">{bot.name}</strong>
            {bot.description ? <span className="block truncate type-supporting text-muted-foreground">{bot.description}</span> : null}
            {bot.management === "state-missing" ? <span className="type-caption text-muted-foreground">管理资料待恢复</span> : null}
            {bot.keyScope === "ungrouped" ? <span className="type-caption text-muted-foreground">未分组</span> : null}
          </span>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {managed && onSetShared ? <BotShareAction disabled={sharingDisabled} bot={bot} onSetShared={onSetShared} /> : null}
          {!managed && bot.shared ? <span className="inline-flex items-center gap-1 type-caption text-muted-foreground"><Check className="size-3.5" aria-hidden="true" />已共享</span> : null}
          {managed ? <Button size="sm" variant="ghost" onClick={() => onEdit(bot.ref)}>编辑</Button> : null}
          {managed ? (
            <ManagedBotActions bot={bot} onSave={onSave} onEdit={onEdit} onRequestArchive={onRequestArchive} />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`${bot.name} 的更多操作`}><MoreHorizontal className="size-3.5" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {bot.management === "remote-only" ? <DropdownMenuItem onSelect={() => onEdit(bot.ref)}>控制台配置</DropdownMenuItem> : null}
                <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(bot.ref.agentId)}>复制 ID</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {memberLabels.length > 0 ? (
        <button type="button" className="mb-3 flex max-w-full items-center gap-1 rounded-[var(--radius-sm)] type-caption text-muted-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenChats(bot)} aria-label={`查看 ${bot.name} 的协作成员`}>
          <span className="truncate">协作成员 {memberLabels.length} 位 · {memberLabels.slice(0, 3).join("、")}{memberLabels.length > 3 ? " 等" : ""}</span><ArrowUpRight className="size-3 shrink-0" />
        </button>
      ) : null}
      {coordinators.length > 0 ? (
        <button type="button" className="mb-3 flex max-w-full items-center gap-1 rounded-[var(--radius-sm)] type-caption text-muted-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenChats(coordinators.length === 1 ? coordinators[0] : bot)} aria-label={`查看 ${bot.name} 参与的协作`}>
          <span className="truncate">参与 {coordinators.slice(0, 2).map((item) => item.name).join("、")}{coordinators.length > 2 ? ` 等 ${coordinators.length} 个协调者` : ""} 的协作</span><ArrowUpRight className="size-3 shrink-0" />
        </button>
      ) : null}
    </li>
  );
}
