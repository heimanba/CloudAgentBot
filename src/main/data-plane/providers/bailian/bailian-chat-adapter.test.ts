import { describe, expect, it } from "vitest";
import { BailianApiError, parseBailianSse } from "./bailian-client";
import { classifyBailianStatus, toBailianHostError } from "./bailian-errors";
import {
  createBailianChatAdapter,
  toBailianChatView,
  toBailianTimelineItem,
} from "./bailian-chat-adapter";
import { createBailianBotCatalog } from "./bailian-bot-catalog";

describe("Bailian wire mapping", () => {
  it("reads Session snapshot and maps thread events from nested data and metadata", () => {
    expect(toBailianChatView({ id: "s", agent: { id: "a", multiagent: { type: "coordinator", agents: [{ id: "worker" }] } } }).collaboration?.memberAgentIds).toEqual(["worker"]);
    expect(toBailianTimelineItem({ id: "c", type: "thread_created", content: [{ type: "data", data: { agent_name: "Worker", session_thread_id: "child" } }] })).toMatchObject({ kind: "delegation", action: "created", agentName: "Worker", threadId: "child" });
    expect(toBailianTimelineItem({ id: "s", type: "thread_message_sent", metadata: { to_agent_name: "Worker", to_session_thread_id: "child" } })).toMatchObject({ kind: "delegation", action: "sent", agentName: "Worker", threadId: "child" });
  });
  it("maps sessions without leaking wire fields", () => {
    expect(
      toBailianChatView({
        id: "sesn_1",
        agent: { id: "agt_1" },
        title: "Demo",
        status: "idle",
        updated_at: "2026-09-18T00:00:00Z",
      }),
    ).toEqual({
      ref: { connectionId: "", agentId: "agt_1", sessionId: "sesn_1" },
      title: "Demo",
      remoteStatus: "idle",
      updatedAt: "2026-09-18T00:00:00Z",
    });
  });

  it("maps CloudAgentBot Key scope and exact sharing state from Session metadata", () => {
    expect(toBailianChatView({
      id: "sesn_1",
      agent: { id: "agt_1" },
      metadata: {
        openagentbot_key_scope: "oab-key-v1-test",
        openagentbot_shared: "true",
      },
    })).toMatchObject({ keyScopeMarker: "oab-key-v1-test", shared: true });
    expect(toBailianChatView({
      id: "sesn_2",
      agent: { id: "agt_1" },
      metadata: { openagentbot_shared: true },
    }).shared).toBeUndefined();
  });

  it("maps messages, status, tool output, error and unknown events", () => {
    expect(
      toBailianTimelineItem({
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
      }),
    ).toMatchObject({ kind: "message", role: "assistant", content: "hello" });
    expect(
      toBailianTimelineItem({
        id: "status_1",
        type: "session_status",
        content: [
          { type: "data", data: { session_status: "idle", stop_reason: { type: "end_turn" } } },
        ],
      }),
    ).toMatchObject({ kind: "status", status: "idle", stopReason: "end_turn" });
    expect(
      toBailianTimelineItem({
        id: "out_1",
        type: "tool_call_output",
        is_error: true,
        content: [{ type: "data", data: { call_id: "call_1", output: "failed" } }],
      }),
    ).toMatchObject({ kind: "tool-result", toolUseId: "call_1", content: "failed", isError: true });
    expect(
      toBailianTimelineItem({ id: "err_1", type: "error", error: { message: "boom" } }),
    ).toMatchObject({
      kind: "error",
      message: "boom",
    });
    expect(toBailianTimelineItem({ id: "future_1", type: "future_event" })).toMatchObject({
      kind: "unknown",
    });
  });

  it("parses file/image/video content blocks into message attachments", () => {
    expect(
      toBailianTimelineItem({
        id: "msg_att",
        type: "message",
        role: "user",
        content: [
          { type: "image", file_id: "file-img" },
          { type: "video", file_id: "file-vid" },
          { type: "file", file_id: "file-doc", filename: "report.pdf" },
          { type: "text", text: "看看这些" },
        ],
      }),
    ).toMatchObject({
      kind: "message",
      role: "user",
      content: "看看这些",
      attachments: [
        { fileId: "file-img", kind: "image" },
        { fileId: "file-vid", kind: "video" },
        { fileId: "file-doc", kind: "file", filename: "report.pdf" },
      ],
    });
  });

  it("omits attachments when the message has only text", () => {
    expect(
      toBailianTimelineItem({
        id: "msg_txt",
        type: "message",
        role: "user",
        content: [{ type: "text", text: "纯文本" }],
      }),
    ).not.toHaveProperty("attachments");
  });
});

