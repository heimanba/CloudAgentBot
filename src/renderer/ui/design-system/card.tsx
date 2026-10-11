import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type CardProps = HTMLAttributes<HTMLDivElement>;

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      {...rest}
      className={cn(
        "rounded-[var(--radius-xl)] border border-border/80 bg-card text-card-foreground shadow-[var(--shadow-card)]",
        className,
      )}
    />
  );
});
