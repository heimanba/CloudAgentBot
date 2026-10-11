import { describe, expect, it } from "vitest";
import { ChatDataPlane } from "./chat-data-plane";
import type { ChatAdapter } from "./chat-adapter";
import type { AdapterDeploymentView, DeploymentAdapter } from "./deployment-adapter";
import {
  API_KEY_SCOPE_METADATA_KEY,
  DEPLOYMENT_EXPIRES_AT_METADATA_KEY,
  SESSION_SHARED_METADATA_KEY,
  apiKeyScopeId,
} from "../api-key-scope";

/**
 * ChatDataPlane 的 Deployment 组装测试。保护的风险：
 * - 其他 Key 范围未共享的 Deployment 泄漏到列表/详情；
 * - 写操作（update/pause/archive/setShared）对非所有者放行；
 * - metadata 整体替换语义下归属/共享/到期标记丢失（read-merge-write 失效）；
 * - 无 Deployment 能力的 Provider 错误分类漂移。
 */

const SCOPE = apiKeyScopeId("bailian", "k");
const OTHER_SCOPE = apiKeyScopeId("bailian", "other-key");

function deploymentView(partial: Partial<AdapterDeploymentView>): AdapterDeploymentView {
  const merged: AdapterDeploymentView = {
    agentId: "a1",
    deploymentId: "depl_1",
    name: "每日汇总",
    status: "active",
    prompt: "汇总",
    shared: false,
    metadata: { [API_KEY_SCOPE_METADATA_KEY]: SCOPE },
    ...partial,
  };
  // 真实 Adapter 由 wire metadata 派生 keyScopeMarker；夹具保持同一关系。
  const marker = merged.metadata[API_KEY_SCOPE_METADATA_KEY];
  if (marker !== undefined && merged.keyScopeMarker === undefined) {
    merged.keyScopeMarker = marker;
  }
  if (merged.metadata[SESSION_SHARED_METADATA_KEY] === "true" && partial.shared === undefined) {
    merged.shared = true;
  }
  const expiresAt = merged.metadata[DEPLOYMENT_EXPIRES_AT_METADATA_KEY];
  if (expiresAt !== undefined && merged.expiresAt === undefined) merged.expiresAt = expiresAt;
  return merged;
}

function createPlane(adapter: Partial<DeploymentAdapter>, provider = "bailian") {
  const chatAdapter: ChatAdapter = {
    listChats: () => Promise.resolve([]),
    getChat: () => Promise.reject(new Error("unused")),
    getKeyScopeMarker: () => Promise.resolve(undefined),
    createChat: () => Promise.reject(new Error("unused")),
    sendMessage: () => Promise.resolve({ ok: true }),
    subscribe: () => Promise.resolve(() => {}),
    archiveChat: () => Promise.resolve(),
    deleteChat: () => Promise.resolve(),
  };
  return new ChatDataPlane({
    chatAdapters: { [provider]: () => chatAdapter },
    botCatalogs: {
      [provider]: () => ({
        listBots: () =>
          Promise.resolve([{ agentId: "a1", name: "Bot", managed: false, keyScopeMarker: SCOPE }]),
      }),
    },
    ...(provider === "bailian"
      ? { deploymentAdapters: { bailian: () => adapter as DeploymentAdapter } }
      : {}),
    resolveCredential: () =>
      Promise.resolve({ provider, credential: "k", workspaceId: "ws" }),
    resolveManagedEnvironmentId: () => Promise.resolve(null),
    resolveDefaultEnvironmentId: () => Promise.resolve("env_default"),
  });
}

describe("deployment visibility", () => {
  it("hides other-scope unshared deployments; shows own, ungrouped and shared", async () => {
    const plane = createPlane({
      listDeployments: () =>
        Promise.resolve([
          deploymentView({ deploymentId: "own" }),
          deploymentView({
            deploymentId: "foreign",
            metadata: { [API_KEY_SCOPE_METADATA_KEY]: OTHER_SCOPE },
          }),
          deploymentView({
            deploymentId: "foreign-shared",
            shared: true,
            metadata: {
              [API_KEY_SCOPE_METADATA_KEY]: OTHER_SCOPE,
              [SESSION_SHARED_METADATA_KEY]: "true",
            },
          }),
          deploymentView({ deploymentId: "console", metadata: {} }),
        ]),
    });
    const list = await plane.listDeployments("c1", "a1");
    expect(list.map((d) => d.ref.deploymentId).sort()).toEqual([
      "console",
      "foreign-shared",
      "own",
    ]);
    expect(list.find((d) => d.ref.deploymentId === "own")?.keyScope).toBe("current");
    expect(list.find((d) => d.ref.deploymentId === "console")?.keyScope).toBe("ungrouped");
  });

  it("rejects get for other-scope unshared deployment as not-found", async () => {
    const plane = createPlane({
      getDeployment: () =>
        Promise.resolve(
          deploymentView({ metadata: { [API_KEY_SCOPE_METADATA_KEY]: OTHER_SCOPE } }),
        ),
    });
    await expect(plane.getDeployment("c1", "a1", "depl_1")).rejects.toMatchObject({
      code: "not-found",
    });
  });
});

