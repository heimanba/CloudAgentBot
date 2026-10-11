import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConnection } from "../../../connections/connection-verifier";
import {
  createQoderDeploymentAdapter,
  toQoderDeploymentRunView,
  toQoderDeploymentView,
} from "./qoder-deployment-adapter";

/**
 * Qoder Deployment Adapter 合同测试。
 *
 * 保护的风险：
 * - wire → view 映射漂移（agent 字符串/对象双形态、upcoming_runs_at、trigger_context）；
 * - 请求组装（environment_id 必填、user.message 形状、分页）随 Provider 合同变化。
 */

const connection: ResolvedConnection = {
  provider: "qoder",
  credential: "test-key",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return handler(url, init);
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("qoder deployment wire mapping", () => {
  it("maps deployment with schedule, prompt and CloudAgentBot markers", () => {
    const view = toQoderDeploymentView({
      id: "dep_1",
      name: "每日汇总",
      description: "d",
      status: "paused",
      agent: "agent_1",
      schedule: {
        type: "cron",
        expression: "0 9 * * *",
        timezone: "Asia/Shanghai",
        upcoming_runs_at: ["2026-10-09T01:00:00Z"],
        last_run_at: null,
      },
      initial_events: [
        { type: "user.message", content: [{ type: "text", text: "汇总" }] },
      ],
      metadata: {
        openagentbot_key_scope: "oab-key-v1-x",
        openagentbot_shared: "true",
        openagentbot_expires_at: "2026-12-31",
        other_key: 42,
      },
      created_at: "2026-10-08T00:00:00Z",
      updated_at: "2026-10-08T01:00:00Z",
    });
    expect(view).toMatchObject({
      agentId: "agent_1",
      deploymentId: "dep_1",
      name: "每日汇总",
      status: "paused",
      prompt: "汇总",
      shared: true,
      keyScopeMarker: "oab-key-v1-x",
      expiresAt: "2026-12-31",
      schedule: {
        expression: "0 9 * * *",
        timezone: "Asia/Shanghai",
        nextRunAt: "2026-10-09T01:00:00Z",
      },
      createdAt: "2026-10-08T00:00:00Z",
      updatedAt: "2026-10-08T01:00:00Z",
    });
    expect(view.metadata).toEqual({
      openagentbot_key_scope: "oab-key-v1-x",
      openagentbot_shared: "true",
      openagentbot_expires_at: "2026-12-31",
    });
  });

  it("agent 引用为对象形态时取 id；archived_at 判定归档", () => {
    const view = toQoderDeploymentView({
      id: "dep_2",
      name: "n",
      agent: { id: "agent_9", type: "agent", version: 3 },
      status: "active",
      archived_at: "2026-10-08T02:00:00Z",
    });
    expect(view.agentId).toBe("agent_9");
    expect(view.status).toBe("archived");
  });

  it("无 schedule 与空 schedule（null）均不产出调度信息", () => {
    expect(toQoderDeploymentView({ id: "dep_3", name: "n" }).schedule).toBeUndefined();
    expect(
      toQoderDeploymentView({ id: "dep_4", name: "n", schedule: null }).schedule,
    ).toBeUndefined();
  });

  it("maps run: trigger_context、session_id 与 error 互斥、finished_at", () => {
    expect(
      toQoderDeploymentRunView({
        id: "drun_1",
        deployment_id: "dep_1",
        status: "succeeded",
        session_id: "sess_1",
        trigger_context: { type: "schedule" },
        started_at: "2026-10-08T01:00:00Z",
        finished_at: "2026-10-08T01:05:00Z",
      }),
    ).toEqual({
      id: "drun_1",
      deploymentId: "dep_1",
      trigger: "schedule",
      status: "succeeded",
      sessionId: "sess_1",
      startedAt: "2026-10-08T01:00:00Z",
      finishedAt: "2026-10-08T01:05:00Z",
    });
    expect(
      toQoderDeploymentRunView({
        id: "drun_2",
        deployment_id: "dep_1",
        status: "failed",
        error: { message: "boom" },
        trigger_context: { type: "manual" },
      }),
    ).toMatchObject({ trigger: "manual", status: "failed", errorMessage: "boom" });
  });
});

describe("qoder deployment adapter requests", () => {
  it("createDeployment 组装 user.message 与必填 environment_id", async () => {
    const calls = mockFetch((url) => {
      expect(url).toContain("/deployments");
      return json(200, { id: "dep_new", name: "每日汇总" });
    });
    const adapter = createQoderDeploymentAdapter(connection);
    await adapter.createDeployment({
      agentId: "agent_1",
      environmentId: "env_1",
      name: "每日汇总",
      prompt: "汇总今日事项",
      schedule: { expression: "0 9 * * *", timezone: "Asia/Shanghai" },
      metadata: { openagentbot_key_scope: "oab-key-v1-x" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      body: {
        name: "每日汇总",
        agent: "agent_1",
        environment_id: "env_1",
        initial_events: [
          { type: "user.message", content: [{ type: "text", text: "汇总今日事项" }] },
        ],
        schedule: { type: "cron", expression: "0 9 * * *", timezone: "Asia/Shanghai" },
        metadata: { openagentbot_key_scope: "oab-key-v1-x" },
      },
    });
  });

  it("listDeployments 翻页聚合并按 agent_id 过滤", async () => {
    mockFetch((url) => {
      if (url.includes("page=p2")) {
        return json(200, { data: [{ id: "dep_2", name: "b" }], has_more: false });
      }
      expect(url).toContain("agent_id=agent_1");
      return json(200, { data: [{ id: "dep_1", name: "a" }], has_more: true, next_page: "p2" });
    });
    const adapter = createQoderDeploymentAdapter(connection);
    const deployments = await adapter.listDeployments("agent_1");
    expect(deployments.map((d) => d.deploymentId)).toEqual(["dep_1", "dep_2"]);
  });

  it("updateDeployment 以 merge-patch 语义只传变更字段，schedule 传 null 清除", async () => {
    const calls = mockFetch((url) => {
      expect(url).toContain("/deployments/dep_1");
      return json(200, { id: "dep_1", name: "改名" });
    });
    const adapter = createQoderDeploymentAdapter(connection);
    await adapter.updateDeployment("dep_1", { name: "改名", schedule: null });
    expect(calls[0]).toMatchObject({
      method: "POST",
      body: { name: "改名", schedule: null },
    });
  });

  it("run 与 listRuns 走专属端点并映射视图", async () => {
    mockFetch((url) => {
      if (url.endsWith("/run")) {
        return json(200, {
          id: "drun_1",
          deployment_id: "dep_1",
          status: "running",
          trigger_context: { type: "manual" },
        });
      }
      return json(200, {
        data: [
          {
            id: "drun_1",
            deployment_id: "dep_1",
            status: "succeeded",
            session_id: "sess_1",
            trigger_context: { type: "manual" },
          },
        ],
        has_more: false,
      });
    });
    const adapter = createQoderDeploymentAdapter(connection);
    const run = await adapter.runDeployment("dep_1");
    expect(run).toMatchObject({ id: "drun_1", status: "running", trigger: "manual" });
    const runs = await adapter.listDeploymentRuns("dep_1");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ sessionId: "sess_1", status: "succeeded" });
  });

  it("pause/unpause/archive 命中对应端点；API 错误收敛为 HostError", async () => {
    const calls = mockFetch((url) => {
      if (url.includes("/archive")) return json(404, { error: { message: "not found" } });
      return json(200, { id: "dep_1", name: "n", status: "paused" });
    });
    const adapter = createQoderDeploymentAdapter(connection);
    await adapter.pauseDeployment("dep_1");
    await adapter.unpauseDeployment("dep_1");
    expect(calls.map((c) => c.url)).toEqual([
      expect.stringContaining("/deployments/dep_1/pause"),
      expect.stringContaining("/deployments/dep_1/unpause"),
    ]);
    await expect(adapter.archiveDeployment("dep_1")).rejects.toMatchObject({
      code: "not-found",
    });
  });
});
