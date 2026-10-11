import { afterEach, describe, expect, it, vi } from "vitest";
import { createQoderDataClient } from "./qoder-client";
import { QoderApiError, QoderConflictError } from "./qoder-http";

/**
 * 合同测试：本客户端自己拥有 Qoder 数据面，不依赖 OpenAgentPack 数据面入口。
 *
 * 保护的风险：
 * - Session 创建/发送/事件读取的 wire 形状与分页/SSE 行为变化。
 *
 * （OpenAgentPack 依赖边界由 scripts/check-architecture.mjs 在 gate 中统一守护。）
 */

describe("QoderDataClient wire 行为（经装配点）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{ url: string; method: string; body?: unknown; headers?: HeadersInit }> = [];
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
        headers: init?.headers,
      });
      return handler(url, init);
    });
    return calls;
  }

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("createSession writes CloudAgentBot Key scope in Provider metadata", async () => {
    const calls = mockFetch(() =>
      json(200, {
        id: "sess_scoped",
        agent: { id: "agent_1" },
        environment_id: "env_1",
        metadata: { openagentbot_key_scope: "oab-key-v1-scope" },
        status: "idle",
      }),
    );
    const client = createQoderDataClient({ apiKey: "k" });
    const session = await client.createSession({
      agent_id: "agent_1",
      environment_id: "env_1",
      metadata: { openagentbot_key_scope: "oab-key-v1-scope" },
    });
    expect(calls[0]?.body).toEqual({
      agent: "agent_1",
      environment_id: "env_1",
      metadata: { openagentbot_key_scope: "oab-key-v1-scope" },
    });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.qoder.com/api/v1/cloud/sessions");
    expect(session.id).toBe("sess_scoped");
    expect(session.attributes.metadata).toEqual({ openagentbot_key_scope: "oab-key-v1-scope" });
  });

  it("updateSessionMetadata accepts an empty success response", async () => {
    const calls = mockFetch(() => new Response(null, { status: 204 }));
    const client = createQoderDataClient({ apiKey: "k" });

    await client.updateSessionMetadata("sess_scoped", {
      openagentbot_shared: "true",
    });

    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.qoder.com/api/v1/cloud/sessions/sess_scoped",
      body: { metadata: { openagentbot_shared: "true" } },
    });
  });

  it("sendMessage 返回持久化事件 receipt", async () => {
    const calls = mockFetch(() => json(200, { id: "evt_1" }));

    const client = createQoderDataClient({ apiKey: "k" });
    const receipt = await client.sendMessage("sess_1", "hello", ["file_1"]);

    expect(receipt).toBe("evt_1");
    expect(calls[0]?.body).toEqual({
      events: [
        {
          type: "user.message",
          content: [
            { type: "text", text: "hello" },
            { type: "image", source: { type: "file", file_id: "file_1" } },
          ],
        },
      ],
    });
  });

  it("uploadFile 以 multipart 上传并映射文件元数据", async () => {
    const calls = mockFetch(() =>
      json(200, {
        id: "file_1",
        filename: "spec.md",
        size_bytes: 4,
        mime_type: "text/markdown",
      }),
    );

    const client = createQoderDataClient({ apiKey: "k" });
    const file = await client.uploadFile(
      new TextEncoder().encode("test").buffer,
      "spec.md",
      "text/markdown",
    );

    expect(calls[0]?.url).toBe("https://api.qoder.com/api/v1/cloud/files");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBeInstanceOf(FormData);
    const headers = calls[0]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer k");
    expect(headers["Content-Type"]).toBeUndefined();
    const uploaded = (calls[0]?.body as FormData).get("file") as File;
    expect(uploaded.name).toBe("spec.md");
    expect(uploaded.type).toBe("text/markdown");
    expect(file).toMatchObject({ id: "file_1", filename: "spec.md", size_bytes: 4 });
  });

  it("addSessionFileResource 挂载已上传文件并返回挂载路径", async () => {
    const calls = mockFetch(() =>
      json(200, {
        id: "sesr_1",
        type: "file",
        file_id: "file_1",
        mount_path: "/mnt/session/uploads/file_1/spec.md",
      }),
    );
    const client = createQoderDataClient({ apiKey: "k" });

    const resource = await client.addSessionFileResource("sess_1", "file_1");

    expect(calls[0]?.url).toBe("https://api.qoder.com/api/v1/cloud/sessions/sess_1/resources");
    expect(calls[0]?.body).toEqual({ type: "file", file_id: "file_1" });
    expect(resource.mount_path).toBe("/mnt/session/uploads/file_1/spec.md");
  });

  it("lists session resources and reads file metadata", async () => {
    const calls = mockFetch((url) => {
      if (url.includes("/resources?")) {
        return json(200, {
          data: [
            { id: "sesr_1", type: "file", file_id: "file_1", created_at: "2026-09-29T01:51:00Z" },
          ],
          has_more: false,
        });
      }
      return json(200, { id: "file_1", filename: "spec.md", mime_type: "text/markdown" });
    });
    const client = createQoderDataClient({ apiKey: "k" });

    const resources = await client.listSessionResources("sess_1");
    const file = await client.getFile("file_1");

    expect(calls[0]?.url).toContain("/sessions/sess_1/resources?limit=100");
    expect(resources[0]).toMatchObject({ file_id: "file_1" });
    expect(file).toMatchObject({ id: "file_1", filename: "spec.md" });
  });

  it("listEvents 透传分页游标并映射事件类型", async () => {
    const calls = mockFetch(() =>
      json(200, {
        data: [
          { id: "e1", type: "user.message", content: [{ type: "text", text: "hi" }] },
          { id: "e2", type: "session.status_idle" },
        ],
        has_more: false,
        first_id: "e1",
        last_id: "e2",
      }),
    );

    const client = createQoderDataClient({ apiKey: "k" });
    const page = await client.listEvents("sess_1", { after_id: "e0", limit: 50 });

    expect(calls[0]?.url).toContain("/sessions/sess_1/events?");
    expect(calls[0]?.url).toContain("after_id=e0");
    expect(page.events.map((e) => [e.type, e.status])).toEqual([
      ["message", undefined],
      ["status", "idle"],
    ]);
    expect(page.last_id).toBe("e2");
  });

  it("streamEvents 使用 event_deltas query 与 Last-Event-ID header", async () => {
    const calls = mockFetch(
      () => new Response('data: {"id":"e2","type":"session.status_idle"}\n\n', { status: 200 }),
    );
    const client = createQoderDataClient({ apiKey: "k" });
    const iterator = client.streamEvents("sess_1", {
      last_event_id: "e1",
      event_deltas: ["agent.message", "agent.thinking"],
      include_tool_calls: true,
    });
    await iterator.next();
    expect(calls[0]?.url).toContain("event_deltas%5B%5D=agent.message");
    expect(calls[0]?.url).toContain("event_deltas%5B%5D=agent.thinking");
    const headers = calls[0]?.headers as Record<string, string>;
    expect(headers["Last-Event-ID"]).toBe("e1");
    expect(headers["X-Qoder-Beta"]).toBe("thinking-event-stream-delta-2026-07-20");
  });

  it("streamEvents 跳过 heartbeat 帧并解析 data 载荷", async () => {
    const sse =
      ": heartbeat\n" +
      "event: heartbeat\n" +
      "data: {}\n\n" +
      'data: {"id":"e1","type":"agent.message","content":[{"type":"text","text":"hi"}]}\n\n';
    mockFetch(
      () => new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );

    const client = createQoderDataClient({ apiKey: "k" });
    const events = [];
    for await (const event of client.streamEvents("sess_1")) events.push(event);

    expect(events.map((e) => [e.id, e.content])).toEqual([["e1", "hi"]]);
  });

  it("401 分类为 ApiError 且消息不含凭据", async () => {
    mockFetch(() => json(401, { error: { message: "TOKEN_INVALID" } }));

    const client = createQoderDataClient({ apiKey: "secret-pat" });
    const error = await client.validateCredential().catch((e: unknown) => e);

    expect((error as { statusCode?: number }).statusCode).toBe(401);
    expect((error as Error).message).not.toContain("secret-pat");
  });

  it("404 与 409 保留可分类的 transport error", async () => {
    let status = 404;
    mockFetch(() => json(status, { error: { message: "failure" } }));
    const client = createQoderDataClient({ apiKey: "k" });
    const missing = await client.getSession("missing").catch((error: unknown) => error);
    expect(QoderApiError.isNotFound(missing)).toBe(true);
    status = 409;
    const conflict = await client
      .createSession({ agent_id: "a", environment_id: "e" })
      .catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(QoderConflictError);
  });

  it("custom gateway overrides the default base URL", async () => {
    const calls = mockFetch(() => json(200, { data: [] }));
    await createQoderDataClient({
      apiKey: "k",
      gateway: "https://example.test/cloud",
    }).listSessions();
    expect(calls[0]?.url).toBe("https://example.test/cloud/sessions");
  });
});
