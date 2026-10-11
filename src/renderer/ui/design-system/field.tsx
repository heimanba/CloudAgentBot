import { forwardRef, type HTMLAttributes, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type FieldProps = HTMLAttributes<HTMLDivElement>;

/**
 * 字段容器：垂直堆叠 label 与控件，保持组内间距。
 * 不识别产品概念，只提供布局与语义关联。
 */
export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  { className, ...rest },
  ref,
) {
  return <div ref={ref} {...rest} className={cn("flex flex-col gap-2", className)} />;
});

export type FieldLabelProps = LabelHTMLAttributes<HTMLLabelElement>;

/** 字段标签：关联控件 id，消费 token 字体与颜色。 */
export const FieldLabel = forwardRef<HTMLLabelElement, FieldLabelProps>(function FieldLabel(
  { className, ...rest },
  ref,
) {
  return <label ref={ref} {...rest} className={cn("type-control text-foreground/85", className)} />;
});

export type FieldDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

/** 字段说明：辅助文本，消费 muted-foreground。 */
export const FieldDescription = forwardRef<HTMLParagraphElement, FieldDescriptionProps>(
  function FieldDescription({ className, ...rest }, ref) {
    return (
      <p
        ref={ref}
        {...rest}
        className={cn("m-0 type-supporting text-muted-foreground", className)}
      />
    );
  },
);
