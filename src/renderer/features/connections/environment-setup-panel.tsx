import { useState } from "react";
import type { EnvironmentCandidate } from "@shared/models";
import { Button, RadioGroup, RadioGroupItem } from "../../ui/design-system";

export interface EnvironmentSetupPanelProps {
  candidates: EnvironmentCandidate[];
  onSelect(environmentId: string): void;
  pending: boolean;
  showHeader?: boolean;
}

/**
 * 环境选择面板：多环境歧义时由用户显式选择一个运行环境。
 * 无跳过出口；计划 §4.1 要求设置成功才进入工作区，取消由外层 Dialog 的关闭控制。
 */
export function EnvironmentSetupPanel({
  candidates,
  onSelect,
  pending,
  showHeader = true,
}: EnvironmentSetupPanelProps) {
  const preferredId =
    candidates.find((candidate) => candidate.name === "Agents/base")?.environmentId ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(preferredId);

  return (
    <div className="grid gap-4">
      {showHeader ? (
        <div>
          <h4 className="m-0 type-body font-medium">选择运行环境</h4>
          <p className="mt-1 mb-0 type-supporting text-muted-foreground">
            Bot 和 Chat 将在选定的云端运行环境中执行。
          </p>
        </div>
      ) : null}
      <div className="max-h-[280px] overflow-y-auto pr-1" aria-label="可选运行环境" tabIndex={0}>
        <RadioGroup value={selectedId ?? ""} onValueChange={setSelectedId}>
          {candidates.map((env) => (
            <label
              key={env.environmentId}
              className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border px-3 py-2.5 cursor-pointer transition-colors hover:bg-surface-hover"
            >
              <RadioGroupItem value={env.environmentId} />
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate type-control">{env.name}</span>
                <span className="truncate font-mono type-caption text-muted-foreground">
                  {env.environmentId}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={selectedId === null || pending}
          pending={pending}
          onClick={() => {
            if (selectedId !== null) onSelect(selectedId);
          }}
        >
          {pending ? "设置中…" : "使用选定环境"}
        </Button>
      </div>
    </div>
  );
}
