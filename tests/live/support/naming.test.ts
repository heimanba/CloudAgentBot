import { describe, expect, it } from "vitest";
import { testRunStamp, testRunSuffix, uniqueTestPrefix } from "./naming";

describe("live 资源命名", () => {
  it("stamp 为 UTC yyyymmddhhmmss", () => {
    expect(testRunStamp(new Date("2026-10-05T12:34:56Z"))).toBe("20261005123456");
  });

  it("suffix 长度精确且为小写字母数字", () => {
    expect(testRunSuffix(8)).toMatch(/^[a-z0-9]{8}$/);
    expect(testRunSuffix(12)).toMatch(/^[a-z0-9]{12}$/);
  });

  it("prefix 带 label 与时间戳，多次调用互不相同", () => {
    const now = new Date("2026-10-05T12:34:56Z");
    expect(uniqueTestPrefix("share", now)).toMatch(
      /^openagentbot-share-20261005123456-[a-z0-9]{8}$/,
    );
    expect(uniqueTestPrefix("v2s05", now)).not.toBe(uniqueTestPrefix("v2s05", now));
  });
});
