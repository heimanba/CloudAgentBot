import { expect, it } from "vitest";
import type { ChatTimelineItemView } from "@shared/models";
import { deriveChatAnchors } from "./chat-anchors";

it("keeps user messages, failures, artifacts and assistant replies as navigation anchors", () => {
  const items: ChatTimelineItemView[] = [
    { id: "u", rawType: "user.message", kind: "message", role: "user", content: "开始" },
    { id: "e", rawType: "tool_result", kind: "tool-result", content: "failed", isError: true },
    { id: "a", rawType: "artifact", kind: "artifact", filename: "report.md", fileId: "f" },
    { id: "r", rawType: "agent.message", kind: "message", role: "assistant", content: "完成" },
  ];
  expect(deriveChatAnchors(items).map((anchor) => anchor.kind)).toEqual([
    "user",
    "failure",
    "artifact",
    "assistant",
  ]);
});
