/**
 * Connection 级共享 Environment 的真实 Cloud 合同验证（MUTATING，自动清理）。
 *
 * 运行：
 *   OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/shared-environment.live.test.ts --no-file-parallelism
 *
 * 每个 Provider 通过生产 EnvironmentControlPlane 创建一个共享 Environment，
 * 然后通过生产 BotControlPlane 创建两个独立 Managed Bot（引用同一 Environment），
 * 最后为每个 Bot 创建 Session 并断言 Session 指向同一个 remote Environment ID。
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvironmentControlPlane } from "../../src/main/control-plane/environment-control-plane";
import { BotControlPlane } from "../../src/main/control-plane/bot-control-plane";
import { ManagedBotStore } from "../../src/main/control-plane/managed-bot-store";
import { ScopeLock } from "../../src/main/control-plane/scope-lock";
import { QoderDataClient } from "../../src/main/data-plane/providers/qoder/qoder-client";
import { createCleanupCollector } from "./support/cleanup";
import { requireQoderAndBailian } from "./support/credentials";
import { bailianBaseUrl, QODER_GATEWAY } from "./support/endpoints";
import { testRunSuffix, uniqueTestPrefix } from "./support/naming";
import { createTestEnvironment } from "./support/project";
import { deleteQoderResource, jsonRows, providerRequester } from "./support/rest";
import { pollUntil } from "./support/sse-gate";

const LIVE = process.env.OPENAGENTBOT_LIVE === "1";
const suffix = testRunSuffix(8);

describe.skipIf(!LIVE)("shared environment live contract", () => {
  const credentials = LIVE
    ? requireQoderAndBailian()
    : { qoderPat: "", bailianApiKey: "", bailianWorkspaceId: "" };

  describe("Qoder", () => {
    const prefix = uniqueTestPrefix("shared-q");
    const connectionId = `conn_qoder_${suffix}`;
    const roots: string[] = [];
    const agentIds: string[] = [];
    const sessionIds: string[] = [];
    let environmentId: string | undefined;
    const client = LIVE
      ? new QoderDataClient({ apiKey: credentials.qoderPat, gateway: QODER_GATEWAY })
      : (null as unknown as QoderDataClient);
    const request = providerRequester("qoder", credentials);

    afterAll(async () => {
      const cleanup = createCleanupCollector("Qoder live resource cleanup failed");
      for (const id of sessionIds) {
        cleanup.attempt(() => client.deleteSession(id));
      }
      if (sessionIds.length) await new Promise((resolve) => setTimeout(resolve, 1_500));
      for (const id of agentIds) {
        cleanup.attempt(() => deleteQoderResource(credentials.qoderPat, "agent", id));
      }
      if (environmentId) {
        cleanup.attempt(() =>
          deleteQoderResource(credentials.qoderPat, "environment", environmentId!),
        );
      }
      for (const root of roots) await rm(root, { recursive: true, force: true }).catch(() => {});
      // §14.7：清理后验证——活动清单中不得残留本次资源。Qoder 列表接口存在
      // 秒级最终一致性延迟（DELETE 成功后短窗口内仍可见），先用有界重试等待
      // 清单收敛，再逐项断言保留精确失败信息。
      const [agentRows, envRows, sessionRows] = await pollUntil(
        async () => {
          const [agents, environments, sessions] = await Promise.all([
            jsonRows(await request("/agents?limit=100")),
            jsonRows(await request("/environments?limit=100")),
            jsonRows(await request("/sessions?limit=100")),
          ]);
          const hasResidue =
            agents.some((a) => typeof a.name === "string" && a.name.startsWith(`${prefix}-`)) ||
            environments.some(
              (e) => typeof e.name === "string" && e.name.startsWith(`${prefix}-`),
            ) ||
            sessions.some((s) => sessionIds.includes(String(s.id)));
          return hasResidue ? null : ([agents, environments, sessions] as const);
        },
        `${prefix} cleanup convergence (active lists must drop test resources)`,
        20_000,
        2_000,
      );
      expect(
        agentRows.some((a) => typeof a.name === "string" && a.name.startsWith(`${prefix}-`)),
        "no test agents should remain",
      ).toBe(false);
      expect(
        envRows.some((e) => typeof e.name === "string" && e.name.startsWith(`${prefix}-`)),
        "no test environments should remain",
      ).toBe(false);
      expect(
        sessionRows.some((s) => sessionIds.includes(String(s.id))),
        "no test sessions should remain",
      ).toBe(false);
      cleanup.flush();
    });

    it("reuses one environment across two bots created via production path", async () => {
      // 1. 创建带唯一前缀的测试环境，再走生产 EnvironmentControlPlane 显式选中路径绑定。
      const createdId = await createTestEnvironment("qoder", `${prefix}-environment`, credentials, {
        description: "CloudAgentBot shared-environment live contract",
        testLabel: "shared-environment",
      });
      const envPlane = new EnvironmentControlPlane();
      // 测试账号已有多个未归档环境：无参 setup 必须返回 selection-required。
      const autoResult = await envPlane.setup({
        id: connectionId,
        provider: "qoder",
        credential: credentials.qoderPat,
      });
      expect(autoResult.status).toBe("selection-required");
      if (autoResult.status === "selection-required") {
        expect(autoResult.candidates.some((c) => c.environmentId === createdId)).toBe(true);
      }
      const setupResult = await envPlane.setup(
        { id: connectionId, provider: "qoder", credential: credentials.qoderPat },
        createdId,
      );
      expect(setupResult).toEqual({ status: "ready", environmentId: createdId });
      environmentId = createdId;

      // 2. 生产 BotControlPlane 创建两个 Bot，引用同一环境
      const root = await mkdtemp(join(tmpdir(), `${prefix}-`));
      roots.push(root);
      const store = new ManagedBotStore(join(root, "managed-bots"));
      const botPlane = new BotControlPlane({
        store,
        lock: new ScopeLock(),
        resolveCredential: () =>
          Promise.resolve({ provider: "qoder", credential: credentials.qoderPat }),
        resolveDefaultEnvironmentId: () => Promise.resolve(environmentId!),
      });

      const botA = await botPlane.create(connectionId, {
        name: `${prefix}-a`,
        description: "CloudAgentBot shared-environment live contract bot A",
      });
      agentIds.push(botA.ref.agentId);

      const botB = await botPlane.create(connectionId, {
        name: `${prefix}-b`,
        description: "CloudAgentBot shared-environment live contract bot B",
      });
      agentIds.push(botB.ref.agentId);

      // 3. 两个 Bot 各创建一个 Session，断言共享同一环境
      for (const agentId of agentIds) {
        const session = await client.createSession({
          agent_id: agentId,
          environment_id: environmentId!,
          metadata: { openagentbot_test: "shared-environment", test_run: prefix },
        });
        sessionIds.push(session.id);
        const remote = await client.getSession(session.id);
        expect(remote.environment_id).toBe(environmentId);
      }
    }, 480_000);
  });

  describe("Bailian", () => {
    const prefix = uniqueTestPrefix("shared-b");
    const connectionId = `conn_bailian_${suffix}`;
    const roots: string[] = [];
    const agentIds: string[] = [];
    const sessionIds: string[] = [];
    let environmentId: string | undefined;
    // 归档边界的裸 fetch 需要真实 Response.status，保留显式 baseUrl。
    const baseUrl = bailianBaseUrl(credentials.bailianWorkspaceId);
    const request = providerRequester("bailian", credentials);

    afterAll(async () => {
      const cleanup = createCleanupCollector("Bailian live resource cleanup failed");
      for (const id of sessionIds) {
        cleanup.attempt(() => request(`/sessions/${id}`, { method: "DELETE" }));
      }
      for (const id of agentIds) {
        cleanup.attempt(() => request(`/agents/${id}/archive`, { method: "POST", body: "{}" }));
      }
      if (environmentId) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        cleanup.attempt(() => request(`/environments/${environmentId}`, { method: "DELETE" }));
      }
      for (const root of roots) await rm(root, { recursive: true, force: true }).catch(() => {});
      // §14.7：清理后验证——活动清单中不得残留本次资源。列表接口存在秒级
      // 最终一致性延迟（DELETE 成功后短窗口内仍可见），先用有界重试等待清单
      // 收敛，再逐项断言保留精确失败信息。
      const [agentRows, envRows, sessionRows] = await pollUntil(
        async () => {
          const [agents, environments, sessions] = await Promise.all([
            jsonRows(await request("/agents?limit=100")),
            jsonRows(await request("/environments?limit=100")),
            jsonRows(await request("/sessions?limit=100")),
          ]);
          const hasResidue =
            agents.some((a) => typeof a.name === "string" && a.name.startsWith(`${prefix}-`)) ||
            environments.some(
              (e) => typeof e.name === "string" && e.name.startsWith(`${prefix}-`),
            ) ||
            sessions.some((s) => sessionIds.includes(String(s.id)));
          return hasResidue ? null : ([agents, environments, sessions] as const);
        },
        `${prefix} cleanup convergence (active lists must drop test resources)`,
        20_000,
        2_000,
      );
      expect(
        agentRows.some((a) => typeof a.name === "string" && a.name.startsWith(`${prefix}-`)),
        "no test agents should remain",
      ).toBe(false);
      expect(
        envRows.some((e) => typeof e.name === "string" && e.name.startsWith(`${prefix}-`)),
        "no test environments should remain",
      ).toBe(false);
      expect(
        sessionRows.some((s) => sessionIds.includes(String(s.id))),
        "no test sessions should remain",
      ).toBe(false);
      cleanup.flush();
    });

    it("reuses one environment across two bots created via production path", async () => {
      // 1. 创建带唯一前缀的测试环境，再走生产 EnvironmentControlPlane 显式选中路径绑定。
      const createdId = await createTestEnvironment(
        "bailian",
        `${prefix}-environment`,
        credentials,
        {
          description: "CloudAgentBot shared-environment live contract",
          testLabel: "shared-environment",
        },
      );
      const envPlane = new EnvironmentControlPlane();
      // 测试账号已有多个未归档环境：无参 setup 必须返回 selection-required。
      const autoResult = await envPlane.setup({
        id: connectionId,
        provider: "bailian",
        credential: credentials.bailianApiKey,
        workspaceId: credentials.bailianWorkspaceId,
      });
      expect(autoResult.status).toBe("selection-required");
      if (autoResult.status === "selection-required") {
        expect(autoResult.candidates.some((c) => c.environmentId === createdId)).toBe(true);
      }
      const setupResult = await envPlane.setup(
        {
          id: connectionId,
          provider: "bailian",
          credential: credentials.bailianApiKey,
          workspaceId: credentials.bailianWorkspaceId,
        },
        createdId,
      );
      expect(setupResult).toEqual({ status: "ready", environmentId: createdId });
      environmentId = createdId;

      // 2. 生产 BotControlPlane 创建两个 Bot，引用同一环境
      const root = await mkdtemp(join(tmpdir(), `${prefix}-`));
      roots.push(root);
      const store = new ManagedBotStore(join(root, "managed-bots"));
      const botPlane = new BotControlPlane({
        store,
        lock: new ScopeLock(),
        resolveCredential: () =>
          Promise.resolve({
            provider: "bailian",
            credential: credentials.bailianApiKey,
            workspaceId: credentials.bailianWorkspaceId,
          }),
        resolveDefaultEnvironmentId: () => Promise.resolve(environmentId!),
      });

      const botA = await botPlane.create(connectionId, {
        name: `${prefix}-a`,
        description: "CloudAgentBot shared-environment live contract bot A",
      });
      agentIds.push(botA.ref.agentId);

      const botB = await botPlane.create(connectionId, {
        name: `${prefix}-b`,
        description: "CloudAgentBot shared-environment live contract bot B",
      });
      agentIds.push(botB.ref.agentId);

      // 3. 两个 Bot 各创建一个 Session，断言共享同一环境
      for (const agentId of agentIds) {
        const session = await request("/sessions", {
          method: "POST",
          body: JSON.stringify({
            agent: agentId,
            environment_id: environmentId,
            metadata: { openagentbot_test: "shared-environment", test_run: prefix },
          }),
        });
        expect(typeof session.id).toBe("string");
        sessionIds.push(session.id as string);
        const remote = await request(`/sessions/${session.id as string}`);
        expect(remote.environment_id).toBe(environmentId);
      }

      // 百炼文档只保证归档不影响既有 Session，未说明能否创建新 Session。
      // 真机固定这个生命周期边界；仅输出状态码，不输出 Provider body 或凭据。
      await request(`/environments/${environmentId}/archive`, { method: "POST", body: "{}" });
      const createAfterArchive = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.bailianApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ agent: agentIds[0], environment_id: environmentId }),
      });
      expect(createAfterArchive.status).toBe(404);
      for (const id of sessionIds) {
        const existing = await request(`/sessions/${id}`);
        expect(existing.environment_id).toBe(environmentId);
      }
    }, 480_000);
  });
});
