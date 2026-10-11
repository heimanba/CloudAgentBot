import type { BotRef, BotView, CollaborationRosterView } from "@shared/models";
import { BotAvatar } from "./bot-avatar/bot-avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./design-system";
import { ProviderBadge } from "./provider-brand/provider-brand";

/** 两处共用同一头像组合；侧栏整行打开 Chat，详情页头的头像打开各自 Bot。 */
export function SessionCollaborationAvatars({
  botName,
  botRef,
  roster,
  bots,
  provider,
  onOpenBot,
  onShowMore,
}: {
  botName: string;
  botRef: BotRef;
  roster?: CollaborationRosterView;
  bots: BotView[];
  provider?: string;
  onOpenBot?(bot: BotView): void;
  onShowMore?(): void;
}) {
  const ids = roster?.memberAgentIds ?? [];
  const coordinator = bots.find(
    (item) => item.ref.connectionId === botRef.connectionId && item.ref.agentId === botRef.agentId,
  );
  const coordinatorAvatar = (
    <span className="relative z-10 shrink-0">
      <BotAvatar name={botName} botRef={botRef} size="compact" decorative />
      {provider ? (
        <ProviderBadge
          provider={provider}
          className="pointer-events-none absolute -bottom-1 -left-1 size-[14px]"
        />
      ) : null}
    </span>
  );
  return (
    <span className="flex shrink-0 items-center" aria-hidden={onOpenBot ? undefined : "true"}>
      {coordinator && onOpenBot ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="relative z-10 cursor-pointer rounded-full motion-safe:transition-transform motion-safe:duration-[var(--duration-fast)] hover:z-30 hover:scale-125 focus-visible:z-30 focus-visible:scale-125 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" aria-label={`查看协调者 ${botName} 的 Bot 详情`} onClick={() => onOpenBot(coordinator)}>
              {coordinatorAvatar}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={10}>查看 {botName} 的 Bot 详情</TooltipContent>
        </Tooltip>
      ) : coordinatorAvatar}
      {ids.slice(0, 1).map((id) => {
        const member = bots.find(
          (item) => item.ref.connectionId === botRef.connectionId && item.ref.agentId === id,
        );
        const avatar = (
          <span className="-ml-1.5 rounded-full">
            {member ? (
              <BotAvatar name={member.name} botRef={member.ref} size="mini" decorative />
            ) : (
              <span className="flex size-[22px] items-center justify-center rounded-full bg-surface-subtle text-[9px] text-muted-foreground">?</span>
            )}
          </span>
        );
        return member && onOpenBot ? (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button type="button" className="relative z-20 cursor-pointer rounded-full motion-safe:transition-transform motion-safe:duration-[var(--duration-fast)] hover:z-30 hover:scale-125 focus-visible:z-30 focus-visible:scale-125 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" aria-label={`查看成员 ${member.name} 的 Bot 详情`} onClick={() => onOpenBot(member)}>
                {avatar}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={10}>查看 {member.name} 的 Bot 详情</TooltipContent>
          </Tooltip>
        ) : <span key={id}>{avatar}</span>;
      })}
      {ids.length > 1 ? (
        onShowMore ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="relative z-0 -ml-1.5 flex size-[26px] cursor-pointer items-center justify-center rounded-full bg-surface-subtle type-caption text-muted-foreground motion-safe:transition-transform motion-safe:duration-[var(--duration-fast)] hover:z-30 hover:scale-125 focus-visible:z-30 focus-visible:scale-125 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" aria-label={`查看其余 ${ids.length - 1} 位协作成员`} onClick={onShowMore}>
                +{ids.length - 1}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={10}>查看全部协作成员</TooltipContent>
          </Tooltip>
        ) : (
          <span className="-ml-1.5 flex size-[26px] items-center justify-center rounded-full bg-surface-subtle type-caption text-muted-foreground">
            +{ids.length - 1}
          </span>
        )
      ) : null}
    </span>
  );
}
