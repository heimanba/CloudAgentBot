/**
 * Stage 05 真实 Cloud 写入 smoke（MUTATING，自动清理）。
 * 运行：OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/qoder-chat-write.live.test.ts
 *
 * 覆盖 validation.md Stage 05 用户流程：
 * - 经 ChatDataPlane.createChat 使用 Connection 默认 Environment 创建远程 Chat；
 * - sendMessage 发送文本，subscribe 消费 SSE 直至 done；
 * - SSE 收口后重读远程历史，断言助手回复已持久化；
 * - listChats 重新发现新 Chat；
 * - cleanup：删除 Session/Agent，环境被引用时退到 archive。
 *
 * 资源用唯一前缀 `openagentbot-v2s05-<stamp>-<suffix>` + metadata `openagentbot_test=v2-stage05`，
 * 完成后清理。凭据从当前仓库 .env 或环境变量读取，不出现在日志或断言消息中。
 *
 * Environment 由真实资源同步创建，再作为 Connection 默认环境传给 ChatDataPlane。
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalFileStateBackend,
  resolveProjectConfigFromObject,
  syncProjectResourcesWithStateBackend,
} from "@openagentpack/sdk";
import { QoderDataClient } from "../../src/main/data-plane/providers/qoder/qoder-client";
import { ChatDataPlane } from "../../src/main/data-plane/chat-data-plane";
import { createQoderChatAdapter } from "../../src/main/data-plane/providers/qoder/qoder-chat-adapter";
import { createQoderBotCatalog } from "../../src/main/data-plane/providers/qoder/qoder-bot-catalog";
import type { ChatEventView } from "../../src/shared/models";
import { requireQoderPat } from "./support/credentials";
import { QODER_GATEWAY } from "./support/endpoints";
import { uniqueTestPrefix } from "./support/naming";
import { deleteQoderResource } from "./support/rest";

const LIVE = process.env.OPENAGENTBOT_LIVE === "1";

// agent 逻辑名；远程 bot.name 与之相同。
const agentName = uniqueTestPrefix("v2s05");
const envName = `${agentName}-environment`;

function projectConfig(pat: string) {
  return {
    version: "1",
    providers: { qoder: { api_key: pat, gateway: QODER_GATEWAY } },
    defaults: { provider: "qoder" },
    environments: {
      [envName]: {
        description: "openagentbot v2 stage05 smoke environment",
        config: {
          type: "cloud",
          networking: { type: "unrestricted" },
          setup_script: "printf 'ready\\n' > /tmp/openagentbot-v2s05-ready",
        },
        metadata: { openagentbot_test: "v2-stage05" },
      },
    },
    agents: {
      [agentName]: {
        description: "openagentbot v2 stage05 smoke agent",
        model: "ultimate",
        instructions: "You are a temporary smoke agent. Reply with exactly the single word PONG.",
        environment: envName,
        tools: { builtin: ["read"] },
        metadata: { openagentbot_test: "v2-stage05" },
      },
    },
  };
}

describe.skipIf(!LIVE)("qoder chat write live (mutating, auto-cleanup)", () => {
  const pat = LIVE ? requireQoderPat() : "";
  const rawClient = LIVE
    ? new QoderDataClient({ apiKey: pat })
    : (null as unknown as QoderDataClient);

  let dir = "";
  let agentId: string | undefined;
  let envId: string | undefined;
  let sessionId: string | undefined;

  afterAll(async () => {
    if (sessionId) {
      await rawClient.deleteSession(sessionId).catch(() => {});
      // 等后端解除 session→environment 引用，避免环境删除 409（真实后端时序，live 例外）。
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (agentId) await deleteQoderResource(pat, "agent", agentId).catch(() => {});
    if (envId) await deleteQoderResource(pat, "environment", envId).catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("creates a chat via ChatDataPlane, sends, streams to idle, re-reads history, rediscovers", async () => {
    dir = await mkdtemp(join(tmpdir(), `${agentName}-`));
    const stateBackend = new LocalFileStateBackend({ configPath: join(dir, "agents.yaml") });
    const scope = { projectId: agentName };
    const loaded = await resolveProjectConfigFromObject(projectConfig(pat), {
      basePath: dir,
      projectName: agentName,
    });

    const run = await syncProjectResourcesWithStateBackend(
      { projectName: agentName, config: loaded.config, stateBackend, stateScope: scope },
      { policy: "force" },
    );
    expect((run.execution?.results ?? []).some((r) => r.status === "success")).toBe(true);

    const stateRaw = JSON.parse(await readFile(stateBackend.getStatePath(scope), "utf8")) as {
      resources?: Record<string, { address: { type: string }; remote_id?: string }>;
    };
    const resources = Object.values(stateRaw.resources ?? {});
    agentId = resources.find((r) => r.address.type === "agent")?.remote_id;
    envId = resources.find((r) => r.address.type === "environment")?.remote_id;
    expect(agentId).toBeDefined();
    expect(envId).toBeDefined();

    // 经真实 ChatDataPlane，使用 Connection 默认 Environment 创建 Chat。
    const plane = new ChatDataPlane({
      chatAdapters: { qoder: createQoderChatAdapter },
      botCatalogs: { qoder: createQoderBotCatalog },
      resolveCredential: () => Promise.resolve({ provider: "qoder", credential: pat }),
      resolveDefaultEnvironmentId: () => Promise.resolve(envId!),
    });
    const chat = await plane.createChat("conn_live", agentId!);
    sessionId = chat.ref.sessionId;
    expect(chat.keyScope).toBe("current");
    expect(chat.ref.connectionId).toBe("conn_live");
    expect(chat.ref.agentId).toBe(agentId);
    expect(
      (await plane.listChats("conn_live", agentId!)).find(
        (item) => item.ref.sessionId === sessionId,
      )?.keyScope,
    ).toBe("current");

    // Qoder 新建 session 初始为 running（环境启动中），409 表示尚未就绪；
    // 轮询直到 idle 再发送，避免冷启动竞态。
    {
      const deadline = Date.now() + 120_000;
      for (;;) {
        const detail = await plane.getChat("conn_live", sessionId);
        if (detail.chat.remoteStatus === "idle") break;
        if (Date.now() > deadline) throw new Error("session did not become idle within 120s");
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 2000);
        await promise;
      }
    }

    // 发送 + SSE 到 done。先开订阅再发送，避免错过早期事件。
    const seen: string[] = [];
    let streamedText = "";
    const doneGate = Promise.withResolvers<void>();
    // live 集成测试对真实 SSE 服务计时至多 600s（Qoder 环境冷启动 + agent 执行延迟 + SSE 连接建立 >180s）；
    // 无法虚拟化平台时钟（例外）。
    const timeout = setTimeout(
      () => doneGate.reject(new Error("SSE did not reach done within 600s")),
      600_000,
    );
    // idle 子保护：若 adapter bug 导致流永久静默（不 done 不 error 不结束），
    // 600s gate 才失败会掩盖真实 hang 并拖慢 CI。最近一次事件以来 120s 无任何帧即判定 hang。
    // 120s 上限的根据：Qoder agent 执行单步典型 <60s；环境冷启动已在外层 idle 轮询排除。
    let idleTimer: NodeJS.Timeout | undefined;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => doneGate.reject(new Error("SSE idle for 120s without any event (suspected hang)")),
        120_000,
      );
    };
    resetIdleTimer();
    // plane.subscribe resolve 即订阅已建立（凭据解析 + adapter 就绪），无需猜时等待。
    const unsubscribe = await plane.subscribe("conn_live", sessionId!, (event: ChatEventView) => {
      resetIdleTimer();
      if (event.type === "token") {
        streamedText += event.text ?? "";
        seen.push("token");
      } else if (event.type === "done") {
        seen.push("done");
        clearTimeout(idleTimer);
        clearTimeout(timeout);
        doneGate.resolve();
      } else if (event.type === "error") {
        seen.push("error");
        clearTimeout(idleTimer);
        clearTimeout(timeout);
        doneGate.reject(new Error(`stream error: ${event.error.code}`));
      }
    });
    const send = await plane.sendMessage(
      "conn_live",
      sessionId,
      "Reply with exactly the single word PONG.",
    );
    expect(send.ok).toBe(true);
    await doneGate.promise;
    unsubscribe();
    expect(seen).toContain("done");
    // SSE 临时增量已收到非空内容（最终内容仍以重读历史为准）。
    expect(streamedText.length).toBeGreaterThan(0);

    // SSE 收口后重读远程历史，断言助手回复持久化（最终内容以历史为准）。
    const detail = await plane.getChat("conn_live", sessionId);
    const finalText = detail.messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .join("");
    expect(finalText).toContain("PONG");

    // listChats 重新发现。
    const chats = await plane.listChats("conn_live", agentId!);
    expect(chats.some((c) => c.ref.sessionId === sessionId)).toBe(true);
  }, 900_000);
});
