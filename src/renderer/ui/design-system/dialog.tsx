import { forwardRef, type ComponentProps } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogContent = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof DialogPrimitive.Content>
>(function DialogContent({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-surface-overlay backdrop-blur-[5px] data-[state=open]:motion-safe:animate-[surface-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]" />
      <DialogPrimitive.Content
        ref={ref}
        {...props}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[min(506px,calc(100vh-76px))] w-full max-w-[min(506px,calc(100vw-28px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border/80 bg-card shadow-[var(--shadow-popover)] outline-none data-[state=open]:motion-safe:animate-[surface-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]",
          className,
        )}
      />
    </DialogPrimitive.Portal>
  );
});
