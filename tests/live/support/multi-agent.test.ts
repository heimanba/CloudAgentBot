import { describe, expect, it } from "vitest";
import { canonicalRoster, histogram, requireRoster } from "./multi-agent";

describe("canonicalRoster / requireRoster", () => {
  it("无/空 = 空 roster；字符串与对象成员都取 id；type 透传", () => {
    expect(canonicalRoster(null)).toEqual({ ids: [] });
    expect(canonicalRoster(undefined)).toEqual({ ids: [] });
    expect(canonicalRoster({ agents: [] })).toEqual({ ids: [] });
    expect(
      canonicalRoster({ agents: ["a1", { id: "a2" }, { agent_id: "a3" }], type: "delegation" }),
    ).toEqual({
      ids: ["a1", "a2", "a3"],
      type: "delegation",
    });
    expect(canonicalRoster({ agents: ["a1"] })).toEqual({ ids: ["a1"] });
  });

  it("ids 去重并排序（与两份 inline 原版一致，断言顺序稳定）", () => {
    expect(canonicalRoster({ agents: ["b1", "a1", "b1", { id: "a2" }] })).toEqual({
      ids: ["a1", "a2", "b1"],
    });
  });

  it("形状漂移返回 unsupported；requireRoster 抛错防止被当成空 roster", () => {
    for (const raw of [
      "plain",
      42,
      [],
      { members: ["a1"] },
      { agents: "a1" },
      { agents: [7] },
      { agents: [{ id: 3 }] },
    ]) {
      expect(canonicalRoster(raw)).toBe("unsupported");
    }
    expect(() => requireRoster({ agents: "a1" })).toThrowError(
      /shape this client does not understand/,
    );
  });

  it("requireRoster 正常路径透传归一化结果", () => {
    expect(requireRoster({ agents: [{ id: "a1" }] })).toEqual({ ids: ["a1"] });
  });
});

describe("histogram", () => {
  it("计数合并相同键", () => {
    expect(histogram(["a", "b", "a"])).toEqual({ a: 2, b: 1 });
    expect(histogram([])).toEqual({});
  });
});
