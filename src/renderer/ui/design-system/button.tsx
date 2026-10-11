import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// secondary 是统一的次按钮；outline 保留为兼容别名，避免业务调用方重复维护视觉层级。
const secondaryStyle =
  "bg-card text-secondary-foreground border-button-border not-disabled:hover:bg-button-hover not-disabled:hover:border-button-border-hover not-disabled:active:bg-button-active";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] border border-transparent font-medium transition-[background-color,color,border-color,box-shadow] duration-[var(--duration-fast)] select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:not-aria-busy:bg-button-disabled disabled:not-aria-busy:text-muted-foreground disabled:not-aria-busy:border-button-border motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground not-disabled:hover:bg-primary-hover not-disabled:active:bg-button-primary-active",
        secondary: secondaryStyle,
        outline: secondaryStyle,
        ghost: "bg-transparent text-foreground not-disabled:hover:bg-button-hover not-disabled:active:bg-button-active",
        destructive: "bg-destructive text-destructive-foreground not-disabled:hover:bg-button-destructive-hover not-disabled:active:bg-button-destructive-active",
      },
      size: {
        default: "h-[var(--control-md)] px-4 type-control",
        sm: "h-[var(--control-sm)] px-3 type-supporting",
        icon: "h-[var(--control-sm)] w-[var(--control-sm)] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** 提交/发送中：显示加载指示并禁用。调用方仍负责提供提交中的具体文案。 */
  pending?: boolean;
  /** 将 Button 样式合并到子元素上，用于 Link 或 Radix Primitive 子元素。 */
  asChild?: boolean;
}

/**
 * Button Primitive（shadcn/ui 模式：Tailwind + CVA + Radix Slot）。
 * 消费 Design System token；不识别产品概念。
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, pending = false, disabled, asChild = false, children, ...rest },
  ref,
) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      ref={ref}
      {...rest}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={Boolean(disabled || pending)}
      aria-busy={pending ? "true" : undefined}
    >
      {pending && !asChild ? (
        <>
          <Loader2 className="size-[12px] animate-spin" aria-hidden="true" />
          {children}
        </>
      ) : (
        children
      )}
    </Component>
  );
});
