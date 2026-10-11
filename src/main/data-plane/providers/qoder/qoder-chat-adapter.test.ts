import { describe, expect, it, vi, afterEach } from "vitest";
import { createQoderBotCatalog, toBotCatalogView } from "./qoder-bot-catalog";
import {
  createQoderChatAdapter,
  toChatEventView,
  toChatView,
  toMessageViews,
  toTimelineItems,
} from "./qoder-chat-adapter";
import { classifyQoderStatus, toQoderHostError } from "./qoder-errors";
import { QoderApiError } from "./qoder-http";
import { isHostError } from "@shared/errors";

/**
 * Stage 04 数据面测试。保护的风险：
 * - wire agent/session/event → view model 的映射漂移（Bot/Chat 列表与历史显示错误）；
 * - Provider 错误分类漂移（用户看到错误的操作引导）；
 * - 错误消息携带 Provider 响应正文或凭据（凭据泄露）。
 */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body
        ? typeof init.body === "string"
          ? JSON.parse(init.body)
          : init.body
        : undefined,
    });
    return handler(url, init);
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toBotCatalogView", () => {
  it("maps a remote agent with managed metadata to managed", () => {
    const view = toBotCatalogView({
      id: "agent_1",
      name: "My Bot",
      description: "desc",
      model: "qoder-v1",
      metadata: { "agents.project": "proj", "agents.resource": "bot" },
    });
    expect(view).toEqual({
      agentId: "agent_1",
      name: "My Bot",
      description: "desc",
      model: "qoder-v1",
      remoteStatus: undefined,
      managed: true,
    });
  });

  it("only maps the exact shared metadata string", () => {
    const session = {
      id: "sess_1",
      agent_id: "agent_1",
      environment_id: "env_1",
      status: "idle",
      created_at: "",
      updated_at: "",
    };
    expect(
      toChatView({ ...session, attributes: { metadata: { openagentbot_shared: "true" } } }).shared,
    ).toBe(true);
    expect(
      toChatView({ ...session, attributes: { metadata: { openagentbot_shared: true } } }).shared,
    ).toBeUndefined();
    expect(
      toChatView({ ...session, attributes: { metadata: { openagentbot_shared: "false" } } }).shared,
    ).toBeUndefined();
  });

  it("maps a remote agent without managed metadata to remote-only", () => {
    const view = toBotCatalogView({ id: "agent_2", name: "Other" });
    expect(view.managed).toBe(false);
    expect(view.description).toBeUndefined();
    expect(view.model).toBeUndefined();
  });

  it("reads the Provider's current coordinator roster from the Agent list", () => {
    const view = toBotCatalogView({
      id: "chief",
      name: "Chief",
      multiagent: { type: "coordinator", agents: [{ id: "worker" }] },
    });
    expect(view.collaboration?.memberAgentIds).toEqual(["worker"]);
  });
});

describe("toMessageViews", () => {
  it("keeps only user/assistant message events with content", () => {
    const messages = toMessageViews([
      { type: "message", raw_type: "user.message", role: "user", content: "hi", raw: {} },
      { type: "thinking", raw_type: "agent.thinking", raw: {} },
      { type: "message", raw_type: "agent.message", role: "assistant", content: "PONG", raw: {} },
      { type: "status", raw_type: "session.status_idle", status: "idle", raw: {} },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "hi" });
    expect(messages[1]).toMatchObject({ role: "assistant", content: "PONG" });
  });
});

