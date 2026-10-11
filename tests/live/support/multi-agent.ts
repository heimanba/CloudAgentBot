import type { Json } from "./rest";

export interface RosterShape {
  ids: string[];
  type?: string;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 值直方图（raw_type 统计等取证打印用）。 */
export function histogram(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/** 远端 multiagent 归一化：无/空 = 空 roster；{type, agents:[{id}|"id"]} 取 id；其他形状 "unsupported"。 */
export function canonicalRoster(raw: unknown): RosterShape | "unsupported" {
  if (raw === null || raw === undefined) return { ids: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) return "unsupported";
  const decl = raw as Json;
  if (!Array.isArray(decl.agents)) return "unsupported";
  const ids: string[] = [];
  for (const member of decl.agents) {
    if (typeof member === "string") {
      ids.push(member);
      continue;
    }
    if (!member || typeof member !== "object" || Array.isArray(member)) return "unsupported";
    const record = member as Json;
    const id = record.id ?? record.agent_id;
    if (typeof id !== "string" || id.length === 0) return "unsupported";
    ids.push(id);
  }
  const type = stringField(decl.type);
  return { ids: [...new Set(ids)].sort(), ...(type ? { type } : {}) };
}

/** requireRoster：unsupported 直接抛错，防止 Provider 形状漂移被静默当成空 roster。 */
export function requireRoster(raw: unknown): RosterShape {
  const parsed = canonicalRoster(raw);
  if (parsed === "unsupported") {
    throw new Error("remote multiagent field has a shape this client does not understand");
  }
  return parsed;
}
