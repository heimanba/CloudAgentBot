/**
 * 百炼（Bailian）Multi-Agent 协作的真实 Cloud 合同验证（MUTATING，自动清理）。
 *
 * 运行：
 *   OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/bailian-multi-agent-collaboration.live.test.ts --no-file-parallelism
 *
 * 探针设计（与 Qoder 版本同构；稳定验收只使用强制委派探针）：
 * 1. 两个带唯一前缀的临时成员 Agent（worker + decoy），coordinator 以 external agent_id 引用；
 * 2. coordinator instructions 明确要求把本次探针强制委派给唯一 worker，并原样返回其答案；
 * 3. 发送普通用户消息（不含 @name / 不依赖任何 mention 路由）；
 * 4. 硬断言 = 真实 child Thread 证据：`thread_created` + 双向 `thread_message_sent` /
 *    `thread_message_received`，且这些事件带 child `session_thread_id`；
 * 5. worker 生成的随机 token 只用于 prove 最终答案的来源，不能替代 Thread 事件证据；
 * 6. roster 2->1->0 远程收敛、coordinator ID 不变、成员 Agent 未被更新/归档/删除。
 *
 * “普通任务是否主动委派”不作为确定性 pass/fail 条件：本文件只发送强制委派消息。
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBailianChatAdapter } from "../../src/main/data-plane/providers/bailian/bailian-chat-adapter";
import { createBailianBotCatalog } from "../../src/main/data-plane/providers/bailian/bailian-bot-catalog";
import { ChatDataPlane } from "../../src/main/data-plane/chat-data-plane";
import { BotControlPlane } from "../../src/main/control-plane/bot-control-plane";
import { ManagedBotStore } from "../../src/main/control-plane/managed-bot-store";
import { ScopeLock } from "../../src/main/control-plane/scope-lock";
import type { ChatEventView } from "../../src/shared/models";
import { createCleanupCollector } from "./support/cleanup";
import { requireBailian } from "./support/credentials";
import { histogram, requireRoster } from "./support/multi-agent";
import { testRunSuffix, uniqueTestPrefix } from "./support/naming";
import { createTestEnvironment } from "./support/project";
import { jsonRows, providerRequester, type Json } from "./support/rest";
import { createSseObserver } from "./support/sse-gate";

const LIVE = process.env.OPENAGENTBOT_LIVE === "1";

const prefix = uniqueTestPrefix("v2mab");
const suffix = testRunSuffix(4);
const workerName = `${prefix}-worker`;
const decoyName = `${prefix}-decoy`;
const coordinatorName = `${prefix}-coordinator`;
const environmentName = `${prefix}-environment`;
const MEMBER_CONN = `conn_live_mab_m_${suffix}`;
const COORD_CONN = `conn_live_mab_c_${suffix}`;

const TOKEN_PATTERN = /MK-[A-Z0-9]{6}/g;

/** 强制委派：coordinator 不得自行回答，必须点名委派给唯一 worker 并原样返回其答案。 */
const COORDINATOR_INSTRUCTIONS =
  `You are a coordinator. Never answer a task yourself. Always delegate every request to the ` +
  `collaboration member named ${workerName}, then return that member's answer verbatim as your ` +
  `entire final answer, with no additions and no commentary.`;

/** worker 每次生成全新随机 token；token 只经真实委派链路产生。 */
const WORKER_INSTRUCTIONS =
  "You are a probe worker. For every request, generate exactly one fresh random token of the form " +
  "MK- followed by 6 uppercase letters or digits, and reply with only that token and nothing else.";

const DECOY_INSTRUCTIONS =
  "You are an idle standby member. If you ever receive a request, reply with exactly the single word STANDBY.";

const credentials = LIVE ? requireBailian() : { bailianApiKey: "", bailianWorkspaceId: "" };

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 事件行上的 child `session_thread_id`（与 SDK 同一读法：顶层 / metadata / content.data）。 */
function eventThreadId(raw: Json): string | undefined {
  const direct = stringField(raw.session_thread_id);
  if (direct) return direct;
  const metadata = raw.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const value = stringField((metadata as Json).session_thread_id);
    if (value) return value;
  }
  const content = Array.isArray(raw.content) ? (raw.content as Json[]) : [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const data = (block as Json).data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const value = stringField((data as Json).session_thread_id);
      if (value) return value;
    }
  }
  return undefined;
}

const request = providerRequester("bailian", credentials);

