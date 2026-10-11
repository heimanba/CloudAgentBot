/**
 * BotControlPlane.archive 单元测试。
 * 归档只调用 `@openagentpack/sdk` 包根 `archiveCloudAgent`（整体 mock，Provider 副作用不
 * 进入单元测试）；验证点：managed scope 定位与锁内复核、凭据/provider 注入、fail-closed
 * 门禁、并发串行化、本地文件在成功/失败路径均不变、不触发 Sync 写路径或删除方法。
 * 真实 Cloud 归档结果见 tests/live/bot-archive.live.test.ts。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CONN, mockArchiveRuntime, mockSdkSuccess, sdkMocks } from "./bot-control-plane.testkit";

// vi.mock 被 hoisted 到文件顶部（先于 testkit 顶层 import 完成），factory 内必须动态
// import testkit 取 sdkMocks，避免 TDZ。factory 惰性执行，动态 import 不影响测试时序。
vi.mock("@openagentpack/sdk", async (importOriginal) => {
  const { sdkMocks } = await import("./bot-control-plane.testkit");
  const actual = await importOriginal<typeof import("@openagentpack/sdk")>();
  return {
    ...actual,
    syncProjectResourcesWithStateBackend: sdkMocks.syncProjectResourcesWithStateBackend,
    resolveProjectConfigFromObject: sdkMocks.resolveProjectConfigFromObject,
    readProjectRuntime: sdkMocks.readProjectRuntime,
    archiveCloudAgent: sdkMocks.archiveCloudAgent,
  };
});

import { BotControlPlane } from "./bot-control-plane";
import { ManagedBotStore } from "./managed-bot-store";
import { ScopeLock } from "./scope-lock";
import { ApiError, LocalFileStateBackend } from "@openagentpack/sdk";

/** 构造 store + plane（qoder 凭据）；可注入默认 Environment 解析。 */
function makePlane(
  root: string,
  options?: {
    resolveDefaultEnvironmentId?: (connectionId: string) => Promise<string | null>;
  },
) {
  const store = new ManagedBotStore(root);
  const lock = new ScopeLock();
  const plane = new BotControlPlane({
    store,
    lock,
    resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "PAT_SECRET" }),
    resolveDefaultEnvironmentId:
      options?.resolveDefaultEnvironmentId ?? (async () => "env_shared_123"),
  });
  return { store, plane, lock };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BotControlPlane.archive", () => {
  /** 创建 managed Bot 并返回 ref 与 scope dir；归档测试统一入口。 */
  async function createManaged(root: string, agentId = "agent-arch") {
    const { store, plane, lock } = makePlane(root);
    mockSdkSuccess(agentId);
    const view = await plane.create(CONN, { name: "Demo", description: "d" });
    const snapshot = await store.findScopeByAgentId(CONN, agentId);
    return { store, plane, lock, view, scope: snapshot!.scope, dir: snapshot!.dir };
  }

  it("完整 Managed Bot：以 state 中的 agentId 调用一次 archiveCloudAgent，本地文件不变", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane, view, dir } = await createManaged(root);
      mockArchiveRuntime();
      sdkMocks.archiveCloudAgent.mockResolvedValue(undefined);

      const projectBefore = await readFile(join(dir, "agents.yaml"), "utf8");
      const stateBefore = await readFile(join(dir, "agents.state.json"), "utf8");
      const manifestBefore = await readFile(join(dir, "manifest.json"), "utf8");
      const backupProjectBefore = await readFile(join(dir, "backup", "agents.yaml"), "utf8");
      const backupStateBefore = await readFile(join(dir, "backup", "agents.state.json"), "utf8");

      await expect(plane.archive(view.ref)).resolves.toBeUndefined();

      expect(sdkMocks.archiveCloudAgent).toHaveBeenCalledTimes(1);
      const [, archivedId, archiveOpts] = sdkMocks.archiveCloudAgent.mock.calls[0]!;
      expect(archivedId).toBe("agent-arch");
      expect(archiveOpts).toEqual({ provider: "qoder" });

      // 本地资料逐一保持不变。
      expect(await readFile(join(dir, "agents.yaml"), "utf8")).toBe(projectBefore);
      expect(await readFile(join(dir, "agents.state.json"), "utf8")).toBe(stateBefore);
      expect(await readFile(join(dir, "manifest.json"), "utf8")).toBe(manifestBefore);
      expect(await readFile(join(dir, "backup", "agents.yaml"), "utf8")).toBe(backupProjectBefore);
      expect(await readFile(join(dir, "backup", "agents.state.json"), "utf8")).toBe(
        backupStateBefore,
      );
      // 归档不触发 Sync 写路径。
      expect(sdkMocks.syncProjectResourcesWithStateBackend).toHaveBeenCalledTimes(1); // 仅 create
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("coordinator 归档只归档当前 Agent，成员与 Project Document 原样保留", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-lead");
      const view = await plane.create(CONN, {
        name: "Lead",
        memberAgentIds: ["agent_member_a", "agent_member_b"],
      });
      const snapshot = await store.findScopeByAgentId(CONN, "agent-lead");
      const projectBefore = await readFile(join(snapshot!.dir, "agents.yaml"), "utf8");
      mockArchiveRuntime();
      sdkMocks.archiveCloudAgent.mockResolvedValue(undefined);

      await plane.archive(view.ref);

      // 只归档当前 Bot；成员是外部引用，不随本 scope 归档。
      expect(sdkMocks.archiveCloudAgent).toHaveBeenCalledTimes(1);
      expect(sdkMocks.archiveCloudAgent.mock.calls[0]![1]).toBe("agent-lead");
      expect(await readFile(join(snapshot!.dir, "agents.yaml"), "utf8")).toBe(projectBefore);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Qoder runtime 只注入当前 Connection credential，provider option 为 qoder", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane, view } = await createManaged(root);
      mockArchiveRuntime();
      sdkMocks.archiveCloudAgent.mockResolvedValue(undefined);

      await plane.archive(view.ref);

      const runtimeInput = sdkMocks.readProjectRuntime.mock.calls[0]![0] as {
        providers: Record<string, unknown>;
      };
      expect(runtimeInput.providers).toEqual({ qoder: { api_key: "PAT_SECRET" } });
      expect(sdkMocks.archiveCloudAgent.mock.calls[0]![2]).toEqual({ provider: "qoder" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("百炼 runtime 注入 credential 与 workspace_id，provider option 为 bailian", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const store = new ManagedBotStore(root);
      const lock = new ScopeLock();
      const plane = new BotControlPlane({
        store,
        lock,
        resolveCredential: () =>
          Promise.resolve({ provider: "bailian", credential: "DASH_SECRET", workspaceId: "ws-1" }),
        resolveDefaultEnvironmentId: async () => "env_shared",
      });
      // 百炼创建路径：seed state 标记 provider=bailian 的 agent。
      sdkMocks.resolveProjectConfigFromObject.mockImplementation(
        (raw: unknown, opts: { projectName: string }) =>
          Promise.resolve({ config: raw, projectName: opts.projectName }),
      );
      sdkMocks.syncProjectResourcesWithStateBackend.mockImplementation(
        async (input: {
          stateBackend: LocalFileStateBackend;
          stateScope: { projectId: string };
        }) => {
          await input.stateBackend.write(input.stateScope, (state) => {
            state.setResource({
              address: { provider: "bailian", type: "agent", name: "Demo" },
              remote_id: "agent-bailian",
              content_hash: "h",
            });
          });
          return { planned: [], execution: { results: [], partial: false } };
        },
      );
      const view = await plane.create(CONN, { name: "Demo" });
      mockArchiveRuntime();
      sdkMocks.archiveCloudAgent.mockResolvedValue(undefined);

      await plane.archive(view.ref);

      const runtimeInput = sdkMocks.readProjectRuntime.mock.calls[0]![0] as {
        providers: Record<string, unknown>;
      };
      expect(runtimeInput.providers).toEqual({
        bailian: { api_key: "DASH_SECRET", workspace_id: "ws-1" },
      });
      expect(sdkMocks.archiveCloudAgent.mock.calls[0]![1]).toBe("agent-bailian");
      expect(sdkMocks.archiveCloudAgent.mock.calls[0]![2]).toEqual({ provider: "bailian" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("无匹配 scope（Remote-only）：not-found 且 archive 零调用", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane } = makePlane(root);
      mockArchiveRuntime();
      await expect(plane.archive({ connectionId: CONN, agentId: "nope" })).rejects.toMatchObject({
        code: "not-found",
      });
      expect(sdkMocks.archiveCloudAgent).not.toHaveBeenCalled();
      expect(sdkMocks.readProjectRuntime).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("state 缺失/损坏、缺 manifest、缺 Project：远程 mutation 前 fail-closed", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane, view, dir } = await createManaged(root);
      mockArchiveRuntime();

      // state 损坏（配对 backup 仍定位到 scope，锁内 assertWritable fail-closed）。
      await writeFile(join(dir, "agents.state.json"), "corrupt", "utf8");
      await expect(plane.archive(view.ref)).rejects.toMatchObject({
        code: "managed-state-missing",
      });
      expect(sdkMocks.archiveCloudAgent).not.toHaveBeenCalled();

      // state 缺失：同样 managed-state-missing。
      const {
        plane: planeMissing,
        view: viewMissing,
        dir: dirMissing,
      } = await (async () => {
        const store2 = new ManagedBotStore(join(root, "second"));
        const p = new BotControlPlane({
          store: store2,
          lock: new ScopeLock(),
          resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "PAT_SECRET" }),
          resolveDefaultEnvironmentId: async () => "env_shared_123",
        });
        mockSdkSuccess("agent-m2");
        const v = await p.create(CONN, { name: "Demo" });
        const snap = await store2.findScopeByAgentId(CONN, "agent-m2");
        return { plane: p, view: v, dir: snap!.dir };
      })();
      await rm(join(dirMissing, "agents.state.json"));
      mockArchiveRuntime();
      await expect(planeMissing.archive(viewMissing.ref)).rejects.toMatchObject({
        code: "managed-state-missing",
      });
      expect(sdkMocks.archiveCloudAgent).not.toHaveBeenCalled();

      // 缺 manifest：state 完好但 manifest 缺失 → not-found（不猜测归属）。
      const {
        plane: planeNoManifest,
        view: viewNoManifest,
        dir: dirNoManifest,
      } = await (async () => {
        const store3 = new ManagedBotStore(join(root, "third"));
        const p = new BotControlPlane({
          store: store3,
          lock: new ScopeLock(),
          resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "PAT_SECRET" }),
          resolveDefaultEnvironmentId: async () => "env_shared_123",
        });
        mockSdkSuccess("agent-m3");
        const v = await p.create(CONN, { name: "Demo" });
        const snap = await store3.findScopeByAgentId(CONN, "agent-m3");
        return { plane: p, view: v, dir: snap!.dir };
      })();
      await rm(join(dirNoManifest, "manifest.json"));
      mockArchiveRuntime();
      await expect(planeNoManifest.archive(viewNoManifest.ref)).rejects.toMatchObject({
        code: "not-found",
      });
      expect(sdkMocks.archiveCloudAgent).not.toHaveBeenCalled();

      // 缺 Project（agents.yaml）：锁内 fail-closed → managed-state-missing。
      const {
        plane: planeNoProject,
        view: viewNoProject,
        dir: dirNoProject,
      } = await (async () => {
        const store4 = new ManagedBotStore(join(root, "fourth"));
        const p = new BotControlPlane({
          store: store4,
          lock: new ScopeLock(),
          resolveCredential: () => Promise.resolve({ provider: "qoder", credential: "PAT_SECRET" }),
          resolveDefaultEnvironmentId: async () => "env_shared_123",
        });
        mockSdkSuccess("agent-m4");
        const v = await p.create(CONN, { name: "Demo" });
        const snap = await store4.findScopeByAgentId(CONN, "agent-m4");
        return { plane: p, view: v, dir: snap!.dir };
      })();
      await rm(join(dirNoProject, "agents.yaml"));
      mockArchiveRuntime();
      await expect(planeNoProject.archive(viewNoProject.ref)).rejects.toMatchObject({
        code: "managed-state-missing",
      });
      expect(sdkMocks.archiveCloudAgent).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("manifest Provider 与 Connection Provider 不一致：conflict 且零 mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane, view, dir } = await createManaged(root);
      mockArchiveRuntime();
      // 把 manifest provider 改成 bailian（Connection 仍是 qoder）。
      const manifestPath = join(dir, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
      manifest.provider = "bailian";
      await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

      await expect(plane.archive(view.ref)).rejects.toMatchObject({ code: "conflict" });
      expect(sdkMocks.archiveCloudAgent).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Provider 错误经 toControlPlaneError 稳定映射；本地文件不变", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane, view, dir } = await createManaged(root);
      mockArchiveRuntime();
      const projectBefore = await readFile(join(dir, "agents.yaml"), "utf8");
      sdkMocks.archiveCloudAgent.mockRejectedValue(new ApiError(403, "Forbidden", "archive agent"));

      await expect(plane.archive(view.ref)).rejects.toMatchObject({ code: "permission" });
      expect(await readFile(join(dir, "agents.yaml"), "utf8")).toBe(projectBefore);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("同 scope 的 archive 与 sync 串行（不并行进入 Provider mutation）", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane, view } = await createManaged(root);
      mockArchiveRuntime();

      const events: string[] = [];
      const archiveGate = Promise.withResolvers<void>();
      const archiveEntered = Promise.withResolvers<void>();
      sdkMocks.archiveCloudAgent.mockImplementation(async () => {
        events.push("archive:enter");
        archiveEntered.resolve();
        await archiveGate.promise;
        events.push("archive:exit");
      });
      sdkMocks.syncProjectResourcesWithStateBackend.mockImplementation(
        async (input: {
          stateBackend: LocalFileStateBackend;
          stateScope: { projectId: string };
        }) => {
          events.push("sync:enter");
          await input.stateBackend.write(input.stateScope, (state) => {
            state.setResource({
              address: { provider: "qoder", type: "agent", name: "Demo" },
              remote_id: "agent-arch",
              content_hash: "h",
            });
          });
          events.push("sync:exit");
          return { planned: [], execution: { results: [], partial: false } };
        },
      );

      // archive 先发起并确认已进入 mutation（持锁），再发起 sync：sync 必然排队，
      // 避免两调用公平竞争同 scope 锁导致的调度顺序不确定。
      const archiving = plane.archive(view.ref);
      await archiveEntered.promise;
      const syncing = plane.sync(view.ref);
      archiveGate.resolve();
      await Promise.all([archiving, syncing]);

      // archive 完整退出后 sync 才进入（锁串行）。
      expect(events).toEqual(["archive:enter", "archive:exit", "sync:enter", "sync:exit"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("不同 scope 的归档不被全局锁串行化", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane } = makePlane(root);
      mockSdkSuccess("agent-a");
      const viewA = await plane.create(CONN, { name: "A" });
      mockSdkSuccess("agent-b");
      const viewB = await plane.create(CONN, { name: "B" });
      mockArchiveRuntime();

      const aGate = Promise.withResolvers<void>();
      const aEntered = Promise.withResolvers<void>();
      const bEntered = Promise.withResolvers<void>();
      const events: string[] = [];
      sdkMocks.archiveCloudAgent.mockImplementation(async (_rt: unknown, id: string) => {
        if (id === "agent-a") {
          events.push("a:enter");
          aEntered.resolve();
          await aGate.promise;
          events.push("a:exit");
        } else {
          events.push("b:enter");
          bEntered.resolve();
        }
      });

      const archivingA = plane.archive(viewA.ref);
      await aEntered.promise;
      const archivingB = plane.archive(viewB.ref);
      // B 在 A 仍持锁时已进入 mutation：不同 scope 并行。
      await bEntered.promise;
      expect(events).toEqual(["a:enter", "b:enter"]);
      aGate.resolve();
      await Promise.all([archivingA, archivingB]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("首次定位后 state 被改变：锁内复核失败且零 mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    const release = Promise.withResolvers<void>();
    let holding: Promise<void> | undefined;
    try {
      const { plane, lock, view, scope, dir } = await createManaged(root);
      const entered = Promise.withResolvers<void>();
      holding = lock.runExclusive(scope, async () => {
        entered.resolve();
        await release.promise;
      });
      await entered.promise;

      // 仅用 spy 观察排队边界，互斥和回调仍由真实 ScopeLock 执行。
      const queued = Promise.withResolvers<void>();
      const runExclusive = lock.runExclusive.bind(lock);
      vi.spyOn(lock, "runExclusive").mockImplementationOnce(
        <T>(key: string, fn: () => Promise<T>): Promise<T> => {
          const result = runExclusive(key, fn);
          queued.resolve();
          return result;
        },
      );
      mockArchiveRuntime();
      sdkMocks.archiveCloudAgent.mockResolvedValue(undefined);
      const archiving = plane.archive(view.ref);
      const rejected = expect(archiving).rejects.toMatchObject({ code: "managed-state-missing" });
      await queued.promise;

      // 首次定位已成功，archive 仍在等锁；改为另一 Agent 后再释放锁。
      const backend = new LocalFileStateBackend({ statePath: join(dir, "agents.state.json") });
      await backend.write({ projectId: "x" }, (state) => {
        state.setResource({
          address: { provider: "qoder", type: "agent", name: "Demo" },
          remote_id: "agent-other",
          content_hash: "h",
        });
      });
      release.resolve();
      await holding;
      await rejected;
      expect(sdkMocks.archiveCloudAgent).not.toHaveBeenCalled();
      expect(sdkMocks.readProjectRuntime).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await holding;
      await rm(root, { recursive: true, force: true });
    }
  });
});
