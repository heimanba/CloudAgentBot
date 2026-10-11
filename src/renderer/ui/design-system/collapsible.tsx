import { forwardRef, type ComponentProps } from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const Collapsible = CollapsiblePrimitive.Root;

export const CollapsibleTrigger = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof CollapsiblePrimitive.Trigger>
>(function CollapsibleTrigger({ className, children, ...props }, ref) {
  return (
    <CollapsiblePrimitive.Trigger
      ref={ref}
      {...props}
      className={cn(
        "group/collapsible flex w-full cursor-pointer items-center gap-[9px] rounded-[var(--radius-md)] border-0 bg-transparent px-3 py-2.5 text-left text-inherit transition-[color,background-color,border-color,box-shadow] duration-[var(--duration-fast)] hover:bg-surface-hover focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/20",
        className,
      )}
    >
      <ChevronRight
        className="size-[12px] shrink-0 text-muted-foreground transition-transform duration-[var(--duration-fast)] group-data-[state=open]/collapsible:rotate-90"
        aria-hidden="true"
      />
      {children}
    </CollapsiblePrimitive.Trigger>
  );
});

export const CollapsibleContent = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof CollapsiblePrimitive.Content>
>(function CollapsibleContent({ className, ...props }, ref) {
  return <CollapsiblePrimitive.Content ref={ref} {...props} className={className} />;
});
