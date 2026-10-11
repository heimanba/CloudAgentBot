import type { UseConnectionsResult } from "../features/connections/use-connections";
import { ConnectionsPage } from "../features/connections/connections-page";

export interface ConnectionsGateProps {
  version: string;
  mode: "onboarding" | "settings";
  connectionsApi: UseConnectionsResult;
  /** 当前工作区活动连接；设置模式下默认选中它。 */
  activeConnectionId?: string | null;
  onBack(): void;
  onConnected?(connectionId?: string): void;
}

export function ConnectionsGate({
  version,
  mode,
  connectionsApi,
  activeConnectionId = null,
  onBack,
  onConnected,
}: ConnectionsGateProps) {
  const isOnboarding = mode === "onboarding";
  const hasSavedConnection = connectionsApi.connections.length > 0;
  const needsReconnect =
    hasSavedConnection &&
    connectionsApi.connections.every((connection) => !connection.credentialStored);
  const versionLabel = version === "0.0.0" ? "开发构建" : version;

  return (
    <>
      <header className="sticky top-0 z-10 flex min-h-[56px] items-center justify-between border-b border-border bg-surface-overlay py-3 pl-24 pr-6 [-webkit-app-region:drag]">
        <div>
          <div className="type-section-title">CloudAgentBot</div>
          <div className="mt-0.5 type-caption text-muted-foreground">{versionLabel}</div>
        </div>
      </header>
      {isOnboarding ? (
        <section
          className="mx-auto grid w-[min(960px,calc(100%-40px))] grid-cols-[minmax(0,1fr)_minmax(340px,440px)] items-start gap-16 py-[72px] max-md:w-[min(100%-24px,480px)] max-md:grid-cols-1 max-md:gap-6 max-md:py-8"
          aria-label="连接管理"
        >
          <div className="pt-[26px] max-md:pt-0">
            <span className="type-caption font-bold uppercase tracking-[0.12em] text-ring">
              {needsReconnect ? "恢复连接" : hasSavedConnection ? "完成设置" : "开始使用"}
            </span>
            <h1 className="m-0 mt-2 mb-3 max-w-[520px] text-[clamp(32px,5vw,48px)] font-semibold leading-[1.08] tracking-[-0.04em] max-md:text-[30px]">
              {needsReconnect
                ? "连接后，继续工作"
                : hasSavedConnection
                  ? "完成连接设置"
                  : "连接你的远程 Bot"}
            </h1>
            <p className="m-0 max-w-[520px] type-body text-muted-foreground">
              {needsReconnect
                ? "连接已断开。重新验证凭据，即可继续使用远程 Bot 和任务。"
                : hasSavedConnection
                  ? "完成剩余步骤后即可进入工作区；已有连接资料和凭据不会丢失。"
                  : "凭据仅进入本机安全存储。连接后即可管理远程 Bot、发起任务，并在桌面端查看实时回复。"}
            </p>
            {!hasSavedConnection ? (
              <ul className="mt-5 grid gap-2 p-0 type-supporting text-muted-foreground">
                <li>管理同一 Provider 下的远程 Bot</li>
                <li>选择 Bot 并发起新的 Chat 任务</li>
                <li>在桌面端持续查看实时回复</li>
              </ul>
            ) : null}
          </div>
          <ConnectionsPage
            mode="onboarding"
            connectionsApi={connectionsApi}
            onConnected={onConnected}
          />
        </section>
      ) : (
        <section
          className="mx-auto w-[min(960px,calc(100%-40px))] py-8 max-md:w-[min(100%-24px,480px)] max-md:py-6"
          aria-label="连接管理"
        >
          <div className="mx-auto max-w-[920px]">
          <ConnectionsPage
            mode="settings"
            connectionsApi={connectionsApi}
            activeConnectionId={activeConnectionId}
            onConnected={onConnected}
            onBack={onBack}
          />
          </div>
        </section>
      )}
    </>
  );
}
