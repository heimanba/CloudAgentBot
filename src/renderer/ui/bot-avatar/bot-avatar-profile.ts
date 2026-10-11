import type { BotRef } from "@shared/models";

export const BOT_AVATAR_COLORS = [
  "#009957",
  "#377fe6",
  "#d94b52",
  "#e78531",
  "#8057c8",
  "#0ea5c6",
  "#d84f8b",
  "#d8a729",
  "#01a492",
  "#e5634e",
] as const;

export type BotAvatarColor = (typeof BOT_AVATAR_COLORS)[number];

export interface BotAvatarProfile {
  color: BotAvatarColor;
}

/** Small deterministic hash: stable across reloads and independent of JS engine randomness. */
export function hashBotAvatarSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Remote identity owns the final avatar. A name is only a creation-time preview seed,
 * so renaming an existing Bot never changes its visual identity.
 */
export function resolveBotAvatarProfile(input: { ref?: BotRef; name: string }): BotAvatarProfile {
  const seed = input.ref
    ? `${input.ref.connectionId}:${input.ref.agentId}`
    : input.name.trim() || "new-bot";
  const hash = hashBotAvatarSeed(seed);
  return {
    color: BOT_AVATAR_COLORS[hash % BOT_AVATAR_COLORS.length],
  };
}
