import { afterEach, describe, expect, it, vi } from "vitest";
import { createQoderBotCatalog } from "./qoder-bot-catalog";
import { isHostError } from "@shared/errors";

/**
 * Qoder BotCatalog 分页合同测试。保护的风险：
 * - `bots.list` 只返回第一页，导致协作成员候选静默缺失；
 * - cursor 不前进时死循环，或把不完整列表当作完整列表返回；
 * - 分页中途失败时返回部分结果；
 * - 错误消息携带 Provider 响应正文或凭据。
 */

const base = "https://api.qoder.com/api/v1/cloud";

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function mockFetch(handler: (url: string) => Response) {
	const calls: string[] = [];
	vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input.toString();
		calls.push(url);
		return handler(url);
	});
	return calls;
}

function agent(id: string) {
	return { id, name: id.toUpperCase() };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("QoderBotCatalog 分页", () => {
	it("仅精确字符串 true 映射为共享，不推断权限", async () => {
		mockFetch(() => json(200, { data: [
			{ ...agent("shared"), metadata: { openagentbot_shared: "true", openagentbot_key_scope: "scope-one" } },
			{ ...agent("ordinary"), metadata: { openagentbot_shared: "True" } },
		] }));
		const bots = await createQoderBotCatalog("k").listBots();
		expect(bots.map((bot) => Boolean(bot.shared))).toEqual([true, false]);
		expect(bots[0]?.keyScopeMarker).toBe("scope-one");
	});
	it("循环读取 next_page 直到 has_more 为假", async () => {
		const calls = mockFetch((url) =>
			url.includes("page=p2")
				? json(200, { data: [agent("a2")], has_more: false })
				: json(200, { data: [agent("a1")], has_more: true, next_page: "p2" }),
		);

		const bots = await createQoderBotCatalog("k").listBots();

		expect(bots.map((bot) => bot.agentId)).toEqual(["a1", "a2"]);
		expect(calls).toEqual([`${base}/agents?limit=100`, `${base}/agents?limit=100&page=p2`]);
	});

	it("空页结束分页并保留已读取结果", async () => {
		const calls = mockFetch((url) =>
			url.includes("page=p2")
				? json(200, { data: [], has_more: false, next_page: null })
				: json(200, { data: [agent("a1")], has_more: true, next_page: "p2" }),
		);

		const bots = await createQoderBotCatalog("k").listBots();

		expect(bots.map((bot) => bot.agentId)).toEqual(["a1"]);
		expect(calls).toHaveLength(2);
	});

	it("首页为空时返回空列表", async () => {
		const calls = mockFetch(() => json(200, { data: [] }));

		const bots = await createQoderBotCatalog("k").listBots();

		expect(bots).toEqual([]);
		expect(calls).toEqual([`${base}/agents?limit=100`]);
	});

	it("cursor 不前进时 fail closed，不返回部分列表", async () => {
		const calls = mockFetch((url) =>
			new URL(url).searchParams.get("page") === "p2"
				? json(200, { data: [agent("a2")], has_more: true, next_page: "p2" })
				: json(200, { data: [agent("a1")], has_more: true, next_page: "p2" }),
		);

		const error: unknown = await createQoderBotCatalog("k")
			.listBots()
			.catch((caught: unknown) => caught);

		expect(isHostError(error)).toBe(true);
		if (isHostError(error)) expect(error.code).toBe("unavailable");
		expect(calls).toHaveLength(2);
	});

	it("has_more 为真但没有可用 cursor 时 fail closed", async () => {
		mockFetch(() => json(200, { data: [agent("a1")], has_more: true, next_page: null }));

		const error: unknown = await createQoderBotCatalog("k")
			.listBots()
			.catch((caught: unknown) => caught);

		expect(isHostError(error)).toBe(true);
		if (isHostError(error)) expect(error.code).toBe("unavailable");
	});

	it("分页中途失败时不返回部分列表", async () => {
		mockFetch((url) =>
			url.includes("page=p2")
				? json(500, { error: { message: "boom" } })
				: json(200, { data: [agent("a1")], has_more: true, next_page: "p2" }),
		);

		const error: unknown = await createQoderBotCatalog("k")
			.listBots()
			.catch((caught: unknown) => caught);

		expect(isHostError(error)).toBe(true);
		if (isHostError(error)) {
			expect(error.code).toBe("unavailable");
			expect(error.message).not.toContain("boom");
		}
	});

	it("第一页被拒绝时映射为 authentication 且不泄露凭据", async () => {
		mockFetch(() => json(401, { error: { message: "TOKEN_INVALID" } }));

		const error: unknown = await createQoderBotCatalog("secret-pat")
			.listBots()
			.catch((caught: unknown) => caught);

		expect(isHostError(error)).toBe(true);
		if (isHostError(error)) {
			expect(error.code).toBe("authentication");
			expect(error.message).not.toContain("secret-pat");
		}
	});
});
