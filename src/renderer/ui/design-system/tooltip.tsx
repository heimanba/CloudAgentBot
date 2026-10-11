import { forwardRef, type ComponentProps } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        {...props}
        className={cn(
          "z-50 rounded-[var(--radius-sm)] bg-foreground px-2 py-1 type-caption text-background shadow-[var(--shadow-popover)] data-[state=delayed-open]:motion-safe:animate-[surface-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]",
          className,
        )}
      />
    </TooltipPrimitive.Portal>
  );
});
