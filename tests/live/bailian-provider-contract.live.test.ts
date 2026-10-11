/**
 * Bailian Provider 阶段 3–4 真实 Cloud 合同验证（MUTATING，自动清理）。
 *
 * 运行：OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/bailian-provider-contract.live.test.ts
 *
 * 控制面只使用 @openagentpack/sdk 公共入口；数据面以原生 REST/SSE 固定
 * Bailian Session/Event wire 合同。凭据只从当前仓库 .env 或环境变量读取，不输出也不落盘。
 */
import { afterAll, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, readFile as readText, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalFileStateBackend,
  listRemoteAgents,
  listRemoteEnvironments,
  readProjectRuntime,
  resolveProjectConfigFromObject,
  syncProjectResourcesWithStateBackend,
} from "@openagentpack/sdk";
import { createBailianChatAdapter } from "../../src/main/data-plane/providers/bailian/bailian-chat-adapter";
import { createBailianBotCatalog } from "../../src/main/data-plane/providers/bailian/bailian-bot-catalog";
import { createBailianVerifier } from "../../src/main/connections/bailian-verifier";
import { ChatDataPlane } from "../../src/main/data-plane/chat-data-plane";
import { ManagedBotStore } from "../../src/main/control-plane/managed-bot-store";
import { requireBailian } from "./support/credentials";
import { bailianBaseUrl } from "./support/endpoints";
import { uniqueTestPrefix } from "./support/naming";
import { providerRequester, type Json } from "./support/rest";
import type { ChatEventView } from "../../src/shared/models";

const LIVE = process.env.OPENAGENTBOT_LIVE === "1";
const prefix = uniqueTestPrefix("v2-bailian");
const envName = `${prefix}-environment`;

