import type { BotView, ChatView } from "@shared/models";
import type { ChatRosterBotStatus, ChatRosterItem } from "../features/chats/use-chat-roster";
import { chatDisplayTitle } from "../features/chats/chat-display-title";

const RECENT_CHAT_LIMIT = 8;

export function botKey(ref: { connectionId: string; agentId: string }): string {
  return `${ref.connectionId}/${ref.agentId}`;
}

export function chatKey(ref: ChatView["ref"]): string {
  return `${botKey(ref)}/${ref.sessionId}`;
}

export interface BotNavigationItem {
  bot: BotView;
  chatCount: number | null;
  chatStatus: ChatRosterBotStatus;
}

export interface WorkspaceNavigationModel {
  recentChats: ChatRosterItem[];
  allChats: ChatRosterItem[];
  chatSearchResults: ChatRosterItem[];
  botRows: BotNavigationItem[];
  botSearchResults: BotNavigationItem[];
}

export interface WorkspaceNavigationModelInput {
  bots: BotView[];
  items: ChatRosterItem[];
  botStatusByKey: ReadonlyMap<string, ChatRosterBotStatus>;
  chatQuery: string;
  botQuery: string;
}

function updatedAtValue(chat: ChatView): number {
  if (!chat.updatedAt) return 0;
  const parsed = Date.parse(chat.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function compareChatItems(left: ChatRosterItem, right: ChatRosterItem): number {
  const time = updatedAtValue(right.chat) - updatedAtValue(left.chat);
  if (time !== 0) return time;
  const name = left.bot.name.localeCompare(right.bot.name);
  if (name !== 0) return name;
  return chatKey(left.chat.ref).localeCompare(chatKey(right.chat.ref));
}

function compareBotRows(left: BotNavigationItem, right: BotNavigationItem): number {
  const managed =
    Number(right.bot.management === "managed") - Number(left.bot.management === "managed");
  if (managed !== 0) return managed;
  const name = left.bot.name.localeCompare(right.bot.name);
  if (name !== 0) return name;
  return botKey(left.bot.ref).localeCompare(botKey(right.bot.ref));
}

function contains(value: string | undefined, query: string): boolean {
  return value?.toLocaleLowerCase().includes(query) ?? false;
}

export function deriveWorkspaceNavigationModel(
  input: WorkspaceNavigationModelInput,
): WorkspaceNavigationModel {
  const allChats = [...input.items].sort(compareChatItems);
  const recentChats = allChats.slice(0, RECENT_CHAT_LIMIT);
  const chatQuery = input.chatQuery.trim().toLocaleLowerCase();
  const botQuery = input.botQuery.trim().toLocaleLowerCase();

  const counts = new Map<string, number>();
  for (const item of input.items) {
    const key = botKey(item.bot.ref);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const botRows = input.bots
    .map((bot): BotNavigationItem => {
      const key = botKey(bot.ref);
      const chatStatus = input.botStatusByKey.get(key) ?? "loading";
      const knownCount = counts.get(key);
      return {
        bot,
        chatStatus,
        chatCount: knownCount ?? (chatStatus === "loaded" ? 0 : null),
      };
    })
    .sort(compareBotRows);

  const chatSearchResults =
    chatQuery === ""
      ? []
      : allChats.filter(
          ({ bot, chat }) =>
            contains(chatDisplayTitle(chat), chatQuery) || contains(bot.name, chatQuery),
        );
  const botSearchResults =
    botQuery === ""
      ? []
      : botRows.filter(
          ({ bot }) => contains(bot.name, botQuery) || contains(bot.description, botQuery),
        );

  return { recentChats, allChats, chatSearchResults, botRows, botSearchResults };
}
