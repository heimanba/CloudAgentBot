/**
 * Step 8 / 计划 §11.6 真实 Cloud 协作闭环：Qoder（MUTATING，自动清理）。
 *
 * 运行：
 *   OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/qoder-multi-agent-collaboration.live.test.ts --no-file-parallelism
 *
 * 覆盖计划 §11.6 的 11 步（经生产 BotControlPlane / ChatDataPlane，不绕过产品路径）：
 * 创建两个临时成员 Agent → coordinator 以 external agent_id 引用成员 → scope state 只记录
 * coordinator → 强制委派探针 → child Thread 创建与双向 thread message 事件 → roster 2→1→清空
 * → 成员未被改动 → 归档/删除临时资源 → 记录不含凭据。
 *
 * 强制委派探针：worker 的 instructions 要求每次生成一个全新的随机 token（MK-XXXXXX），
 * 该 token 不出现在任何 instructions、用户消息或本地文件中；coordinator 只能通过真实委派
 * 与回传拿到它。硬断言 = child Thread 创建 + 双向 thread message 事件 + roster 收敛 +
 * 成员配置未被改动，不依赖模型自称"已委派"，也不依赖模型最终文本。
 * 普通任务是否主动委派、自然语言点名是否影响选择、回合是否产生 assistant 文本帧，
 * 只作为体验观察记录，不作为确定性 pass/fail 条件（plan §11.6）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { QoderDataClient } from "../../src/main/data-plane/providers/qoder/qoder-client";
import { QoderConflictError } from "../../src/main/data-plane/providers/qoder/qoder-http";
import { ChatDataPlane } from "../../src/main/data-plane/chat-data-plane";
import { createQoderChatAdapter } from "../../src/main/data-plane/providers/qoder/qoder-chat-adapter";
import { createQoderBotCatalog } from "../../src/main/data-plane/providers/qoder/qoder-bot-catalog";
import { BotControlPlane } from "../../src/main/control-plane/bot-control-plane";
import { ManagedBotStore } from "../../src/main/control-plane/managed-bot-store";
import { ScopeLock } from "../../src/main/control-plane/scope-lock";
import type { ChatEventView } from "../../src/shared/models";
import { createCleanupCollector } from "./support/cleanup";
import { requireQoderPat } from "./support/credentials";
import { QODER_GATEWAY } from "./support/endpoints";
import { histogram, requireRoster } from "./support/multi-agent";
import { testRunSuffix, uniqueTestPrefix } from "./support/naming";
import { createTestEnvironment } from "./support/project";
import { deleteQoderResource, jsonRows, providerRequester, type Json } from "./support/rest";

const LIVE = process.env.OPENAGENTBOT_LIVE === "1";

const suffix = testRunSuffix(4);
const prefix = uniqueTestPrefix("v2ma");
const workerName = `${prefix}-worker`;
const decoyName = `${prefix}-decoy`;
const coordinatorName = `${prefix}-coordinator`;
const environmentName = `${prefix}-environment`;
const MEMBER_CONN = `conn_live_ma_m_${suffix}`;
const COORD_CONN = `conn_live_ma_c_${suffix}`;

const TOKEN_PATTERN = /MK-[A-Z0-9]{6}/g;

/** 强制委派：coordinator 不得自行回答，必须点名委派给唯一 worker 并原样返回其答案。 */
const COORDINATOR_INSTRUCTIONS =
  `You are a coordinator. Never answer a task yourself. Always delegate every request to the ` +
  `collaboration member named ${workerName}, then return that member's answer verbatim as your ` +
  `entire final answer, with no additions and no commentary.`;

/** worker 每次生成全新随机 token；token 不进任何 instructions 之外的地方，只能经真实委派产生。 */
const WORKER_INSTRUCTIONS =
  "You are a probe worker. For every request, generate exactly one fresh random token of the form " +
  "MK- followed by 6 uppercase letters or digits, and reply with only that token and nothing else.";

