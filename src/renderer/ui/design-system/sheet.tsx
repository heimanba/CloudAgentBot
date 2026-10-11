import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * shadcn/ui Sheet 官方结构，经项目 theme token 适配。
 * Root/Trigger/Portal/Overlay/Content/Close 保持官方组合；Feature 不自制 focus trap。
 */

type SheetTriggerElement = React.ElementRef<typeof SheetPrimitive.Trigger>;
const SheetTriggerRefContext =
  React.createContext<React.RefObject<SheetTriggerElement | null> | null>(null);

function setForwardedRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

export function Sheet({
  onOpenChange,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root>) {
  const triggerRef = React.useRef<SheetTriggerElement>(null);
  return (
    <SheetTriggerRefContext.Provider value={triggerRef}>
      <SheetPrimitive.Root
        data-slot="sheet"
        onOpenChange={(open) => {
          onOpenChange?.(open);
          if (!open) {
            setTimeout(() => triggerRef.current?.focus(), 0);
          }
        }}
        {...props}
      />
    </SheetTriggerRefContext.Provider>
  );
}

export function SheetTrigger({
  ref,
  onClick,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  const triggerRef = React.useContext(SheetTriggerRefContext);
  return (
    <SheetPrimitive.Trigger
      ref={(node) => {
        if (triggerRef) triggerRef.current = node;
        setForwardedRef(ref, node);
      }}
      onClick={(event) => {
        if (triggerRef) triggerRef.current = event.currentTarget;
        onClick?.(event);
      }}
      data-slot="sheet-trigger"
      {...props}
    />
  );
}

export function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal(props: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-surface-overlay",
        "data-[state=open]:motion-safe:animate-[surface-fade-in_var(--duration-sheet-enter)_cubic-bezier(0.32,0.72,0,1)_both]",
        "data-[state=closed]:motion-safe:animate-[surface-fade-out_var(--duration-sheet-exit)_cubic-bezier(0.4,0,1,1)_both]",
        className,
      )}
      {...props}
    />
  );
}

export interface SheetContentProps extends React.ComponentProps<typeof SheetPrimitive.Content> {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
}

export function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  onCloseAutoFocus,
  ...props
}: SheetContentProps) {
  const triggerRef = React.useContext(SheetTriggerRefContext);
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-card text-card-foreground shadow-[var(--shadow-popover)] outline-none",
          "will-change-transform",
          side === "right" &&
            "inset-y-0 right-0 h-full w-3/4 border-l data-[state=open]:motion-safe:animate-[sheet-right-in_var(--duration-sheet-enter)_cubic-bezier(0.32,0.72,0,1)_both] data-[state=closed]:motion-safe:animate-[sheet-right-out_var(--duration-sheet-exit)_cubic-bezier(0.4,0,1,1)_both] sm:max-w-sm",
          side === "left" &&
            "inset-y-0 left-0 h-full w-3/4 border-r data-[state=open]:motion-safe:animate-[sheet-left-in_var(--duration-sheet-enter)_cubic-bezier(0.32,0.72,0,1)_both] data-[state=closed]:motion-safe:animate-[sheet-left-out_var(--duration-sheet-exit)_cubic-bezier(0.4,0,1,1)_both] sm:max-w-sm",
          side === "top" &&
            "inset-x-0 top-0 h-auto border-b data-[state=open]:motion-safe:animate-[sheet-top-in_var(--duration-sheet-enter)_cubic-bezier(0.32,0.72,0,1)_both] data-[state=closed]:motion-safe:animate-[sheet-top-out_var(--duration-sheet-exit)_cubic-bezier(0.4,0,1,1)_both]",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto border-t data-[state=open]:motion-safe:animate-[sheet-bottom-in_var(--duration-sheet-enter)_cubic-bezier(0.32,0.72,0,1)_both] data-[state=closed]:motion-safe:animate-[sheet-bottom-out_var(--duration-sheet-exit)_cubic-bezier(0.4,0,1,1)_both]",
          className,
        )}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (!event.defaultPrevented && triggerRef?.current) {
            event.preventDefault();
            triggerRef.current.focus();
          }
        }}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close
            className="absolute right-3 top-3 grid size-[var(--control-sm)] place-items-center rounded-[var(--radius-sm)] text-muted-foreground opacity-70 transition-opacity duration-[var(--duration-fast)] hover:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20"
            aria-label="关闭"
          >
            <X className="size-[14px]" aria-hidden="true" />
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  );
}

export function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("type-section-title font-semibold text-foreground", className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("type-supporting text-muted-foreground", className)}
      {...props}
    />
  );
}
