import { expect, it } from "vitest";
import type { BotView } from "@shared/models";
import { rankNewChatBots } from "./new-chat-candidates";

const bot = (agentId: string, name: string, management: BotView["management"]): BotView => ({
  ref: { connectionId: "c", agentId },
  name,
  management,
});

it("ranks managed Bots first without hiding the complete catalog", () => {
  const bots = [bot("a", "Alpha", "managed"), bot("b", "Beta", "remote-only")];
  const roster = [
    {
      bot: bots[1],
      chat: {
        ref: { ...bots[1].ref, sessionId: "s" },
        title: "Chat",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    },
  ];
  expect(rankNewChatBots(bots, roster, "").map((item) => item.name)).toEqual(["Alpha", "Beta"]);
  expect(rankNewChatBots(bots, roster, "alp").map((item) => item.name)).toEqual(["Alpha"]);
});

it("includes cross-key shared Bots but excludes cross-key private Bots", () => {
  const bots: BotView[] = [
    { ...bot("shared", "Shared", "remote-only"), shared: true, keyScope: "current" },
    { ...bot("managed", "Managed", "managed"), keyScope: "current" },
    { ...bot("legacy", "Legacy", "remote-only"), keyScope: "ungrouped" },
    { ...bot("private", "Private", "remote-only"), keyScope: "other" },
    { ...bot("foreign", "Foreign", "remote-only"), shared: true, keyScope: "other" },
  ];
  expect(rankNewChatBots(bots, [], "", "team-shared").map((item) => item.ref.agentId)).toEqual([
    "foreign",
    "shared",
  ]);
  expect(rankNewChatBots(bots, [], "", "managed").map((item) => item.ref.agentId)).toEqual([
    "managed",
  ]);
  expect(rankNewChatBots(bots, [], "", "all-available").map((item) => item.ref.agentId).sort()).toEqual([
    "foreign",
    "legacy",
    "managed",
    "shared",
  ]);
});
