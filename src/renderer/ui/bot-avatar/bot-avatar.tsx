import type { BotRef } from "@shared/models";
import { resolveBotAvatarProfile } from "./bot-avatar-profile";
import "./bot-avatar.css";

type BotAvatarSize = "tiny" | "mini" | "compact" | "default" | "hero";

const botAvatarSizeClass: Record<BotAvatarSize, string> = {
  tiny: "size-4 text-[8px]",
  mini: "size-[22px] text-[9px]",
  compact: "size-[30px] text-[11px]",
  default: "size-8 text-[13px]",
  hero: "size-[88px] text-[28px]",
};

export interface BotAvatarProps {
  name: string;
  botRef?: BotRef;
  size?: BotAvatarSize;
  creating?: boolean;
  decorative?: boolean;
}

export function BotAvatar({
  name,
  botRef,
  size = "default",
  creating = false,
  decorative = false,
}: BotAvatarProps) {
  const profile = resolveBotAvatarProfile({ ref: botRef, name });
  const displayName = name.trim() || "新 Bot";
  const initial = Array.from(displayName)[0]?.toLocaleUpperCase() ?? "B";

  return (
    <span
      className={`bot-avatar ${botAvatarSizeClass[size]}${creating ? " is-creating" : ""}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${displayName} 的头像`}
      aria-hidden={decorative ? "true" : undefined}
      style={{ backgroundColor: profile.color }}
    >
      {initial}
    </span>
  );
}
