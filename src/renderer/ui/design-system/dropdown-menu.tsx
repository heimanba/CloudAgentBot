import { forwardRef, type ComponentProps } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        {...props}
        className={cn(
          "z-50 min-w-[140px] overflow-hidden rounded-[var(--radius-lg)] border border-border/80 bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-popover)] outline-none data-[state=open]:motion-safe:animate-[surface-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]",
          className,
        )}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof DropdownMenuPrimitive.Item>
>(function DropdownMenuItem({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      {...props}
      className={cn(
        "relative flex min-h-[var(--control-sm)] cursor-default select-none items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 type-supporting outline-none max-md:min-h-[var(--control-lg)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-secondary data-[highlighted]:text-foreground [&_svg]:size-[14px] [&_svg]:shrink-0",
        className,
      )}
    />
  );
});
