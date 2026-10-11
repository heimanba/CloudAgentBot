// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BotAvatar } from "./bot-avatar";
import { resolveBotAvatarProfile } from "./bot-avatar-profile";

describe("BotAvatar", () => {
  it("uses remote identity for a stable profile even after a rename", () => {
    const ref = { connectionId: "connection-1", agentId: "agent-1" };
    expect(resolveBotAvatarProfile({ ref, name: "Before" })).toEqual(
      resolveBotAvatarProfile({ ref, name: "After" }),
    );
  });

  it("uses the draft name as the creation preview seed", () => {
    expect(resolveBotAvatarProfile({ name: "Atlas" })).not.toEqual(
      resolveBotAvatarProfile({ name: "Juniper" }),
    );
  });

  it("renders an accessible initial avatar and a decorative mode", () => {
    const accessible = renderToStaticMarkup(<BotAvatar name="Atlas" />);
    const decorative = renderToStaticMarkup(<BotAvatar name="Atlas" decorative />);
    expect(accessible).toContain('role="img"');
    expect(accessible).toContain('aria-label="Atlas 的头像"');
    expect(accessible).toContain("background-color:#009957");
    expect(accessible).toContain(">A</span>");
    expect(decorative).toContain('aria-hidden="true"');
  });

  it("uses compact, default, and hero avatar sizes", () => {
    expect(renderToStaticMarkup(<BotAvatar name="Compact" size="compact" />)).toContain(
      "size-[30px]",
    );
    expect(renderToStaticMarkup(<BotAvatar name="Default" />)).toContain("size-8");
    expect(renderToStaticMarkup(<BotAvatar name="Hero" size="hero" />)).toContain("size-[88px]");
  });
});