describe("toTimelineItems", () => {
  it("maps provider child-thread evidence without treating thread idle as session completion", () => {
    const items = toTimelineItems([
      {
        type: "unknown",
        raw_type: "session.thread_created",
        id: "c",
        session_thread_id: "child",
        raw: { agent_name: "Worker" },
      },
      {
        type: "unknown",
        raw_type: "agent.thread_message_sent",
        id: "s",
        raw: { to_agent_name: "Worker", to_session_thread_id: "child" },
      },
      {
        type: "unknown",
        raw_type: "agent.thread_message_received",
        id: "r",
        raw: { from_agent_name: "Worker", from_session_thread_id: "child" },
      },
    ]);
    expect(items.map((item) => item.kind)).toEqual(["delegation", "delegation", "delegation"]);
    expect(items.map((item) => item.threadId)).toEqual(["child", "child", "child"]);
    expect(items.map((item) => (item.kind === "delegation" ? item.action : ""))).toEqual([
      "created",
      "sent",
      "received",
    ]);
    expect(
      toChatEventView({
        type: "status",
        raw_type: "session.thread_status_idle",
        status: "idle",
        raw: {},
      })?.type,
    ).toBe("timeline");
    expect(
      toChatEventView({ type: "status", raw_type: "session.status_idle", status: "idle", raw: {} }),
    ).toEqual({ type: "done" });
  });

  it("reads the Session's Agent roster snapshot separately from current Bot configuration", () => {
    const chat = toChatView({
      id: "s",
      agent_id: "a",
      environment_id: "e",
      status: "idle",
      created_at: "",
      updated_at: "",
      attributes: { agent: { multiagent: { type: "coordinator", agents: [{ id: "worker" }] } } },
    });
    expect(chat.collaboration?.memberAgentIds).toEqual(["worker"]);
  });
  it("保留工具、产物、状态、用量和 processed_at", () => {
    const items = toTimelineItems([
      {
        type: "tool_use",
        raw_type: "agent.tool_use",
        id: "e1",
        processed_at: "2026-09-17T01:00:00Z",
        name: "Bash",
        input: { command: "ls" },
        raw: {},
      },
      {
        type: "tool_result",
        raw_type: "agent.tool_result",
        id: "e2",
        tool_use_id: "e1",
        content: "ok",
        is_error: false,
        raw: {},
      },
      {
        type: "artifact",
        raw_type: "agent.artifact_delivered",
        id: "e3",
        file_id: "f1",
        filename: "report.html",
        size: 1024,
        raw: {},
      },
      {
        type: "usage",
        raw_type: "span.model_request_end",
        id: "e4",
        credits: 0.42,
        is_error: false,
        raw: {},
      },
      {
        type: "status",
        raw_type: "session.status_idle",
        id: "e5",
        status: "idle",
        stop_reason: "end_turn",
        raw: {},
      },
    ]);
    expect(items.map((item) => item.kind)).toEqual([
      "tool-call",
      "tool-result",
      "artifact",
      "usage",
      "status",
    ]);
    expect(items[0]).toMatchObject({ occurredAt: "2026-09-17T01:00:00Z", name: "Bash" });
    expect(items[2]).toMatchObject({ filename: "report.html", fileId: "f1" });
  });
});

describe("classifyQoderStatus / toQoderHostError", () => {
  it("maps 401/403/404/429/5xx to stable codes", () => {
    expect(classifyQoderStatus(401)).toBe("authentication");
    expect(classifyQoderStatus(403)).toBe("permission");
    expect(classifyQoderStatus(404)).toBe("not-found");
    expect(classifyQoderStatus(429)).toBe("rate-limited");
    expect(classifyQoderStatus(500)).toBe("unavailable");
    expect(classifyQoderStatus(400)).toBe("invalid-input");
  });

  it("ApiError maps without leaking response body or credential", () => {
    const err = toQoderHostError(
      new QoderApiError(401, "token invalid", "Qoder API"),
      "qoder list agents",
    );
    expect(isHostError(err)).toBe(true);
    if (isHostError(err)) {
      expect(err.code).toBe("authentication");
      expect(err.message).toContain("status 401");
      expect(err.message).not.toContain("token invalid");
    }
  });
});

describe("QoderBotCatalog", () => {
  it("listBots maps wire agents to catalog views", async () => {
    mockFetch(() =>
      json(200, {
        data: [
          {
            id: "a1",
            name: "Bot One",
            metadata: { "agents.project": "p", "agents.resource": "r" },
          },
          { id: "a2", name: "Bot Two" },
        ],
      }),
    );
    const catalog = createQoderBotCatalog("k");
    const bots = await catalog.listBots();
    expect(bots).toHaveLength(2);
    expect(bots[0]).toMatchObject({ agentId: "a1", name: "Bot One", managed: true });
    expect(bots[1]).toMatchObject({ agentId: "a2", managed: false });
  });
});

