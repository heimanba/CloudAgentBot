import type { ConnectionView } from "@shared/models";
import { PanelLeft, Plus, Settings } from "lucide-react";
import { Button, SheetTrigger } from "../ui/design-system";
import { ProviderBadge } from "../ui/provider-brand/provider-brand";

export interface WorkspaceHeaderProps {
  activeConnection: ConnectionView | null;
  activeProviderName: string;
  onOpenBotList(): void;
  onOpenNewChat(): void;
  onOpenConnections(): void;
}

export function WorkspaceHeader({
  activeConnection,
  activeProviderName,
  onOpenBotList,
  onOpenNewChat,
  onOpenConnections,
}: WorkspaceHeaderProps) {
  return (
    <header className="hidden h-[52px] shrink-0 items-center justify-between border-b border-border bg-surface-overlay pl-24 pr-3 max-md:flex [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
      <div className="flex min-w-0 items-center gap-2">
        <SheetTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="max-md:size-[44px]"
            aria-label="打开导航"
            title="打开导航"
          >
            <PanelLeft className="size-[18px]" aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <button
          className="truncate border-0 bg-transparent p-0 text-inherit font-semibold"
          type="button"
          onClick={onOpenBotList}
        >
          CloudAgentBot
        </button>
        {activeConnection ? (
          <span className="flex items-center gap-1 type-caption text-muted-foreground">
            <ProviderBadge provider={activeConnection.provider} />
            {activeProviderName}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          size="icon"
          variant="ghost"
          className="max-md:size-[44px]"
          aria-label="新任务"
          onClick={onOpenNewChat}
        >
          <Plus className="size-[14px]" aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="max-md:size-[44px]"
          aria-label="管理连接"
          onClick={onOpenConnections}
        >
          <Settings className="size-[14px]" aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}
