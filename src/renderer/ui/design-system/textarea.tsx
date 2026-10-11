import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const textareaVariants = cva(
  "block w-full resize-none border-0 type-body text-foreground outline-none transition-[background-color,box-shadow] duration-[var(--duration-enter)] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:text-muted-foreground",
  {
    variants: {
      variant: {
        default:
          "min-h-[var(--control-md)] rounded-[var(--radius-md)] bg-transparent px-3 py-2 shadow-[inset_0_0_0_1px_var(--input)] hover:shadow-[inset_0_0_0_1px_rgb(52_52_51/0.5)] focus-visible:shadow-[inset_0_0_0_1px_var(--input-focus)] disabled:bg-muted/60 aria-invalid:bg-destructive/[0.025] aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] aria-invalid:focus-visible:shadow-[inset_0_0_0_2px_var(--destructive)]",
        bare: "bg-transparent p-0 shadow-none hover:shadow-none focus-visible:shadow-none disabled:bg-transparent",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>, VariantProps<typeof textareaVariants> {}

/**
 * Textarea Primitive（shadcn/ui 模式：Tailwind）。
 * 消费 Design System token；placeholder、disabled、aria 透传。
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, variant, ...rest },
  ref,
) {
  return <textarea ref={ref} {...rest} className={cn(textareaVariants({ variant }), className)} />;
});