describe("Bailian transport", () => {
  it("hydrates Session scope from detail when the list response omits metadata", async () => {
    const requests: string[] = [];
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      const body = url.includes("/sessions?")
        ? { data: [{ id: "sesn_1", agent: { id: "agt_1" }, status: "idle" }] }
        : { id: "sesn_1", agent: { id: "agt_1" }, metadata: { openagentbot_key_scope: "scope-one" } };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    };
    const adapter = createBailianChatAdapter(
      { provider: "bailian", credential: "secret", workspaceId: "workspace" },
      { fetchImpl: fetchImpl as typeof fetch },
    );

    const chats = await adapter.listChats("agt_1");

    expect(chats[0]?.keyScopeMarker).toBe("scope-one");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain("/sessions/sesn_1");
  });

  it("maps current coordinator roster from a single Agent list call", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: "chief", name: "Chief", multiagent: { type: "coordinator", agents: [{ id: "worker" }] } }] }), { headers: { "Content-Type": "application/json" } });
    try {
      const bots = await createBailianBotCatalog({ provider: "bailian", credential: "key", workspaceId: "ws" }).listBots();
      expect(bots[0]?.collaboration?.memberAgentIds).toEqual(["worker"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("reads the exact sharing metadata value from the complete Agent catalog", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [
      { id: "shared", name: "Shared", metadata: { openagentbot_shared: "true", openagentbot_key_scope: "scope-one" } },
      { id: "ordinary", name: "Ordinary", metadata: { openagentbot_shared: true } },
    ] }), { headers: { "Content-Type": "application/json" } });
    try {
      const bots = await createBailianBotCatalog({ provider: "bailian", credential: "key", workspaceId: "ws" }).listBots();
      expect(bots.map((bot) => Boolean(bot.shared))).toEqual([true, false]);
      expect(bots[0]?.keyScopeMarker).toBe("scope-one");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("parses comments, keepalive and JSON data frames", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              ': connected\n\nevent: message\ndata: {"type":"event_delta","event_id":"msg_1"}\n\n:keepalive\n\n',
            ),
          );
          controller.close();
        },
      }),
    );
    const frames = [];
    for await (const frame of parseBailianSse(response)) frames.push(frame);
    expect(frames).toEqual([{ type: "event_delta", event_id: "msg_1" }]);
  });

  it("normalizes HTTP errors without exposing response bodies", () => {
    expect(classifyBailianStatus(401)).toBe("authentication");
    expect(classifyBailianStatus(404)).toBe("not-found");
    expect(classifyBailianStatus(429)).toBe("rate-limited");
    expect(
      toBailianHostError(new BailianApiError(401, "secret response"), "bailian request"),
    ).toEqual({
      code: "authentication",
      message: "bailian request rejected with status 401",
    });
  });

  it("archiveChat posts to the archive endpoint", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
    };
    const adapter = createBailianChatAdapter(
      { provider: "bailian", credential: "secret", workspaceId: "workspace" },
      { fetchImpl: fetchImpl as typeof fetch },
    );
    await adapter.archiveChat("sesn_1");
    expect(requests).toEqual([
      {
        method: "POST",
        url: "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_1/archive",
        body: "{}",
      },
    ]);
  });

  it("createChat persists the app Key scope alongside supplied test metadata", async () => {
    let body: Record<string, unknown> | undefined;
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "sesn_scoped",
        agent: { id: "agt_1" },
        metadata: { openagentbot_key_scope: "oab-key-v1-scope", openagentbot_test: "yes" },
      }), { headers: { "Content-Type": "application/json" } });
    };
    const adapter = createBailianChatAdapter(
      { provider: "bailian", credential: "secret", workspaceId: "workspace" },
      { fetchImpl: fetchImpl as typeof fetch, sessionMetadata: { openagentbot_test: "yes" } },
    );
    const session = await adapter.createChat("agt_1", "env_1", undefined, {
      openagentbot_key_scope: "oab-key-v1-scope",
    });
    expect(body?.metadata).toEqual({
      openagentbot_test: "yes",
      openagentbot_key_scope: "oab-key-v1-scope",
    });
    expect(session.keyScopeMarker).toBe("oab-key-v1-scope");
  });

  it("updates Session sharing without dropping existing metadata", async () => {
    const requests: Array<{ method: string; body?: Record<string, unknown> }> = [];
    let reads = 0;
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({
        method,
        ...(init?.body ? { body: JSON.parse(init.body as string) as Record<string, unknown> } : {}),
      });
      if (method === "POST") {
        return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
      }
      reads += 1;
      return new Response(JSON.stringify({
        id: "sesn_1",
        agent: { id: "agt_1" },
        metadata: {
          openagentbot_key_scope: "scope-owner",
          custom: "keep-me",
          ...(reads > 1 ? { openagentbot_shared: "true" } : {}),
        },
      }), { headers: { "Content-Type": "application/json" } });
    };
    const adapter = createBailianChatAdapter(
      { provider: "bailian", credential: "secret", workspaceId: "workspace" },
      { fetchImpl: fetchImpl as typeof fetch },
    );

    const chat = await adapter.setChatShared!("sesn_1", true, "scope-owner");

    expect(requests).toEqual([
      { method: "GET" },
      {
        method: "POST",
        body: {
          metadata: {
            openagentbot_key_scope: "scope-owner",
            custom: "keep-me",
            openagentbot_shared: "true",
          },
        },
      },
      { method: "GET" },
    ]);
    expect(chat.shared).toBe(true);
  });

  it("deleteChat deletes the session", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? "GET" });
      return new Response(null, { status: 204 });
    };
    const adapter = createBailianChatAdapter(
      { provider: "bailian", credential: "secret", workspaceId: "workspace" },
      { fetchImpl: fetchImpl as typeof fetch },
    );
    await adapter.deleteChat("sesn_1");
    expect(requests).toEqual([
      {
        method: "DELETE",
        url: "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_1",
      },
    ]);
  });

  it("archiveChat and deleteChat map errors without leaking body", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: "secret" }), { status: 404 });
    const adapter = createBailianChatAdapter(
      { provider: "bailian", credential: "secret", workspaceId: "workspace" },
      { fetchImpl: fetchImpl as typeof fetch },
    );
    await expect(adapter.archiveChat("sesn_1")).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(adapter.deleteChat("sesn_1")).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("reconciles history after SSE disconnect without repeating the send", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    let historyRequests = 0;
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? "GET" });
      if (url.includes("/events/stream")) {
        return new Response(new ReadableStream({ start: (controller) => controller.close() }));
      }
      historyRequests += 1;
      return new Response(
        JSON.stringify({
          data:
            historyRequests === 1
              ? [
                  {
                    id: "old_msg",
                    type: "message",
                    role: "assistant",
                    content: [{ type: "text", text: "old answer" }],
                  },
                  {
                    id: "old_status",
                    type: "session_status",
                    content: [
                      {
                        type: "data",
                        data: { session_status: "idle", stop_reason: { type: "end_turn" } },
                      },
                    ],
                  },
                ]
              : [
                  {
                    id: "old_msg",
                    type: "message",
                    role: "assistant",
                    content: [{ type: "text", text: "old answer" }],
                  },
                  {
                    id: "old_status",
                    type: "session_status",
                    content: [
                      {
                        type: "data",
                        data: { session_status: "idle", stop_reason: { type: "end_turn" } },
                      },
                    ],
                  },
                  {
                    id: "msg_1",
                    type: "message",
                    role: "assistant",
                    content: [{ type: "text", text: "recovered" }],
                  },
                  {
                    id: "status_1",
                    type: "session_status",
                    content: [
                      {
                        type: "data",
                        data: { session_status: "idle", stop_reason: { type: "end_turn" } },
                      },
                    ],
                  },
                ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    };
    const adapter = createBailianChatAdapter(
      { provider: "bailian", credential: "secret", workspaceId: "workspace" },
      { fetchImpl: fetchImpl as typeof fetch, reconciliationAttempts: 1, reconciliationDelayMs: 0 },
    );
    const events: Parameters<Parameters<typeof adapter.subscribe>[1]>[0][] = [];
    const unsubscribe = await adapter.subscribe("sesn_1", (event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 50));
    unsubscribe();

    expect(requests.map((request) => request.url)).toEqual([
      expect.stringContaining("/events/stream"),
      expect.stringContaining("/events?"),
      expect.stringContaining("/events?"),
    ]);
    expect(events).toContainEqual({ type: "token", text: "recovered", eventId: "msg_1" });
    expect(events).not.toContainEqual({ type: "token", text: "old answer", eventId: "old_msg" });
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  it("binds ordered deltas to event_start identity and suppresses the completed duplicate", async () => {
    const frames = [
      { type: "event_start", event: { id: "msg_1", type: "message" } },
      {
        type: "event_delta",
        event_id: "msg_1",
        delta: { type: "content_delta", index: 0, content: { type: "text", text: "快" } },
      },
      {
        type: "event_delta",
        event_id: "msg_1",
        delta: { type: "content_delta", index: 0, content: { type: "text", text: "速" } },
      },
      {
        id: "msg_1",
        object: "message",
        status: "completed",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "快速" }],
      },
      {
        id: "status_1",
        type: "session_status",
        content: [
          {
            type: "data",
            data: { session_status: "idle", stop_reason: { type: "end_turn" } },
          },
        ],
      },
    ];
    const sse = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
    const fetchImpl = async (input: string | URL | Request) =>
      String(input).includes("/events/stream")
        ? new Response(sse, { headers: { "Content-Type": "text/event-stream" } })
        : new Response(JSON.stringify({ data: [] }), {
            headers: { "Content-Type": "application/json" },
          });
    const adapter = createBailianChatAdapter(
      { provider: "bailian", credential: "secret", workspaceId: "workspace" },
      { fetchImpl: fetchImpl as typeof fetch },
    );
    const events: Parameters<Parameters<typeof adapter.subscribe>[1]>[0][] = [];
    await adapter.subscribe("sesn_1", (event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(events.filter((event) => event.type === "token")).toEqual([
      { type: "token", text: "快", eventId: "msg_1" },
      { type: "token", text: "速", eventId: "msg_1" },
    ]);
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});
