import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { ButtonVariant } from "./button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  pending?: boolean;
  disabled?: boolean;
  /** 确认回调；参数为按钮 click 事件，可 preventDefault 阻止弹窗自动关闭（如失败后保持打开）。 */
  onConfirm: (event?: { preventDefault(): void }) => void;
  onCancel?: () => void;
}

/**
 * 破坏性/不可逆操作的二次确认弹窗。
 *
 * 基于 shadcn/ui AlertDialog 实现，屏蔽 overlay 点击与 Esc 关闭，
 * 确保用户只能通过“确认”或“取消”按钮离开。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  confirmVariant = "default",
  pending = false,
  disabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <div className="flex items-start gap-3">
          <div className="flex size-[32px] shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="size-[16px]" aria-hidden="true" />
          </div>
          <AlertDialogHeader className="flex-1">
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
          </AlertDialogHeader>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={pending || disabled}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={confirmVariant}
            pending={pending}
            disabled={pending || disabled}
            onClick={onConfirm}
          >
            {pending ? "处理中…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
