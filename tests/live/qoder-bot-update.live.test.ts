/**
 * Stage 08 真实 Cloud 更新 smoke（MUTATING，自动清理）。
 * 运行：OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/qoder-bot-update.live.test.ts
 *
 * 覆盖 validation.md Stage 08 用户流程（经真实 BotControlPlane，不绕过产品路径）：
 * - update：先保存完整新版本地期望配置（agents.yaml 无凭据），再直接 SDK Sync；
 *   远程 Agent 描述更新，agentId 不变，同名 Agent 唯一；
 * - 重试：对同一 Bot 再次 update，仍作用于同一远程 Agent（无新建）；
 * - no-op：同值 update 与手动 sync 收敛于同一远程 Agent，不产生重复；
 * - fail-closed：删除 agents.state.json 后 update 报 managed-state-missing
 *   （配对 backup 只读定位 scope，零 SDK mutation），远程 Agent 未被改动；
 * - cleanup：删除 Agent；环境被引用时退到 archive。
 *
 * 资源名用唯一前缀 `openagentbot-v2s08-<stamp>-<suffix>`；远程唯一性断言按完整
 * botName 精确匹配，不受历史同前缀残留影响。凭据从当前仓库 .env 或环境变量读取，
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

const botName = uniqueTestPrefix("v2s08");
const CONN = "conn_live_s08";

/** 完整五字段 update 输入（roster 空 = 普通 Bot）；描述可变，其余沿创建默认值（qoder 模型 auto）。 */
function fullInput(description: string) {
  return {
    name: botName,
    description,
    instructions:
      "You are a helpful assistant managed by CloudAgentBot. Answer concisely and accurately.",
    model: "auto",
    memberAgentIds: [],
  };
}

describe.skipIf(!LIVE)("qoder bot update live (mutating, auto-cleanup)", () => {
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

  it("updates description on the same remote agent; retries converge; state-missing fails closed", async () => {
    // 新模型：Bot 引用 Connection 共享环境，不自动创建。先创建测试环境。
    const envName = `${botName}-environment`;
    envId = await createTestEnvironment(
      "qoder",
      envName,
      { qoderPat: pat },
      {
        description: "CloudAgentBot live test environment",
        testLabel: "bot-update",
        testRun: botName,
      },
    );

    root = await mkdtemp(join(tmpdir(), "v2s08-live-"));
    const store = new ManagedBotStore(join(root, "managed-bots"));
    const plane = new BotControlPlane({
      store,
      lock: new ScopeLock(),
      resolveCredential: () => Promise.resolve({ provider: "qoder", credential: pat }),
      resolveDefaultEnvironmentId: () => Promise.resolve(envId!),
    });

    const view = await plane.create(CONN, { name: botName, description: "stage08 before" });
    agentId = view.ref.agentId;

    const scopes = await store.listScopes(CONN);
    expect(scopes).toHaveLength(1);
    const scopeDir = scopes[0]!.dir;

    // state 中的 environment remote_id 必须等于预创建的共享环境 ID。
    const stateRaw = JSON.parse(await readFile(join(scopeDir, "agents.state.json"), "utf8")) as {
      resources?: Record<string, { address: { type: string }; remote_id?: string }>;
    };
    const stateEnvId = Object.values(stateRaw.resources ?? {}).find(
      (r) => r.address.type === "environment",
    )?.remote_id;
    expect(stateEnvId).toBe(envId);

    // update：新版期望配置先落盘（无凭据），Sync 后远程描述更新、agentId 不变。
    const updated = await plane.update(view.ref, fullInput("stage08 after"));
    expect(updated.ref.agentId).toBe(agentId);
    expect(updated.management).toBe("managed");

    const yamlOnDisk = await readFile(join(scopeDir, "agents.yaml"), "utf8");
    expect(yamlOnDisk).toContain("stage08 after");
    expect(yamlOnDisk).not.toContain(pat);

    const findById = async (id: string) =>
      (await rawClient.listAgents()).find((a) => a.id === id) as
        { id: string; name?: string; description?: string } | undefined;

    const remoteAfter = await findById(agentId);
    expect(remoteAfter?.description).toBe("stage08 after");

    // 唯一性用精确 botName 匹配，不受历史同前缀残留影响。
    const matching = (await rawClient.listAgents()).filter((a) => a.name === botName);
    expect(matching).toHaveLength(1);
    expect(matching[0]?.id).toBe(agentId);

    // 重试：再次 update 仍作用于同一远程 Agent，不产生重复。
    const retried = await plane.update(view.ref, fullInput("stage08 retry"));
    expect(retried.ref.agentId).toBe(agentId);
    const afterRetry = (await rawClient.listAgents()).filter((a) => a.name === botName);
    expect(afterRetry).toHaveLength(1);

    // no-op：同值 update 收敛于同一远程 Agent；手动 sync 同样不产生重复。
    const noop = await plane.update(view.ref, fullInput("stage08 retry"));
    expect(noop.ref.agentId).toBe(agentId);
    const synced = await plane.sync(view.ref);
    expect(synced.ref.agentId).toBe(agentId);
    const afterNoop = (await rawClient.listAgents()).filter((a) => a.name === botName);
    expect(afterNoop).toHaveLength(1);

    // fail-closed：删除当前 state 后 update 报 managed-state-missing（配对 backup 仍
    // 存有历史 agentId 关联，控制面经 backup 只读定位 scope 后按当前完整性 fail-closed），
    // 远程不被改动；backup 绝不恢复、复制或进入 SDK 输入。
    await rm(join(scopeDir, "agents.state.json"));
    await expect(plane.update(view.ref, fullInput("must not apply"))).rejects.toMatchObject({
      code: "managed-state-missing",
    });
    const remoteFinal = await findById(agentId);
    expect(remoteFinal?.description).toBe("stage08 retry");
    // 当前 state 未被恢复：fail-closed 只是诊断性拒绝，不修复本地文件。
    const snapshotAfter = await store.listScopes(CONN);
    expect(snapshotAfter[0]?.hasState).toBe(false);

    // backup 目录在 update 成功后成对存在（由成功路径写入）。
    const backupEntries = await readdir(join(scopeDir, "backup"));
    expect(backupEntries).toContain("agents.yaml");
  }, 180_000);
});
