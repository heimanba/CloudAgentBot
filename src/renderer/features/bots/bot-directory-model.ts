import type { BotView } from "@shared/models";

export type BotDirectoryFilter = "all" | "managed" | "shared" | "remote-only" | "coordinator" | "other" | "provider";

export interface BotDirectoryRow {
  bot: BotView;
  members: BotView[];
  missingMemberIds: string[];
  memberLabels: string[];
  coordinators: BotView[];
  searchText: string;
}

/** 只从当前 Connection 的 Provider 列表派生关系；不推断历史委派。 */
export function buildBotDirectory(bots: BotView[]) {
  const byId = new Map(bots.map((bot) => [bot.ref.agentId, bot]));
  const coordinatorsByMemberId = new Map<string, BotView[]>();
  for (const bot of bots) {
    for (const memberId of bot.collaboration?.memberAgentIds ?? []) {
      const existing = coordinatorsByMemberId.get(memberId) ?? [];
      existing.push(bot);
      coordinatorsByMemberId.set(memberId, existing);
    }
  }

  const rows: BotDirectoryRow[] = bots.map((bot) => {
    const memberIds = bot.collaboration?.memberAgentIds ?? [];
    const members = memberIds.map((id) => byId.get(id)).filter((item): item is BotView => item !== undefined);
    const missingMemberIds = memberIds.filter((id) => !byId.has(id));
    const memberLabels = memberIds.map((id) => byId.get(id)?.name ?? `不可见 · ${id.slice(-8)}`);
    const coordinators = coordinatorsByMemberId.get(bot.ref.agentId) ?? [];
    return {
      bot,
      members,
      missingMemberIds,
      memberLabels,
      coordinators,
      searchText: [bot.name, bot.ref.agentId, bot.description, ...members.map((item) => item.name), ...coordinators.map((item) => item.name)].filter(Boolean).join(" ").toLocaleLowerCase(),
    };
  });

  const ordinaryRows = rows.filter((row) => isWorkspaceBot(row.bot));
  return {
    rows,
    workspaceCount: ordinaryRows.length,
    coordinatorCount: ordinaryRows.filter((row) => (row.bot.collaboration?.memberAgentIds.length ?? 0) > 0).length,
    otherCount: ordinaryRows.filter((row) => !(row.bot.collaboration?.memberAgentIds.length ?? 0)).length,
    managedCount: ordinaryRows.filter((row) => row.bot.management === "managed").length,
    sharedCount: ordinaryRows.filter((row) => row.bot.shared === true).length,
    remoteOnlyCount: ordinaryRows.filter((row) => row.bot.management === "remote-only").length,
  };
}

/** 本机资料、当前 Key 归属或 Provider 可见的共享 Bot 构成工作区目录；不是 Provider ACL。 */
function isWorkspaceBot(bot: BotView): boolean {
  return bot.management !== "remote-only" || bot.keyScope === "current" || bot.shared === true;
}

export function filterBotDirectory(rows: BotDirectoryRow[], filter: BotDirectoryFilter, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (filter === "provider") {
      if (row.bot.keyScope === "other" && row.bot.shared !== true) return false;
    } else if (!isWorkspaceBot(row.bot)) return false;
    const count = row.bot.collaboration?.memberAgentIds.length;
    if (filter === "coordinator" && !count) return false;
    if (filter === "other" && count) return false;
    if (filter === "managed" && row.bot.management !== "managed") return false;
    if (filter === "shared" && !(row.bot.shared === true)) return false;
    if (filter === "remote-only" && row.bot.management !== "remote-only") return false;
    return !normalized || row.searchText.includes(normalized);
  });
}
