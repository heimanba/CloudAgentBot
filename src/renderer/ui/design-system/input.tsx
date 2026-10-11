import { forwardRef, type InputHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const inputVariants = cva(
  "block w-full border-0 type-body text-foreground outline-none transition-[background-color,box-shadow] duration-[var(--duration-enter)] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:text-muted-foreground",
  {
    variants: {
      variant: {
        default:
          "h-[var(--control-md)] rounded-[var(--radius-md)] bg-transparent px-3 shadow-[inset_0_0_0_1px_var(--input)] hover:shadow-[inset_0_0_0_1px_rgb(52_52_51/0.5)] focus-visible:shadow-[inset_0_0_0_1px_var(--input-focus)] disabled:bg-muted/60 aria-invalid:bg-destructive/[0.025] aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] aria-invalid:focus-visible:shadow-[inset_0_0_0_2px_var(--destructive)]",
        bare: "h-auto bg-transparent p-0 shadow-none hover:shadow-none focus-visible:shadow-none disabled:bg-transparent",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface InputProps
  extends InputHTMLAttributes<HTMLInputElement>, VariantProps<typeof inputVariants> {}

/**
 * Input Primitive（shadcn/ui 模式：Tailwind）。
 * 消费 Design System token；placeholder、disabled、aria 透传。
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, variant, ...rest },
  ref,
) {
  return <input ref={ref} {...rest} className={cn(inputVariants({ variant }), className)} />;
});
