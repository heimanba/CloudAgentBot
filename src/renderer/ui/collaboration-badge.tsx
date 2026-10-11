import type { CollaborationRosterView } from "@shared/models";

/** 只表示远程配置或 Session 快照非空，不代表本次实际委派。 */
export function CollaborationBadge({
  roster,
  label = "协作",
}: {
  roster?: CollaborationRosterView;
  label?: string;
}) {
  if (!roster?.memberAgentIds.length) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-[var(--radius-sm)] bg-surface-subtle px-1.5 py-0.5 type-caption font-medium text-muted-foreground">
      {label}
    </span>
  );
}
