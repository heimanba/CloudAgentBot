import { describe, expect, it } from "vitest";
import { createSseObserver, pollUntil } from "./sse-gate";
import type { ChatEventView } from "../../../src/shared/models";

/** 构造最小合法事件视图。 */
function eventOf(type: ChatEventView["type"]): ChatEventView {
  if (type === "token") return { type: "token", text: "hi" };
  if (type === "timeline") {
    return {
      type: "timeline",
      item: {
        id: "t1",
        rawType: "agent.message",
        kind: "message",
        role: "assistant",
        content: "x",
      },
    };
  }
  if (type === "error") return { type: "error", error: { code: "unavailable", message: "boom" } };
  return { type: "done" };
}

describe("createSseObserver", () => {
  it("计数、日志、token/done/error 语义与既有 live 观察块一致", () => {
    const observer = createSseObserver();
    observer.track(eventOf("token"));
    observer.track(eventOf("token"));
    observer.track(eventOf("timeline"));
    observer.track(eventOf("done"));
    observer.track(eventOf("error"));
    expect(observer.counts).toEqual({ token: 2, timeline: 1, done: 1, error: 1 });
    expect(observer.tokenFrames).toBe(2);
    expect(observer.doneSeen).toBe(true);
    expect(observer.errors).toEqual(["unavailable"]);
    expect(observer.log).toHaveLength(5);
  });

  it("日志上限 60 条防证据洪泛，计数不受影响", () => {
    const observer = createSseObserver();
    for (let index = 0; index < 80; index += 1) observer.track(eventOf("token"));
    expect(observer.log).toHaveLength(60);
    expect(observer.counts.token).toBe(80);
  });
});

describe("pollUntil", () => {
  it("read 返回非 null 即返回该值", async () => {
    let calls = 0;
    const result = await pollUntil(
      async () => {
        calls += 1;
        return calls < 3 ? null : "ready";
      },
      "probe",
      5_000,
      1,
    );
    expect(result).toBe("ready");
    expect(calls).toBe(3);
  });

  it("超时抛出带标签的错误", async () => {
    await expect(pollUntil(async () => null, "session idle", 40, 5)).rejects.toThrowError(
      /session idle did not complete within/,
    );
  });
});
