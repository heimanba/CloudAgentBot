import { describe, expect, it } from "vitest";
import { chatDisplayTitle } from "./chat-display-title";

describe("chatDisplayTitle", () => {
  const ref = { connectionId: "c", agentId: "a", sessionId: "s-1" };
  it("uses remote title when meaningful", () => {
    expect(chatDisplayTitle({ ref, title: "需求讨论" })).toBe("需求讨论");
  });
  it("does not present the opaque Session ID as a title", () => {
    expect(chatDisplayTitle({ ref, title: "s-1" })).toBe("新 Chat");
  });
});