describe("QoderChatAdapter", () => {
  it("listChats pages through sessions for the agent", async () => {
    const calls = mockFetch((url) => {
      if (url.includes("page=p2")) {
        return json(200, {
          data: [
            {
              id: "s2",
              agent_id: "a1",
              environment_id: "e1",
              status: "idle",
              created_at: "t",
              updated_at: "t",
            },
          ],
          has_more: false,
        });
      }
      return json(200, {
        data: [
          {
            id: "s1",
            agent_id: "a1",
            environment_id: "e1",
            status: "idle",
            created_at: "t",
            updated_at: "t",
            metadata: { openagentbot_shared: "true" },
          },
        ],
        has_more: true,
        next_page: "p2",
      });
    });
    const adapter = createQoderChatAdapter("k");
    const chats = await adapter.listChats("a1");
    expect(calls).toHaveLength(2);
    expect(chats.map((c) => c.ref.sessionId)).toEqual(["s1", "s2"]);
    expect(chats[0]).toMatchObject({ ref: { agentId: "a1" }, shared: true });
  });

  it("getChat returns session plus message history", async () => {
    mockFetch((url) => {
      if (url.endsWith("/sessions/s1/events") || url.includes("/events?")) {
        return json(200, {
          data: [
            { id: "e1", type: "user.message", content: [{ type: "text", text: "ping" }] },
            { id: "e2", type: "agent.message", content: [{ type: "text", text: "pong" }] },
          ],
          has_more: false,
        });
      }
      if (url.includes("/resources?")) return json(200, { data: [], has_more: false });
      return json(200, {
        id: "s1",
        agent_id: "a1",
        environment_id: "e1",
        status: "idle",
        title: "Chat One",
        created_at: "t",
        updated_at: "t",
      });
    });
    const adapter = createQoderChatAdapter("k");
    const detail = await adapter.getChat("s1");
    expect(detail.chat.title).toBe("Chat One");
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[1]?.content).toBe("pong");
    expect(detail.events).toHaveLength(2);
  });

  it("getChat attaches session files to the following user message", async () => {
    mockFetch((url) => {
      if (url.includes("/events?")) {
        return json(200, {
          data: [
            {
              id: "e1",
              type: "user.message",
              processed_at: "2026-09-29T01:51:01Z",
              content: [{ type: "text", text: "这是什么文件" }],
            },
          ],
          has_more: false,
        });
      }
      if (url.includes("/resources?")) {
        return json(200, {
          data: [
            {
              id: "sesr-1",
              type: "file",
              file_id: "file-1",
              created_at: "2026-09-29T01:51:00Z",
            },
          ],
          has_more: false,
        });
      }
      if (url.endsWith("/files/file-1")) {
        return json(200, {
          id: "file-1",
          filename: "stylelint.config.mjs",
          size_bytes: 128,
          mime_type: "text/javascript",
        });
      }
      return json(200, {
        id: "s1",
        agent_id: "a1",
        environment_id: "e1",
        status: "idle",
        created_at: "t",
        updated_at: "t",
      });
    });

    const detail = await createQoderChatAdapter("k").getChat("s1");

    expect(detail.messages[0]?.attachments).toEqual([
      { fileId: "file-1", kind: "file", filename: "stylelint.config.mjs" },
    ]);
    expect(detail.events.find((item) => item.kind === "message")).toMatchObject({
      attachments: [{ fileId: "file-1", filename: "stylelint.config.mjs" }],
    });
  });

  it("restores mounted files to the exact same-content messages and hides path prefixes", async () => {
    mockFetch((url) => {
      if (url.includes("/events?")) {
        return json(200, {
          data: [
            {
              id: "e1",
              type: "user.message",
              content: [
                {
                  type: "text",
                  text: "[/mnt/session/uploads/first--a1.md] review it",
                },
              ],
            },
            {
              id: "e2",
              type: "user.message",
              content: [
                {
                  type: "text",
                  text: "[/mnt/session/uploads/second--b2.md] review it",
                },
              ],
            },
          ],
          has_more: false,
        });
      }
      if (url.includes("/resources?")) {
        return json(200, {
          data: [
            {
              id: "sesr-1",
              type: "file",
              file_id: "file-1",
              mount_path: "/mnt/session/uploads/first--a1.md",
            },
            {
              id: "sesr-2",
              type: "file",
              file_id: "file-2",
              mount_path: "/mnt/session/uploads/second--b2.md",
            },
          ],
          has_more: false,
        });
      }
      if (url.endsWith("/files/file-1")) {
        return json(200, { id: "file-1", filename: "first.md", mime_type: "text/markdown" });
      }
      if (url.endsWith("/files/file-2")) {
        return json(200, { id: "file-2", filename: "second.md", mime_type: "text/markdown" });
      }
      return json(200, {
        id: "s1",
        agent_id: "a1",
        environment_id: "e1",
        status: "idle",
        created_at: "t",
        updated_at: "t",
      });
    });

    const detail = await createQoderChatAdapter("k").getChat("s1");

    expect(detail.messages).toMatchObject([
      {
        id: "e1",
        content: "review it",
        attachments: [{ fileId: "file-1", filename: "first.md" }],
      },
      {
        id: "e2",
        content: "review it",
        attachments: [{ fileId: "file-2", filename: "second.md" }],
      },
    ]);
    expect(detail.events.filter((item) => item.kind === "message")).toMatchObject([
      { id: "e1", content: "review it", attachments: [{ fileId: "file-1" }] },
      { id: "e2", content: "review it", attachments: [{ fileId: "file-2" }] },
    ]);
  });

  it("restores a mounted file from its path when resource listing fails", async () => {
    mockFetch((url) => {
      if (url.includes("/events?")) {
        return json(200, {
          data: [
            {
              id: "e1",
              type: "user.message",
              content: [
                {
                  type: "text",
                  text: "[/mnt/session/uploads/file-1/spec.md] inspect",
                },
              ],
            },
          ],
          has_more: false,
        });
      }
      if (url.includes("/resources?")) return json(500, { error: "unavailable" });
      if (url.endsWith("/files/file-1")) return json(404, { error: "not found" });
      return json(200, {
        id: "s1",
        agent_id: "a1",
        environment_id: "e1",
        status: "idle",
        created_at: "t",
        updated_at: "t",
      });
    });

    const detail = await createQoderChatAdapter("k").getChat("s1");

    expect(detail.messages[0]).toMatchObject({
      content: "inspect",
      attachments: [{ fileId: "file-1", filename: "spec.md" }],
    });
  });

  it("getChat keeps a Session resource visible when file metadata is unavailable", async () => {
    mockFetch((url) => {
      if (url.includes("/events?")) {
        return json(200, {
          data: [
            { id: "e1", type: "user.message", content: [{ type: "text", text: "review it" }] },
          ],
          has_more: false,
        });
      }
      if (url.includes("/resources?")) {
        return json(200, {
          data: [{ id: "sesr-1", type: "file", file_id: "file-1" }],
          has_more: false,
        });
      }
      if (url.endsWith("/files/file-1")) return json(404, { error: "not found" });
      return json(200, {
        id: "s1",
        agent_id: "a1",
        environment_id: "e1",
        status: "idle",
        created_at: "t",
        updated_at: "t",
      });
    });

    const detail = await createQoderChatAdapter("k").getChat("s1");

    expect(detail.messages[0]?.attachments).toEqual([{ fileId: "file-1", kind: "file" }]);
  });

  it("getChat restores Session files when user events omit processed_at", async () => {
    const calls = mockFetch((url) => {
      if (url.includes("/events?")) {
        return json(200, {
          data: [
            { id: "e1", type: "user.message", content: [{ type: "text", text: "review it" }] },
          ],
          has_more: false,
        });
      }
      if (url.endsWith("/files/file-1")) {
        return json(200, {
          id: "file-1",
          filename: "stylelint.config.mjs",
          mime_type: "text/javascript",
        });
      }
      if (url.includes("/resources?")) return json(200, { data: [], has_more: false });
      return json(200, {
        id: "s1",
        agent_id: "a1",
        environment_id: "e1",
        status: "idle",
        created_at: "t",
        updated_at: "t",
        resources: [
          {
            id: "sesr-1",
            type: "file",
            file_id: "file-1",
            created_at: "2026-09-29T01:51:00Z",
          },
        ],
      });
    });

    const detail = await createQoderChatAdapter("k").getChat("s1");

    expect(detail.messages[0]?.attachments).toEqual([
      { fileId: "file-1", kind: "file", filename: "stylelint.config.mjs" },
    ]);
    expect(calls.some((call) => call.url.includes("/resources?"))).toBe(true);
  });

  it("getChat restores image files from the owning user.message", async () => {
    mockFetch((url) => {
      if (url.includes("/events?")) {
        return json(200, {
          data: [
            {
              id: "e1",
              type: "user.message",
              content: [
                { type: "text", text: "what is this" },
                { type: "image", source: { type: "file", file_id: "file-image" } },
              ],
            },
            { id: "e2", type: "user.message", content: [{ type: "text", text: "next" }] },
          ],
          has_more: false,
        });
      }
      if (url.includes("/resources?")) return json(200, { data: [], has_more: false });
      if (url.endsWith("/files/file-image")) {
        return json(200, { id: "file-image", filename: "diagram.png", mime_type: "image/png" });
      }
      return json(200, {
        id: "s1",
        agent_id: "a1",
        environment_id: "e1",
        status: "idle",
        created_at: "t",
        updated_at: "t",
      });
    });

    const detail = await createQoderChatAdapter("k").getChat("s1");

    expect(detail.messages[0]?.attachments).toEqual([
      { fileId: "file-image", kind: "image", filename: "diagram.png" },
    ]);
    expect(detail.messages[1]?.attachments).toBeUndefined();
  });

  it("getChat follows last_id/after_id until history is complete", async () => {
    const calls = mockFetch((url) => {
      if (url.includes("/events")) {
        if (url.includes("after_id=e1"))
          return json(200, {
            data: [{ id: "e2", type: "agent.message", content: [{ type: "text", text: "done" }] }],
            first_id: "e2",
            last_id: "e2",
            has_more: false,
          });
        return json(200, {
          data: [{ id: "e1", type: "user.message", content: [{ type: "text", text: "go" }] }],
          first_id: "e1",
          last_id: "e1",
          has_more: true,
        });
      }
      if (url.includes("/resources?")) return json(200, { data: [], has_more: false });
      return json(200, {
        id: "s1",
        agent_id: "a1",
        environment_id: "e1",
        status: "idle",
        created_at: "t",
        updated_at: "t",
      });
    });
    const detail = await createQoderChatAdapter("k").getChat("s1");
    expect(detail.messages.map((message) => message.content)).toEqual(["go", "done"]);
    expect(calls.some((call) => call.url.includes("after_id=e1"))).toBe(true);
  });

  it("surfaces provider errors as stable HostError without body", async () => {
    mockFetch(() => json(401, { error: "bad token" }));
    const adapter = createQoderChatAdapter("k");
    await expect(adapter.listChats("a1")).rejects.toMatchObject({
      code: "authentication",
    });
  });

  it("reads Session scope and sharing access from metadata", async () => {
    mockFetch(() =>
      json(200, {
        id: "s1",
        agent_id: "a1",
        environment_id: "e1",
        status: "idle",
        metadata: {
          openagentbot_key_scope: "owner-scope",
          openagentbot_shared: "true",
        },
      }),
    );
    const adapter = createQoderChatAdapter("k");

    await expect(adapter.getChatAccess?.("s1")).resolves.toEqual({
      keyScopeMarker: "owner-scope",
      shared: true,
    });
  });

  it.each([
    { shared: true, wireValue: "true", expectedShared: true },
    { shared: false, wireValue: "false", expectedShared: undefined },
  ])(
    "updates only the Qoder Session sharing metadata key to $wireValue",
    async ({ shared, wireValue, expectedShared }) => {
      let reads = 0;
      const calls = mockFetch((_url, init) => {
        if (init?.method === "POST") return new Response(null, { status: 204 });
        reads += 1;
        return json(200, {
          id: "s1",
          agent_id: "a1",
          environment_id: "e1",
          status: "idle",
          metadata: {
            openagentbot_key_scope: "owner-scope",
            existing: "keep",
            ...(reads > 1 ? { openagentbot_shared: wireValue } : {}),
          },
        });
      });
      const adapter = createQoderChatAdapter("k");

      const updated = await adapter.setChatShared?.("s1", shared, "owner-scope");

      expect(updated).toMatchObject({ keyScopeMarker: "owner-scope" });
      expect(updated?.shared).toBe(expectedShared);
      expect(calls.map((call) => [call.method, call.url])).toEqual([
        ["GET", "https://api.qoder.com/api/v1/cloud/sessions/s1"],
        ["POST", "https://api.qoder.com/api/v1/cloud/sessions/s1"],
        ["GET", "https://api.qoder.com/api/v1/cloud/sessions/s1"],
      ]);
      expect(calls[1]?.body).toEqual({
        metadata: { openagentbot_shared: wireValue },
      });
    },
  );

  it("does not update sharing outside the owner scope", async () => {
    const calls = mockFetch(() =>
      json(200, {
        id: "s1",
        agent_id: "a1",
        environment_id: "e1",
        status: "idle",
        metadata: { openagentbot_key_scope: "other-scope" },
      }),
    );
    const adapter = createQoderChatAdapter("k");

    await expect(adapter.setChatShared?.("s1", true, "owner-scope")).rejects.toMatchObject({
      code: "not-found",
    });
    expect(calls).toHaveLength(1);
  });

  it("createChat posts environment_id and maps the session", async () => {
    const calls = mockFetch(() =>
      json(200, {
        id: "s-new",
        agent_id: "a1",
        environment_id: "env-1",
        status: "running",
        created_at: "t",
        updated_at: "t",
      }),
    );
    const adapter = createQoderChatAdapter("k");
    const chat = await adapter.createChat("a1", "env-1");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/sessions");
    expect(calls[0]?.body).toMatchObject({ agent: "a1", environment_id: "env-1" });
    expect(chat.ref.sessionId).toBe("s-new");
    expect(chat.remoteStatus).toBe("running");
  });

  it("sendMessage posts the text and resolves ok", async () => {
    const calls = mockFetch(() => json(200, { id: "evt-1" }));
    const adapter = createQoderChatAdapter("k");
    const result = await adapter.sendMessage("s1", "hello");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/sessions/s1/events");
    expect(result.ok).toBe(true);
  });

  it("uploads a file through the Qoder Files API", async () => {
    const calls = mockFetch(() =>
      json(200, {
        id: "file-1",
        filename: "spec.md",
        size_bytes: 4,
        mime_type: "text/markdown",
      }),
    );
    const adapter = createQoderChatAdapter("k");

    const uploaded = await adapter.uploadFile?.({
      filename: "spec.md",
      mimeType: "text/markdown",
      bytes: new TextEncoder().encode("test").buffer,
    });

    expect(calls[0]?.url).toBe("https://api.qoder.com/api/v1/cloud/files");
    expect(calls[0]?.body).toBeInstanceOf(FormData);
    expect(uploaded).toEqual({
      fileId: "file-1",
      filename: "spec.md",
      mimeType: "text/markdown",
      sizeBytes: 4,
    });
  });

  it("mounts attachments and writes their paths into the user message", async () => {
    const calls = mockFetch((url) =>
      url.endsWith("/events")
        ? json(200, { id: "evt-1" })
        : json(200, {
            id: "sesr-1",
            type: "file",
            file_id: "file-1",
            mount_path: "/mnt/session/uploads/file-1/spec.md",
          }),
    );
    const adapter = createQoderChatAdapter("k");

    await adapter.sendMessage("s1", "review it", [
      { fileId: "file-1", filename: "spec.md", mimeType: "text/markdown" },
    ]);

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.qoder.com/api/v1/cloud/sessions/s1/resources",
      "https://api.qoder.com/api/v1/cloud/sessions/s1/events",
    ]);
    expect(calls[0]?.body).toEqual({ type: "file", file_id: "file-1" });
    expect(calls[1]?.body).toEqual({
      events: [
        {
          type: "user.message",
          content: [
            {
              type: "text",
              text: "[/mnt/session/uploads/file-1/spec.md] review it",
            },
          ],
        },
      ],
    });
  });

  it("writes every mounted file path before the original text", async () => {
    const calls = mockFetch((url, init) => {
      if (url.endsWith("/events")) return json(200, { id: "evt-1" });
      const body = JSON.parse(String(init?.body)) as { file_id: string };
      return json(200, {
        id: `resource-${body.file_id}`,
        type: "file",
        file_id: body.file_id,
        mount_path: `/mnt/session/uploads/${body.file_id}/${body.file_id}.md`,
      });
    });

    await createQoderChatAdapter("k").sendMessage("s1", "compare", [
      { fileId: "file-1", filename: "first.md", mimeType: "text/markdown" },
      { fileId: "file-2", filename: "second.md", mimeType: "text/markdown" },
    ]);

    expect(calls[2]?.body).toEqual({
      events: [
        {
          type: "user.message",
          content: [
            {
              type: "text",
              text: "[/mnt/session/uploads/file-1/file-1.md] [/mnt/session/uploads/file-2/file-2.md] compare",
            },
          ],
        },
      ],
    });
  });

  it("does not send a file message when Qoder omits the mount path", async () => {
    const calls = mockFetch(() =>
      json(200, {
        id: "sesr-1",
        type: "file",
        file_id: "file-1",
      }),
    );

    await expect(
      createQoderChatAdapter("k").sendMessage("s1", "review", [
        { fileId: "file-1", filename: "spec.md", mimeType: "text/markdown" },
      ]),
    ).rejects.toMatchObject({ code: "unavailable" });

    expect(calls).toHaveLength(1);
  });

  it("sends images as user.message image blocks", async () => {
    const calls = mockFetch(() => json(200, { id: "evt-1" }));
    const adapter = createQoderChatAdapter("k");

    await adapter.sendMessage("s1", "describe it", [
      { fileId: "file-image", filename: "diagram.png", mimeType: "image/png" },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.qoder.com/api/v1/cloud/sessions/s1/events");
    expect(calls[0]?.body).toEqual({
      events: [
        {
          type: "user.message",
          content: [
            { type: "text", text: "describe it" },
            { type: "image", source: { type: "file", file_id: "file-image" } },
          ],
        },
      ],
    });
  });

  it("archiveChat posts to the archive endpoint", async () => {
    const calls = mockFetch(() => json(200, {}));
    const adapter = createQoderChatAdapter("k");
    await adapter.archiveChat("s1");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.qoder.com/api/v1/cloud/sessions/s1/archive");
  });

  it("deleteChat deletes the session", async () => {
    const calls = mockFetch(() => new Response(null, { status: 204 }));
    const adapter = createQoderChatAdapter("k");
    await adapter.deleteChat("s1");
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("https://api.qoder.com/api/v1/cloud/sessions/s1");
  });

  it("getArtifact verifies the file belongs to the session and fetches preview content", async () => {
    const calls = mockFetch((url) => {
      if (url === "https://api.qoder.com/api/v1/cloud/sessions/s1/events?limit=100&order=asc") {
        return json(200, {
          data: [
            {
              id: "event-1",
              type: "agent.artifact_delivered",
              file_id: "file-1",
              original_filename: "report.html",
              content_type: "text/html",
              size: 128,
            },
          ],
          has_more: false,
        });
      }
      if (url === "https://api.qoder.com/api/v1/cloud/files/file-1/content") {
        return json(200, { url: "https://files.example/report.html", expires_at: "2026-01-01" });
      }
      return new Response('<html><script src="https://cdn.example/app.js"></script></html>', {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    });
    const adapter = createQoderChatAdapter("k");
    if (adapter.getArtifact === undefined) throw new Error("qoder artifact support is required");
    let artifact;
    try {
      artifact = await adapter.getArtifact("s1", "file-1", { includeContent: true });
    } catch (error) {
      throw error;
    }

    expect(artifact).toMatchObject({
      filename: "report.html",
      contentType: "text/html",
      size: 128,
      downloadUrl: "https://files.example/report.html",
      content: expect.stringContaining("<html>"),
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.qoder.com/api/v1/cloud/sessions/s1/events?limit=100&order=asc",
      "https://api.qoder.com/api/v1/cloud/files/file-1/content",
      "https://files.example/report.html",
    ]);
  });

  it("getArtifact fetches PNG preview content as binary data", async () => {
    const pngBytes = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+2wUAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const pngBuffer = new ArrayBuffer(pngBytes.byteLength);
    new Uint8Array(pngBuffer).set(pngBytes);
    mockFetch((url) => {
      if (url === "https://api.qoder.com/api/v1/cloud/sessions/s1/events?limit=100&order=asc") {
        return json(200, {
          data: [
            {
              id: "event-1",
              type: "agent.artifact_delivered",
              file_id: "file-1",
              original_filename: "diagram.png",
              content_type: "image/png",
              size: 3,
            },
          ],
          has_more: false,
        });
      }
      if (url === "https://api.qoder.com/api/v1/cloud/files/file-1/content") {
        return json(200, { url: "https://files.example/diagram.png", expires_at: "2026-01-01" });
      }
      return new Response(pngBuffer, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });
    const adapter = createQoderChatAdapter("k");
    if (adapter.getArtifact === undefined) throw new Error("qoder artifact support is required");

    await expect(
      adapter.getArtifact("s1", "file-1", { includeContent: true }),
    ).resolves.toMatchObject({
      filename: "diagram.png",
      contentType: "image/png",
      downloadUrl: "https://files.example/diagram.png",
      previewData: { contentType: "image/png", bytes: pngBuffer },
    });
  });

  it("getArtifact rejects files not delivered in the session", async () => {
    const calls = mockFetch(() =>
      json(200, {
        data: [
          {
            id: "event-1",
            type: "agent.artifact_delivered",
            file_id: "other-file",
          },
        ],
        has_more: false,
      }),
    );
    const adapter = createQoderChatAdapter("k");
    if (adapter.getArtifact === undefined) throw new Error("qoder artifact support is required");

    await expect(adapter.getArtifact("s1", "file-1")).rejects.toMatchObject({
      code: "not-found",
    });
    expect(calls).toHaveLength(1);
  });

  it("archiveChat and deleteChat map errors without leaking body", async () => {
    mockFetch(() => json(404, { error: "not found secret" }));
    const adapter = createQoderChatAdapter("k");
    await expect(adapter.archiveChat("s1")).rejects.toMatchObject({
      code: "not-found",
    });
    mockFetch(() => json(403, { error: "forbidden secret" }));
    await expect(adapter.deleteChat("s1")).rejects.toMatchObject({
      code: "permission",
    });
  });
});

/** 构造一段 SSE 文本流（标准 `data: {json}\n\n` 帧）。 */
function sseStream(frames: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

describe("toChatEventView", () => {
  it("maps assistant message to token, idle to done, error to error", () => {
    expect(
      toChatEventView({
        type: "message",
        raw_type: "agent.message",
        role: "assistant",
        content: "Hi",
        raw: {},
      }),
    ).toEqual({ type: "token", text: "Hi" });
    expect(
      toChatEventView({ type: "status", raw_type: "session.status_idle", status: "idle", raw: {} }),
    ).toEqual({
      type: "done",
    });
    const err = toChatEventView({
      type: "error",
      raw_type: "session.error",
      content: "boom",
      raw: {},
    });
    expect(err?.type).toBe("error");
    expect(
      toChatEventView({ type: "thinking", raw_type: "agent.thinking", content: "plan", raw: {} }),
    ).toMatchObject({
      type: "timeline",
      item: { kind: "thinking", content: "plan" },
    });
    expect(
      toChatEventView({
        type: "message",
        raw_type: "user.message",
        role: "user",
        content: "[/mnt/session/uploads/spec--a1.md] inspect",
        raw: {},
      }),
    ).toMatchObject({
      type: "timeline",
      item: {
        kind: "message",
        content: "inspect",
      },
    });
  });
});

describe("QoderChatAdapter subscribe", () => {
  it("emits token then done, and stops after idle", async () => {
    mockFetch(
      () =>
        new Response(
          sseStream([
            { type: "agent.message", content: [{ type: "text", text: "Hello" }] },
            { type: "session.status_idle" },
          ]),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    const adapter = createQoderChatAdapter("k");
    const events: string[] = [];
    const done = new Promise<void>((resolve) => {
      adapter.subscribe("s1", (e) => {
        events.push(e.type === "token" ? `token:${e.text ?? ""}` : e.type);
        if (e.type === "done") resolve();
      });
    });
    await done;
    expect(events).toEqual(["token:Hello", "done"]);
  });

  it("emits error when the stream repeatedly ends without idle", async () => {
    mockFetch(
      () =>
        new Response(
          sseStream([{ type: "agent.message", content: [{ type: "text", text: "Hi" }] }]),
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        ),
    );
    const adapter = createQoderChatAdapter("k");
    const types: string[] = [];
    const done = new Promise<void>((resolve) => {
      adapter.subscribe("s1", (e) => {
        types.push(e.type);
        if (e.type === "error") resolve();
      });
    });
    await done;
    expect(types).toContain("error");
  });

  it("subscribe 连接失败时通过 error 事件上抛（不 reject）", async () => {
    mockFetch(() => {
      throw new Error("network down");
    });
    const adapter = createQoderChatAdapter("k");

    const errored = new Promise<{ code: string }>((resolve) => {
      void adapter.subscribe("s1", (e) => {
        if (e.type === "error" && e.error) resolve({ code: e.error.code });
      });
    });
    const err = await errored;
    expect(err.code).toBe("unavailable");
  });

  it("静默 SSE 首帧前返回 unsubscribe，取消后到达的事件不再 emit", async () => {
    // bg_1/bg_6：UI 等 subscribe 完成才能发送；等待首帧会与静默 SSE 互相死锁。
    const cancelled = Promise.withResolvers<void>();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let streamCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      cancel() {
        streamCancelled = true;
        cancelled.resolve();
      },
    });
    mockFetch(
      () =>
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    );
    const received: string[] = [];
    const adapter = createQoderChatAdapter("k");
    try {
      // 此处没有任何帧；若实现等待首帧才返回，本测试无法走到 enqueue。
      const unsub = await adapter.subscribe("s1", (event) => received.push(event.type));
      unsub();
      controller.enqueue(
        new TextEncoder().encode(
          'data: {"type":"agent.message","content":[{"type":"text","text":"late-arriving"}]}\n\n',
        ),
      );
      // reader 被取消，证明后台已处理 pending read 并退出，不依赖固定微任务拍数。
      await cancelled.promise;
      expect(received).toEqual([]);
    } finally {
      if (!streamCancelled) controller.close();
    }
  });
});
