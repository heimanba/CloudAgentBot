/**
 * Stage 07 真实 Cloud 创建 smoke（MUTATING，自动清理）。
 * 运行：OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/qoder-bot-create.live.test.ts
 *
 * 覆盖 validation.md Stage 07 用户流程（经真实 BotControlPlane，不绕过产品路径）：
 * - create：本地 IaC 文件先落盘（agents.yaml 无凭据），直接 SDK Sync 创建远程 Agent；
 * - phase 终态 managed，state 记录远程 agentId，backup/ 成对备份存在；
 * - 远程可经 QoderDataClient 发现该 Agent（名字唯一前缀），且同前缀无重复 Agent；
 * - sync：再次对同一 Bot 直接 Sync，成功返回且不产生重复远程 Agent；
 * - cleanup：删除 Agent；环境被引用时退到 archive。
 *
 * 资源名用唯一前缀 `openagentbot-v2s07-<stamp>-<suffix>`。凭据从当前仓库 .env 或环境变量读取，
 * 不出现在日志、断言消息或磁盘文件中。
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QoderDataClient } from "../../src/main/data-plane/providers/qoder/qoder-client";
import { BotControlPlane } from "../../src/main/control-plane/bot-control-plane";
import { ManagedBotStore } from "../../src/main/control-plane/managed-bot-store";
import { ScopeLock } from "../../src/main/control-plane/scope-lock";
import { requireQoderPat } from "./support/credentials";
import { deleteQoderResource } from "./support/rest";
import { createTestEnvironment } from "./support/project";
import { uniqueTestPrefix } from "./support/naming";

const LIVE = process.env.OPENAGENTBOT_LIVE === "1";

// Bot 逻辑名 = 远程显示名来源；唯一前缀保证可识别、可断言无重复。
const botName = uniqueTestPrefix("v2s07");
const CONN = "conn_live_s07";

describe.skipIf(!LIVE)("qoder bot create live (mutating, auto-cleanup)", () => {
  const pat = LIVE ? requireQoderPat() : "";
  const rawClient = LIVE
    ? new QoderDataClient({ apiKey: pat })
    : (null as unknown as QoderDataClient);

  let root = "";
  let agentId: string | undefined;
  let envId: string | undefined;

  afterAll(async () => {
    if (agentId) await deleteQoderResource(pat, "agent", agentId).catch(() => {});
    if (envId) await deleteQoderResource(pat, "environment", envId).catch(() => {});
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("creates a managed bot via BotControlPlane, syncs again without duplicates, cleans up", async () => {
    // 新模型：Bot 引用 Connection 共享环境，不自动创建。先创建测试环境。
    const envName = `${botName}-environment`;
    envId = await createTestEnvironment(
      "qoder",
      envName,
      { qoderPat: pat },
      {
        description: "CloudAgentBot live test environment",
        testLabel: "bot-create",
        testRun: botName,
      },
    );

    root = await mkdtemp(join(tmpdir(), "v2s07-live-"));
    const store = new ManagedBotStore(join(root, "managed-bots"));
    const plane = new BotControlPlane({
      store,
      lock: new ScopeLock(),
      resolveCredential: () => Promise.resolve({ provider: "qoder", credential: pat }),
      resolveDefaultEnvironmentId: () => Promise.resolve(envId!),
    });

    const view = await plane.create(CONN, { name: botName, description: "stage07 live smoke" });
    agentId = view.ref.agentId;
    expect(view.management).toBe("managed");
    expect(view.name).toBe(botName);
    expect(view.ref.connectionId).toBe(CONN);

    // 本地资料完整：agents.yaml / manifest.json / agents.state.json / backup/。
    const scopes = await store.listScopes(CONN);
    expect(scopes).toHaveLength(1);
    const scopeDir = scopes[0]!.dir;
    expect(scopes[0]!.integrity).toBe("managed");
    const entries = await readdir(scopeDir);
    expect(entries).toContain("agents.yaml");
    expect(entries).toContain("manifest.json");
    expect(entries).toContain("agents.state.json");
    const backupEntries = await readdir(join(scopeDir, "backup"));
    expect(backupEntries).toContain("agents.yaml");
    expect(backupEntries).toContain("agents.state.json");

    // 凭据不落盘。
    const yamlOnDisk = await readFile(join(scopeDir, "agents.yaml"), "utf8");
    expect(yamlOnDisk).not.toContain(pat);
    const stateOnDisk = await readFile(join(scopeDir, "agents.state.json"), "utf8");
    expect(stateOnDisk).not.toContain(pat);

    // 远程可发现；state 中的 environment remote_id 必须等于预创建的共享环境 ID。
    const stateRaw = JSON.parse(stateOnDisk) as {
      resources?: Record<string, { address: { type: string }; remote_id?: string }>;
    };
    const resources = Object.values(stateRaw.resources ?? {});
    expect(resources.find((r) => r.address.type === "agent")?.remote_id).toBe(agentId);
    const stateEnvId = resources.find((r) => r.address.type === "environment")?.remote_id;
    expect(stateEnvId).toBe(envId);

    const remoteAgents = await rawClient.listAgents();
    const matching = remoteAgents.filter(
      (a) => (a.name as string | undefined)?.startsWith("openagentbot-v2s07-") ?? false,
    );
    // 唯一前缀：除本测试创建的 1 个外，同前缀无残留/重复 Agent。
    expect(matching).toHaveLength(1);
    expect(matching[0]?.id).toBe(agentId);

    // 再次 sync 同一 Bot：成功、不产生重复远程 Agent。
    const synced = await plane.sync(view.ref);
    expect(synced.ref.agentId).toBe(agentId);
    const afterSync = await rawClient.listAgents();
    expect(
      afterSync.filter(
        (a) => (a.name as string | undefined)?.startsWith("openagentbot-v2s07-") ?? false,
      ),
    ).toHaveLength(1);
  }, 180_000);
});
