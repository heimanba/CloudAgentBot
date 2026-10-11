// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { BotView, ChatView } from "@shared/models";
import type { ChatRosterBotStatus, ChatRosterItem } from "../features/chats/use-chat-roster";
import { botKey, deriveWorkspaceNavigationModel } from "./chat-navigation-model";

function bot(
  agentId: string,
  name: string,
  management: BotView["management"],
  description?: string,
): BotView {
  return { ref: { connectionId: "conn-1", agentId }, name, management, description };
}

function item(botView: BotView, sessionId: string, title: string, updatedAt?: string) {
  const chat: ChatView = { ref: { ...botView.ref, sessionId }, title, updatedAt };
  return { bot: botView, chat };
}

function statuses(entries: Array<[BotView, ChatRosterBotStatus]>) {
  return new Map(entries.map(([entry, status]) => [botKey(entry.ref), status]));
}

function model(
  bots: BotView[],
  items: ChatRosterItem[],
  chatQuery = "",
  botQuery = "",
  botStatuses = statuses(bots.map((entry) => [entry, "loaded"])),
) {
  return deriveWorkspaceNavigationModel({
    bots,
    items,
    botStatusByKey: botStatuses,
    chatQuery,
    botQuery,
  });
}

describe("deriveWorkspaceNavigationModel", () => {
  it("侧栏最近 Chat 最多显示 8 个，全部 Chat 保留完整稳定排序", () => {
    const helper = bot("agent-1", "Helper", "managed");
    const items = Array.from({ length: 10 }, (_, index) =>
      item(
        helper,
        `session-${index}`,
        `Chat ${index}`,
        `2026-09-${String(index + 1).padStart(2, "0")}T08:00:00Z`,
      ),
    );

    const result = model([helper], items);

    expect(result.recentChats).toHaveLength(8);
    expect(result.recentChats[0]!.chat.ref.sessionId).toBe("session-9");
    expect(result.recentChats[7]!.chat.ref.sessionId).toBe("session-2");
    expect(result.allChats).toHaveLength(10);
    expect(result.allChats.at(-1)!.chat.ref.sessionId).toBe("session-0");
  });

  it("Chat 搜索匹配 Chat 标题和所属 Bot，但只返回 Chat", () => {
    const product = bot("agent-product", "产品助手", "managed");
    const ops = bot("agent-ops", "运维助手", "remote-only");
    const items = [
      item(product, "s1", "需求评审讨论", "2026-09-20T08:00:00Z"),
      item(ops, "s2", "API 故障排查", "2026-09-19T08:00:00Z"),
    ];

    expect(
      model([product, ops], items, "需求").chatSearchResults.map((x) => x.chat.ref.sessionId),
    ).toEqual(["s1"]);
    expect(
      model([product, ops], items, "运维助手").chatSearchResults.map((x) => x.chat.ref.sessionId),
    ).toEqual(["s2"]);
  });

  it("Bot 搜索只返回 Bot，并派生可靠的 Chat 数量和加载状态", () => {
    const product = bot("agent-product", "产品助手", "managed", "产品规划");
    const ops = bot("agent-ops", "运维助手", "remote-only", "故障排查");
    const failing = bot("agent-failing", "写作助手", "state-missing");
    const result = model(
      [product, ops, failing],
      [item(product, "s1", "A"), item(product, "s2", "B"), item(ops, "s3", "C")],
      "",
      "助手",
      statuses([
        [product, "loaded"],
        [ops, "loading"],
        [failing, "error"],
      ]),
    );

    expect(result.botSearchResults.map((entry) => entry.bot.name)).toEqual([
      "产品助手",
      "写作助手",
      "运维助手",
    ]);
    expect(result.botRows.find((entry) => entry.bot === product)).toMatchObject({
      chatCount: 2,
      chatStatus: "loaded",
    });
    expect(result.botRows.find((entry) => entry.bot === ops)).toMatchObject({
      chatCount: 1,
      chatStatus: "loading",
    });
    expect(result.botRows.find((entry) => entry.bot === failing)).toMatchObject({
      chatCount: null,
      chatStatus: "error",
    });
  });

  it("Chat identity 仍包含 Connection，跨 Connection 的同 Agent ID 不相互覆盖", () => {
    const left = {
      ...bot("same", "Left", "managed"),
      ref: { connectionId: "left", agentId: "same" },
    };
    const right = {
      ...bot("same", "Right", "managed"),
      ref: { connectionId: "right", agentId: "same" },
    };
    const result = model([left, right], [item(left, "s1", "Left Chat")]);

    expect(result.botRows.find((entry) => entry.bot === left)?.chatCount).toBe(1);
    expect(result.botRows.find((entry) => entry.bot === right)?.chatCount).toBe(0);
  });
});
