import { useEffect, useRef, useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { cn } from "../../lib/utils";
import { getDesktopHost } from "../../desktop-host";

export interface CopyActionProps extends Omit<ButtonProps, "children" | "onClick"> {
  value: string;
  label?: string;
}

type CopyState = "idle" | "copied" | "failed";

/**
 * 统一的轻量复制反馈。调用方拥有内容语义与布局，本组件只封装剪贴板交互。
 */
export function CopyAction({ value, label = "复制", className, ...props }: CopyActionProps) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const accessibleLabel = state === "copied" ? "已复制" : state === "failed" ? "复制失败" : label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          {...props}
          type="button"
          size="icon"
          variant="ghost"
          className={cn("size-8 text-muted-foreground", className)}
          aria-label={accessibleLabel}
          onClick={async () => {
            if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
            try {
              await getDesktopHost().app.copyText(value);
              setState("copied");
            } catch {
              setState("failed");
            }
            resetTimer.current = window.setTimeout(() => setState("idle"), 1800);
          }}
        >
          {state === "copied" ? (
            <Check className="size-[14px]" aria-hidden="true" />
          ) : state === "failed" ? (
            <TriangleAlert className="size-[14px]" aria-hidden="true" />
          ) : (
            <Copy className="size-[14px]" aria-hidden="true" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{accessibleLabel}</TooltipContent>
    </Tooltip>
  );
}
