import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isHostError } from "../../shared/errors";
import { ManagedBotStore } from "./managed-bot-store";
import type { ManagedBotManifest } from "./managed-bot-store";
import { createManagedStateBackend } from "./state-backend";

const CONN = "conn_test";
const PROJECT = "version: 1\nproject: demo\n";
const STATE = '{"version":1,"resources":[]}\n';

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "v2-managed-"));
}

function manifest(scope: string, phase: ManagedBotManifest["phase"]): ManagedBotManifest {
  return {
    version: 1,
    scope,
    connectionId: CONN,
    provider: "qoder",
    projectName: "demo",
    phase,
  };
}

/** 直接在 scope 目录写文件（绕过 store，构造矩阵各组合）。 */
async function seed(
  store: ManagedBotStore,
  scope: string,
  files: { manifest?: string; project?: string; state?: string },
): Promise<string> {
  const dir = store.scopeDir(CONN, scope);
  await mkdir(dir, { recursive: true });
  if (files.manifest !== undefined)
    await writeFile(join(dir, "manifest.json"), files.manifest, "utf8");
  if (files.project !== undefined) await writeFile(join(dir, "agents.yaml"), files.project, "utf8");
  if (files.state !== undefined)
    await writeFile(join(dir, "agents.state.json"), files.state, "utf8");
  return dir;
}

