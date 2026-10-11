/**
 * CloudAgentBot V2 Design System 公开入口。
 * Feature 只能通过本文件消费 Primitive，不导入组件文件路径。
 * 实现为 shadcn/ui 模式：Tailwind CSS v4 + CVA + Radix（ADR-0005）。
 */

export { Button } from "./button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./button";

export { CopyAction } from "./copy-action";
export type { CopyActionProps } from "./copy-action";

export { Textarea } from "./textarea";
export type { TextareaProps } from "./textarea";

export { Input } from "./input";
export type { InputProps } from "./input";

export { Select } from "./select";
export type { SelectProps, SelectOption } from "./select";

export { Field, FieldLabel, FieldDescription } from "./field";
export type { FieldProps, FieldLabelProps, FieldDescriptionProps } from "./field";

export { Alert } from "./alert";
export type { AlertProps, AlertVariant } from "./alert";

export { Card } from "./card";
export type { CardProps } from "./card";

export { RefreshAction } from "./refresh-action";
export type { RefreshActionProps } from "./refresh-action";

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./dropdown-menu";

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "./context-menu";

export { Popover, PopoverTrigger, PopoverContent } from "./popover";

export {
  Dialog,
  DialogContent,
  DialogClose,
  DialogTitle,
  DialogDescription,
} from "./dialog";

export {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./alert-dialog";

export { ConfirmDialog } from "./confirm-dialog";
export type { ConfirmDialogProps } from "./confirm-dialog";

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./sheet";
export type { SheetContentProps } from "./sheet";

export { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./collapsible";

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "./tooltip";

export { RadioGroup, RadioGroupItem } from "./radio-group";

export { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";

export { Checkbox } from "./checkbox";

// 排版角色 class 名（消费 theme.css 的 .type-* 工具类）。
// 不使用 Tailwind 的 text-* 命名空间，避免 twMerge 将排版角色与文字颜色误判为冲突。
// Feature 使用语义角色，不散落任意字号。
export const typography = {
  pageTitle: "type-page-title",
  sectionTitle: "type-section-title",
  body: "type-body",
  control: "type-control",
  supporting: "type-supporting",
  caption: "type-caption",
} as const;
