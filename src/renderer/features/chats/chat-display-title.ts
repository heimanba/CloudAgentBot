import type { ChatView } from "@shared/models";

export function chatDisplayTitle(chat: ChatView): string {
  const title = chat.title.trim();
  if (title && title !== chat.ref.sessionId) return chat.title;
  const date = chat.updatedAt ? new Date(chat.updatedAt) : null;
  if (!date || Number.isNaN(date.getTime())) return "新 Chat";
  return `新 Chat · ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)}`;
}
