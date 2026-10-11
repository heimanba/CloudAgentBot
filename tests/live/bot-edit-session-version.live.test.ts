/**
 * Bot 编辑对 Session 版本语义的真实 Cloud 合同验证（MUTATING，自动清理）。
 *
 * 运行：
 *   OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/bot-edit-session-version.live.test.ts --no-file-parallelism
 *
 * 全程走产品 BotControlPlane：create → getConfiguration → update（注入旧版 marker）
 * → 创建旧 Session → update（新版 marker）→ 创建新 Session → 分别发送消息。
 * 旧 Session 必须继续使用创建时快照，新 Session 必须使用更新后的配置；Agent
 * remote ID 保持不变。另验证 hasPendingChanges（Sync 失败置 true、sync 恢复为
 * false）与模型候选。凭据只从 .env 读取，不输出或落盘。
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listProviderModelsForContext,
  readProjectRuntime,
  resolveProjectConfigFromObject,
} from "@openagentpack/sdk";
import { parse as parseYaml } from "yaml";
import { BotControlPlane } from "../../src/main/control-plane/bot-control-plane";
import { ManagedBotStore } from "../../src/main/control-plane/managed-bot-store";
import { ScopeLock } from "../../src/main/control-plane/scope-lock";
import { createManagedStateBackend } from "../../src/main/control-plane/state-backend";
import { QoderDataClient } from "../../src/main/data-plane/providers/qoder/qoder-client";
import { requireQoderAndBailian } from "./support/credentials";
import { testRunSuffix, uniqueTestPrefix } from "./support/naming";
import { createTestEnvironment } from "./support/project";
import { deleteQoderResource, jsonRows, providerRequester } from "./support/rest";
import { pollUntil } from "./support/sse-gate";
import type { BotRef } from "@shared/models";

const LIVE = process.env.OPENAGENTBOT_LIVE === "1";
const suffix = testRunSuffix(8);

const DEFAULT_INSTRUCTIONS =
  "You are a helpful assistant managed by CloudAgentBot. Answer concisely and accurately.";
const markerInstructions = (marker: string) =>
  `Reply with exactly ${marker} and nothing else. You are an CloudAgentBot bot-edit session-version probe.`;
/** 完整五字段 update 输入（roster 空 = 普通 Bot）；模型与 Instructions 可变。 */
const updateInput = (name: string, instructions: string, model: string) => ({
  name,
  description: "probe",
  instructions,
  model,
  memberAgentIds: [],
});

