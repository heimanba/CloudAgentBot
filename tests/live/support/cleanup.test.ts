import { describe, expect, it } from "vitest";
import { createCleanupCollector } from "./cleanup";

describe("live 清理聚合器", () => {
  it("单项失败不中断后续清理，flush 聚合抛出", async () => {
    const collector = createCleanupCollector("cleanup failed");
    const order: string[] = [];
    await collector.attempt(async () => {
      order.push("a");
    });
    await collector.attempt(async () => {
      order.push("b");
      throw new Error("boom-b");
    });
    await collector.attempt(async () => {
      order.push("c");
    });
    expect(order).toEqual(["a", "b", "c"]);
    try {
      collector.flush();
      expect.unreachable("flush should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors.map(String)).toEqual(["Error: boom-b"]);
      expect((error as Error).message).toBe("cleanup failed");
    }
  });

  it("无失败时 flush 不动作", async () => {
    const collector = createCleanupCollector();
    await collector.attempt(() => Promise.resolve());
    expect(() => collector.flush()).not.toThrow();
  });
});
