import { describe, expect, it } from "vitest";
import { ScopeLock } from "./scope-lock";

describe("ScopeLock", () => {
  it("serializes concurrent operations on the same scope", async () => {
    const lock = new ScopeLock();
    const events: string[] = [];
    // first 在临界区内挂起，直到测试显式放行；second 排队等待。
    const gate = Promise.withResolvers<void>();

    const first = lock.runExclusive("scope-a", async () => {
      events.push("first:enter");
      await gate.promise;
      events.push("first:exit");
    });
    const second = lock.runExclusive("scope-a", async () => {
      events.push("second:enter");
      events.push("second:exit");
    });

    // 让两个 runExclusive 都进入队列；second 在 first 未放行前不得进入临界区。
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first:enter"]);

    gate.resolve();
    await Promise.all([first, second]);

    expect(events).toEqual(["first:enter", "first:exit", "second:enter", "second:exit"]);
  });

  it("allows different scopes to run in parallel", async () => {
    const lock = new ScopeLock();
    const order: string[] = [];
    // scope-a 挂起在 gate 上；scope-b 不应被阻塞。
    const gate = Promise.withResolvers<void>();

    const a = lock.runExclusive("scope-a", async () => {
      order.push("a:enter");
      await gate.promise;
      order.push("a:exit");
    });
    const b = lock.runExclusive("scope-b", async () => {
      order.push("b:enter");
      order.push("b:exit");
    });

    await b;
    expect(order).toEqual(["a:enter", "b:enter", "b:exit"]);

    gate.resolve();
    await a;
    expect(order).toEqual(["a:enter", "b:enter", "b:exit", "a:exit"]);
  });

  it("releases the lock when an operation throws so the next can proceed", async () => {
    const lock = new ScopeLock();
    await expect(
      lock.runExclusive("scope-a", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // 失败不阻塞后续操作。
    await expect(lock.runExclusive("scope-a", async () => "ok")).resolves.toBe("ok");
  });
});
