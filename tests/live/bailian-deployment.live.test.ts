/**
 * 百炼 Deployment（定时任务）真实 Cloud 合同验证（MUTATING，自动清理）。
 *
 * 运行：OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/bailian-deployment.live.test.ts
 *
 * 合同证据与探测结论见 docs/research/bailian-deployment-api-contract-2026-10-08.md。
 * 资源使用唯一前缀与 openagentbot 测试 metadata；结束时归档 Deployment、删除产生的 Session。
 */
import { afterAll, describe, expect, it } from "vitest";
import { createBailianDeploymentAdapter } from "../../src/main/data-plane/providers/bailian/bailian-deployment-adapter";
import { requireBailian } from "./support/credentials";
import { uniqueTestPrefix } from "./support/naming";
import { providerRequester, type Json } from "./support/rest";

const LIVE = process.env.OPENAGENTBOT_LIVE === "1";
const prefix = uniqueTestPrefix("deployment");

describe.skipIf(!LIVE)("bailian deployment live contract", () => {
  const credentials = LIVE ? requireBailian() : { bailianApiKey: "", bailianWorkspaceId: "" };
  const request = providerRequester("bailian", credentials);
  // 惰性创建：非 live 模式下无凭据，避免收集期实例化抛错。
  const adapter = () =>
    createBailianDeploymentAdapter({
      provider: "bailian",
      credential: credentials.bailianApiKey,
      workspaceId: credentials.bailianWorkspaceId,
    });

  let deploymentId: string | undefined;
  let runSessionId: string | undefined;
  let agent: { id: string; version?: number };

  afterAll(async () => {
    if (deploymentId !== undefined) {
      await adapter().archiveDeployment(deploymentId).catch(() => {});
    }
    if (runSessionId !== undefined) {
      await request(`/sessions/${runSessionId}`, { method: "DELETE" }).catch(() => {});
    }
  });

  it("创建 → 手动触发 → Run 关联 Session 进入会话列表 → 暂停/恢复 → 归档", async () => {
    const agents = await request("/agents?limit=1");
    const first = (agents.data as Json[])[0];
    agent = { id: String(first.id), version: first.version as number | undefined };

    const created = await adapter().createDeployment({
      agentId: agent.id,
      environmentId: "",
      name: `${prefix}-定时任务`,
      prompt: "ping：回复 ok 即可",
      schedule: { expression: "0 9 * * *", timezone: "Asia/Shanghai" },
      metadata: { openagentbot_test_run: prefix },
    });
    deploymentId = created.deploymentId;
    expect(deploymentId).toMatch(/^depl_/);
    expect(created.status).toBe("active");
    expect(created.schedule?.nextRunAt).toBeDefined();
    expect(created.metadata.openagentbot_test_run).toBe(prefix);

    const run = await adapter().runDeployment(deploymentId);
    expect(run.status).toBe("running");

    // 轮询 Run 至终态并拿到 Session。
    let finalRun = run;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const runs = await adapter().listDeploymentRuns(deploymentId);
      const latest = runs.find((candidate) => candidate.id === run.id);
      if (latest !== undefined) finalRun = latest;
      if (finalRun.status !== "running" && finalRun.sessionId !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    expect(finalRun.status).toBe("succeeded");
    expect(finalRun.sessionId).toBeDefined();
    runSessionId = finalRun.sessionId;

    // Run 关联 Session 出现在会话列表，且继承 Deployment metadata。
    const sessions = await request(`/sessions?agent_id=${agent.id}&limit=100`);
    const hit = (sessions.data as Json[]).find((session) => session.id === runSessionId);
    expect(hit).toBeDefined();
    const detail = await request(`/sessions/${runSessionId}`);
    expect((detail.metadata as Json)?.openagentbot_test_run).toBe(prefix);

    // 暂停/恢复/归档的状态机与幂等性。
    const paused = await adapter().pauseDeployment(deploymentId);
    expect(paused.status).toBe("paused");
    const resumed = await adapter().unpauseDeployment(deploymentId);
    expect(resumed.status).toBe("active");

    await adapter().archiveDeployment(deploymentId);
    const listed = await adapter().listDeployments(agent.id);
    expect(listed.some((d) => d.deploymentId === deploymentId)).toBe(false);
    await expect(adapter().runDeployment(deploymentId)).rejects.toMatchObject({
      code: "conflict",
    });
    deploymentId = undefined;
  }, 180_000);
});
