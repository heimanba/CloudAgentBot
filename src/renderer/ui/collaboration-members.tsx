import type { BotView, CollaborationRosterView } from "@shared/models";
import { ArrowUpRight } from "lucide-react";
import { BotAvatar } from "./bot-avatar/bot-avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./design-system";

function memberLabel(id: string, bots: BotView[], connectionId: string): string {
  const bot = bots.find((item) => item.ref.connectionId === connectionId && item.ref.agentId === id);
  return bot ? `${bot.name}（当前名称）` : `当前列表不可见 · ${id.slice(-8)}`;
}

/** 当前列表中的反向引用；只表示当前 roster，不代表历史任务委派。 */
export function coordinatorsForMember(member: BotView, bots: BotView[]): BotView[] {
  return bots.filter((bot) =>
    bot.ref.connectionId === member.ref.connectionId &&
    bot.ref.agentId !== member.ref.agentId &&
    bot.collaboration?.memberAgentIds.includes(member.ref.agentId),
  );
}

export function CollaborationCoordinators({
  member,
  bots,
  onOpenBot,
}: {
  member: BotView;
  bots: BotView[];
  onOpenBot?(bot: BotView): void;
}) {
  const coordinators = coordinatorsForMember(member, bots);
  if (coordinators.length === 0) return null;
  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-card px-3 py-2" aria-label="参与的协作">
      <h2 className="m-0 type-supporting font-medium">参与的协作 · {coordinators.length} 个协调者</h2>
      <p className="my-1 type-caption text-muted-foreground">来自当前远程配置；是否参与过任务请查看协作过程。</p>
      <ul className="m-0 list-none p-0">
        {coordinators.map((bot) => (
          <li key={`${bot.ref.connectionId}/${bot.ref.agentId}`}>
            {onOpenBot ? (
              <button type="button" className="flex min-h-[44px] w-full items-center gap-2 rounded-[var(--radius-sm)] px-1 text-left type-supporting hover:bg-surface-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenBot(bot)}>
                <BotAvatar name={bot.name} botRef={bot.ref} size="mini" decorative />
                <span className="min-w-0 flex-1 truncate">{bot.name}</span>
                <span className="type-caption text-muted-foreground">Bot 详情</span>
                <ArrowUpRight className="size-3 text-muted-foreground" aria-hidden="true" />
              </button>
            ) : <span className="type-supporting">{bot.name}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CollaborationMemberList({
  roster,
  bots,
  connectionId,
  snapshot = false,
  onOpenBot,
}: {
  roster: CollaborationRosterView;
  bots: BotView[];
  connectionId: string;
  snapshot?: boolean;
  onOpenBot?(bot: BotView): void;
}) {
  return (
    <>
      <ul className="m-0 list-none space-y-1 p-0">
        {roster.memberAgentIds.map((id) => {
          const member = bots.find(
            (item) => item.ref.connectionId === connectionId && item.ref.agentId === id,
          );
          return (
            <li key={id} className="type-supporting text-muted-foreground" title={id}>
              {member && onOpenBot ? (
                <button type="button" className="flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-1 text-left text-foreground hover:bg-surface-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenBot(member)}>
                  <BotAvatar name={member.name} botRef={member.ref} size="mini" decorative />
                  <span className="min-w-0 flex-1 truncate">{memberLabel(id, bots, connectionId)}</span>
                  <span className="inline-flex shrink-0 items-center gap-0.5 type-caption text-muted-foreground">Bot 详情<ArrowUpRight className="size-3" aria-hidden="true" /></span>
                </button>
              ) : memberLabel(id, bots, connectionId)}
            </li>
          );
        })}
      </ul>
      <p className="mb-0 mt-2 type-caption text-muted-foreground">
        {snapshot ? "成员来自此任务创建时的远程快照；是否参与请看协作过程。" : "协调者按需委派，成员保持独立。"}
      </p>
    </>
  );
}

/** roster 的只读展示；成员仍是独立 Bot，且不表示本次执行过委派。 */
export function CollaborationMembers({
  roster,
  bots,
  connectionId,
  snapshot = false,
  onOpenBot,
}: {
  roster?: CollaborationRosterView;
  bots: BotView[];
  connectionId: string;
  snapshot?: boolean;
  onOpenBot?(bot: BotView): void;
}) {
  if (!roster?.memberAgentIds.length) return null;
  const title = snapshot ? "创建此任务时的协作成员" : "当前远程协作成员";
  const preview = roster.memberAgentIds
    .slice(0, 3)
    .map((id) => bots.find((bot) => bot.ref.connectionId === connectionId && bot.ref.agentId === id)?.name ?? `不可见 · ${id.slice(-8)}`)
    .join("、");
  return (
    <Collapsible className="rounded-[var(--radius-lg)] border border-border bg-card px-2 py-1">
      <CollapsibleTrigger className="min-w-0 type-supporting [&>svg:first-child]:order-last [&>svg:first-child]:ml-auto">
        <span className="min-w-0 flex-1 text-left">
          <span className="font-medium text-foreground">{title} · {roster.memberAgentIds.length} 位</span>
          <span className="block truncate text-muted-foreground">{preview}{roster.memberAgentIds.length > 3 ? " 等" : ""}</span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mx-3 mt-1 border-t border-border pt-2">
          <CollaborationMemberList roster={roster} bots={bots} connectionId={connectionId} snapshot={snapshot} onOpenBot={onOpenBot} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
