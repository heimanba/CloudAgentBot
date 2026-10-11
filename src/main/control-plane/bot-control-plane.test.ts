/**
 * BotControlPlane 单元测试（create/sync/update/getConfiguration）。
 * OpenAgentPack SDK 的 Sync 被整体 mock（Provider 副作用不进入单元测试）；
 * 验证点：本地资料写入顺序与内容、phase 流转、凭据注入位置、失败语义、
 * fail-closed 门禁、backup 生成。远程行为由 live smoke 证明。
 * 文档编辑（读取/合并 YAML 形状）见 project-document.test.ts；
 * archive 场景见同目录 bot-control-plane-archive.test.ts；共享助手见 testkit。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtemp, chmod, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  CONN,
  DEFAULT_INSTRUCTIONS,
  DEFAULT_MODEL,
  fullInput,
  mockSdkSuccess,
  sdkMocks,
  syncedAgentRaw,
  syncedAgents,
} from "./bot-control-plane.testkit";

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
    createProjectRuntime: sdkMocks.createProjectRuntime,
    listSkills: sdkMocks.listSkills,
  };
});

import { BotControlPlane } from "./bot-control-plane";
import { ManagedBotStore } from "./managed-bot-store";
import { ScopeLock } from "./scope-lock";
import type { LocalFileStateBackend } from "@openagentpack/sdk";
import { apiKeyScopeId } from "../api-key-scope";

/** 构造 store + plane；可注入默认 Environment 解析。 */
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
  return { store, plane };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BotControlPlane.listSkills", () => {
  it("为 Qoder 已安装 Skill 暴露市场来源 ID", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane } = makePlane(root);
      sdkMocks.resolveProjectConfigFromObject.mockResolvedValue({
        projectName: "openagentbot-skill-catalog",
        config: { defaults: { provider: "qoder" } },
      });
      sdkMocks.createProjectRuntime.mockReturnValue({});
      sdkMocks.listSkills
        .mockResolvedValueOnce([
          {
            id: "skill_installed",
            name: "deep-research",
            source: "custom",
            status: "active",
            attributes: { metadata: { marketplace_skill_id: "official_1" } },
          },
        ])
        .mockResolvedValueOnce([]);

      await expect(plane.listSkills(CONN)).resolves.toEqual([
        expect.objectContaining({
          skillId: "skill_installed",
          marketplaceSkillId: "official_1",
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("百炼我的 Skills 只返回可挂载 custom 项并固定具体版本", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const store = new ManagedBotStore(root);
      const plane = new BotControlPlane({
        store,
        lock: new ScopeLock(),
        resolveCredential: () =>
          Promise.resolve({ provider: "bailian", credential: "SECRET", workspaceId: "ws-1" }),
        resolveDefaultEnvironmentId: async () => "env-1",
      });
      sdkMocks.resolveProjectConfigFromObject.mockResolvedValue({
        projectName: "openagentbot-skill-catalog",
        config: { defaults: { provider: "bailian" } },
      });
      sdkMocks.createProjectRuntime.mockReturnValue({});
      sdkMocks.listSkills.mockResolvedValueOnce([
        {
          id: "skill_custom",
          name: "Custom",
          source: "custom",
          status: "active",
          latest_version: "1.2",
        },
        { id: "skill_checking", name: "Checking", source: "custom", status: "checking" },
      ]);

      await expect(plane.listSkills(CONN)).resolves.toEqual([
        {
          type: "custom",
          skillId: "skill_custom",
          version: "1.2",
          latestVersion: "1.2",
          name: "Custom",
        },
      ]);
      expect(sdkMocks.listSkills).toHaveBeenCalledTimes(1);
      expect(sdkMocks.listSkills).toHaveBeenCalledWith(expect.anything(), {
        provider: "bailian",
        source: "custom",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("BotControlPlane.create", () => {
  it("共享开关先更新 Project Document 再 Sync，保留其他 metadata 与远程身份", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-share-"));
    try {
      const { plane } = makePlane(root);
      mockSdkSuccess("agent-shared");
      const created = await plane.create(CONN, {
        name: "Demo",
        metadata: { openagentbot_template: "示例模板" },
      });
      const shared = await plane.setShared(created.ref, true);
      expect(shared).toMatchObject({ ref: created.ref, shared: true, management: "managed" });
      const syncCalls = sdkMocks.syncProjectResourcesWithStateBackend.mock.calls;
      const config = syncCalls.at(-1)?.[0]?.config;
      const agent = syncedAgentRaw(config, "Demo");
      expect(agent.metadata).toEqual({
        openagentbot_template: "示例模板",
        openagentbot_shared: "true",
        openagentbot_key_scope: apiKeyScopeId("qoder", "PAT_SECRET"),
      });
      expect(sdkMocks.syncProjectResourcesWithStateBackend).toHaveBeenCalledTimes(2);
      const unshared = await plane.setShared(created.ref, false);
      expect(unshared).toMatchObject({ ref: created.ref, shared: false });
      expect(
        syncedAgentRaw(
          sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.at(-1)?.[0]?.config,
          "Demo",
        ).metadata,
      ).toEqual({
        openagentbot_template: "示例模板",
        openagentbot_shared: "",
        openagentbot_key_scope: apiKeyScopeId("qoder", "PAT_SECRET"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("写盘前拒绝当前 Provider 不支持的内置工具", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane } = makePlane(root);
      await expect(
        plane.create(CONN, { name: "Demo", builtinTools: ["mark_artifacts"] }),
      ).rejects.toMatchObject({ code: "invalid-input" });
      expect(sdkMocks.syncProjectResourcesWithStateBackend).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("Connection 未设置共享环境时拒绝创建", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root, {
        resolveDefaultEnvironmentId: async () => null,
      });

      await expect(plane.create(CONN, { name: "Demo" })).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringContaining("environment"),
      });

      // 不产生任何本地 scope。
      expect(await store.listScopes(CONN)).toEqual([]);
      expect(sdkMocks.syncProjectResourcesWithStateBackend).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("百炼未验证模型 fail-closed 拒绝；验证列表内模型透传进 agents.yaml", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const store = new ManagedBotStore(root);
      const plane = new BotControlPlane({
        store,
        lock: new ScopeLock(),
        resolveCredential: () =>
          Promise.resolve({
            provider: "bailian",
            credential: "DASHSCOPE_SECRET",
            workspaceId: "ws-1",
          }),
        resolveDefaultEnvironmentId: async () => "env_bailian_1",
      });

      // 未验证模型：任何本地资料与远程副作用之前拒绝。
      await expect(plane.create(CONN, { name: "Demo", model: "qwen3-max" })).rejects.toMatchObject({
        code: "invalid-input",
      });
      expect(await store.listScopes(CONN)).toEqual([]);
      expect(sdkMocks.syncProjectResourcesWithStateBackend).not.toHaveBeenCalled();

      // 验证列表内模型：写入 agents.yaml 并进入 Sync。
      mockSdkSuccess("agent-b1");
      await plane.create(CONN, { name: "Demo", model: "glm-5.2" });
      const snapshot = await store.findScopeByAgentId(CONN, "agent-b1");
      const yaml = await readFile(join(snapshot!.dir, "agents.yaml"), "utf8");
      expect(yaml).toContain("model: glm-5.2");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("成功路径：资料先落盘，凭据仅经 providers 注入，最终 phase=managed 且生成 backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-42");

      const view = await plane.create(CONN, { name: "Demo", description: "d" });

      expect(view).toMatchObject({
        ref: { connectionId: CONN, agentId: "agent-42" },
        name: "Demo",
        description: "d",
        management: "managed",
      });

      // Sync 收到的 providers 注入包含凭据；config 是 agents.yaml 解析结果。
      expect(sdkMocks.syncProjectResourcesWithStateBackend).toHaveBeenCalledTimes(1);
      const [syncInput, syncOpts] = sdkMocks.syncProjectResourcesWithStateBackend.mock.calls[0]!;
      expect(syncInput.providers).toEqual({ qoder: { api_key: "PAT_SECRET" } });
      expect(syncOpts).toEqual({ policy: "force" });

      // scope 目录包含 project + manifest + state；backup/ 下成对备份。
      const scopeDirs = await readdir(join(root, CONN));
      expect(scopeDirs).toHaveLength(1);
      const dir = join(root, CONN, scopeDirs[0]!);
      const entries = await readdir(dir);
      expect(entries).toContain("agents.yaml");
      expect(entries).toContain("manifest.json");
      expect(entries).toContain("agents.state.json");
      const backupEntries = await readdir(join(dir, "backup"));
      expect(backupEntries).toContain("agents.yaml");
      expect(backupEntries).toContain("agents.state.json");

      // 凭据不落盘：agents.yaml 无凭据。
      const yamlOnDisk = await readFile(join(dir, "agents.yaml"), "utf8");
      expect(yamlOnDisk).not.toContain("PAT_SECRET");

      // manifest 终态 managed，且不复制远程 ID。
      const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
      expect(manifest.phase).toBe("managed");
      expect(JSON.stringify(manifest)).not.toContain("agent-42");

      // 资料快照可反查。
      const found = await store.findScopeByAgentId(CONN, "agent-42");
      expect(found?.scope).toBe(scopeDirs[0]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Provider 失败：资料保留，phase 停 applying，无 backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      sdkMocks.resolveProjectConfigFromObject.mockImplementation(
        (raw: unknown, opts: { projectName: string }) =>
          Promise.resolve({ config: raw, projectName: opts.projectName }),
      );
      sdkMocks.syncProjectResourcesWithStateBackend.mockRejectedValue(new Error("network down"));

      await expect(plane.create(CONN, { name: "Demo" })).rejects.toMatchObject({
        code: "unavailable",
      });

      const scopes = await store.listScopes(CONN);
      expect(scopes).toHaveLength(1);
      expect(scopes[0]?.manifest?.phase).toBe("applying");
      expect(scopes[0]?.hasProject).toBe(true);
      expect(scopes[0]?.hasState).toBe(false);
      const entries = await readdir(scopes[0]!.dir);
      expect(entries).not.toContain("backup");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Sync 成功但 state 无 agentId：报 sync-incomplete，phase 停 applying", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      sdkMocks.resolveProjectConfigFromObject.mockImplementation(
        (raw: unknown, opts: { projectName: string }) =>
          Promise.resolve({ config: raw, projectName: opts.projectName }),
      );
      sdkMocks.syncProjectResourcesWithStateBackend.mockResolvedValue({
        planned: [],
        execution: { results: [], partial: false },
      });

      await expect(plane.create(CONN, { name: "Demo" })).rejects.toMatchObject({
        code: "sync-incomplete",
      });
      const scopes = await store.listScopes(CONN);
      expect(scopes[0]?.manifest?.phase).toBe("applying");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("BotControlPlane.sync", () => {
  it("state 被删除但配对 backup 存在时 sync 报 managed-state-missing 且零 SDK mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      // 先成功创建（state 记录 agent-x，scope 可经 findScopeByAgentId 定位）。
      mockSdkSuccess("agent-x");
      await plane.create(CONN, { name: "Demo" });
      const snapshot = await store.findScopeByAgentId(CONN, "agent-x");
      expect(snapshot).not.toBeNull();

      // 模拟 state 丢失：删除当前 state；配对 backup 仍在（成功 Sync 留下的历史关联）。
      await rm(join(snapshot!.dir, "agents.state.json"));

      const callsBefore = sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length;
      // 当前 state 反查失败 → backup 只读反查定位 scope → 锁内 assertWritable
      // 按当前完整性 fail-closed：managed-state-missing，无任何新的 SDK mutation。
      await expect(plane.sync({ connectionId: CONN, agentId: "agent-x" })).rejects.toMatchObject({
        code: "managed-state-missing",
      });
      expect(sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length).toBe(callsBefore);

      // backup 未被恢复/复制到当前 state：当前 state 仍缺失。
      expect((await store.inspect(CONN, snapshot!.scope)).hasState).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("state 与 backup 同时缺失时 sync 报 not-found 且零 SDK mutation（不猜测归属）", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-x");
      await plane.create(CONN, { name: "Demo" });
      const snapshot = await store.findScopeByAgentId(CONN, "agent-x");
      expect(snapshot).not.toBeNull();

      // 当前 state 与配对 backup 均缺失：无任何可信关联，保持 not-found。
      await rm(join(snapshot!.dir, "agents.state.json"));
      await rm(join(snapshot!.dir, "backup"), { recursive: true, force: true });

      const callsBefore = sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length;
      await expect(plane.sync({ connectionId: CONN, agentId: "agent-x" })).rejects.toMatchObject({
        code: "not-found",
      });
      expect(sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length).toBe(callsBefore);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("state 损坏但配对 backup 存在时 sync 报 managed-state-missing 且零 SDK mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-x");
      await plane.create(CONN, { name: "Demo" });
      const snapshot = await store.findScopeByAgentId(CONN, "agent-x");
      expect(snapshot).not.toBeNull();

      // 模拟 state 损坏：当前 state 不可解析；配对 backup 仍存有历史关联。
      await rm(join(snapshot!.dir, "agents.state.json"));
      await writeFile(join(snapshot!.dir, "agents.state.json"), "{ not-json", "utf8");

      const callsBefore = sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length;
      await expect(plane.sync({ connectionId: CONN, agentId: "agent-x" })).rejects.toMatchObject({
        code: "managed-state-missing",
      });
      expect(sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length).toBe(callsBefore);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("锁内 state 被删除时在 Provider mutation 前 fail-closed（TOCTOU 关闭）", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-t");
      const view = await plane.create(CONN, { name: "Demo" });

      const snapshot = await store.findScopeByAgentId(CONN, "agent-t");

      // 包装 assertWritable：第一次（第一个 sync）原样放行；第二次（第二个 sync，
      // 已进入锁）先删除 state 再校验——模拟“定位后、锁内校验前 state 被删除”的
      // TOCTOU 窗口。此时必须 fail-closed，且不触发任何 Provider 调用。
      const originalAssert = store.assertWritable.bind(store);
      let assertCalls = 0;
      let syncCallsBeforeSecondAssert = 0;
      store.assertWritable = async (connectionId: string, scope: string) => {
        assertCalls += 1;
        if (assertCalls === 2) {
          syncCallsBeforeSecondAssert =
            sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length;
          await rm(join(snapshot!.dir, "agents.state.json"));
        }
        return originalAssert(connectionId, scope);
      };

      await plane.sync(view.ref);
      await expect(plane.sync(view.ref)).rejects.toMatchObject({ code: "managed-state-missing" });
      expect(assertCalls).toBe(2);
      // 第二个 sync 的失败发生在任何新的 Provider Sync 之前。
      expect(sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length).toBe(
        syncCallsBeforeSecondAssert,
      );
      expect(snapshot).not.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("非本机管理的 agentId 报 not-found", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane } = makePlane(root);
      await expect(
        plane.sync({ connectionId: CONN, agentId: "agent-elsewhere" }),
      ).rejects.toMatchObject({ code: "not-found" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("sync 不修改 Project Document", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo", description: "keep" });

      const snapshot = await store.findScopeByAgentId(CONN, "agent-9");
      const before = await readFile(join(snapshot!.dir, "agents.yaml"), "utf8");

      mockSdkSuccess("agent-9");
      await plane.sync(view.ref);

      const after = await readFile(join(snapshot!.dir, "agents.yaml"), "utf8");
      expect(after).toBe(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("create 后可对同一 Bot 手动 sync，生成 backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-7");
      const view = await plane.create(CONN, { name: "Demo" });

      mockSdkSuccess("agent-7");
      const synced = await plane.sync(view.ref);
      expect(synced.ref.agentId).toBe("agent-7");
      expect(sdkMocks.syncProjectResourcesWithStateBackend).toHaveBeenCalledTimes(2);
      // 成功 Sync 生成 project + state 成对 backup（与成功路径断言的备份布局一致）。
      const snapshot = await store.findScopeByAgentId(CONN, "agent-7");
      const backupEntries = await readdir(join(snapshot!.dir, "backup"));
      expect(backupEntries).toContain("agents.yaml");
      expect(backupEntries).toContain("agents.state.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("BotControlPlane.update", () => {
  it("先写完整新版 agents.yaml 再直接 Sync；成功更新 backup 并返回新名称/描述", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo", description: "old" });

      mockSdkSuccess("agent-9");
      const updated = await plane.update(
        view.ref,
        fullInput({
          name: "Renamed",
          description: "new desc",
          instructions: "Be terse.",
          model: "efficient",
        }),
      );

      expect(updated).toMatchObject({
        ref: { connectionId: CONN, agentId: "agent-9" },
        name: "Renamed",
        description: "new desc",
        model: "efficient",
        management: "managed",
      });
      expect(sdkMocks.syncProjectResourcesWithStateBackend).toHaveBeenCalledTimes(2);

      // Sync 收到的 config 是新版 agents.yaml 的解析结果。
      const [syncInput] = sdkMocks.syncProjectResourcesWithStateBackend.mock.calls[1]!;
      const agents = syncedAgents(syncInput.config);
      expect(agents["Demo"]?.name).toBe("Renamed");
      expect(agents["Demo"]?.description).toBe("new desc");
      expect(agents["Demo"]?.instructions).toBe("Be terse.");
      expect(agents["Demo"]?.model).toBe("efficient");

      // 磁盘上的期望配置与配对备份都已是新版。
      const snapshot = await store.findScopeByAgentId(CONN, "agent-9");
      const yamlOnDisk = await readFile(join(snapshot!.dir, "agents.yaml"), "utf8");
      const parsed = parseYaml(yamlOnDisk) as {
        agents: Record<string, Record<string, unknown>>;
      };
      expect(parsed.agents["Demo"]).toMatchObject({
        name: "Renamed",
        description: "new desc",
        instructions: "Be terse.",
        model: "efficient",
        environment: "default",
      });
      const backupYaml = await readFile(join(snapshot!.dir, "backup", "agents.yaml"), "utf8");
      expect(backupYaml).toContain("Renamed");

      // phase 保持 managed；agents.yaml 不含凭据。
      const manifest = JSON.parse(await readFile(join(snapshot!.dir, "manifest.json"), "utf8"));
      expect(manifest.phase).toBe("managed");
      expect(yamlOnDisk).not.toContain("PAT_SECRET");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Sync 失败后本地新版期望配置保留，phase 保持 managed，可重试并作用于同一 Agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo", description: "old" });

      sdkMocks.syncProjectResourcesWithStateBackend.mockRejectedValueOnce(
        new Error("network down"),
      );
      await expect(
        plane.update(view.ref, fullInput({ description: "pending" })),
      ).rejects.toMatchObject({
        code: "unavailable",
      });

      // 本地期望配置已是新版；旧 backup 保持 create 时的配对（不被半成品覆盖）。
      const snapshot = await store.findScopeByAgentId(CONN, "agent-9");
      const yamlOnDisk = await readFile(join(snapshot!.dir, "agents.yaml"), "utf8");
      expect(yamlOnDisk).toContain("pending");
      const backupYaml = await readFile(join(snapshot!.dir, "backup", "agents.yaml"), "utf8");
      expect(backupYaml).toContain("old");
      const manifest = JSON.parse(await readFile(join(snapshot!.dir, "manifest.json"), "utf8"));
      expect(manifest.phase).toBe("managed");

      // 重试作用于 state 指向的同一 Agent，成功后 backup 前进到新版。
      mockSdkSuccess("agent-9");
      const retried = await plane.update(view.ref, fullInput({ description: "pending" }));
      expect(retried.ref.agentId).toBe("agent-9");
      const backupAfter = await readFile(join(snapshot!.dir, "backup", "agents.yaml"), "utf8");
      expect(backupAfter).toContain("pending");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("update 时 Project Document 写失败：旧配置保持不动且不调用 Provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo", description: "old" });
      expect(sdkMocks.syncProjectResourcesWithStateBackend).toHaveBeenCalledTimes(1);

      // 让 scope 目录只读，使 update 的 writeProject 失败（fail-closed 在 SDK 之前）。
      const snapshot = await store.findScopeByAgentId(CONN, "agent-9");
      const dir = snapshot!.dir;
      await chmod(dir, 0o500);
      let failed: unknown;
      try {
        await plane
          .update(view.ref, fullInput({ description: "should-not-apply" }))
          .catch((e) => (failed = e));
      } finally {
        await chmod(dir, 0o700);
      }
      expect(failed).toBeDefined();
      // 写失败发生在 SDK 调用前：Provider 不被触及。
      expect(sdkMocks.syncProjectResourcesWithStateBackend).toHaveBeenCalledTimes(1);
      // 旧期望配置原样保留。
      const yamlOnDisk = await readFile(join(dir, "agents.yaml"), "utf8");
      expect(yamlOnDisk).toContain("old");
      expect(yamlOnDisk).not.toContain("should-not-apply");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("state 被删除但配对 backup 存在时 update 报 managed-state-missing 且零 SDK mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo" });

      const snapshot = await store.findScopeByAgentId(CONN, "agent-9");
      // 当前 state 删除；配对 backup 仍在。update 经 backup 只读定位 scope 后
      // 由锁内 assertWritable fail-closed：managed-state-missing，零 SDK mutation。
      await rm(join(snapshot!.dir, "agents.state.json"));

      const callsBefore = sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length;
      await expect(plane.update(view.ref, fullInput({ name: "X" }))).rejects.toMatchObject({
        code: "managed-state-missing",
      });
      expect(sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length).toBe(callsBefore);
      // backup 未被恢复/复制到当前 state：当前 state 仍缺失。
      expect((await store.inspect(CONN, snapshot!.scope)).hasState).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("state 与 backup 同时缺失时 update 报 not-found 且零 SDK mutation（不猜测归属）", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo" });

      const snapshot = await store.findScopeByAgentId(CONN, "agent-9");
      await rm(join(snapshot!.dir, "agents.state.json"));
      await rm(join(snapshot!.dir, "backup"), { recursive: true, force: true });

      const callsBefore = sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length;
      await expect(plane.update(view.ref, fullInput())).rejects.toMatchObject({
        code: "not-found",
      });
      expect(sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length).toBe(callsBefore);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("非本机管理的 agentId 报 not-found", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane } = makePlane(root);
      await expect(
        plane.update({ connectionId: CONN, agentId: "agent-elsewhere" }, fullInput()),
      ).rejects.toMatchObject({ code: "not-found" });
      expect(sdkMocks.syncProjectResourcesWithStateBackend).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("description 显式传空串清除描述，name 按输入保留", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo", description: "keep-me" });

      // 完整四字段：name 改名时 description 按输入保留。
      mockSdkSuccess("agent-9");
      const renamed = await plane.update(
        view.ref,
        fullInput({ name: "Renamed", description: "keep-me" }),
      );
      expect(renamed.description).toBe("keep-me");
      const snapshot = await store.findScopeByAgentId(CONN, "agent-9");
      let parsed = parseYaml(await readFile(join(snapshot!.dir, "agents.yaml"), "utf8")) as {
        agents: Record<string, Record<string, unknown>>;
      };
      expect(parsed.agents["Demo"]!.description).toBe("keep-me");

      // 显式空串：清除描述，name 按输入保留。
      mockSdkSuccess("agent-9");
      const cleared = await plane.update(view.ref, fullInput({ name: "Renamed", description: "" }));
      expect(cleared.name).toBe("Renamed");
      expect(cleared.description).toBe("");
      parsed = parseYaml(await readFile(join(snapshot!.dir, "agents.yaml"), "utf8")) as {
        agents: Record<string, Record<string, unknown>>;
      };
      expect(parsed.agents["Demo"]!.name).toBe("Renamed");
      expect(parsed.agents["Demo"]!.description).toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("手改过的 agents.yaml（多 agent/缺 agents 段/非法条目）报 invalid-input，不触发 Provider 且磁盘不变", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo", description: "orig" });

      const snapshot = await store.findScopeByAgentId(CONN, "agent-9");
      const dir = snapshot!.dir;
      const originalYaml = await readFile(join(dir, "agents.yaml"), "utf8");

      const cases: string[] = [
        // 多 agent
        'version: "1"\nagents:\n  a:\n    name: a\n  b:\n    name: b\n',
        // 缺 agents 段
        'version: "1"\nproviders:\n  qoder: {}\n',
        // agent 条目非法（非对象）
        'version: "1"\nagents:\n  Demo: "oops"\n',
      ];
      for (const content of cases) {
        await writeFile(join(dir, "agents.yaml"), content, "utf8");
        const callsBefore = sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length;
        await expect(plane.update(view.ref, fullInput({ description: "x" }))).rejects.toMatchObject(
          {
            code: "invalid-input",
          },
        );
        expect(sdkMocks.syncProjectResourcesWithStateBackend.mock.calls.length).toBe(callsBefore);
        // 失败发生在写盘之前：用户手改的文件原样保留，不被半成品覆盖。
        expect(await readFile(join(dir, "agents.yaml"), "utf8")).toBe(content);
        await writeFile(join(dir, "agents.yaml"), originalYaml, "utf8");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("同 scope 的并发 update 串行执行（第二个等待第一个完成）", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo" });

      // 用 withResolvers 门控第一个 Sync：第二个 update 必须在第一个完成后才进入 SDK。
      const firstEntered = Promise.withResolvers<void>();
      const firstGate = Promise.withResolvers<void>();
      const events: string[] = [];
      let callIndex = 0;
      sdkMocks.syncProjectResourcesWithStateBackend.mockImplementation(
        async (input: {
          stateBackend: LocalFileStateBackend;
          stateScope: { projectId: string };
        }) => {
          const mine = callIndex++;
          events.push(`enter:${mine}`);
          if (mine === 0) {
            firstEntered.resolve();
            await firstGate.promise;
          }
          // 第二个调用进入时，第一个必须已退出（锁串行）。
          if (mine === 1) expect(events).toEqual(["enter:0", "exit:0", "enter:1"]);
          await input.stateBackend.write(input.stateScope, (state) => {
            state.setResource({
              address: { provider: "qoder", type: "agent", name: "Demo" },
              remote_id: "agent-9",
              content_hash: "h",
            });
          });
          events.push(`exit:${mine}`);
          return { planned: [], execution: { results: [], partial: false } };
        },
      );

      const first = plane.update(view.ref, fullInput({ description: "a" }));
      const second = plane.update(view.ref, fullInput({ description: "b" }));
      // 第一个已进入 SDK（持锁）后放行；第二个若未串行会在 exit:0 前进入并触发断言。
      await firstEntered.promise;
      firstGate.resolve();
      await Promise.all([first, second]);

      expect(events).toEqual(["enter:0", "exit:0", "enter:1", "exit:1"]);
      // create 消耗 1 次 Sync，两个 update 各 1 次。
      expect(sdkMocks.syncProjectResourcesWithStateBackend).toHaveBeenCalledTimes(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("BotControlPlane.getConfiguration", () => {
  it("读取四字段期望配置；pending=false（与成功 backup 一致）", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo", description: "old" });

      const cfg = await plane.getConfiguration(view.ref);
      expect(cfg.ref).toEqual(view.ref);
      expect(cfg.name).toBe("Demo");
      expect(cfg.description).toBe("old");
      expect(cfg.instructions).toBe(DEFAULT_INSTRUCTIONS);
      expect(cfg.model).toBe(DEFAULT_MODEL);
      expect(cfg.hasPendingChanges).toBe(false);
      // Qoder：枚举失败降级为仅当前模型（当前模型固定第一项）。
      expect(cfg.models[0]?.value).toBe(DEFAULT_MODEL);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Remote-only 引用报 not-found", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane } = makePlane(root);
      await expect(
        plane.getConfiguration({ connectionId: CONN, agentId: "nope" }),
      ).rejects.toMatchObject({ code: "not-found" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("state 损坏时 fail-closed 报 managed-state-missing，不读取配置", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo", description: "old" });

      const snapshot = await store.findScopeByAgentId(CONN, "agent-9");
      await writeFile(join(snapshot!.dir, "agents.state.json"), "corrupt", "utf8");

      await expect(plane.getConfiguration(view.ref)).rejects.toMatchObject({
        code: "managed-state-missing",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Sync 失败后 hasPendingChanges=true；再次成功 Sync 后回到 false", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo", description: "old" });

      // Sync 失败：本地新版保留，backup 仍为旧版 → pending=true。
      sdkMocks.syncProjectResourcesWithStateBackend.mockRejectedValueOnce(
        new Error("network down"),
      );
      await expect(
        plane.update(view.ref, fullInput({ description: "pending" })),
      ).rejects.toMatchObject({ code: "unavailable" });

      const cfgPending = await plane.getConfiguration(view.ref);
      expect(cfgPending.description).toBe("pending");
      expect(cfgPending.hasPendingChanges).toBe(true);

      // 再次成功 Sync：backup 前进到新版 → pending=false。
      mockSdkSuccess("agent-9");
      await plane.sync(view.ref);
      const cfgSynced = await plane.getConfiguration(view.ref);
      expect(cfgSynced.hasPendingChanges).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("SDK 返回资源执行失败时不把本地配置标为已同步", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo", description: "old" });
      sdkMocks.syncProjectResourcesWithStateBackend.mockResolvedValueOnce({
        planned: [],
        execution: {
          partial: true,
          results: [{ status: "failed", error: new Error("provider rejected update") }],
        },
      });

      await expect(plane.update(view.ref, fullInput({ description: "new" }))).rejects.toMatchObject(
        { code: "unavailable" },
      );
      const config = await plane.getConfiguration(view.ref);
      expect(config.description).toBe("new");
      expect(config.hasPendingChanges).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("合并保留逻辑 key、projectName、environment 与未开放 YAML 字段", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-9");
      const view = await plane.create(CONN, { name: "Demo", description: "old" });

      const snapshot = await store.findScopeByAgentId(CONN, "agent-9");
      const dir = snapshot!.dir;
      // 手工加入未开放字段（tools/skills/metadata/顶层未知键）模拟真实扩展文档。
      const enriched = parseYaml(await readFile(join(dir, "agents.yaml"), "utf8")) as Record<
        string,
        unknown
      >;
      const agents = enriched.agents as Record<string, Record<string, unknown>>;
      agents["Demo"]!.tools = { group: ["fs"] };
      agents["Demo"]!.skills = [{ type: "custom", skill_id: "skill_doc_read", version: "1.0" }];
      agents["Demo"]!.metadata = { team: "ops" };
      enriched.custom_top = { keep: true };
      await writeFile(join(dir, "agents.yaml"), stringifyYaml(enriched), "utf8");
      // backup 与当前保持一致，避免 pending 干扰。
      await store.writePairBackup(dir);

      mockSdkSuccess("agent-9");
      await plane.update(
        view.ref,
        fullInput({
          name: "Renamed",
          description: "new",
          instructions: "Be terse.",
          model: "efficient",
        }),
      );

      const after = parseYaml(await readFile(join(dir, "agents.yaml"), "utf8")) as Record<
        string,
        unknown
      >;
      expect(after.custom_top).toEqual({ keep: true }); // 顶层未知键保留
      expect(after.environments).toBeDefined(); // environments 段不变
      const agentsAfter = after.agents as Record<string, Record<string, unknown>>;
      const agent = agentsAfter["Demo"]!; // 逻辑 key 不变
      expect(agent.name).toBe("Renamed");
      expect(agent.description).toBe("new");
      expect(agent.instructions).toBe("Be terse.");
      expect(agent.model).toBe("efficient");
      expect(agent.tools).toEqual({ group: ["fs"] });
      expect(agent.skills).toEqual([]);
      expect(agent.metadata).toEqual({
        team: "ops",
        openagentbot_key_scope: apiKeyScopeId("qoder", "PAT_SECRET"),
      });
      expect(agent.environment).toBe("default"); // environment 不变
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("BotControlPlane 协作成员（roster）", () => {
  const MEMBERS = ["agent_member_a", "agent_member_b"];
  const asRecord = (value: string) => parseYaml(value) as { agents: Record<string, unknown> };

  it("create 带成员：只写 external refs，state/manifest 不含成员", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-lead");

      const view = await plane.create(CONN, { name: "Lead", memberAgentIds: MEMBERS });

      // Sync 收到的 config 是 external refs：不写逻辑名成员，不写 Provider wire payload。
      const [syncInput] = sdkMocks.syncProjectResourcesWithStateBackend.mock.calls[0]!;
      expect(syncedAgentRaw(syncInput.config, "Lead").multiagent).toEqual({
        type: "coordinator",
        agents: [{ agent_id: "agent_member_a" }, { agent_id: "agent_member_b" }],
      });

      // 磁盘 Project Document 同形状；成员不进入 scope state 或 manifest。
      const snapshot = await store.findScopeByAgentId(CONN, "agent-lead");
      const agent = (asRecord(await readFile(join(snapshot!.dir, "agents.yaml"), "utf8")).agents[
        "Lead"
      ] ?? {}) as Record<string, unknown>;
      expect(agent.multiagent).toEqual({
        type: "coordinator",
        agents: [{ agent_id: "agent_member_a" }, { agent_id: "agent_member_b" }],
      });
      const backupYaml = await readFile(join(snapshot!.dir, "backup", "agents.yaml"), "utf8");
      expect(backupYaml).toContain("agent_member_a");
      const stateRaw = await readFile(join(snapshot!.dir, "agents.state.json"), "utf8");
      expect(stateRaw).not.toContain("agent_member_a");
      const manifestRaw = await readFile(join(snapshot!.dir, "manifest.json"), "utf8");
      expect(manifestRaw).not.toContain("agent_member_a");
      expect(view.ref.agentId).toBe("agent-lead");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("getConfiguration 返回成员 roster 与 YAML 顺序", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { plane } = makePlane(root);
      mockSdkSuccess("agent-lead");
      const view = await plane.create(CONN, { name: "Lead", memberAgentIds: MEMBERS });

      const cfg = await plane.getConfiguration(view.ref);

      expect(cfg.memberAgentIds).toEqual(MEMBERS);
      expect(cfg.hasPendingChanges).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("update 替换与清空 roster：写盘与 Sync config 一致；空数组删除 multiagent 键", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-lead");
      const view = await plane.create(CONN, { name: "Lead", memberAgentIds: MEMBERS });
      const snapshot = await store.findScopeByAgentId(CONN, "agent-lead");
      const dir = snapshot!.dir;

      const replaced = ["agent_member_b", "agent_member_c"];
      mockSdkSuccess("agent-lead");
      await plane.update(view.ref, fullInput({ name: "Lead", memberAgentIds: replaced }));

      const [replaceSync] = sdkMocks.syncProjectResourcesWithStateBackend.mock.calls[1]!;
      expect(syncedAgentRaw(replaceSync.config, "Lead").multiagent).toEqual({
        type: "coordinator",
        agents: [{ agent_id: "agent_member_b" }, { agent_id: "agent_member_c" }],
      });
      const afterReplace = (asRecord(await readFile(join(dir, "agents.yaml"), "utf8")).agents[
        "Lead"
      ] ?? {}) as Record<string, unknown>;
      expect(afterReplace.multiagent).toEqual({
        type: "coordinator",
        agents: [{ agent_id: "agent_member_b" }, { agent_id: "agent_member_c" }],
      });
      expect(await readFile(join(dir, "agents.yaml"), "utf8")).not.toContain("agent_member_a");

      mockSdkSuccess("agent-lead");
      await plane.update(view.ref, fullInput({ name: "Lead" }));

      // 清空 = 完整删除 multiagent 键（磁盘与 Sync config 都不再出现）。
      const [clearSync] = sdkMocks.syncProjectResourcesWithStateBackend.mock.calls[2]!;
      expect(syncedAgentRaw(clearSync.config, "Lead")).not.toHaveProperty("multiagent");
      const afterClear = (asRecord(await readFile(join(dir, "agents.yaml"), "utf8")).agents[
        "Lead"
      ] ?? {}) as Record<string, unknown>;
      expect(afterClear).not.toHaveProperty("multiagent");
      const cfg = await plane.getConfiguration(view.ref);
      expect(cfg.memberAgentIds).toEqual([]);
      expect(cfg.hasPendingChanges).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("update roster 含自身 agentId：写文件与 Provider mutation 前 invalid-input", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-self");
      const view = await plane.create(CONN, { name: "Demo" });
      expect(sdkMocks.syncProjectResourcesWithStateBackend).toHaveBeenCalledTimes(1);
      const snapshot = await store.findScopeByAgentId(CONN, "agent-self");
      const before = await readFile(join(snapshot!.dir, "agents.yaml"), "utf8");

      await expect(
        plane.update(view.ref, fullInput({ memberAgentIds: ["agent_other", "agent-self"] })),
      ).rejects.toMatchObject({
        code: "invalid-input",
        message: "a bot cannot include itself as a collaboration member",
      });

      // 零 Provider mutation 且磁盘不变。
      expect(sdkMocks.syncProjectResourcesWithStateBackend).toHaveBeenCalledTimes(1);
      expect(await readFile(join(snapshot!.dir, "agents.yaml"), "utf8")).toBe(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Sync 失败保留本地 roster 且 backup 不变；retry 成功后 pending 消失", async () => {
    const root = await mkdtemp(join(tmpdir(), "v2-cp-"));
    try {
      const { store, plane } = makePlane(root);
      mockSdkSuccess("agent-lead");
      const view = await plane.create(CONN, { name: "Lead" });
      const snapshot = await store.findScopeByAgentId(CONN, "agent-lead");
      const dir = snapshot!.dir;

      sdkMocks.syncProjectResourcesWithStateBackend.mockRejectedValueOnce(
        new Error("network down"),
      );
      await expect(
        plane.update(view.ref, fullInput({ name: "Lead", memberAgentIds: MEMBERS })),
      ).rejects.toMatchObject({ code: "unavailable" });

      // 本地新版 roster 保留；旧 backup 不被半成品覆盖；pending=true。
      expect(await readFile(join(dir, "agents.yaml"), "utf8")).toContain("agent_member_a");
      expect(await readFile(join(dir, "backup", "agents.yaml"), "utf8")).not.toContain(
        "multiagent",
      );
      const cfgPending = await plane.getConfiguration(view.ref);
      expect(cfgPending.memberAgentIds).toEqual(MEMBERS);
      expect(cfgPending.hasPendingChanges).toBe(true);

      // retry sync 直接应用当前 Project Document：backup 前进，pending 消失。
      mockSdkSuccess("agent-lead");
      await plane.sync(view.ref);
      expect(await readFile(join(dir, "backup", "agents.yaml"), "utf8")).toContain(
        "agent_member_a",
      );
      const cfgSynced = await plane.getConfiguration(view.ref);
      expect(cfgSynced.memberAgentIds).toEqual(MEMBERS);
      expect(cfgSynced.hasPendingChanges).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
