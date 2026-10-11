/**
 * Stage 04 真实 Cloud 只读 smoke。
 * 运行：OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/
 *
 * 覆盖 validation.md 用户流程 1/6/8 与 Stage 04 完成条件：
 * - 有效凭据列出远程 Agent；
 * - 列出 Agent 的远程 Session，读取历史；
 * - 只读：不创建、不修改、不删除任何远程资源。
 * 凭据从当前仓库 .env 或环境变量读取，不出现在日志或断言消息中。
 */
import { describe, expect, it } from "vitest";
import { createQoderBotCatalog } from "../../src/main/data-plane/providers/qoder/qoder-bot-catalog";
import { createQoderChatAdapter } from "../../src/main/data-plane/providers/qoder/qoder-chat-adapter";
import { requireQoderPat } from "./support/credentials";

const LIVE = process.env.OPENAGENTBOT_LIVE === "1";

describe.skipIf(!LIVE)("qoder data plane live (read-only)", () => {
  it("lists remote agents, sessions and message history without mutation", async () => {
    const pat = requireQoderPat();
    const catalog = createQoderBotCatalog(pat);
    const adapter = createQoderChatAdapter(pat);

    const bots = await catalog.listBots();
    expect(Array.isArray(bots)).toBe(true);
    // 每个 Bot 映射出必需字段；managed 标志按 metadata 存在性判定。
    for (const bot of bots) {
      expect(typeof bot.agentId).toBe("string");
      expect(bot.agentId.length).toBeGreaterThan(0);
      expect(typeof bot.name).toBe("string");
      expect(typeof bot.managed).toBe("boolean");
    }

    if (bots.length > 0) {
      const chats = await adapter.listChats(bots[0].agentId);
      expect(Array.isArray(chats)).toBe(true);
      for (const chat of chats) {
        expect(chat.ref.agentId).toBe(bots[0].agentId);
        expect(typeof chat.ref.sessionId).toBe("string");
      }

      if (chats.length > 0) {
        const detail = await adapter.getChat(chats[0].ref.sessionId);
        expect(detail.chat.ref.sessionId).toBe(chats[0].ref.sessionId);
        expect(Array.isArray(detail.messages)).toBe(true);
        for (const message of detail.messages) {
          expect(["user", "assistant"]).toContain(message.role);
          expect(typeof message.content).toBe("string");
        }
      }
    }

    // 只读断言：两次 list 结果一致，证明未发生任何创建/删除。
    const again = await catalog.listBots();
    expect(again.map((b) => b.agentId).sort()).toEqual(bots.map((b) => b.agentId).sort());
  }, 60_000);

  it("rejects invalid credential with stable authentication error", async () => {
    const catalog = createQoderBotCatalog("invalid-pat-live-probe");
    await expect(catalog.listBots()).rejects.toMatchObject({ code: "authentication" });
  }, 20_000);
});
