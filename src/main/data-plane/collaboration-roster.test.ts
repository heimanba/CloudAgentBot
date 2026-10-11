import { describe, expect, it } from "vitest";
import { readRemoteRoster } from "./collaboration-roster";

describe("readRemoteRoster", () => {
  it("distinguishes coordinator, explicit empty roster, and unknown response", () => {
    expect(readRemoteRoster({ type: "coordinator", agents: [{ id: "a" }, { id: "b" }] }))
      .toEqual({ memberAgentIds: ["a", "b"] });
    expect(readRemoteRoster(null)).toEqual({ memberAgentIds: [] });
    expect(readRemoteRoster({ type: "coordinator", agents: [] })).toEqual({ memberAgentIds: [] });
    expect(readRemoteRoster(undefined)).toBeUndefined();
    expect(readRemoteRoster({ type: "coordinator", agents: [{ name: "a" }] })).toBeUndefined();
  });
});
