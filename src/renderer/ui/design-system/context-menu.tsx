import { forwardRef, type ComponentProps } from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "@/lib/utils";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export const ContextMenuContent = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof ContextMenuPrimitive.Content>
>(function ContextMenuContent({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        ref={ref}
        {...props}
        className={cn(
          "z-50 min-w-[140px] overflow-hidden rounded-[var(--radius-md)] border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-popover)] outline-none data-[state=open]:motion-safe:animate-[surface-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]",
          className,
        )}
      />
    </ContextMenuPrimitive.Portal>
  );
});

export const ContextMenuItem = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof ContextMenuPrimitive.Item>
>(function ContextMenuItem({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Item
      ref={ref}
      {...props}
      className={cn(
        "relative flex min-h-[var(--control-sm)] cursor-default select-none items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 type-supporting outline-none max-md:min-h-[var(--control-lg)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-secondary data-[highlighted]:text-foreground [&_svg]:size-[14px] [&_svg]:shrink-0",
        className,
      )}
    />
  );
});
