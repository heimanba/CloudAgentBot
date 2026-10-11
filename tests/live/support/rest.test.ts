import { afterEach, describe, expect, it, vi } from "vitest";
import { bailianBaseUrl, QODER_GATEWAY } from "./endpoints";
import {
  archiveResource,
  deleteQoderResource,
  jsonRequest,
  jsonRows,
  providerRequester,
  restRequest,
  restTarget,
  type Json,
} from "./rest";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/** 记录调用的 fetch 桩；返回值由 respond 决定。 */
function stubFetch(respond: (call: FetchCall) => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Provider 端点与组合", () => {
  it("bailianBaseUrl 按工作区拼域名", () => {
    expect(bailianBaseUrl("ws-demo")).toBe(
      "https://ws-demo.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio",
    );
  });

  it("restTarget 组合 Provider、基地址与凭据，缺字段即报错", () => {
    expect(restTarget("qoder", { qoderPat: "pat" })).toEqual({
      provider: "qoder",
      base: QODER_GATEWAY,
      token: "pat",
    });
    expect(restTarget("bailian", { bailianApiKey: "key", bailianWorkspaceId: "ws" })).toEqual({
      provider: "bailian",
      base: bailianBaseUrl("ws"),
      token: "key",
    });
    expect(() => restTarget("qoder", {})).toThrowError(/QODER_PAT/);
    expect(() => restTarget("bailian", { bailianApiKey: "key" })).toThrowError(
      /BAILIAN_WORKSPACE_ID/,
    );
  });

  it("restRequest 拼接路径并携带 Bearer/JSON 头，init.headers 可覆盖", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    await restRequest(
      { provider: "qoder", base: "https://example.test", token: "t" },
      "/agents/1",
      {
        method: "DELETE",
        headers: { "X-Override": "1" },
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.test/agents/1");
    expect(calls[0].init?.method).toBe("DELETE");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer t");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Override"]).toBe("1");
  });

  it("archiveResource POST 到正式归档路径", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    await archiveResource(
      { provider: "qoder", base: "https://example.test", token: "t" },
      "agent",
      "a1",
    );
    expect(calls[0].url).toBe("https://example.test/agents/a1/archive");
    expect(calls[0].init?.method).toBe("POST");
  });
});

describe("jsonRequest / jsonRows / providerRequester", () => {
  it("jsonRequest 解析 2xx 体；空体返回 {}", async () => {
    stubFetch(() => new Response(JSON.stringify({ data: [1] }), { status: 200 }));
    await expect(
      jsonRequest({ provider: "bailian", base: "https://example.test", token: "t" }, "/agents"),
    ).resolves.toEqual({ data: [1] });
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(
      jsonRequest({ provider: "bailian", base: "https://example.test", token: "t" }, "/agents"),
    ).resolves.toEqual({});
  });

  it("jsonRequest 非 2xx 抛带 Provider 标签的错误且不含凭据", async () => {
    stubFetch(() => new Response("{}", { status: 401 }));
    await expect(
      jsonRequest({ provider: "qoder", base: "https://example.test", token: "sk-live" }, "/agents"),
    ).rejects.toThrowError(/Qoder GET \/agents: 401/);
    stubFetch(() => new Response(null, { status: 500 }));
    await expect(
      jsonRequest(
        { provider: "bailian", base: "https://example.test", token: "sk-live" },
        "/agents",
        { method: "DELETE" },
      ),
    ).rejects.toThrowError(/Bailian DELETE \/agents: 500/);
    try {
      await jsonRequest(
        { provider: "qoder", base: "https://example.test", token: "sk-live-secret" },
        "/agents",
      );
      expect.unreachable("non-2xx should throw");
    } catch (error) {
      expect((error as Error).message).not.toContain("sk-live-secret");
    }
  });

  it("jsonRows 归一化裸数组与 data/items/threads 包裹", () => {
    const rows: Json[] = [{ name: "a" }];
    expect(jsonRows(rows)).toEqual(rows);
    expect(jsonRows({ data: rows })).toEqual(rows);
    expect(jsonRows({ items: rows })).toEqual(rows);
    expect(jsonRows({ threads: rows })).toEqual(rows);
    expect(jsonRows({})).toEqual([]);
    expect(jsonRows({ data: undefined, items: null })).toEqual([]);
  });

  it("providerRequester 惰性组合：创建不读凭据，调用才校验", async () => {
    expect(() => providerRequester("qoder", {})).not.toThrow();
    await expect(providerRequester("qoder", {})("/agents")).rejects.toThrowError(/QODER_PAT/);
    await expect(
      providerRequester("bailian", { bailianApiKey: "key" })("/agents"),
    ).rejects.toThrowError(/BAILIAN_WORKSPACE_ID/);
  });

  it("providerRequester 委托 jsonRequest 并携带 Bearer 头", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const request = providerRequester("qoder", { qoderPat: "pat" });
    await expect(request("/agents?limit=100")).resolves.toEqual({});
    expect(calls[0].url).toBe(`${QODER_GATEWAY}/agents?limit=100`);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer pat");
  });
});

describe("deleteQoderResource", () => {
  it("DELETE 成功即结束，不再归档", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    await deleteQoderResource("pat", "environment", "e1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${QODER_GATEWAY}/environments/e1`);
    expect(calls[0].init?.method).toBe("DELETE");
  });

  it("404/410 视为已清理", async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    await expect(deleteQoderResource("pat", "agent", "a1")).resolves.toBeUndefined();
  });

  it("Environment 409 时按正式协议归档", async () => {
    const calls = stubFetch((call) =>
      call.init?.method === "DELETE"
        ? new Response(null, { status: 409 })
        : new Response("{}", { status: 200 }),
    );
    await deleteQoderResource("pat", "environment", "e1");
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(`${QODER_GATEWAY}/environments/e1/archive`);
    expect(calls[1].init?.method).toBe("POST");
  });

  it("Agent 409、其他状态码与归档失败都抛错", async () => {
    stubFetch(() => new Response(null, { status: 409 }));
    await expect(deleteQoderResource("pat", "agent", "a1")).rejects.toThrowError(
      /agent cleanup failed: 409/,
    );
    stubFetch(() => new Response(null, { status: 500 }));
    await expect(deleteQoderResource("pat", "environment", "e1")).rejects.toThrowError(
      /environment cleanup failed: 500/,
    );
    stubFetch((call) =>
      call.init?.method === "DELETE"
        ? new Response(null, { status: 409 })
        : new Response(null, { status: 500 }),
    );
    await expect(deleteQoderResource("pat", "environment", "e1")).rejects.toThrowError(
      /archive failed: 500/,
    );
  });
});
