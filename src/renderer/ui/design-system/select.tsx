import { forwardRef, type ComponentProps, type ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: ReactNode;
}

export interface SelectProps {
  id?: string;
  className?: string;
  value?: string;
  onValueChange?(value: string): void;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  options: SelectOption[];
}

/**
 * Select Primitive（shadcn/ui 模式：Radix Select）。
 * 提供键盘导航、焦点管理与 portal 定位；消费 Design System token。
 */
export function Select({
  id,
  className,
  value,
  onValueChange,
  placeholder,
  disabled,
  options,
  ...rest
}: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={rest["aria-label"]}
        aria-invalid={rest["aria-invalid"]}
        className={cn(
          "flex h-[var(--control-md)] w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border-0 bg-transparent px-3 type-body text-foreground shadow-[inset_0_0_0_1px_var(--input)] outline-none transition-[background-color,box-shadow] duration-[var(--duration-enter)] hover:shadow-[inset_0_0_0_1px_rgb(52_52_51/0.5)] focus-visible:shadow-[inset_0_0_0_1px_var(--input-focus)] disabled:cursor-not-allowed disabled:bg-muted/60 disabled:text-muted-foreground data-[placeholder]:text-muted-foreground aria-invalid:bg-destructive/[0.025] aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] aria-invalid:focus-visible:shadow-[inset_0_0_0_2px_var(--destructive)]",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-[14px] opacity-60" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-[252px] min-w-[var(--radix-select-trigger-width)] overflow-y-auto rounded-[var(--radius-lg)] border border-border/80 bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-popover)] outline-none data-[state=open]:motion-safe:animate-[surface-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

const SelectItem = forwardRef<HTMLDivElement, ComponentProps<typeof SelectPrimitive.Item>>(
  function SelectItem({ className, children, ...props }, ref) {
    return (
      <SelectPrimitive.Item
        ref={ref}
        {...props}
        className={cn(
          "relative flex min-h-[var(--control-sm)] cursor-default select-none items-center gap-2 rounded-[var(--radius-sm)] py-1.5 pl-3 pr-8 type-supporting outline-none max-md:min-h-[var(--control-lg)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-secondary data-[highlighted]:text-foreground [&_svg]:size-[14px] [&_svg]:shrink-0",
          className,
        )}
      >
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        <span className="absolute right-2 flex size-[14px] items-center justify-center">
          <SelectPrimitive.ItemIndicator>
            <Check className="size-[14px]" aria-hidden="true" />
          </SelectPrimitive.ItemIndicator>
        </span>
      </SelectPrimitive.Item>
    );
  },
);
