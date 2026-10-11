import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
} from "../../ui/design-system";
import {
  availableBuiltinTools,
  BAILIAN_BUILTIN_TOOL_DESCRIPTIONS,
  BUILTIN_TOOL_LABELS,
} from "@shared/builtin-tools";

export function BotBuiltinTools({
  provider,
  value,
  disabled,
  onChange,
}: {
  provider: string;
  value: string[] | undefined;
  disabled: boolean;
  onChange(value: string[]): void;
}) {
  const triggerId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const available = availableBuiltinTools(provider);
  const selected = value ?? [];
  const unrecognized = value?.filter((tool) => !available.includes(tool)) ?? [];
  const blocked = disabled || unrecognized.length > 0;

  return (
    <Field>
      <FieldLabel htmlFor={triggerId}>内置工具</FieldLabel>
      <Button
        id={triggerId}
        type="button"
        variant="outline"
        className="h-auto min-h-[var(--control-lg)] w-full justify-between px-3 py-2.5 text-left"
        aria-label="选择内置工具"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={blocked}
        onClick={() => {
          setDraft([...selected]);
          setOpen(true);
        }}
      >
        <span className="min-w-0">
          <span className="block truncate type-control">
            {value === undefined
              ? "使用 Provider 默认设置"
              : selected.length === 0
                ? "未启用内置工具"
                : `已启用 ${selected.length} 个内置工具`}
          </span>
          <span className="block type-caption text-muted-foreground">
            {value === undefined ? "勾选工具后将显式覆盖默认设置" : "点击查看或调整工具"}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Button>
      {unrecognized.length > 0 ? (
        <FieldDescription>
          现有配置包含当前版本未开放的工具（{unrecognized.join("、")}），工具集合保持原样。
        </FieldDescription>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[min(720px,calc(100vh-32px))] max-w-[min(680px,calc(100vw-28px))]">
          <div className="border-b border-border px-6 py-5">
            <DialogTitle className="type-section-title">选择内置工具</DialogTitle>
            <DialogDescription className="mt-1 type-supporting text-muted-foreground">
              按当前 Bot 的需要选择工具，确认后随 Bot 一起保存并同步。
            </DialogDescription>
            <p className="mt-2 mb-0 type-caption text-muted-foreground">
              已选择 {draft.length}/{available.length} 个工具
            </p>
          </div>
          <div className="min-h-0 overflow-y-auto px-6 py-2">
            <div className="divide-y divide-border">
              {available.map((tool) => {
                const detail = BUILTIN_TOOL_LABELS[tool]!;
                const label = provider === "bailian" ? tool : detail.label;
                return (
                  <label
                    key={tool}
                    className="flex min-h-[52px] cursor-pointer items-center gap-3 py-2"
                  >
                    <Checkbox
                      checked={draft.includes(tool)}
                      onCheckedChange={(checked) =>
                        setDraft(
                          checked === true
                            ? available.filter((name) => draft.includes(name) || name === tool)
                            : draft.filter((name) => name !== tool),
                        )
                      }
                      aria-label={label}
                    />
                    <span className="w-36 shrink-0 type-control">{label}</span>
                    <span className="type-supporting text-muted-foreground">
                      {provider === "bailian"
                        ? BAILIAN_BUILTIN_TOOL_DESCRIPTIONS[tool]
                        : detail.description}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (value === undefined || JSON.stringify(draft) !== JSON.stringify(selected)) {
                  onChange(draft);
                }
                setOpen(false);
              }}
            >
              确认选择（{draft.length}）
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Field>
  );
}