describe.skipIf(!LIVE)("bailian provider control/data contract live", () => {
  const credentials = LIVE ? requireBailian() : { bailianApiKey: "", bailianWorkspaceId: "" };
  const baseUrl = bailianBaseUrl(credentials.bailianWorkspaceId);

  let root = "";
  let agentId: string | undefined;
  let environmentId: string | undefined;
  let sessionId: string | undefined;

  const request = providerRequester("bailian", credentials);

  async function waitForIdleHistory(
    id: string,
    afterEventId?: string,
    timeoutMs = 180_000,
  ): Promise<Json[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const history = await request(`/sessions/${id}/events?order=asc&limit=100`);
      const events = history.data as Json[];
      const afterIndex = afterEventId ? events.findIndex((event) => event.id === afterEventId) : -1;
      const relevantEvents = afterEventId ? events.slice(afterIndex + 1) : events;
      const idle =
        afterIndex >= (afterEventId ? 0 : -1) &&
        relevantEvents.some((event) => {
          if (event.type !== "session_status") return false;
          const content = Array.isArray(event.content) ? event.content : [];
          return content.some(
            (block) =>
              typeof block === "object" &&
              block !== null &&
              ((block as Json).data as Json | undefined)?.session_status === "idle",
          );
        });
      if (idle) return events;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Bailian history did not reach idle");
  }

  afterAll(async () => {
    if (sessionId) await request(`/sessions/${sessionId}`, { method: "DELETE" }).catch(() => {});
    if (agentId)
      await request(`/agents/${agentId}/archive`, { method: "POST", body: "{}" }).catch(() => {});
    if (environmentId) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await request(`/environments/${environmentId}`, { method: "DELETE" }).catch(() => {});
    }
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("syncs one agent, sends one event, observes SSE to idle, and reconciles history", async () => {
    root = await mkdtemp(join(tmpdir(), `${prefix}-`));
    const stateBackend = new LocalFileStateBackend({ configPath: join(root, "agents.yaml") });
    const stateScope = { projectId: prefix };
    const project = {
      version: "1",
      providers: {
        bailian: {
          api_key: credentials.bailianApiKey,
          workspace_id: credentials.bailianWorkspaceId,
        },
      },
      defaults: { provider: "bailian" },
      environments: {
        [envName]: {
          description: "CloudAgentBot Bailian contract smoke environment",
          config: { type: "cloud", networking: { type: "unrestricted" } },
          metadata: { openagentbot_test: "bailian-phase-1-4", test_run: prefix },
        },
      },
      agents: {
        [prefix]: {
          description: "CloudAgentBot Bailian contract smoke agent",
          model: "qwen3.7-max",
          instructions: "Reply with exactly BAILIAN_CONTRACT_OK.",
          environment: envName,
          tools: { builtin: [] },
          metadata: { openagentbot_test: "bailian-phase-1-4", test_run: prefix },
        },
      },
    };

    const loaded = await resolveProjectConfigFromObject(project, {
      basePath: root,
      projectName: prefix,
    });
    const first = await syncProjectResourcesWithStateBackend(
      { projectName: prefix, config: loaded.config, stateBackend, stateScope },
      { policy: "force" },
    );
    const remoteIds = await stateBackend.read(stateScope, (state) => ({
      resources: state.listResources().map((resource) => ({
        type: resource.address.type,
        remoteId: resource.remote_id,
      })),
      agentId: state.listResources().find((resource) => resource.address.type === "agent")
        ?.remote_id,
      environmentId: state
        .listResources()
        .find((resource) => resource.address.type === "environment")?.remote_id,
    }));
    expect(remoteIds.resources.map((resource) => resource.type)).toContain("agent");
    agentId = remoteIds.agentId ?? undefined;
    environmentId = remoteIds.environmentId ?? undefined;
    expect(
      (first.execution?.results ?? [])
        .filter((result) => result.status !== "success")
        .map((result) => ({
          address: result.action.address,
          status: result.status,
          error: result.error,
        })),
    ).toEqual([]);
    expect(agentId).toBeTruthy();
    expect(environmentId).toBeTruthy();

    await syncProjectResourcesWithStateBackend(
      { projectName: prefix, config: loaded.config, stateBackend, stateScope },
      { policy: "force" },
    );
    const [agents, environments] = await readProjectRuntime(
      { projectName: prefix, config: loaded.config, stateBackend, stateScope },
      (runtime) =>
        Promise.all([
          listRemoteAgents(runtime, { provider: "bailian", include_archived: true, limit: 100 }),
          listRemoteEnvironments(runtime, {
            provider: "bailian",
            include_archived: true,
            limit: 100,
          }),
        ]),
    );
    expect(agents.data.filter((agent) => agent.id === agentId)).toHaveLength(1);
    expect(environments.data.some((environment) => environment.id === environmentId)).toBe(true);

    const updatedProject = structuredClone(project);
    updatedProject.agents[prefix]!.description =
      "CloudAgentBot Bailian contract smoke agent updated";
    updatedProject.agents[prefix]!.instructions = "Reply with exactly BAILIAN_UPDATE_OK.";
    (updatedProject.agents[prefix] as Record<string, unknown>).name = `${prefix}-renamed`;
    const updatedLoaded = await resolveProjectConfigFromObject(updatedProject, {
      basePath: root,
      projectName: prefix,
    });
    const updated = await syncProjectResourcesWithStateBackend(
      { projectName: prefix, config: updatedLoaded.config, stateBackend, stateScope },
      { policy: "force" },
    );
    expect(
      (updated.execution?.results ?? []).filter((result) => result.status !== "success"),
    ).toEqual([]);
    const agentIdAfterUpdate = await stateBackend.read(
      stateScope,
      (state) =>
        state.listResources().find((resource) => resource.address.type === "agent")?.remote_id,
    );
    expect(agentIdAfterUpdate).toBe(agentId);
    const updatedAgents = await readProjectRuntime(
      { projectName: prefix, config: updatedLoaded.config, stateBackend, stateScope },
      (runtime) =>
        listRemoteAgents(runtime, { provider: "bailian", include_archived: true, limit: 100 }),
    );
    const updatedAgent = updatedAgents.data.find((agent) => agent.id === agentId);
    expect(updatedAgent?.description).toBe("CloudAgentBot Bailian contract smoke agent updated");

    const resolvedConnection = {
      provider: "bailian",
      credential: credentials.bailianApiKey,
      workspaceId: credentials.bailianWorkspaceId,
    };
    await createBailianVerifier().verify({
      provider: "bailian",
      displayName: prefix,
      credential: credentials.bailianApiKey,
      workspaceId: credentials.bailianWorkspaceId,
    });
    const catalogBots = await createBailianBotCatalog(resolvedConnection).listBots();
    expect(catalogBots.some((bot) => bot.agentId === agentId)).toBe(true);

    // 把本次 OAP apply 产生的真实 state 放入生产 ManagedBotStore 布局，验证其环境绑定。
    const managedStore = new ManagedBotStore(join(root, "managed-bots"));
    const managedManifest = await managedStore.createScope({
      connectionId: "live-bailian",
      provider: "bailian",
      projectName: prefix,
      projectYaml: JSON.stringify(updatedProject),
    });
    const managedDir = managedStore.scopeDir("live-bailian", managedManifest.scope);
    const applyingManifest = await managedStore.transitionPhase(
      managedDir,
      managedManifest,
      "applying",
    );
    await copyFile(stateBackend.getStatePath(stateScope), join(managedDir, "agents.state.json"));
    await managedStore.transitionPhase(managedDir, applyingManifest, "managed");
    expect(await managedStore.findManagedEnvironmentId("live-bailian", agentId!)).toBe(
      environmentId,
    );
    const productPlane = new ChatDataPlane({
      chatAdapters: {
        bailian: (connection) =>
          createBailianChatAdapter(connection, {
            sessionMetadata: { openagentbot_test: "bailian-e2e", test_run: prefix },
          }),
      },
      botCatalogs: { bailian: createBailianBotCatalog },
      resolveCredential: () => Promise.resolve(resolvedConnection),
      resolveManagedEnvironmentId: (connectionId, id) =>
        managedStore.findManagedEnvironmentId(connectionId, id),
    });
    const productBots = await productPlane.listBots("live-bailian");
    expect(productBots.some((bot) => bot.ref.agentId === agentId)).toBe(true);
    const created = await productPlane.createChat("live-bailian", agentId!);
    sessionId = created.ref.sessionId;
    expect(sessionId).toMatch(/^sesn_/);
    expect(created.remoteStatus).toBe("idle");
    expect(created.keyScope).toBe("current");
    let listedSession;
    const listDeadline = Date.now() + 15_000;
    while (Date.now() < listDeadline) {
      listedSession = (await productPlane.listChats("live-bailian", agentId!)).find(
        (chat) => chat.ref.sessionId === sessionId,
      );
      if (listedSession) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(listedSession?.keyScope).toBe("current");

    const abort = new AbortController();
    const frames: Json[] = [];
    let connected = false;
    const stream = fetch(`${baseUrl}/sessions/${sessionId}/events/stream`, {
      headers: {
        Authorization: `Bearer ${credentials.bailianApiKey}`,
        Accept: "text/event-stream",
      },
      signal: abort.signal,
    }).then(async (response) => {
      expect(response.ok).toBe(true);
      expect(response.body).not.toBeNull();
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            if (/:\s*connected\b/.test(chunk)) connected = true;
            const data = chunk
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n");
            if (!data) continue;
            const parsed = JSON.parse(data) as Json;
            frames.push(parsed);
            const content = Array.isArray(parsed.content) ? parsed.content : [];
            const idle =
              parsed.type === "session_status" &&
              content.some(
                (block) =>
                  typeof block === "object" &&
                  block !== null &&
                  (block as Json).type === "data" &&
                  ((block as Json).data as Json | undefined)?.session_status === "idle",
              );
            if (idle) abort.abort();
          }
        }
      } catch (error) {
        if (!abort.signal.aborted) throw error;
      }
    });

    const connectedDeadline = Date.now() + 15_000;
    while (!connected && Date.now() < connectedDeadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connected).toBe(true);

    const sent = await request(`/sessions/${sessionId}/events`, {
      method: "POST",
      body: JSON.stringify({
        input: [{ role: "user", type: "message", content: [{ type: "text", text: "ping" }] }],
      }),
    });
    const sentEvents = sent.data as Json[];
    expect(sentEvents).toHaveLength(1);
    const sentEventId = String(sentEvents[0]!.id);

    await Promise.race([
      stream,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Bailian SSE did not reach idle")), 180_000),
      ),
    ]).finally(() => abort.abort());

    expect(frames.some((frame) => frame.type === "session_status")).toBe(true);
    expect(frames.some((frame) => frame.type === "message" && frame.role === "assistant")).toBe(
      true,
    );

    const history = await request(`/sessions/${sessionId}/events?order=asc&limit=100`);
    const historicalEvents = history.data as Json[];
    expect(historicalEvents.some((event) => event.id === sentEventId)).toBe(true);
    const streamedFinalIds = frames
      .filter(
        (frame) =>
          frame.object === "message" &&
          frame.status === "completed" &&
          typeof frame.id === "string",
      )
      .map((frame) => frame.id);
    expect(streamedFinalIds.every((id) => historicalEvents.some((event) => event.id === id))).toBe(
      true,
    );

    const deltaAbort = new AbortController();
    const deltaFrames: Json[] = [];
    let deltaConnected = false;
    const deltaStream = fetch(
      `${baseUrl}/sessions/${sessionId}/events/stream?event_deltas[]=message&event_deltas[]=reasoning`,
      {
        headers: {
          Authorization: `Bearer ${credentials.bailianApiKey}`,
          Accept: "text/event-stream",
        },
        signal: deltaAbort.signal,
      },
    ).then(async (response) => {
      expect(response.ok).toBe(true);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            if (/:\s*connected\b/.test(chunk)) deltaConnected = true;
            const data = chunk
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n");
            if (data) deltaFrames.push(JSON.parse(data) as Json);
          }
        }
      } catch (error) {
        if (!deltaAbort.signal.aborted) throw error;
      }
    });
    const deltaDeadline = Date.now() + 15_000;
    while (!deltaConnected && Date.now() < deltaDeadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    expect(deltaConnected).toBe(true);
    const deltaSent = await request(`/sessions/${sessionId}/events`, {
      method: "POST",
      body: JSON.stringify({
        input: [{ role: "user", type: "message", content: [{ type: "text", text: "delta ping" }] }],
      }),
    });
    const deltaSentId = String((deltaSent.data as Json[])[0]!.id);
    const deltaCaptureDeadline = Date.now() + 30_000;
    while (
      !deltaFrames.some((frame) => frame.type === "event_delta") &&
      Date.now() < deltaCaptureDeadline
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    deltaAbort.abort();
    await deltaStream;
    const recoveredHistory = await waitForIdleHistory(sessionId, deltaSentId);
    const starts = deltaFrames.filter((frame) => frame.type === "event_start");
    const deltas = deltaFrames.filter((frame) => frame.type === "event_delta");
    expect(starts.length).toBeGreaterThan(0);
    expect(deltas.length).toBeGreaterThan(0);
    expect(starts.some((start) => (start.event as Json | undefined)?.type === "reasoning")).toBe(
      true,
    );
    expect(starts.some((start) => (start.event as Json | undefined)?.type === "message")).toBe(
      true,
    );
    expect(
      deltas.some((frame) => {
        const delta = frame.delta as Json | undefined;
        const content = delta?.content as Json | undefined;
        return (
          delta?.type === "content_delta" &&
          typeof delta.index === "number" &&
          content?.type === "text" &&
          typeof content.text === "string"
        );
      }),
    ).toBe(true);
    for (const delta of deltas) {
      expect(typeof delta.event_id).toBe("string");
      expect(starts.some((start) => (start.event as Json | undefined)?.id === delta.event_id)).toBe(
        true,
      );
    }
    expect(
      starts.every((start) =>
        recoveredHistory.some((event) => event.id === (start.event as Json | undefined)?.id),
      ),
    ).toBe(true);

    const productAdapter = createBailianChatAdapter({
      provider: "bailian",
      credential: credentials.bailianApiKey,
      workspaceId: credentials.bailianWorkspaceId,
    });
    const productEvents: ChatEventView[] = [];
    let resolveProductDone!: () => void;
    const productDone = new Promise<void>((resolve) => {
      resolveProductDone = resolve;
    });
    const unsubscribe = await productAdapter.subscribe(sessionId, (event) => {
      productEvents.push(event);
      if (event.type === "done") resolveProductDone();
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await productAdapter.sendMessage(sessionId, "production adapter ping");
    await Promise.race([
      productDone,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Production Bailian adapter did not reach done")),
          180_000,
        ),
      ),
    ]).finally(unsubscribe);
    expect(productEvents.some((event) => event.type === "token" && event.text.length > 0)).toBe(
      true,
    );
    expect(productEvents.some((event) => event.type === "error")).toBe(false);
    const productHistory = await productAdapter.getChat(sessionId);
    expect(productHistory.messages.some((message) => message.role === "assistant")).toBe(true);

    const unauthorized = await fetch(`${baseUrl}/sessions/${sessionId}/events?limit=1`, {
      headers: { Authorization: "Bearer deliberately-invalid", Accept: "application/json" },
    });
    const unauthorizedBody = (await unauthorized.json()) as Json;
    expect(unauthorized.status).toBe(401);
    expect(typeof unauthorizedBody.code).toBe("string");
    expect(typeof unauthorizedBody.message).toBe("string");

    const missing = await fetch(`${baseUrl}/sessions/sesn_missing_contract/events?limit=1`, {
      headers: { Authorization: `Bearer ${credentials.bailianApiKey}`, Accept: "application/json" },
    });
    const missingBody = (await missing.json()) as Json;
    expect(missing.status).toBe(404);
    expect(missingBody.type).toBe("error");
    expect(typeof (missingBody.error as Json | undefined)?.code).toBe("string");
    expect(typeof (missingBody.error as Json | undefined)?.message).toBe("string");

    const stateText = await readText(stateBackend.getStatePath(stateScope), "utf8");
    expect(stateText).not.toContain(credentials.bailianApiKey);
  }, 240_000);
});