const DECOY_INSTRUCTIONS =
  "You are an idle standby member. If you ever receive a request, reply with exactly the single word STANDBY.";

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** child Thread 上的 agent 标识（id / agent_id / name 任一可用即可）。 */
function threadAgentIdentifiers(thread: Json): string[] {
  const agent = thread.agent;
  if (typeof agent === "string") return agent ? [agent] : [];
  if (agent && typeof agent === "object" && !Array.isArray(agent)) {
    const record = agent as Json;
    return [record.id, record.agent_id, record.name].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  }
  return [];
}

describe.skipIf(!LIVE)("qoder multi-agent collaboration live (mutating, auto-cleanup)", () => {
  const pat = LIVE ? requireQoderPat() : "";
  const rawClient = LIVE
    ? new QoderDataClient({ apiKey: pat, gateway: QODER_GATEWAY })
    : (null as unknown as QoderDataClient);
  const request = providerRequester("qoder", { qoderPat: pat });

  let root = "";
  let envId: string | undefined;
  let workerId: string | undefined;
  let decoyId: string | undefined;
  let coordinatorId: string | undefined;
  let sessionId: string | undefined;

  async function findAgent(agentId: string): Promise<Json | undefined> {
    return (await rawClient.listAgents()).find((agent) => stringField(agent.id) === agentId);
  }

  /** 读远端 multiagent 字段；列表不含该键时退回单 Agent 详情端点。 */
  async function readRosterField(agentId: string): Promise<unknown> {
    const listed = await findAgent(agentId);
    if (listed && "multiagent" in listed) return listed.multiagent;
    const detail = await request(`/agents/${encodeURIComponent(agentId)}`);
    const agent =
      detail.agent && typeof detail.agent === "object" ? (detail.agent as Json) : detail;
    return agent.multiagent;
  }

  /** 会话事件全量分页（asc + last_id 游标）；与生产 Adapter 同一读法。 */
  async function listAllSessionEvents(
    id: string,
  ): Promise<
    Array<{ raw_type: string; raw: Json; session_thread_id?: string; processed_at?: string }>
  > {
    const collected: Array<{
      raw_type: string;
      raw: Json;
      session_thread_id?: string;
      processed_at?: string;
    }> = [];
    let after: string | undefined;
    for (;;) {
      const page = await rawClient.listEvents(id, {
        limit: 100,
        order: "asc",
        ...(after ? { after_id: after } : {}),
      });
      collected.push(
        ...page.events.map((event) => ({
          raw_type: event.raw_type,
          raw: event.raw,
          ...(event.session_thread_id ? { session_thread_id: event.session_thread_id } : {}),
          ...(event.processed_at ? { processed_at: event.processed_at } : {}),
        })),
      );
      if (!page.has_more) return collected;
      const next = page.last_id;
      if (!next || next === after) throw new Error("qoder event cursor did not advance");
      after = next;
    }
  }

  /** 会话删除在远端仍处于 finalize 阶段时会返回 409；短暂退避重试。 */
  async function deleteSessionWithRetry(id: string): Promise<void> {
    const attempts = 5;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rawClient.deleteSession(id);
        return;
      } catch (error) {
        if (!(error instanceof QoderConflictError) || attempt >= attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }

  afterAll(async () => {
    const cleanup = createCleanupCollector("Qoder live resource cleanup failed");
    if (sessionId)
      await cleanup.attempt(async () => {
        const session = await rawClient.getSession(sessionId!);
        if (session.status === "running" || session.status === "rescheduling") {
          await request(`/sessions/${sessionId}/cancel`, { method: "POST" });
          const deadline = Date.now() + 90_000;
          for (;;) {
            const current = await rawClient.getSession(sessionId!);
            if (current.status === "idle" || current.status === "terminated") break;
            if (Date.now() > deadline) throw new Error("qoder session did not settle after cancel");
            await new Promise((resolve) => setTimeout(resolve, 2_000));
          }
        }
        await deleteSessionWithRetry(sessionId!);
      });
    if (sessionId) await new Promise((resolve) => setTimeout(resolve, 1_500));
    for (const id of [coordinatorId, workerId, decoyId]) {
      if (id) await cleanup.attempt(() => deleteQoderResource(pat, "agent", id));
    }
    if (envId) await cleanup.attempt(() => deleteQoderResource(pat, "environment", envId!));
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
    // §14.7：清理后验证——活动清单中不得残留本次资源。
    const activeAgents = jsonRows(await request("/agents?limit=100"));
    const activeEnvironments = jsonRows(await request("/environments?limit=100"));
    expect(
      activeAgents.some((a) => stringField(a.name)?.startsWith(`${prefix}-`)),
      "no test agents should remain",
    ).toBe(false);
    expect(
      activeEnvironments.some((e) => stringField(e.name)?.startsWith(`${prefix}-`)),
      "no test environments should remain",
    ).toBe(false);
    cleanup.flush();
  }, 300_000);

  it("proves real child-thread collaboration and converges roster 2->1->0", async () => {
    // 1. 共享环境（SDK 包根公共 Interface；与 EnvironmentControlPlane 的创建分支同形）。
    envId = await createTestEnvironment(
      "qoder",
      environmentName,
      { qoderPat: pat },
      {
        description: "CloudAgentBot multi-agent collaboration live contract environment",
        testLabel: "multi-agent-collaboration",
        testRun: prefix,
      },
    );

    root = await mkdtemp(join(tmpdir(), `${prefix}-`));
    const store = new ManagedBotStore(join(root, "managed-bots"));
    const plane = new BotControlPlane({
      store,
      lock: new ScopeLock(),
      resolveCredential: () => Promise.resolve({ provider: "qoder", credential: pat }),
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
      model: "auto",
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
      model: "auto",
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
    const workerUpdatedAt = workerSnapshotRaw.updated_at;
    const decoyUpdatedAt = decoySnapshotRaw.updated_at;

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
      model: "auto",
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
    // 成员不是本 scope 的资源：不存在任何以成员 id 为 remote_id 的 state 资源。
    expect(
      stateResources.filter(
        (resource) => resource.remote_id === workerId || resource.remote_id === decoyId,
      ),
    ).toHaveLength(0);
    // 远端读回快照证明服务端记录的 roster 就是这两个 external id。
    expect([...(stateAgents[0]?.remote_snapshot?.multiagent?.member_ids ?? [])].sort()).toEqual(
      [workerId, decoyId].sort(),
    );
    const projectYaml = await readFile(join(scopeDir, "agents.yaml"), "utf8");
    expect(projectYaml).toContain(workerId);
    expect(projectYaml).toContain(decoyId);
    expect(projectYaml).not.toContain(pat);

    // 5. 远端 roster 读回：{type: coordinator, agents: [worker, decoy]}。
    const rosterOnCreate = requireRoster(await readRosterField(coordinatorId));
    expect(rosterOnCreate.type).toBe("coordinator");
    expect(rosterOnCreate.ids).toEqual([workerId, decoyId].sort());

    // 6. 生产 ChatDataPlane 创建 Session，发送普通用户消息（不含 @name）。
    const chatPlane = new ChatDataPlane({
      chatAdapters: { qoder: createQoderChatAdapter },
      botCatalogs: { qoder: createQoderBotCatalog },
      resolveCredential: () => Promise.resolve({ provider: "qoder", credential: pat }),
      resolveManagedEnvironmentId: (connectionId, agentId) =>
        store.findManagedEnvironmentId(connectionId, agentId),
      resolveDefaultEnvironmentId: () => Promise.resolve(envId!),
    });
    const chat = await chatPlane.createChat(COORD_CONN, coordinatorId);
    sessionId = chat.ref.sessionId;
    expect(chat.ref.agentId).toBe(coordinatorId);

    // Qoder 新 session 初始 running（环境启动中）；轮询到 idle 再发送，避免冷启动竞态。
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
    // 子 Thread 空闲不代表主 Session 完成。等待远端委派证据，并检查 SSE 未误报完成。
    const sseViewCounts: Record<string, number> = {};
    const sseViewLog: string[] = [];
    const streamErrors: string[] = [];
    let tokenFrames = 0;
    let doneSeen = false;
    const unsubscribe = await chatPlane.subscribe(COORD_CONN, sessionId, (event: ChatEventView) => {
      sseViewCounts[event.type] = (sseViewCounts[event.type] ?? 0) + 1;
      if (sseViewLog.length < 60) sseViewLog.push(JSON.stringify(event).slice(0, 160));
      if (event.type === "token") tokenFrames += 1;
      else if (event.type === "done") doneSeen = true;
      else if (event.type === "error") streamErrors.push(event.error.code);
    });
    const send = await chatPlane.sendMessage(
      COORD_CONN,
      sessionId,
      "Run the delegation probe now. Request the member's freshly generated code and report that code in your final answer.",
    );
    expect(send.ok).toBe(true);
    const sseDeadline = Date.now() + 240_000;
    let sessionEvents = await listAllSessionEvents(sessionId);
    while (streamErrors.length === 0 && Date.now() < sseDeadline) {
      const types = new Set(sessionEvents.map((event) => event.raw_type));
      if (
        types.has("session.thread_created") &&
        types.has("agent.thread_message_sent") &&
        types.has("agent.thread_message_received")
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      sessionEvents = await listAllSessionEvents(sessionId);
    }
    unsubscribe();

    // 6b. 先取证再断言：原始事件直方图 + SSE 视图日志一次打印，任何失败都能直接定位。
    // coordinator 回合可以只有 thinking/tool_use 而无 assistant 文本帧，于是 token 帧为 0；
    // plan §11.6 只把 Thread 事件当作稳定判据，回合是否产出文本属于体验观察。
    // token 映射本身由 adapter 单测确定性覆盖（qoder-chat-adapter.test.ts：
    // assistant message → token，idle → done），不依赖真实模型行为。
    sessionEvents = await listAllSessionEvents(sessionId);
    const assistantMessageCount = sessionEvents.filter(
      (event) => event.raw_type === "agent.message",
    ).length;
    console.log(
      "[qoder multi-agent sse]",
      JSON.stringify(
        {
          prefix,
          sessionId,
          sseViewCounts,
          sseTokenFrames: tokenFrames,
          sseDoneSeen: doneSeen,
          sseStreamErrors: streamErrors,
          rawAgentMessageEvents: assistantMessageCount,
          rawEventTypeHistogram: histogram(sessionEvents.map((event) => event.raw_type)),
          sseViewLog,
        },
        null,
        2,
      ),
    );
    expect(streamErrors, "multi-agent SSE 不应出现 error 事件").toEqual([]);
    const remoteStatus = (await chatPlane.getChat(COORD_CONN, sessionId)).chat.remoteStatus;
    if (remoteStatus === "running") {
      expect(doneSeen, "主 Session 仍运行时，子 Thread 空闲不得误报 done").toBe(false);
    }

    // 7. Thread 证据（硬门）：真实 child Thread 创建 + 双向 thread message 事件。
    // plan §11.6 与 docs/research/multi-agent-mention-contract.md：最终文本、模型声称“已委派”
    // 或 marker 本身都不能替代 Thread 事件证据。
    // coordinator 主回合的 SSE done 可能早于 child 回复落地，因此对远端事件做有界等待。
    const observedRawTypes = new Set<string>();
    const firstSeenAt: Record<string, string> = {};
    const threadEvidenceDeadline = Date.now() + 180_000;
    for (;;) {
      for (const event of sessionEvents) {
        if (!observedRawTypes.has(event.raw_type)) {
          observedRawTypes.add(event.raw_type);
          firstSeenAt[event.raw_type] = event.processed_at ?? "unknown";
        }
      }
      if (
        observedRawTypes.has("session.thread_created") &&
        observedRawTypes.has("agent.thread_message_sent") &&
        observedRawTypes.has("agent.thread_message_received")
      ) {
        break;
      }
      if (Date.now() > threadEvidenceDeadline) break;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      sessionEvents = await listAllSessionEvents(sessionId);
    }
    const threadMessageEvents = sessionEvents.filter(
      (event) =>
        event.raw_type === "agent.thread_message_sent" ||
        event.raw_type === "agent.thread_message_received",
    );
    console.log(
      "[qoder multi-agent delegation]",
      JSON.stringify(
        {
          prefix,
          sessionId,
          eventTypeHistogram: histogram(sessionEvents.map((event) => event.raw_type)),
          firstSeenAt,
          threadMessageEvents: threadMessageEvents.map((event) => ({
            raw_type: event.raw_type,
            session_thread_id: event.session_thread_id,
            processed_at: event.processed_at,
          })),
          childThreadAgentIds: [
            ...new Set(
              sessionEvents
                .map((event) => event.session_thread_id)
                .filter((value): value is string => typeof value === "string"),
            ),
          ],
        },
        null,
        2,
      ),
    );
    expect(observedRawTypes.has("session.thread_created"), "child thread must be created").toBe(
      true,
    );
    expect(
      observedRawTypes.has("agent.thread_message_sent"),
      "coordinator must send a message into the child thread",
    ).toBe(true);
    expect(
      observedRawTypes.has("agent.thread_message_received"),
      "child thread must send a message back to the coordinator",
    ).toBe(true);

    // 8. Thread API 确认 child Thread 及其 Agent 是 roster 成员（硬门）。
    const threadRows = jsonRows(await request(`/sessions/${sessionId}/threads?limit=100`));
    const childThreads = threadRows.filter((thread) => stringField(thread.parent_thread_id));
    expect(childThreads.length, "at least one child thread must exist").toBeGreaterThan(0);
    const childAgentIds = childThreads.flatMap(threadAgentIdentifiers);
    const memberIdentifiers = [workerId, decoyId, workerName, decoyName];
    expect(
      childAgentIds.some((id) => memberIdentifiers.includes(id)),
      "child thread agent must be a roster member",
    ).toBe(true);
    const childWorkerMatched = childAgentIds.some((id) => id === workerId || id === workerName);

    // 打包应用真实 Renderer：远程 Bot、Session 快照与委派工作记录必须同时可见。
    if (process.env.OPENAGENTBOT_PACKAGED_UI === "1") {
      const run = promisify(execFile);
      const result = await run(
        process.execPath,
        [
          join(__dirname, "../../scripts/verify-collaboration-packaged.mjs"),
          "qoder",
          coordinatorName,
          sessionId,
          workerName,
        ],
        { timeout: 180_000 },
      );
      console.log(result.stdout.trim());
    }

    // 9. 辅助观察（不参与 pass/fail）：worker token 是否出现在最终文本 / thread 载荷中。
    // 过滤掉 instructions 里的字面占位符 MK-XXXXXX，避免把提示词回显当成真实生成。
    const freshTokens = (text: string) =>
      new Set((text.match(TOKEN_PATTERN) ?? []).filter((token) => token !== "MK-XXXXXX"));
    const detail = await chatPlane.getChat(COORD_CONN, sessionId);
    const finalText = detail.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.content)
      .join("\n");
    const finalTokens = freshTokens(finalText);
    const threadPayloads = threadMessageEvents.map((event) => JSON.stringify(event.raw));
    const threadTokens = freshTokens(threadPayloads.join("\n"));
    const tokenInThread = [...finalTokens].some((token) =>
      threadPayloads.some((payload) => payload.includes(token)),
    );

    // child Thread 自身事件（可选证据，仅记录）。
    let childEventNote = "child-thread events unavailable";
    const childThreadId = stringField(childThreads[0]?.id);
    if (childThreadId) {
      try {
        const childRows = jsonRows(
          await request(`/sessions/${sessionId}/threads/${childThreadId}/events?limit=100`),
        );
        if (childRows.length > 0) {
          const childJson = JSON.stringify(childRows);
          const tokenPresent = [...freshTokens(childJson)].some((token) =>
            childJson.includes(token),
          );
          childEventNote = `child events: ${childRows.length}${tokenPresent ? ", token present" : ""}`;
        }
      } catch (error) {
        childEventNote = `child-thread events error: ${error instanceof Error ? error.message : "unknown"}`;
      }
    }

    // 10. roster 2 -> 1：远程收敛且 coordinator ID 不变。
    const shrunk = await plane.update(
      { connectionId: COORD_CONN, agentId: coordinatorId },
      {
        name: coordinatorName,
        description: "multi-agent live contract coordinator",
        instructions: COORDINATOR_INSTRUCTIONS,
        model: "auto",
        memberAgentIds: [workerId],
      },
    );
    expect(shrunk.ref.agentId).toBe(coordinatorId);
    expect(requireRoster(await readRosterField(coordinatorId)).ids).toEqual([workerId]);
    const coordinatorsAfterShrink = (await rawClient.listAgents()).filter(
      (agent) => stringField(agent.name) === coordinatorName,
    );
    expect(coordinatorsAfterShrink).toHaveLength(1);
    expect(stringField(coordinatorsAfterShrink[0]?.id)).toBe(coordinatorId);

    // 11. 清空 roster：远端 multiagent 被清除，coordinator 仍是同一远程 Agent。
    const cleared = await plane.update(
      { connectionId: COORD_CONN, agentId: coordinatorId },
      {
        name: coordinatorName,
        description: "multi-agent live contract coordinator",
        instructions: COORDINATOR_INSTRUCTIONS,
        model: "auto",
        memberAgentIds: [],
      },
    );
    expect(cleared.ref.agentId).toBe(coordinatorId);
    expect(requireRoster(await readRosterField(coordinatorId)).ids).toEqual([]);

    // 12. 成员未被更新、归档或删除（配置身份字段逐字段一致；updated_at 单独记录）。
    const stateTextAfter = await readFile(join(scopeDir, "agents.state.json"), "utf8");
    expect(stateTextAfter).not.toContain(workerId);
    const workerFinal = await findAgent(workerId);
    const decoyFinal = await findAgent(decoyId);
    expect(workerFinal, "worker member must still exist").toBeDefined();
    expect(decoyFinal, "decoy member must still exist").toBeDefined();
    expect(memberConfigSnapshot(workerFinal!)).toEqual(workerSnapshot);
    expect(memberConfigSnapshot(decoyFinal!)).toEqual(decoySnapshot);

    console.log(
      "[qoder multi-agent evidence]",
      JSON.stringify(
        {
          prefix,
          coordinatorAgentId: coordinatorId,
          workerAgentId: workerId,
          decoyAgentId: decoyId,
          environmentId: envId,
          sessionId,
          sseTypes: Object.keys(sseViewCounts).sort(),
          sseTokenFrames: tokenFrames,
          sseStreamErrors: streamErrors,
          rawAgentMessageEvents: assistantMessageCount,
          eventTypeHistogram: histogram(sessionEvents.map((event) => event.raw_type)),
          sessionThreadIds: [
            ...new Set(
              sessionEvents
                .map((event) => event.session_thread_id)
                .filter((value): value is string => typeof value === "string"),
            ),
          ],
          threadRows: threadRows.length,
          childThreadCount: childThreads.length,
          childThreadAgentIds: childAgentIds,
          childThreadAgentMatchedWorker: childWorkerMatched,
          tokenInFinalText: [...finalTokens],
          tokenInThreadMessages: [...threadTokens],
          tokenOriginatesFromThreadMessage: tokenInThread,
          finalAnswerPreview: finalText.slice(0, 200),
          childThreadEventProbe: childEventNote,
          rosterOnCreate: rosterOnCreate.ids,
          rosterAfterShrink: [workerId],
          rosterAfterClear: [],
          memberConfigUnchanged: {
            worker: true,
            decoy: true,
            workerUpdatedAtUnchanged: workerFinal!.updated_at === workerUpdatedAt,
            decoyUpdatedAtUnchanged: decoyFinal!.updated_at === decoyUpdatedAt,
          },
        },
        null,
        2,
      ),
    );
  }, 1_800_000);
});