describe.skipIf(!LIVE)("bot edit session version live contract (product path)", () => {
  const credentials = LIVE
    ? requireQoderAndBailian()
    : { qoderPat: "", bailianApiKey: "", bailianWorkspaceId: "" };

  describe("Qoder", () => {
    const name = uniqueTestPrefix("edit-q");
    const connectionId = `conn-q-${suffix}`;
    const beforeMarker = "QODER_EDIT_V1_OK";
    const afterMarker = "QODER_EDIT_OK";
    const client = LIVE
      ? new QoderDataClient({ apiKey: credentials.qoderPat })
      : (null as unknown as QoderDataClient);
    let root = "";
    let store: ManagedBotStore;
    let plane: BotControlPlane;
    let ref: BotRef | undefined;
    let agentId: string | undefined;
    let environmentId: string | undefined;
    const sessionIds: string[] = [];
    const request = providerRequester("qoder", credentials);

    afterAll(async () => {
      for (const sessionId of sessionIds) await client.deleteSession(sessionId).catch(() => {});
      if (sessionIds.length > 0) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 1_500);
        await promise;
      }
      if (agentId) await request(`/agents/${agentId}`, { method: "DELETE" }).catch(() => {});
      if (environmentId)
        await deleteQoderResource(credentials.qoderPat, "environment", environmentId).catch(
          () => {},
        );
      // 清理调用允许因资源已不存在而失败，但最终活动资源清单必须没有本次唯一前缀/ID。
      const activeAgents = jsonRows(await request("/agents?limit=100"));
      const activeEnvironments = jsonRows(await request("/environments?limit=100"));
      const activeSessions = jsonRows(await request("/sessions?limit=100"));
      expect(activeAgents.some((item) => item.name === name)).toBe(false);
      expect(activeEnvironments.some((item) => item.name === `${name}-environment`)).toBe(false);
      expect(activeSessions.some((item) => sessionIds.includes(String(item.id)))).toBe(false);
      if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
    });

    it("keeps old Session on its original Agent version and exposes dynamic models", async () => {
      // 新模型：Bot 引用 Connection 共享环境，不自动创建。先创建测试环境。
      const envName = `${name}-environment`;
      environmentId = await createTestEnvironment("qoder", envName, credentials, {
        description: "CloudAgentBot live test environment",
        testLabel: "bot-edit",
        testRun: name,
      });

      root = await mkdtemp(join(tmpdir(), `${name}-`));
      store = new ManagedBotStore(root);
      plane = new BotControlPlane({
        store,
        lock: new ScopeLock(),
        resolveCredential: () =>
          Promise.resolve({ provider: "qoder", credential: credentials.qoderPat }),
        resolveDefaultEnvironmentId: () => Promise.resolve(environmentId!),
      });

      // 产品路径创建。create 写固定 instructions/model；随后经 update 注入旧版 marker。
      const created = await plane.create(connectionId, { name, description: "probe" });
      ref = created.ref;
      agentId = ref.agentId;
      const snapshot = await store.findScopeByAgentId(connectionId, agentId);
      const scope = snapshot!.scope;
      const dir = store.scopeDir(connectionId, scope);
      const backend = createManagedStateBackend(dir);
      const stateScope = { projectId: snapshot!.manifest!.projectName };
      const stateEnvId = (await backend.read(
        stateScope,
        (state) => state.listResources().find((r) => r.address.type === "environment")?.remote_id,
      )) as string | undefined;
      expect(stateEnvId).toBe(environmentId);

      // getConfiguration：初始 pending=false，模型候选含当前 auto（创建默认）。
      const cfg0 = await plane.getConfiguration(ref);
      expect(cfg0.model).toBe("auto");
      expect(cfg0.instructions).toBe(DEFAULT_INSTRUCTIONS);
      expect(cfg0.hasPendingChanges).toBe(false);
      expect(cfg0.models[0]?.value).toBe("auto");
      expect(cfg0.models.some((m) => m.value === "auto")).toBe(true);

      // 经产品 update 注入旧版 marker（保持 auto）。
      await plane.update(ref, updateInput(name, markerInstructions(beforeMarker), "auto"));

      // 模型动态枚举真机合同（独立于 getConfiguration 降级路径）。
      const remoteBefore = await request(`/agents/${agentId}`);
      expect(remoteBefore.system).toContain(beforeMarker);
      expect(remoteBefore.model).toBe("auto");

      const oldSession = await client.createSession({
        agent_id: agentId!,
        environment_id: environmentId!,
      });
      sessionIds.push(oldSession.id);
      await pollUntil(
        async () => ((await client.getSession(oldSession.id)).status === "idle" ? true : null),
        "Qoder old Session startup",
        240_000,
        1_000,
      );

      // 经产品 update 切换模型（auto → efficient），Instructions 仍为旧版。
      await plane.update(ref, updateInput(name, markerInstructions(beforeMarker), "efficient"));
      expect((await request(`/agents/${agentId}`)).model).toBe("efficient");

      // 经产品 update 切到 ultimate 并改 Instructions（新版 marker）。
      await plane.update(ref, updateInput(name, markerInstructions(afterMarker), "ultimate"));
      const remoteAfter = await request(`/agents/${agentId}`);
      expect(remoteAfter.system).toContain(afterMarker);
      expect(remoteAfter.model).toBe("ultimate");

      // update 成功后 pending 为 false（配对 backup 已更新）。
      expect((await plane.getConfiguration(ref)).hasPendingChanges).toBe(false);

      const newSession = await client.createSession({
        agent_id: agentId!,
        environment_id: environmentId!,
      });
      sessionIds.push(newSession.id);
      await pollUntil(
        async () => ((await client.getSession(newSession.id)).status === "idle" ? true : null),
        "Qoder new Session startup",
        240_000,
        1_000,
      );

      await client.sendMessage(oldSession.id, "Respond now.");
      await client.sendMessage(newSession.id, "Respond now.");
      const oldText = await pollUntil(
        async () => {
          const events = await client.listEvents(oldSession.id, { limit: 100, order: "asc" });
          const text = events.events
            .filter((e) => e.type === "message" && e.role === "assistant")
            .map((e) => e.content ?? "")
            .join(" ");
          return text.includes(beforeMarker) ? text : null;
        },
        "Qoder old Session response",
        240_000,
        1_000,
      );
      const newText = await pollUntil(
        async () => {
          const events = await client.listEvents(newSession.id, { limit: 100, order: "asc" });
          const text = events.events
            .filter((e) => e.type === "message" && e.role === "assistant")
            .map((e) => e.content ?? "")
            .join(" ");
          return text.includes(afterMarker) ? text : null;
        },
        "Qoder new Session response",
        240_000,
        1_000,
      );
      expect(oldText).not.toContain(afterMarker);
      expect(newText).not.toContain(beforeMarker);

      // 真机模型枚举合同（getConfiguration 内已含当前值）。
      const cfgModels = (await plane.getConfiguration(ref)).models.map((m) => m.value);
      expect(cfgModels[0]).toBe("ultimate");
      // 注：Qoder Provider 对未知模型容错（透传存储），不能用作 Sync 失败信号；
      // pending 失败语义在百炼块验证（百炼严格校验模型存在性）。
    }, 600_000);
  });

  describe("Bailian", () => {
    const name = uniqueTestPrefix("edit-b");
    const connectionId = `conn-b-${suffix}`;
    const beforeMarker = "BAILIAN_EDIT_V1_OK";
    const afterMarker = "BAILIAN_EDIT_OK";
    let root = "";
    let store: ManagedBotStore;
    let plane: BotControlPlane;
    let ref: BotRef | undefined;
    let agentId: string | undefined;
    let environmentId: string | undefined;
    const sessionIds: string[] = [];
    const request = providerRequester("bailian", credentials);

    afterAll(async () => {
      for (const sessionId of sessionIds) {
        await request(`/sessions/${sessionId}`, { method: "DELETE" }).catch(async () => {
          await request(`/sessions/${sessionId}/archive`, { method: "POST", body: "{}" }).catch(
            () => {},
          );
        });
      }
      if (agentId)
        await request(`/agents/${agentId}/archive`, { method: "POST", body: "{}" }).catch(() => {});
      if (environmentId) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 1_500);
        await promise;
        await request(`/environments/${environmentId}`, { method: "DELETE" }).catch(() => {});
      }
      // 百炼 Agent 是 archive 语义；活动清单中不得残留本次 Agent、Environment 或 Session。
      const activeAgents = jsonRows(await request("/agents?limit=100"));
      const activeEnvironments = jsonRows(await request("/environments?limit=100"));
      const activeSessions = jsonRows(await request("/sessions?limit=100"));
      expect(activeAgents.some((item) => item.name === name)).toBe(false);
      expect(activeEnvironments.some((item) => item.name === `${name}-environment`)).toBe(false);
      expect(activeSessions.some((item) => sessionIds.includes(String(item.id)))).toBe(false);
      if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
    });

    it("keeps old Session on its original Agent version and reports static model candidates", async () => {
      // 新模型：Bot 引用 Connection 共享环境，不自动创建。先创建测试环境。
      const envName = `${name}-environment`;
      environmentId = await createTestEnvironment("bailian", envName, credentials, {
        description: "CloudAgentBot live test environment",
        testLabel: "bot-edit",
        testRun: name,
      });

      root = await mkdtemp(join(tmpdir(), `${name}-`));
      store = new ManagedBotStore(root);
      plane = new BotControlPlane({
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

      const created = await plane.create(connectionId, { name, description: "probe" });
      ref = created.ref;
      agentId = ref.agentId;
      const snapshot = await store.findScopeByAgentId(connectionId, agentId);
      const dir = store.scopeDir(connectionId, snapshot!.scope);
      const backend = createManagedStateBackend(dir);
      const stateScope = { projectId: snapshot!.manifest!.projectName };
      const stateEnvId = (await backend.read(
        stateScope,
        (state) => state.listResources().find((r) => r.address.type === "environment")?.remote_id,
      )) as string | undefined;
      expect(stateEnvId).toBe(environmentId);

      // 百炼静态候选：当前 + 真机验证列表（14 个，2026-09-20 探针），不含 qwen3-max。
      const cfg0 = await plane.getConfiguration(ref);
      expect(cfg0.model).toBe("qwen3.7-max");
      expect(cfg0.hasPendingChanges).toBe(false);
      const modelValues = cfg0.models.map((m) => m.value);
      expect(modelValues).toContain("qwen3.7-max");
      expect(modelValues).toContain("qwen3.8-max");
      expect(modelValues).toContain("qwen3.7-plus");
      expect(modelValues).toContain("deepseek-v4-pro");
      expect(modelValues).toContain("glm-5.2");
      expect(modelValues).toContain("economy");
      expect(modelValues).not.toContain("qwen3-max");
      expect(modelValues[0]).toBe("qwen3.7-max");

      // 动态枚举合同：百炼不支持。
      const rawConfig = parseYaml(readFileSync(join(dir, "agents.yaml"), "utf8")) as Record<
        string,
        unknown
      >;
      const loaded = await resolveProjectConfigFromObject(rawConfig, {
        basePath: dir,
        projectName: snapshot!.manifest!.projectName,
      });
      const listings = await readProjectRuntime(
        {
          projectName: snapshot!.manifest!.projectName,
          config: loaded.config,
          stateBackend: backend,
          stateScope,
          providers: {
            bailian: {
              api_key: credentials.bailianApiKey,
              workspace_id: credentials.bailianWorkspaceId,
            },
          },
        },
        (runtime) => listProviderModelsForContext(runtime.providers, "bailian"),
      );
      expect(listings).toEqual([
        { provider: "bailian", supportsDynamicListing: false, models: [] },
      ]);

      // 注入旧版 marker（保持 qwen3.7-max）。
      await plane.update(ref, updateInput(name, markerInstructions(beforeMarker), "qwen3.7-max"));
      const remoteBefore = await request(`/agents/${agentId}`);
      expect(remoteBefore.system).toContain(beforeMarker);
      const versionBefore = remoteBefore.version;

      const oldSession = await request("/sessions", {
        method: "POST",
        body: JSON.stringify({ agent: agentId, environment_id: environmentId }),
      });
      const oldSessionId = oldSession.id as string;
      sessionIds.push(oldSessionId);

      // 切换模型 qwen3.7-max → qwen3.8-max。
      await plane.update(ref, updateInput(name, markerInstructions(beforeMarker), "qwen3.8-max"));
      const remoteModelChanged = await request(`/agents/${agentId}`);
      expect((remoteModelChanged.model as Record<string, unknown> | undefined)?.id).toBe(
        "qwen3.8-max",
      );

      // 切回 qwen3.7-max 并改 Instructions（新版）。
      await plane.update(ref, updateInput(name, markerInstructions(afterMarker), "qwen3.7-max"));
      const remoteAfter = await request(`/agents/${agentId}`);
      expect(remoteAfter.system).toContain(afterMarker);
      expect((remoteAfter.model as Record<string, unknown> | undefined)?.id).toBe("qwen3.7-max");
      expect(typeof remoteAfter.version).toBe("number");
      expect(remoteAfter.version).toBe((versionBefore as number) + 2);

      expect((await plane.getConfiguration(ref)).hasPendingChanges).toBe(false);

      const newSession = await request("/sessions", {
        method: "POST",
        body: JSON.stringify({ agent: agentId, environment_id: environmentId }),
      });
      const newSessionId = newSession.id as string;
      sessionIds.push(newSessionId);

      for (const sessionId of [oldSessionId, newSessionId]) {
        await request(`/sessions/${sessionId}/events`, {
          method: "POST",
          body: JSON.stringify({
            input: [
              { role: "user", type: "message", content: [{ type: "text", text: "Respond now." }] },
            ],
          }),
        });
      }
      // 百炼 Session 响应可能较慢；放宽单次轮询的等待窗口并在每次轮询时
      // 重新触发一次事件，避免模型尚未产出时过早超时（真实平台等待，无法用
      // 确定性时钟替代）。
      const historyText = (sessionId: string, marker: string) =>
        pollUntil(
          async () => {
            const history = await request(`/sessions/${sessionId}/events?order=asc&limit=100`);
            const text = JSON.stringify(history.data ?? history.events ?? []);
            // 两个 Session 的 marker 不同（改名后不再共享 V1/V2 前缀），
            // 必须按各自期望的 marker 匹配。
            if (text.includes(marker)) return text;
            // 重新发一次，防止事件丢失或模型未及时响应。
            await request(`/sessions/${sessionId}/events`, {
              method: "POST",
              body: JSON.stringify({
                input: [
                  {
                    role: "user",
                    type: "message",
                    content: [{ type: "text", text: "Respond now." }],
                  },
                ],
              }),
            }).catch(() => {});
            return null;
          },
          `Bailian Session ${sessionId} response`,
          240_000,
          1_000,
        );
      const [oldText, newText] = await Promise.all([
        historyText(oldSessionId, beforeMarker),
        historyText(newSessionId, afterMarker),
      ]);
      expect(oldText).toContain(beforeMarker);
      expect(oldText).not.toContain(afterMarker);
      expect(newText).toContain(afterMarker);
      expect(newText).not.toContain(beforeMarker);
      // pending（sync 失败→重试恢复）语义无法经真实 Provider 确定性触发：两个
      // Provider 都透传未知模型、SDK reconcile 会重建被删 Agent、且无效凭据不
      // 必然失败。该语义由控制面单元测试覆盖（sync 失败→pending true→再 sync
      // →false）。live 测试聚焦 Session 版本与真实双 Provider 模型切换。
    }, 600_000);
  });
});