describe("deployment writes", () => {
  it("rejects pause/archive/setShared for other-scope deployments", async () => {
    const foreign = deploymentView({
      metadata: { [API_KEY_SCOPE_METADATA_KEY]: OTHER_SCOPE },
    });
    const plane = createPlane({
      getDeployment: () => Promise.resolve(foreign),
      pauseDeployment: () => Promise.resolve(foreign),
      archiveDeployment: () => Promise.resolve(),
      updateDeployment: () => Promise.resolve(foreign),
    });
    await expect(plane.pauseDeployment("c1", "a1", "depl_1")).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(plane.archiveDeployment("c1", "a1", "depl_1")).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(
      plane.setDeploymentShared("c1", "a1", "depl_1", true),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("read-merge-writes metadata so scope marker survives expiresAt update", async () => {
    const seen: Record<string, string>[] = [];
    const plane = createPlane({
      getDeployment: () =>
        Promise.resolve(
          deploymentView({
            shared: true,
            metadata: {
              [API_KEY_SCOPE_METADATA_KEY]: SCOPE,
              [SESSION_SHARED_METADATA_KEY]: "true",
              foreign: "keep",
            },
          }),
        ),
      updateDeployment: (_id, input) => {
        if (input.metadata !== undefined) seen.push(input.metadata);
        return Promise.resolve(deploymentView({ metadata: input.metadata ?? {} }));
      },
    });
    await plane.updateDeployment("c1", "a1", "depl_1", { expiresAt: "2026-12-31" });
    expect(seen[0]).toEqual({
      [API_KEY_SCOPE_METADATA_KEY]: SCOPE,
      [SESSION_SHARED_METADATA_KEY]: "true",
      foreign: "keep",
      [DEPLOYMENT_EXPIRES_AT_METADATA_KEY]: "2026-12-31",
    });
    await plane.updateDeployment("c1", "a1", "depl_1", { expiresAt: null });
    expect(seen[1]).toEqual({
      [API_KEY_SCOPE_METADATA_KEY]: SCOPE,
      [SESSION_SHARED_METADATA_KEY]: "true",
      foreign: "keep",
    });
  });

  it("creates deployment with scope marker, expiry and shared metadata", async () => {
    let captured: Record<string, string> | undefined;
    const plane = createPlane({
      createDeployment: (input) => {
        captured = input.metadata;
        return Promise.resolve(deploymentView({ metadata: input.metadata }));
      },
    });
    const created = await plane.createDeployment("c1", {
      agentId: "a1",
      name: "每日汇总",
      prompt: "汇总",
      schedule: { expression: "0 9 * * *", timezone: "Asia/Shanghai" },
      expiresAt: "2026-12-31",
      shared: true,
    });
    expect(captured).toEqual({
      [API_KEY_SCOPE_METADATA_KEY]: SCOPE,
      [DEPLOYMENT_EXPIRES_AT_METADATA_KEY]: "2026-12-31",
      [SESSION_SHARED_METADATA_KEY]: "true",
    });
    expect(created.keyScope).toBe("current");
    expect(created.shared).toBe(true);
    expect(created.expiresAt).toBe("2026-12-31");
  });

  it("rejects deployment creation for other-scope unshared bot", async () => {
    const plane = new ChatDataPlane({
      chatAdapters: {},
      botCatalogs: {
        bailian: () => ({
          listBots: () =>
            Promise.resolve([
              { agentId: "a1", name: "Bot", managed: false, keyScopeMarker: OTHER_SCOPE },
            ]),
        }),
      },
      deploymentAdapters: { bailian: () => ({}) as DeploymentAdapter },
      resolveCredential: () =>
        Promise.resolve({ provider: "bailian", credential: "k", workspaceId: "ws" }),
      resolveDefaultEnvironmentId: () => Promise.resolve("env_default"),
    });
    await expect(
      plane.createDeployment("c1", { agentId: "a1", name: "n", prompt: "p" }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("reports unavailable for providers without deployment capability", async () => {
    const plane = createPlane({}, "qoder");
    await expect(plane.listDeployments("c1")).rejects.toMatchObject({ code: "unavailable" });
  });
});
