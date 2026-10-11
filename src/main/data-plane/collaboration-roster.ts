import type { CollaborationRosterView } from "@shared/models";

/** 两家 Provider 的 Agent/Snapshot 均返回 {type, agents:[{id,...}]}。缺字段或未知形状不猜测为普通 Bot。 */
export function readRemoteRoster(value: unknown): CollaborationRosterView | undefined {
  if (value === null) return { memberAgentIds: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const roster = value as Record<string, unknown>;
  if (!Array.isArray(roster.agents)) return undefined;
  if (roster.agents.length === 0) return { memberAgentIds: [] };
  if (roster.type !== "coordinator") return undefined;
  const ids: string[] = [];
  for (const entry of roster.agents) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const id = (entry as Record<string, unknown>).id;
    if (typeof id !== "string" || id.trim() === "" || ids.includes(id)) return undefined;
    ids.push(id);
  }
  return { memberAgentIds: ids };
}