async function findAgent(agentId: string): Promise<Json | undefined> {
  const rows = (await request(`/agents?limit=100`)).data as Json[] | undefined;
  const found = (rows ?? []).find((agent) => stringField(agent.id) === agentId);
  if (!found) return undefined;
  // 列表项不含 multiagent/version 等完整字段时退回详情端点。
  if (!("multiagent" in found)) return request(`/agents/${encodeURIComponent(agentId)}`);
  return found;
}

/** 会话事件全量分页（asc + page 游标）；与生产 Adapter 同一读法。 */
async function listAllSessionEvents(sessionId: string): Promise<Json[]> {
  const collected: Json[] = [];
  const seen = new Set<string>();
  let page: string | undefined;
  do {
    const query = new URLSearchParams({ order: "asc", limit: "100" });
    if (page) query.set("page", page);
    const result = await request(`/sessions/${encodeURIComponent(sessionId)}/events?${query}`);
    for (const event of (result.data as Json[] | undefined) ?? []) {
      const id = stringField(event.id);
      if (!id || !seen.has(id)) collected.push(event);
      if (id) seen.add(id);
    }
    const next = stringField(result.next_page);
    if (next && next === page) throw new Error("Bailian event cursor did not advance");
    page = next;
  } while (page);
  return collected;
}

