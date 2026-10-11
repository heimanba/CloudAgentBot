import { useId, useState } from "react";
import { Check, Info, Share2 } from "lucide-react";
import type { BotRef, BotView, HostError } from "@shared/models";
import { Alert, Button, Popover, PopoverContent, PopoverTrigger } from "../../ui/design-system";

/** 列表和详情共用同一个共享入口；打开面板不改变远程状态。 */
export function BotShareAction({ bot, onSetShared, disabled = false }: {
  bot: BotView;
  disabled?: boolean;
  onSetShared(ref: BotRef, shared: boolean): Promise<HostError | null>;
}) {
  const titleId = useId();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Popover onOpenChange={() => { if (!pending) setFailed(false); }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary" disabled={disabled || pending} aria-label={`共享 ${bot.name}`}>
          {bot.shared ? <Check className="size-3.5" aria-hidden="true" /> : <Share2 className="size-3.5" aria-hidden="true" />}
          {bot.shared ? "已共享" : "共享"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-labelledby={titleId} className="w-72 max-w-[calc(100vw-32px)] p-4">
        <h3 id={titleId} className="type-control font-semibold">团队共享</h3>
        <SharingDescription />
        {failed ? <Alert variant="destructive" title="共享设置未同步成功">请重试，或在更多菜单中重新同步。</Alert> : null}
        <Button
          className="mt-4 w-full"
          size="sm"
          variant={bot.shared ? "secondary" : "default"}
          pending={pending}
          disabled={disabled}
          onClick={async () => {
            if (pending || disabled) return;
            setPending(true);
            setFailed(false);
            try {
              setFailed((await onSetShared(bot.ref, !bot.shared)) !== null);
            } catch {
              setFailed(true);
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "同步中…" : bot.shared ? "取消共享" : "开启共享"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function SharingDescription() {
  return <p className="mt-2 type-supporting text-muted-foreground">共享后，拥有该助手 Provider 访问权限的同事可在团队共享中发现并使用，不要求相同 API Key。任务历史仍按 API Key 分组；同一 API Key 的任务历史可跨设备查看。共享不改变 Provider 权限。</p>;
}

/** 接收方也能查看范围说明，不依赖本机管理权限。 */
export function BotSharingHelp() {
  const titleId = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="团队共享说明"><Info className="size-3.5" aria-hidden="true" /></Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-labelledby={titleId} className="w-72 max-w-[calc(100vw-32px)] p-4">
        <h3 id={titleId} className="type-control font-semibold">团队共享</h3>
        <SharingDescription />
      </PopoverContent>
    </Popover>
  );
}