describe("ManagedBotStore 原子写与布局", () => {
  it("createScope 建立随机稳定 scope 与 phase=new 的资料", async () => {
    const root = await makeRoot();
    try {
      const store = new ManagedBotStore(root);
      const m = await store.createScope({
        connectionId: CONN,
        provider: "qoder",
        projectName: "demo",
        projectYaml: PROJECT,
      });
      expect(m.scope).toMatch(/^scope_[0-9a-f]{16}$/);
      expect(m.phase).toBe("new");

      const dir = store.scopeDir(CONN, m.scope);
      expect(JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")).projectName).toBe(
        "demo",
      );
      expect(await readFile(join(dir, "agents.yaml"), "utf8")).toBe(PROJECT);
      // 新 scope 不应有 state（首次创建前）。
      const snapshot = await store.inspect(CONN, m.scope);
      expect(snapshot.hasState).toBe(false);
      expect(snapshot.integrity).toBe("new");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writeProject/writeManifest 覆盖写是原子的，不产生 .tmp 残留", async () => {
    const root = await makeRoot();
    try {
      const store = new ManagedBotStore(root);
      const m = await store.createScope({
        connectionId: CONN,
        provider: "qoder",
        projectName: "demo",
        projectYaml: PROJECT,
      });
      const dir = store.scopeDir(CONN, m.scope);
      await store.writeProject(dir, "version: 2\n");
      expect(await readFile(join(dir, "agents.yaml"), "utf8")).toBe("version: 2\n");
      const entries = await readdir(dir);
      expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writeProject 失败时旧 Project Document 保持不动且不调用后续步骤", async () => {
    const root = await makeRoot();
    try {
      const store = new ManagedBotStore(root);
      const m = await store.createScope({
        connectionId: CONN,
        provider: "qoder",
        projectName: "demo",
        projectYaml: PROJECT,
      });
      const dir = store.scopeDir(CONN, m.scope);
      await chmod(dir, 0o500);
      await expect(store.writeProject(dir, "version: 2\n")).rejects.toThrow();
      await chmod(dir, 0o700);
      expect(await readFile(join(dir, "agents.yaml"), "utf8")).toBe(PROJECT);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("ManagedBotStore 完整性矩阵", () => {
  const cases: Array<{
    name: string;
    phase?: ManagedBotManifest["phase"];
    project?: boolean;
    state?: boolean;
    stateCorrupt?: boolean;
    want: string;
  }> = [
    { name: "new + project，无 state", phase: "new", project: true, state: false, want: "new" },
    {
      name: "applying + project + state",
      phase: "applying",
      project: true,
      state: true,
      want: "interrupted-resumable",
    },
    {
      name: "applying + project，无 state",
      phase: "applying",
      project: true,
      state: false,
      want: "interrupted-unknown",
    },
    {
      name: "managed + project + state",
      phase: "managed",
      project: true,
      state: true,
      want: "managed",
    },
    {
      name: "managed + project，无 state -> state-missing",
      phase: "managed",
      project: true,
      state: false,
      want: "state-missing",
    },
    {
      name: "manifest + state，无 project -> project-missing",
      phase: "managed",
      project: false,
      state: true,
      want: "project-missing",
    },
    {
      name: "project + state，无 manifest -> interrupted-scope",
      project: true,
      state: true,
      want: "interrupted-scope",
    },
    {
      name: "managed + project + 损坏 state -> state-missing",
      phase: "managed",
      project: true,
      state: true,
      stateCorrupt: true,
      want: "state-missing",
    },
  ];

  for (const c of cases) {
    it(`分类：${c.name}`, async () => {
      const root = await makeRoot();
      try {
        const store = new ManagedBotStore(root);
        const scope = `scope_${c.want}`;
        const files: { manifest?: string; project?: string; state?: string } = {};
        if (c.phase !== undefined) files.manifest = JSON.stringify(manifest(scope, c.phase));
        if (c.project) files.project = PROJECT;
        if (c.state) files.state = c.stateCorrupt ? "{corrupt" : STATE;
        await seed(store, scope, files);
        const snapshot = await store.inspect(CONN, scope);
        expect(snapshot.integrity).toBe(c.want);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  it("损坏的 manifest 标记 manifestCorrupt 且不视为合法 manifest", async () => {
    const root = await makeRoot();
    try {
      const store = new ManagedBotStore(root);
      await seed(store, "scope_x", { manifest: "{not-json", project: PROJECT, state: STATE });
      const snapshot = await store.inspect(CONN, "scope_x");
      expect(snapshot.manifest).toBeNull();
      expect(snapshot.manifestCorrupt).toBe(true);
      // project + state，无合法 manifest -> interrupted-scope
      expect(snapshot.integrity).toBe("interrupted-scope");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("ManagedBotStore fail-closed 与配对备份", () => {
  it("从完整 OAP state 解析 managed Agent 对应的 Environment remote ID", async () => {
    const root = await makeRoot();
    try {
      const store = new ManagedBotStore(root);
      await seed(store, "scope_env", {
        manifest: JSON.stringify(manifest("scope_env", "managed")),
        project: PROJECT,
        state: STATE,
      });
      const dir = store.scopeDir(CONN, "scope_env");
      const backend = createManagedStateBackend(dir);
      await backend.write({ projectId: "demo" }, (state) => {
        state.setResource({
          address: { provider: "qoder", type: "agent", name: "Demo" },
          remote_id: "agent-1",
          content_hash: "agent-hash",
        });
        state.setResource({
          address: { provider: "qoder", type: "environment", name: "Demo-environment" },
          remote_id: "env-1",
          content_hash: "env-hash",
        });
      });

      await expect(store.findManagedEnvironmentId(CONN, "agent-1")).resolves.toBe("env-1");
      await expect(store.findManagedEnvironmentId(CONN, "remote-only")).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("state-missing 时 assertWritable 抛 managed-state-missing", async () => {
    const root = await makeRoot();
    try {
      const store = new ManagedBotStore(root);
      await seed(store, "scope_s", {
        manifest: JSON.stringify(manifest("scope_s", "managed")),
        project: PROJECT,
      });
      const error = await store.assertWritable(CONN, "scope_s").catch((e: unknown) => e);
      expect(isHostError(error)).toBe(true);
      expect((error as { code: string }).code).toBe("managed-state-missing");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("interrupted-unknown（applying 无 state）同样 fail-closed", async () => {
    const root = await makeRoot();
    try {
      const store = new ManagedBotStore(root);
      await seed(store, "scope_u", {
        manifest: JSON.stringify(manifest("scope_u", "applying")),
        project: PROJECT,
      });
      const error = await store.assertWritable(CONN, "scope_u").catch((e: unknown) => e);
      expect((error as { code: string }).code).toBe("managed-state-missing");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("成功 Sync 后 writePairBackup 成对复制 project 与 state", async () => {
    const root = await makeRoot();
    try {
      const store = new ManagedBotStore(root);
      const m = await store.createScope({
        connectionId: CONN,
        provider: "qoder",
        projectName: "demo",
        projectYaml: PROJECT,
      });
      const dir = store.scopeDir(CONN, m.scope);
      // 模拟 LocalFileStateBackend 写入 state（Stage 06 不经 SDK，只放文件）。
      await writeFile(join(dir, "agents.state.json"), STATE, "utf8");
      await store.writePairBackup(dir);

      // 配对备份同时存在且内容一致（恢复属未来能力，首版无生产调用方）。
      expect(await readFile(join(dir, "backup", "agents.yaml"), "utf8")).toBe(PROJECT);
      expect(await readFile(join(dir, "backup", "agents.state.json"), "utf8")).toBe(STATE);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("listScopes 以目录扫描作为索引，返回全部 scope 快照", async () => {
    const root = await makeRoot();
    try {
      const store = new ManagedBotStore(root);
      const a = await store.createScope({
        connectionId: CONN,
        provider: "qoder",
        projectName: "a",
        projectYaml: PROJECT,
      });
      const b = await store.createScope({
        connectionId: CONN,
        provider: "qoder",
        projectName: "b",
        projectYaml: PROJECT,
      });
      const listed = await store.listScopes(CONN);
      expect(listed.map((s) => s.scope).sort()).toEqual([a.scope, b.scope].sort());
      // 未知 Connection 返回空。
      expect(await store.listScopes("conn_none")).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("hasPendingProject：与配对 backup 文本不同为 true，相同为 false，backup 缺失为 null", async () => {
    const root = await makeRoot();
    try {
      const store = new ManagedBotStore(root);
      const m = await store.createScope({
        connectionId: CONN,
        provider: "qoder",
        projectName: "demo",
        projectYaml: PROJECT,
      });
      const dir = store.scopeDir(CONN, m.scope);

      // backup 缺失 → null（无法派生）。
      expect(await store.hasPendingProject(dir, PROJECT)).toBeNull();

      // 成功配对后与当前一致 → false（writePairBackup 成对复制 project 与 state）。
      await writeFile(join(dir, "agents.state.json"), STATE, "utf8");
      await store.writePairBackup(dir);
      expect(await store.hasPendingProject(dir, PROJECT)).toBe(false);

      // 当前与 backup 文本不同 → true。
      expect(await store.hasPendingProject(dir, "version: 1\nproject: changed\n")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("只删除指定 Connection 的本地管理资料", async () => {
    const root = await makeRoot();
    try {
      const store = new ManagedBotStore(root);
      await store.createScope({
        connectionId: CONN,
        provider: "qoder",
        projectName: "delete-me",
        projectYaml: PROJECT,
      });
      await store.createScope({
        connectionId: "conn_keep",
        provider: "qoder",
        projectName: "keep-me",
        projectYaml: PROJECT,
      });

      await store.removeConnectionData(CONN);

      expect(await store.listScopes(CONN)).toEqual([]);
      expect(await store.listScopes("conn_keep")).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