describe.skipIf(!LIVE)("bailian multi-agent collaboration live (mutating, auto-cleanup)", () => {
  let root: string | undefined;
  let envId: string | undefined;
  let workerId: string | undefined;
  let decoyId: string | undefined;
  let coordinatorId: string | undefined;
  let sessionId: string | undefined;

  afterAll(async () => {
    const cleanup = createCleanupCollector("Bailian live resource cleanup failed");
    if (sessionId)
      await cleanup.attempt(() => request(`/sessions/${sessionId}`, { method: "DELETE" }));
    for (const id of [coordinatorId, workerId, decoyId]) {
      if (id)
        await cleanup.attempt(() =>
          request(`/agents/${id}/archive`, { method: "POST", body: "{}" }),
        );
    }
    if (envId) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await cleanup.attempt(() => request(`/environments/${envId}`, { method: "DELETE" }));
    }
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
    // §14.7：清理后验证——活动清单中不得残留本次资源。
    const activeAgents = jsonRows(await request("/agents?limit=100"));
    const activeEnvironments = jsonRows(await request("/environments?limit=100"));
    const activeSessions = jsonRows(await request("/sessions?limit=100"));
    expect(
      activeAgents.some((a) => stringField(a.name)?.startsWith(`${prefix}-`)),
      "no test agents should remain",
    ).toBe(false);
    expect(
      activeEnvironments.some((e) => stringField(e.name)?.startsWith(`${prefix}-`)),
      "no test environments should remain",
    ).toBe(false);
    expect(
      activeSessions.some((s) => stringField(s.id) === sessionId),
      "no test sessions should remain",
    ).toBe(false);
    cleanup.flush();
  }, 300_000);

  it("proves real child-thread collaboration and converges roster 2->1->0", async () => {
    // 1. 共享环境（SDK 包根公共 Interface；与 EnvironmentControlPlane 的创建分支同形）。
    envId = await createTestEnvironment("bailian", environmentName, credentials, {
      description: "CloudAgentBot multi-agent collaboration live contract environment",
      testLabel: "multi-agent-collaboration",
      testRun: prefix,
    });

    root = await mkdtemp(join(tmpdir(), `${prefix}-`));
    const store = new ManagedBotStore(join(root, "managed-bots"));
    const plane = new BotControlPlane({
      store,
      lock: new ScopeLock(),
      resolveCredential: () =>
        Promise.resolve({
          provider: "bailian",
          credential: credentials.bailianApiKey,
          workspaceId: credentials.bailianWorkspaceId,
        }),
      resolveDefaultEnvironmentId: () => Promise.resolve(envId!),
    });

    // 2. 两个带唯一前缀的临时成员 Agent（各自独立 scope；roster 只引用其外部 ID）。
    const workerView = await plane.create(MEMBER_CONN, {
      name: workerName,
      description: "multi-agent live contract probe worker",
    });
    workerId = workerView.ref.agentId;
    await plane.update(workerView.ref, {
      name: workerName,
      description: "multi-agent live contract probe worker",
      instructions: WORKER_INSTRUCTIONS,
      model: "qwen3.7-max",
      memberAgentIds: [],
    });

    const decoyView = await plane.create(MEMBER_CONN, {
      name: decoyName,
      description: "multi-agent live contract standby member",
    });
    decoyId = decoyView.ref.agentId;
    await plane.update(decoyView.ref, {
      name: decoyName,
      description: "multi-agent live contract standby member",
      instructions: DECOY_INSTRUCTIONS,
      model: "qwen3.7-max",
      memberAgentIds: [],
    });

    // 成员的远端配置快照：协作全程结束后必须逐字段不变（未被更新/归档/删除）。
    const memberConfigSnapshot = (raw: Json): Json => ({
      name: raw.name,
      description: raw.description,
      system: raw.system,
      model: raw.model,
      multiagent: raw.multiagent ?? null,
      archived_at: raw.archived_at ?? null,
    });
    const workerSnapshotRaw = await findAgent(workerId);
    const decoySnapshotRaw = await findAgent(decoyId);
    if (!workerSnapshotRaw || !decoySnapshotRaw) throw new Error("member agents not visible");
    const workerSnapshot = memberConfigSnapshot(workerSnapshotRaw);
    const decoySnapshot = memberConfigSnapshot(decoySnapshotRaw);

    // 3. coordinator 以 external agent_id 引用两个成员（Create 已含 roster；再 update 设定强制委派指令）。
    const coordView = await plane.create(COORD_CONN, {
      name: coordinatorName,
      description: "multi-agent live contract coordinator",
      memberAgentIds: [workerId, decoyId],
    });
    coordinatorId = coordView.ref.agentId;
    const updatedCoord = await plane.update(coordView.ref, {
      name: coordinatorName,
      description: "multi-agent live contract coordinator",
      instructions: COORDINATOR_INSTRUCTIONS,
      model: "qwen3.7-max",
      memberAgentIds: [workerId, decoyId],
    });
    expect(updatedCoord.ref.agentId).toBe(coordinatorId);
    expect(updatedCoord.management).toBe("managed");

    // 4. scope state 只管理 coordinator 一个 Agent 资源。成员以 external agent_id 出现在
    //    Project Document；state 中成员 id 唯一的合法出现位置是远端读回快照 remote_snapshot
    //    （provider 对 multiagent 字段的读回记录），而不是资源列表。
    const scopes = await store.listScopes(COORD_CONN);
    expect(scopes).toHaveLength(1);
    const scopeDir = scopes[0]!.dir;
    const stateText = await readFile(join(scopeDir, "agents.state.json"), "utf8");
    const stateJson = JSON.parse(stateText) as {
      resources?: Array<{
        address?: { type?: string };
        remote_id?: string | null;
        remote_snapshot?: { multiagent?: { type?: string; member_ids?: string[] } };
      }>;
    };
    const stateResources = stateJson.resources ?? [];
    const stateAgents = stateResources.filter((resource) => resource.address?.type === "agent");
    expect(stateAgents).toHaveLength(1);
    expect(stateAgents[0]?.remote_id).toBe(coordinatorId);
    expect(
      stateResources.filter(
        (resource) => resource.remote_id === workerId || resource.remote_id === decoyId,
      ),
    ).toHaveLength(0);
    expect([...(stateAgents[0]?.remote_snapshot?.multiagent?.member_ids ?? [])].sort()).toEqual(
      [workerId, decoyId].sort(),
    );
    const projectYaml = await readFile(join(scopeDir, "agents.yaml"), "utf8");
    expect(projectYaml).toContain(workerId);
    expect(projectYaml).toContain(decoyId);
    expect(projectYaml).not.toContain(credentials.bailianApiKey);

    // 5. 远端 roster 读回：{type: coordinator, agents: [worker, decoy]}。
    const rosterOnCreate = requireRoster((await findAgent(coordinatorId))?.multiagent);
    expect(rosterOnCreate.type).toBe("coordinator");
    expect(rosterOnCreate.ids).toEqual([workerId, decoyId].sort());

    // 6. 生产 ChatDataPlane 创建 Session，发送普通用户消息（不含 @name）。
    const chatPlane = new ChatDataPlane({
      chatAdapters: { bailian: createBailianChatAdapter },
      botCatalogs: { bailian: createBailianBotCatalog },
      resolveCredential: () =>
        Promise.resolve({
          provider: "bailian",
          credential: credentials.bailianApiKey,
          workspaceId: credentials.bailianWorkspaceId,
        }),
      resolveManagedEnvironmentId: (connectionId, agentId) =>
        store.findManagedEnvironmentId(connectionId, agentId),
      resolveDefaultEnvironmentId: () => Promise.resolve(envId!),
    });
    const chat = await chatPlane.createChat(COORD_CONN, coordinatorId);
    sessionId = chat.ref.sessionId;
    expect(chat.ref.agentId).toBe(coordinatorId);

    // 新 Session 初始 running（环境启动中）；轮询到 idle 再发送，避免冷启动竞态。
    {
      const deadline = Date.now() + 180_000;
      for (;;) {
        const detail = await chatPlane.getChat(COORD_CONN, sessionId);
        if (detail.chat.remoteStatus === "idle") break;
        if (Date.now() > deadline) throw new Error("session did not become idle within 180s");
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }

    // 先开订阅再发送，避免错过早期事件；协作链路可能包含 child Thread 往返。
    // Qoder 侧的 done 可能源自 child Thread 空闲状态（见 qoder live test）；百炼同样保持
    // 只在大窗口内等待 done，不把 token 帧作为完成条件。
    const sse = createSseObserver();
    const unsubscribe = await chatPlane.subscribe(COORD_CONN, sessionId, (event: ChatEventView) =>
      sse.track(event),
    );
    const send = await chatPlane.sendMessage(
      COORD_CONN,
      sessionId,
      "Run the delegation probe now. Request the member's freshly generated code and report that code in your final answer.",
    );
    expect(send.ok).toBe(true);
    const sseDeadline = Date.now() + 240_000;
    while (!sse.doneSeen && sse.errors.length === 0 && Date.now() < sseDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    unsubscribe();

    // 6b. 先取证再断言：原始事件直方图 + SSE 视图日志一次打印，任何失败都能直接定位。
    // plan §11.6 只把 Thread 事件当作稳定判据，回合是否产出 assistant 文本帧属于体验观察。
    // token 映射本身由 adapter 单测确定性覆盖（bailian-chat-adapter.test.ts 的 delta → token）。
    let sessionEvents = await listAllSessionEvents(sessionId);
    console.log(
      "[bailian multi-agent sse]",
      JSON.stringify(
        {
          prefix,
          sessionId,
          sseViewCounts: sse.counts,
          sseTokenFrames: sse.tokenFrames,
          sseDoneSeen: sse.doneSeen,
          sseStreamErrors: sse.errors,
          rawEventTypeHistogram: histogram(
            sessionEvents.map((event) => stringField(event.type) ?? "unknown"),
          ),
          sseViewLog: sse.log,
        },
        null,
        2,
      ),
    );
    expect(sse.errors, "multi-agent SSE 不应出现 error 事件").toEqual([]);
    expect(sse.doneSeen, "multi-agent SSE 必须到达 done").toBe(true);

    // 7. Thread 证据（硬门）：真实 child Thread 创建 + 双向 thread message 事件。
    // plan §11.6 与 docs/research/multi-agent-mention-contract.md：最终文本、模型声称“已委派”
    // 或 marker 本身都不能替代 Thread 事件证据。
    // coordinator 主回合的 SSE done 可能早于 child 回复落地，因此对远端事件做有界等待。
    const observedRawTypes = new Set<string>();
    const threadEvidenceDeadline = Date.now() + 180_000;
    for (;;) {
      for (const event of sessionEvents) {
        const rawType = stringField(event.type);
        if (rawType) observedRawTypes.add(rawType);
      }
      if (
        observedRawTypes.has("thread_created") &&
        observedRawTypes.has("thread_message_sent") &&
        observedRawTypes.has("thread_message_received")
      ) {
        break;
      }
      if (Date.now() > threadEvidenceDeadline) break;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      sessionEvents = await listAllSessionEvents(sessionId);
    }
    const threadEvents = sessionEvents.filter((event) =>
      ["thread_created", "thread_message_sent", "thread_message_received"].includes(
        stringField(event.type) ?? "",
      ),
    );
    const threadedEvents = threadEvents.filter((event) => eventThreadId(event) !== undefined);
    // 辅助观察（不参与 pass/fail）：过滤 instructions 里的字面占位符 MK-XXXXXX。
    const freshTokens = (text: string) =>
      new Set((text.match(TOKEN_PATTERN) ?? []).filter((token) => token !== "MK-XXXXXX"));
    const detail = await chatPlane.getChat(COORD_CONN, sessionId);
    const finalText = detail.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.content)
      .join("\n");
    const finalTokens = freshTokens(finalText);
    const threadPayloads = threadEvents.map((event) => JSON.stringify(event));
    const threadTokens = freshTokens(threadPayloads.join("\n"));
    const tokenInThread = [...finalTokens].some((token) =>
      threadPayloads.some((payload) => payload.includes(token)),
    );
    console.log(
      "[bailian multi-agent delegation]",
      JSON.stringify(
        {
          prefix,
          sessionId,
          eventTypeHistogram: histogram(
            sessionEvents.map((event) => stringField(event.type) ?? "unknown"),
          ),
          observedRawTypes: [...observedRawTypes].sort(),
          threadEventCount: threadEvents.length,
          threadedEventCount: threadedEvents.length,
          childThreadIds: [...new Set(threadedEvents.map((event) => eventThreadId(event)!))],
          tokenInFinalText: [...finalTokens],
          tokenInThreadMessages: [...threadTokens],
          tokenOriginatesFromThreadMessage: tokenInThread,
          finalAnswerPreview: finalText.slice(0, 200),
        },
        null,
        2,
      ),
    );
    expect(observedRawTypes.has("thread_created"), "child thread must be created").toBe(true);
    expect(
      observedRawTypes.has("thread_message_sent"),
      "coordinator must send a message into the child thread",
    ).toBe(true);
    expect(
      observedRawTypes.has("thread_message_received"),
      "child thread must send a message back to the coordinator",
    ).toBe(true);
    expect(
      threadedEvents.length,
      "child-thread events must carry a session_thread_id",
    ).toBeGreaterThan(0);
    const childThreadIds = new Set(threadedEvents.map((event) => eventThreadId(event)!));

    if (process.env.OPENAGENTBOT_PACKAGED_UI === "1") {
      const run = promisify(execFile);
      const result = await run(
        process.execPath,
        [
          join(__dirname, "../../scripts/verify-collaboration-packaged.mjs"),
          "bailian",
          coordinatorName,
          sessionId,
          workerName,
        ],
        { timeout: 180_000 },
      );
      console.log(result.stdout.trim());
    }

    // 9. roster 2 -> 1：远程收敛且 coordinator ID 不变。
    const shrunk = await plane.update(
      { connectionId: COORD_CONN, agentId: coordinatorId },
      {
        name: coordinatorName,
        description: "multi-agent live contract coordinator",
        instructions: COORDINATOR_INSTRUCTIONS,
        model: "qwen3.7-max",
        memberAgentIds: [workerId],
      },
    );
    expect(shrunk.ref.agentId).toBe(coordinatorId);
    expect(requireRoster((await findAgent(coordinatorId))?.multiagent).ids).toEqual([workerId]);
    const coordinatorsAfterShrink = jsonRows(await request("/agents?limit=100")).filter(
      (agent) => stringField(agent.name) === coordinatorName,
    );
    expect(coordinatorsAfterShrink).toHaveLength(1);
    expect(stringField(coordinatorsAfterShrink[0]?.id)).toBe(coordinatorId);

    // 10. 清空 roster：远端 multiagent 被清除（百炼用空 coordinator roster 表达清除）。
    const cleared = await plane.update(
      { connectionId: COORD_CONN, agentId: coordinatorId },
      {
        name: coordinatorName,
        description: "multi-agent live contract coordinator",
        instructions: COORDINATOR_INSTRUCTIONS,
        model: "qwen3.7-max",
        memberAgentIds: [],
      },
    );
    expect(cleared.ref.agentId).toBe(coordinatorId);
    expect(requireRoster((await findAgent(coordinatorId))?.multiagent).ids).toEqual([]);

    // 11. 成员未被更新、归档或删除（配置身份字段逐字段一致）。
    const workerFinal = await findAgent(workerId);
    const decoyFinal = await findAgent(decoyId);
    expect(workerFinal, "worker member must still exist").toBeDefined();
    expect(decoyFinal, "decoy member must still exist").toBeDefined();
    expect(memberConfigSnapshot(workerFinal!)).toEqual(workerSnapshot);
    expect(memberConfigSnapshot(decoyFinal!)).toEqual(decoySnapshot);

    // 12. 证据记录：只记 id、类型直方图和计数，不含凭据、完整响应或用户数据。
    console.log(
      "[bailian multi-agent evidence]",
      JSON.stringify(
        {
          prefix,
          environmentId: envId,
          workerId,
          decoyId,
          coordinatorId,
          sessionId,
          eventTypes: histogram(sessionEvents.map((event) => stringField(event.type) ?? "unknown")),
          sseViewCounts: sse.counts,
          sseTokenFrames: sse.tokenFrames,
          sseStreamErrors: sse.errors,
          threadEventCount: threadEvents.length,
          threadedEventCount: threadedEvents.length,
          childThreadIds: [...childThreadIds],
          tokenCount: finalTokens.size,
          tokenProvenance: tokenInThread ? "thread-message" : "final-text-only",
        },
        null,
        2,
      ),
    );
  }, 1_800_000);
});
