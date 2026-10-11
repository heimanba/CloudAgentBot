import { forwardRef, type ComponentProps } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export const PopoverContent = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, align = "center", sideOffset = 6, ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        {...props}
        className={cn(
          "z-50 rounded-[var(--radius-lg)] border border-border/80 bg-popover text-popover-foreground shadow-[var(--shadow-popover)] outline-none data-[state=open]:motion-safe:animate-[surface-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]",
          className,
        )}
      />
    </PopoverPrimitive.Portal>
  );
});
