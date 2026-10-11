import type { ChatTimelineItemView } from "@shared/models";

export interface ChatAnchor {
  id: string;
  label: string;
  kind: "user" | "failure" | "artifact" | "assistant";
}

export function deriveChatAnchors(items: ChatTimelineItemView[]): ChatAnchor[] {
  const anchors: ChatAnchor[] = [];
  for (const item of items) {
    if (item.kind === "message" && item.role === "user")
      anchors.push({ id: item.id, label: item.content.slice(0, 60) || "用户消息", kind: "user" });
    else if (item.kind === "message" && item.role === "assistant")
      anchors.push({
        id: item.id,
        label: item.content.slice(0, 60) || "助手回复",
        kind: "assistant",
      });
    else if (item.kind === "error")
      anchors.push({
        id: item.id,
        label: item.message.slice(0, 60) || "运行错误",
        kind: "failure",
      });
    else if (item.kind === "tool-result" && item.isError)
      anchors.push({ id: item.id, label: "工具执行失败", kind: "failure" });
    else if (item.kind === "artifact")
      anchors.push({ id: item.id, label: item.filename, kind: "artifact" });
  }
  return anchors;
}
