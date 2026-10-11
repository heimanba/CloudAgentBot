import { RefreshCw } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export interface RefreshActionProps {
  label: string;
  refreshing?: boolean;
  mode?: "icon" | "menu";
  onRefresh(): void;
}

/** 统一的只读数据刷新动作：紧凑图标或菜单项，不承载产品领域语义。 */
export function RefreshAction({
  label,
  refreshing = false,
  mode = "icon",
  onRefresh,
}: RefreshActionProps) {
  const action = (
    <Button
      type="button"
      size={mode === "icon" ? "icon" : "sm"}
      variant="ghost"
      className={cn(mode === "menu" && "w-full justify-start")}
      aria-label={label}
      disabled={refreshing}
      onClick={onRefresh}
    >
      <RefreshCw className={cn("size-[14px]", refreshing && "animate-spin")} aria-hidden="true" />
      {mode === "menu" ? <span>{refreshing ? "刷新中…" : label}</span> : null}
    </Button>
  );

  if (mode === "menu") return action;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{action}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
