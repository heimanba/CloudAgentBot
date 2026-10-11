import { describe, expect, it } from "vitest";
import type { BotView } from "@shared/models";
import { deriveCollaborationNavigation } from "./collaboration-navigation-model";

const bot = (id: string, management: BotView["management"] = "managed", memberAgentIds: string[] = []): BotView => ({
  ref: { connectionId: "conn", agentId: id },
  name: id,
  management,
  collaboration: { memberAgentIds },
});

describe("协作侧栏派生", () => {
  it("共享、远程和不可见成员按 roster 展示，独立助手不重复", () => {
    const a = bot("a", "managed", ["shared", "remote", "missing"]);
    const b = bot("b", "managed", ["shared"]);
    const shared = bot("shared");
    const remote = bot("remote", "remote-only");
    const standalone = bot("standalone");
    const result = deriveCollaborationNavigation([a, b, shared, remote, standalone]);
    expect(result.groups.map((group) => group.coordinator.ref.agentId)).toEqual(["a", "b"]);
    expect(result.groups[0].members.map((member) => member.agentId)).toEqual(["shared", "remote", "missing"]);
    expect(result.groups[0].members[2].bot).toBeNull();
    expect(result.groups[1].members[0].bot).toBe(shared);
    expect(result.standaloneManagedBots).toEqual([standalone]);
  });

  it("互相引用的协调者仍各自保留顶层组", () => {
    const a = bot("a", "managed", ["b"]);
    const b = bot("b", "managed", ["a"]);
    const result = deriveCollaborationNavigation([a, b]);
    expect(result.groups).toHaveLength(2);
    expect(result.standaloneManagedBots).toEqual([]);
  });
});
