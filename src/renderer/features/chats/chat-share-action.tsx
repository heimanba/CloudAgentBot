import { useState } from "react";
import type { ChatView, HostError } from "@shared/models";
import { isHostError } from "@shared/errors";
import { Share2 } from "lucide-react";
import {
  Alert,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../ui/design-system";

export function ChatShareAction({
  chat,
  disabled = false,
  onSetShared,
  onOpenChange,
}: {
  chat: ChatView;
  disabled?: boolean;
  onOpenChange?(open: boolean): void;
  onSetShared(chat: ChatView, shared: boolean): Promise<HostError | null>;
}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<HostError | null>(null);

  return (
    <Popover onOpenChange={(open) => { if (!pending) setFailure(null); onOpenChange?.(open); }}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
          disabled={disabled || pending}
          aria-label={chat.shared ? "管理共享" : "共享任务"}
          title={chat.shared ? "管理共享" : "共享任务"}
        >
          <Share2 className="size-3.5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-w-[calc(100vw-32px)] p-4">
        <h3 className="type-control font-semibold">共享任务</h3>
        <p className="mt-2 type-supporting">{chat.shared ? "已共享给团队" : "尚未共享"}</p>
        <p className="mt-2 type-supporting text-muted-foreground">
          共享后，拥有当前 Provider 空间访问权限的同事可查看并继续此任务。共享不改变 Provider 权限。
        </p>
        {failure ? (
          <Alert variant="destructive" title="共享设置未同步成功">
            {failure.message}（{failure.code}）
          </Alert>
        ) : null}
        <Button
          className="mt-4 w-full"
          size="sm"
          variant={chat.shared ? "secondary" : "default"}
          pending={pending}
          disabled={disabled}
          onClick={async () => {
            if (pending || disabled) return;
            setPending(true);
            setFailure(null);
            try {
              setFailure(await onSetShared(chat, !chat.shared));
            } catch (error) {
              setFailure(
                isHostError(error)
                  ? error
                  : { code: "unavailable", message: "share chat failed" },
              );
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "同步中…" : chat.shared ? "取消共享" : "开启共享"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
