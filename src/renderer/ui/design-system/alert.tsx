import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "flex items-start gap-3 rounded-[var(--radius-lg)] border px-4 py-3 type-control",
  {
    variants: {
      variant: {
        default: "border-border/80 bg-muted/55 text-foreground",
        warning: "border-foreground/10 bg-muted/70 text-warning-foreground",
        success: "border-foreground/10 bg-muted/70 text-success-foreground",
        destructive: "border-destructive/20 bg-destructive/[0.055] text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type AlertVariant = NonNullable<VariantProps<typeof alertVariants>["variant"]>;

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  title?: string;
}

const ICONS: Record<AlertVariant, typeof Info> = {
  default: Info,
  warning: TriangleAlert,
  success: Check,
  destructive: X,
};

/**
 * Alert Primitive（shadcn/ui 模式：Tailwind + CVA + lucide 图标）。
 * 统一状态说明：颜色、图标、边框由 Primitive 拥有；Feature 只提供文案与动作。
 */
export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { className, variant = "default", title, children, ...rest },
  ref,
) {
  const Icon = ICONS[variant ?? "default"];
  return (
    <div ref={ref} role="alert" {...rest} className={cn(alertVariants({ variant }), className)}>
      <Icon className="mt-0.5 size-[14px] shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title !== undefined ? <div className="mb-0.5 font-semibold">{title}</div> : null}
        <p className="m-0 opacity-90">{children}</p>
      </div>
    </div>
  );
});
