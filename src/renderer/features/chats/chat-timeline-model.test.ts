import { describe, expect, it } from "vitest";
import type { ChatTimelineItemView } from "@shared/models";
import { deriveTimelineNodes, mergePersistedAndLiveTimeline } from "./chat-timeline-model";

const call = (id: string, threadId?: string): ChatTimelineItemView => ({
  id,
  rawType: "tool_call",
  kind: "tool-call",
  name: "read",
  ...(threadId ? { threadId } : {}),
});
const message = (id: string): ChatTimelineItemView => ({
  id,
  rawType: "user.message",
  kind: "message",
  role: "user",
  content: id,
});

describe("mergePersistedAndLiveTimeline", () => {
  const persisted: ChatTimelineItemView[] = [{
    id: "old-message",
    rawType: "user.message",
    kind: "message",
    role: "user",
    content: "same message",
  }];
  const live: ChatTimelineItemView[] = [{
    id: "pending-message",
    rawType: "user.message",
    kind: "message",
    role: "user",
    content: "same message",
    attachments: [{ fileId: "file-1", kind: "file", filename: "AGENTS.md" }],
  }];

  it("keeps a same-content optimistic message visible while sending", () => {
    expect(mergePersistedAndLiveTimeline(persisted, live)).toEqual([...persisted, ...live]);
  });

  it("reconciles optimistic attachments after refreshed history arrives", () => {
    const refreshed = [{ ...persisted[0], id: "new-message" }];

    expect(mergePersistedAndLiveTimeline(refreshed, live, true)).toEqual([
      {
        ...refreshed[0],
        attachments: [{ fileId: "file-1", kind: "file", filename: "AGENTS.md" }],
      },
    ]);
  });

  it("does not mix attachments from consecutive same-content messages", () => {
    const persistedMessage = persisted[0] as Extract<ChatTimelineItemView, { kind: "message" }>;
    const liveMessage = live[0] as Extract<ChatTimelineItemView, { kind: "message" }>;
    const persistedMessages: ChatTimelineItemView[] = [
      { ...persistedMessage, id: "remote-1", attachments: [{ fileId: "file-1", kind: "file", filename: "AGENTS.md" }] },
      { ...persistedMessage, id: "remote-2", attachments: [{ fileId: "file-2", kind: "file", filename: "lerna.json" }] },
    ];
    const liveMessages: ChatTimelineItemView[] = [
      liveMessage,
      { ...liveMessage, id: "pending-2", attachments: [{ fileId: "file-2", kind: "file", filename: "lerna.json" }] },
    ];

    expect(mergePersistedAndLiveTimeline(persistedMessages, liveMessages, true)).toEqual(persistedMessages);
  });

  it("keeps a completed streamed answer until refreshed history contains it", () => {
    const assistant: ChatTimelineItemView = {
      id: "pending-assistant",
      rawType: "agent.message",
      kind: "message",
      role: "assistant",
      content: "answer",
    };
    expect(mergePersistedAndLiveTimeline([], [assistant], true)).toEqual([assistant]);
    expect(mergePersistedAndLiveTimeline([{
      ...assistant,
      id: "remote-assistant",
    }], [assistant], true)).toEqual([{
      ...assistant,
      id: "remote-assistant",
    }]);
  });
});

describe("deriveTimelineNodes", () => {
  it("groups adjacent work but keeps messages and failures visible", () => {
    const nodes = deriveTimelineNodes([
      message("m1"),
      call("c1", "t1"),
      call("c2", "t1"),
      { id: "e1", rawType: "tool_result", kind: "tool-result", content: "failed", isError: true },
      call("c3", "t1"),
      message("m2"),
    ]);
    expect(nodes.map((node) => node.kind)).toEqual([
      "event",
      "work-group",
      "event",
      "event",
      "event",
    ]);
    expect(nodes[1].kind === "work-group" && nodes[1].items.map((item) => item.id)).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("does not combine different Thread IDs", () => {
    expect(deriveTimelineNodes([call("a", "t1"), call("b", "t2")])).toHaveLength(2);
    expect(deriveTimelineNodes([call("a"), call("b")])[0].kind).toBe("work-group");
  });

  it("keeps a child Thread handoff and reply in one chronological work group", () => {
    const delegation = (id: string, action: "created" | "sent" | "received", threadId: string): ChatTimelineItemView => ({
      id, rawType: `thread_${action}`, kind: "delegation", action, threadId,
    });
    const nodes = deriveTimelineNodes([
      message("request"),
      delegation("created", "created", "child"),
      call("child-work", "child"),
      delegation("sent", "sent", "main"),
      call("coordinator-work", "main"),
      delegation("received", "received", "child"),
      message("answer"),
    ]);
    expect(nodes.map((node) => node.kind)).toEqual(["event", "work-group", "event"]);
    expect(nodes[1].kind === "work-group" && nodes[1].items.map((item) => item.id)).toEqual([
      "created", "child-work", "sent", "coordinator-work", "received",
    ]);
  });
});
