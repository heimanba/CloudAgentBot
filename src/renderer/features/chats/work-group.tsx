import { useState } from "react";
import type { ChatTimelineItemView } from "@shared/models";
import { Activity } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/design-system";
import { TimelineItem } from "./timeline-item";

export function WorkGroup({
  items,
  defaultOpen = false,
}: {
  items: ChatTimelineItemView[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toolCount = items.filter((item) => item.kind === "tool-call").length;
  const delegationCount = items.filter((item) => item.kind === "delegation" && item.action === "created").length;
  const label = `${delegationCount ? `协作子任务 ${delegationCount} 个 · ` : ""}${toolCount ? `调用工具 ${toolCount} 次 · ` : ""}工作记录 ${items.length} 条`;
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-work-group>
      <CollapsibleTrigger
        className="min-h-9 type-supporting text-muted-foreground"
        aria-label={`${label}，${open ? "折叠" : "展开"}`}
      >
        <Activity className="size-[14px]" aria-hidden="true" />
        <span>{label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-4">
        <div className="border-l border-border pl-2">
          {items.map((item) => (
            <div key={`${item.id}:${item.kind}`} data-timeline-event-id={item.id}>
              <TimelineItem item={item} />
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
