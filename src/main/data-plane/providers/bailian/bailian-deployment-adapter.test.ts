import { describe, expect, it } from "vitest";
import type { ResolvedConnection } from "../../../connections/connection-verifier";
import {
  createBailianDeploymentAdapter,
  toBailianDeploymentRunView,
  toBailianDeploymentView,
} from "./bailian-deployment-adapter";

const connection: ResolvedConnection = {
  provider: "bailian",
  credential: "test-key",
  workspaceId: "ws-test",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: (path: string, init: RequestInit) => Response) {
  const calls: { path: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.slice(url.indexOf("/api/v1/agentstudio") + "/api/v1/agentstudio".length);
    const request = init ?? {};
    calls.push({ path, init: request });
    return handler(path, request);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("bailian deployment wire mapping", () => {
  it("maps deployment with schedule, prompt and CloudAgentBot markers", () => {
    const view = toBailianDeploymentView({
      id: "depl_1",
      name: "每日汇总",
      description: "d",
      status: "paused",
      agent: { id: "agent_1", version: 3 },
      schedule: {
        type: "cron",
        expression: "0 9 * * *",
        timezone: "Asia/Shanghai",
        next_run_at: "2026-10-09T01:00:00Z",
        last_run_at: null,
      },
      initial_events: [
        { type: "message", role: "user", content: [{ type: "text", text: "汇总" }] },
      ],
      metadata: {
        openagentbot_key_scope: "oab-key-v1-x",
        openagentbot_shared: "true",
        openagentbot_expires_at: "2026-12-31",
        other_key: 42,
      },
      archived_at: null,
      created_at: "2026-10-08T00:00:00Z",
      updated_at: "2026-10-08T01:00:00Z",
    });
    expect(view).toMatchObject({
      agentId: "agent_1",
      deploymentId: "depl_1",
      name: "每日汇总",
      status: "paused",
      prompt: "汇总",
      shared: true,
      keyScopeMarker: "oab-key-v1-x",
      expiresAt: "2026-12-31",
      schedule: { expression: "0 9 * * *", timezone: "Asia/Shanghai", nextRunAt: "2026-10-09T01:00:00Z" },
      createdAt: "2026-10-08T00:00:00Z",
      updatedAt: "2026-10-08T01:00:00Z",
    });
    // metadata 全量保留字符串键（read-merge-write 需要），非字符串值被丢弃。
    expect(view.metadata).toEqual({
      openagentbot_key_scope: "oab-key-v1-x",
      openagentbot_shared: "true",
      openagentbot_expires_at: "2026-12-31",
    });
  });

  it("archived_at wins over status; manual-only deployment has no schedule", () => {
    const archived = toBailianDeploymentView({
      id: "depl_2",
      name: "n",
      status: "active",
      agent: { id: "agent_1" },
      archived_at: "2026-10-08T06:13:19Z",
      initial_events: [],
      metadata: {},
    });
    expect(archived.status).toBe("archived");
    expect(archived.schedule).toBeUndefined();
    expect(archived.expiresAt).toBeUndefined();
    expect(archived.keyScopeMarker).toBeUndefined();
    expect(archived.shared).toBe(false);
  });

  it("maps run view including trigger, terminal status and error message", () => {
    expect(
      toBailianDeploymentRunView({
        id: "drun_1",
        deployment_id: "depl_1",
        session_id: "sesn_1",
        trigger_source: "schedule",
        status: "failed",
        error: { message: "boom" },
        started_at: "2026-10-08T01:00:00Z",
        finished_at: "2026-10-08T01:01:00Z",
      }),
    ).toEqual({
      id: "drun_1",
      deploymentId: "depl_1",
      sessionId: "sesn_1",
      trigger: "schedule",
      status: "failed",
      errorMessage: "boom",
      startedAt: "2026-10-08T01:00:00Z",
      finishedAt: "2026-10-08T01:01:00Z",
    });
    const running = toBailianDeploymentRunView({
      id: "drun_2",
      deployment_id: "depl_1",
      session_id: null,
      trigger_source: "manual",
      status: "running",
    });
    expect(running.sessionId).toBeUndefined();
    expect(running.trigger).toBe("manual");
  });
});

describe("bailian deployment adapter HTTP contract", () => {
  it("lists deployments with agent filter and cursor pagination", async () => {
    const { fetchImpl, calls } = mockFetch((path) => {
      if (path.includes("page=p2")) return jsonResponse({ data: [{ id: "depl_2", agent: {}, metadata: {}, initial_events: [] }], next_page: null });
      return jsonResponse({ data: [{ id: "depl_1", agent: {}, metadata: {}, initial_events: [] }], next_page: "p2" });
    });
    const adapter = createBailianDeploymentAdapter(connection, { fetchImpl });
    const list = await adapter.listDeployments("agent_1");
    expect(list.map((d) => d.deploymentId)).toEqual(["depl_1", "depl_2"]);
    expect(calls[0].path).toContain("/deployments?");
    expect(calls[0].path).toContain("agent_id=agent_1");
    expect(calls[1].path).toContain("page=p2");
  });

  it("creates deployment with resolved agent version, cron schedule and metadata", async () => {
    const { fetchImpl, calls } = mockFetch((path, init) => {
      if (path.startsWith("/agents")) {
        return jsonResponse({ data: [{ id: "agent_1", version: 7 }] });
      }
      const body = JSON.parse(String(init.body));
      return jsonResponse({ id: "depl_9", agent: body.agent, metadata: body.metadata, initial_events: body.initial_events, schedule: body.schedule, status: "active" });
    });
    const adapter = createBailianDeploymentAdapter(connection, { fetchImpl });
    const created = await adapter.createDeployment({
      agentId: "agent_1",
      environmentId: "env_1",
      name: "每日汇总",
      prompt: "汇总昨日数据",
      schedule: { expression: "0 9 * * *", timezone: "Asia/Shanghai" },
      metadata: { openagentbot_key_scope: "oab-key-v1-x" },
    });
    expect(created.deploymentId).toBe("depl_9");
    const createCall = calls.find((c) => c.path === "/deployments");
    const body = JSON.parse(String(createCall?.init.body));
    expect(body.agent).toEqual({ id: "agent_1", version: 7 });
    expect(body.environment_id).toBe("env_1");
    expect(body.schedule).toEqual({
      type: "cron",
      expression: "0 9 * * *",
      timezone: "Asia/Shanghai",
    });
    expect(body.initial_events[0].content[0].text).toBe("汇总昨日数据");
  });

  it("updates with schedule null to clear timing and passes merged metadata through", async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      jsonResponse({ id: "depl_1", agent: {}, metadata: {}, initial_events: [], schedule: null, status: "active" }),
    );
    const adapter = createBailianDeploymentAdapter(connection, { fetchImpl });
    await adapter.updateDeployment("depl_1", { schedule: null, metadata: { a: "b" } });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.schedule).toBeNull();
    expect(body.metadata).toEqual({ a: "b" });
    expect(body.initial_events).toBeUndefined();
  });

  it("maps provider error status to HostError code", async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse({ error: { code: "DEPLOYMENT_STATE_CONFLICT" } }, 409));
    const adapter = createBailianDeploymentAdapter(connection, { fetchImpl });
    await expect(adapter.runDeployment("depl_1")).rejects.toMatchObject({ code: "conflict" });
  });

  it("runs lifecycle endpoints against expected paths", async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      jsonResponse({ id: "x", agent: {}, metadata: {}, initial_events: [], status: "active" }),
    );
    const adapter = createBailianDeploymentAdapter(connection, { fetchImpl });
    await adapter.pauseDeployment("depl_1");
    await adapter.unpauseDeployment("depl_1");
    await adapter.archiveDeployment("depl_1");
    await adapter.listDeploymentRuns("depl_1");
    expect(calls.map((c) => c.path)).toEqual([
      "/deployments/depl_1/pause",
      "/deployments/depl_1/unpause",
      "/deployments/depl_1/archive",
      "/deployments/depl_1/runs?limit=100",
    ]);
  });
});
