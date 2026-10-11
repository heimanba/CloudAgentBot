import type { BotView } from "@shared/models";
import type { ChatRosterItem } from "./use-chat-roster";

function key(bot: BotView): string {
  return `${bot.ref.connectionId}/${bot.ref.agentId}`;
}

export type NewChatBotScope = "team-shared" | "managed" | "all-available";

export function inNewChatBotScope(bot: BotView, scope: NewChatBotScope): boolean {
  if (scope === "team-shared") return bot.shared === true;
  if (scope === "managed") return bot.management === "managed";
  return bot.keyScope !== "other" || bot.shared === true;
}

export function rankNewChatBots(
  bots: BotView[],
  roster: ChatRosterItem[],
  query: string,
  scope: NewChatBotScope = "all-available",
): BotView[] {
  const recent = new Map<string, number>();
  for (const { bot, chat } of roster) {
    const time = chat.updatedAt ? Date.parse(chat.updatedAt) : 0;
    const id = key(bot);
    recent.set(id, Math.max(recent.get(id) ?? 0, Number.isNaN(time) ? 0 : time));
  }
  const search = query.trim().toLocaleLowerCase();
  const score = (bot: BotView): number => {
    const name = bot.name.toLocaleLowerCase();
    if (name === search) return 0;
    if (name.startsWith(search)) return 1;
    if (name.includes(search)) return 2;
    return 3;
  };
  return bots
    .filter((bot) => inNewChatBotScope(bot, scope))
    .filter((bot) =>
      search ? `${bot.name} ${bot.description ?? ""}`.toLocaleLowerCase().includes(search) : true,
    )
    .sort((left, right) => {
      if (search) {
        const difference = score(left) - score(right);
        if (difference) return difference;
      } else {
        const managed =
          Number(right.management === "managed") - Number(left.management === "managed");
        if (managed) return managed;
        const leftRecent = recent.get(key(left)) ?? 0;
        const rightRecent = recent.get(key(right)) ?? 0;
        if (leftRecent !== rightRecent) return rightRecent - leftRecent;
      }
      return left.name.localeCompare(right.name) || key(left).localeCompare(key(right));
    });
}
