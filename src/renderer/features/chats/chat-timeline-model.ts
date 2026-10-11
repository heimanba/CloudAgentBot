import type { ChatTimelineItemView } from "@shared/models";

export type TimelineNode =
  | { kind: "event"; key: string; item: ChatTimelineItemView }
  | { kind: "work-group"; key: string; items: ChatTimelineItemView[] };

export function mergePersistedAndLiveTimeline(
  persisted: ChatTimelineItemView[],
  live: ChatTimelineItemView[],
  reconcilePendingByContent = false,
): ChatTimelineItemView[] {
  const merged = [...persisted];
  const consumedLive = new Set<number>();
  const claimedPersisted = new Set<number>();

  live.forEach((liveItem, liveIndex) => {
    if (liveItem.kind !== "message") return;
    let persistedIndex = merged.findIndex(
      (item) => item.kind === "message" && item.role === liveItem.role && item.id === liveItem.id,
    );
    if (persistedIndex < 0 && reconcilePendingByContent) {
      const candidates = merged.flatMap((item, index) =>
        item.kind === "message" &&
        item.role === liveItem.role &&
        item.content === liveItem.content &&
        !claimedPersisted.has(index)
          ? [index]
          : [],
      );
      const liveAttachmentIds = new Set(
        (liveItem.attachments ?? []).map((attachment) => attachment.fileId),
      );
      persistedIndex = candidates.find((index) => {
        const item = merged[index];
        return item.kind === "message" && item.attachments?.some(
          (attachment) => liveAttachmentIds.has(attachment.fileId),
        );
      }) ?? candidates.at(-1) ?? -1;
    }
    if (persistedIndex < 0) return;
    const persistedItem = merged[persistedIndex];
    if (persistedItem.kind !== "message") return;
    claimedPersisted.add(persistedIndex);
    if (liveItem.attachments?.length) {
      const existingIds = new Set(
        (persistedItem.attachments ?? []).map((attachment) => attachment.fileId),
      );
      merged[persistedIndex] = {
        ...persistedItem,
        attachments: [
          ...(persistedItem.attachments ?? []),
          ...liveItem.attachments.filter((attachment) => !existingIds.has(attachment.fileId)),
        ],
      };
    }
    consumedLive.add(liveIndex);
  });

  const seen = new Set<string>();
  return [...merged, ...live.filter((_, index) => !consumedLive.has(index))].filter((item) => {
    const identity = `${item.id}:${item.kind}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function groupable(item: ChatTimelineItemView): boolean {
  return (
    item.kind === "thinking" ||
    item.kind === "delegation" ||
    item.kind === "tool-call" ||
    (item.kind === "tool-result" && !item.isError) ||
    item.kind === "status" ||
    (item.kind === "usage" && !item.isError)
  );
}

/** 只改变当前 Renderer 的展示形状，事件顺序和内容始终来自 Provider。 */
export function deriveTimelineNodes(items: ChatTimelineItemView[]): TimelineNode[] {
  const nodes: TimelineNode[] = [];
  let pending: ChatTimelineItemView[] = [];
  const flush = () => {
    if (pending.length === 1) {
      const item = pending[0];
      nodes.push({ kind: "event", key: `${item.id}:${item.kind}`, item });
    } else if (pending.length > 1) {
      nodes.push({ kind: "work-group", key: `work:${pending[0].id}`, items: pending });
    }
    pending = [];
  };
  for (const item of items) {
    if (groupable(item)) {
      // 协作事件可能由 coordinator 与 child Thread 交替写入。同一段连续工作
      // 保持原始时间顺序放在一个折叠组，避免发送和回传被拆成两处。
      const collaborationBurst = item.kind === "delegation" || pending.some((entry) => entry.kind === "delegation");
      if (pending.length > 0 && pending[0].threadId !== item.threadId && !collaborationBurst) flush();
      pending.push(item);
    } else {
      flush();
      nodes.push({ kind: "event", key: `${item.id}:${item.kind}`, item });
    }
  }
  flush();
  return nodes;
}
