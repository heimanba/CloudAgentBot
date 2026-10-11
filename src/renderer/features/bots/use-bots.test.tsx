// @vitest-environment happy-dom

/**
 * useBots.archive 行为测试。保护的风险：
 * - 成功调用 host bots.archive 并触发 reload（重读 Provider 事实）；
 * - HostError 原样返回且不 reload；
 * - 未知错误收敛为 unavailable；
 * - 不做本地乐观删除（失败/成功都不改本地列表，靠 reload 收敛）。
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { act, useEffect } from "react";
import type { BotRef, BotView, HostError } from "@shared/models";
import type { DesktopHost } from "@shared/desktop-host-contract";
import { mount } from "../../test-support/mount";
import { useBots, type UseBotsResult } from "./use-bots";

const CONN = "conn-1";
const BOT: BotView = {
  ref: { connectionId: CONN, agentId: "agent-1" },
  name: "Helper",
  management: "managed",
};

interface Harness {
  result(): UseBotsResult;
  selectConnection(id: string): void;
  unmount(): void;
}

function UseBotsHarness({
  latestRef,
  connectionId,
}: {
  latestRef: { current: UseBotsResult | null };
  connectionId: string;
}) {
  const bots = useBots(connectionId);
  useEffect(() => {
    latestRef.current = bots;
  });
  return null;
}

function mountUseBots(host: DesktopHost["bots"]): Harness {
  (window as unknown as Record<string, unknown>).desktopHost = { bots: host };
  const latestRef: { current: UseBotsResult | null } = { current: null };
  const view = mount(<UseBotsHarness latestRef={latestRef} connectionId={CONN} />);
  return {
    selectConnection: (connectionId) =>
      act(() =>
        view.root.render(<UseBotsHarness latestRef={latestRef} connectionId={connectionId} />),
      ),
    result: () => {
      if (latestRef.current === null) throw new Error("hook not mounted");
      return latestRef.current;
    },
    unmount: view.unmount,
  };
}

function makeHost(overrides: Partial<DesktopHost["bots"]> = {}): DesktopHost["bots"] {
  return {
    list: () => Promise.resolve([BOT]),
    listSkills: () => Promise.resolve([]),
    listSkillCatalog: () => Promise.resolve([]),
    addSkillFromCatalog: () => Promise.reject({ code: "unavailable", message: "unused" }),
    get: () => Promise.resolve(BOT),
    getConfiguration: () => Promise.reject({ code: "not-found", message: "n/a" } as HostError),
    create: () => Promise.reject({ code: "unavailable", message: "n/a" } as HostError),
    update: () => Promise.resolve(BOT),
    sync: () => Promise.resolve(BOT),
    archive: () => Promise.resolve(),
    setShared: () => Promise.resolve({} as BotView),
    ...overrides,
  };
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).desktopHost;
  document.body.innerHTML = "";
});

describe("useBots.archive", () => {
  it("成功调用 host archive 并触发 reload 返回 null", async () => {
    const archive = vi.fn(() => Promise.resolve());
    const list = vi.fn(() => Promise.resolve([BOT]));
    const harness = mountUseBots(makeHost({ archive, list }));
    await act(async () => Promise.resolve());
    expect(list).toHaveBeenCalledTimes(1);

    const ref: BotRef = { connectionId: CONN, agentId: "agent-1" };
    let result: HostError | null = { code: "unavailable", message: "unset" };
    await act(async () => {
      result = await harness.result().archive(ref);
    });
    expect(result).toBeNull();
    expect(archive).toHaveBeenCalledWith(ref);
    // 成功后触发 reload：list 被再次调用。
    expect(list).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("HostError 原样返回且不 reload", async () => {
    const hostError: HostError = { code: "managed-state-missing", message: "state missing" };
    const archive = vi.fn(() => Promise.reject(hostError));
    const list = vi.fn(() => Promise.resolve([BOT]));
    const harness = mountUseBots(makeHost({ archive, list }));
    await act(async () => Promise.resolve());
    expect(list).toHaveBeenCalledTimes(1);
    expect(harness.result().bots).toEqual([BOT]);

    let result: HostError | null = null;
    await act(async () => {
      result = await harness.result().archive(BOT.ref);
    });
    expect(result).toEqual(hostError);
    expect(harness.result().bots).toEqual([BOT]);
    expect(list).toHaveBeenCalledTimes(1); // 无 reload
    harness.unmount();
  });

  it("未知错误收敛为 unavailable 且不 reload", async () => {
    const archive = vi.fn(() => Promise.reject(new Error("boom")));
    const list = vi.fn(() => Promise.resolve([BOT]));
    const harness = mountUseBots(makeHost({ archive, list }));
    await act(async () => Promise.resolve());

    let result: HostError | null = null;
    await act(async () => {
      result = await harness.result().archive(BOT.ref);
    });
    expect(result).toEqual({ code: "unavailable", message: "archive bot failed" });
    expect(list).toHaveBeenCalledTimes(1);
    harness.unmount();
  });
});

describe("共享后的目录读回", () => {
  it("等待读回后结束共享操作，失败保留目录，重试不重复写入", async () => {
    const readback = Promise.withResolvers<BotView[]>();
    const list = vi
      .fn()
      .mockResolvedValueOnce([BOT])
      .mockReturnValueOnce(readback.promise)
      .mockResolvedValueOnce([{ ...BOT, shared: true }]);
    const setShared = vi.fn(() => Promise.resolve({ ...BOT, shared: true }));
    const harness = mountUseBots(makeHost({ list, setShared }));
    await act(async () => {});
    let finished = false;
    let operation: Promise<HostError | null>;
    await act(async () => {
      operation = harness
        .result()
        .setShared(BOT.ref, true)
        .then((error) => {
          finished = true;
          return error;
        });
    });
    expect(finished).toBe(false);
    expect(harness.result().loading).toBe(true);
    expect(harness.result().bots).toEqual([BOT]);
    await act(async () => readback.reject({ code: "unavailable", message: "offline" }));
    expect(await operation!).toBeNull();
    expect(harness.result().error?.message).toContain("配置已同步，助手列表未更新");
    expect(harness.result().bots).toEqual([BOT]);
    await act(async () => {
      harness.result().reload();
    });
    expect(setShared).toHaveBeenCalledTimes(1);
    expect(harness.result().error).toBeNull();
    expect(harness.result().bots[0].shared).toBe(true);
    harness.unmount();
  });

  it("同步失败不触发目录读回或改变共享状态", async () => {
    const list = vi.fn(() => Promise.resolve([BOT]));
    const failure: HostError = { code: "unavailable", message: "sync failed" };
    const harness = mountUseBots(makeHost({ list, setShared: () => Promise.reject(failure) }));
    await act(async () => {});
    await act(async () => {
      expect(await harness.result().setShared(BOT.ref, true)).toEqual(failure);
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(harness.result().bots).toEqual([BOT]);
    harness.unmount();
  });

  it("旧连接读回和共享完成不能覆盖新连接目录", async () => {
    const oldRead = Promise.withResolvers<BotView[]>();
    const write = Promise.withResolvers<BotView>();
    const other = { ...BOT, name: "Other", ref: { ...BOT.ref, connectionId: "conn-2" } };
    const list = vi
      .fn()
      .mockResolvedValueOnce([BOT])
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce([other]);
    const harness = mountUseBots(makeHost({ list, setShared: () => write.promise }));
    await act(async () => {});
    act(() => {
      harness.result().reload();
      void harness.result().setShared(BOT.ref, true);
    });
    await act(async () => harness.selectConnection("conn-2"));
    await act(async () => {
      oldRead.resolve([{ ...BOT, shared: true }]);
      write.resolve(BOT);
    });
    expect(harness.result().bots).toEqual([other]);
    expect(list).toHaveBeenCalledTimes(3);
    harness.unmount();
  });
});

it("较早的目录请求晚到时不能覆盖最新刷新结果", async () => {
  const oldRead = Promise.withResolvers<BotView[]>();
  const list = vi
    .fn()
    .mockResolvedValueOnce([BOT])
    .mockReturnValueOnce(oldRead.promise)
    .mockResolvedValueOnce([{ ...BOT, description: "最新用途" }]);
  const harness = mountUseBots(makeHost({ list }));
  await act(async () => {});
  act(() => {
    harness.result().reload();
  });
  await act(async () => harness.result().reload());
  await act(async () => oldRead.resolve([{ ...BOT, description: "旧用途" }]));
  expect(harness.result().bots[0].description).toBe("最新用途");
  harness.unmount();
});
