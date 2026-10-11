import type { BotView } from "@shared/models";

export interface CollaborationMemberRow {
  agentId: string;
  bot: BotView | null;
}

export interface CollaborationGroupRow {
  coordinator: BotView;
  members: CollaborationMemberRow[];
}

/** 仅从当前 Connection 的列表派生导航关系；不推断成员状态或所有权。 */
export function deriveCollaborationNavigation(bots: BotView[]) {
  const byId = new Map(bots.map((bot) => [bot.ref.agentId, bot]));
  const groups: CollaborationGroupRow[] = bots
    .filter((bot) => bot.management === "managed" && (bot.collaboration?.memberAgentIds.length ?? 0) > 0)
    .map((coordinator) => ({
      coordinator,
      members: coordinator.collaboration!.memberAgentIds.map((agentId) => ({
        agentId,
        bot: byId.get(agentId) ?? null,
      })),
    }));
  const groupedIds = new Set(groups.flatMap((group) => [group.coordinator.ref.agentId, ...group.members.map((member) => member.agentId)]));
  const standaloneManagedBots = bots.filter((bot) => bot.management === "managed" && !groupedIds.has(bot.ref.agentId));
  return { groups, standaloneManagedBots };
}
