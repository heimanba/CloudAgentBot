import { useRef, useState } from "react";
import type { ConnectionView, EnvironmentCandidate, HostError } from "@shared/models";
import type { UseConnectionsResult } from "./use-connections";
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
} from "../../ui/design-system";
import { Check, ChevronLeft, ChevronRight, Globe, Plus, ShieldCheck } from "lucide-react";
import { getProviderDisplayName, ProviderBadge } from "../../ui/provider-brand/provider-brand";
import { ReconnectForm } from "./reconnect-form";
import { RemoveConnectionDialog } from "./remove-connection-dialog";
import { AddConnectionDialog } from "./add-connection-dialog";
import { EnvironmentSetupPanel } from "./environment-setup-panel";

function errorText(error: HostError, context: "general" | "environment" = "general"): string {
  switch (error.code) {
    case "authentication":
      return "凭据无效，请检查后重试。";
    case "permission":
      return "凭据权限不足。";
    case "rate-limited":
      return "请求过于频繁，请稍后重试。";
    case "unavailable":
      return "服务暂时不可用或安全存储不可用，请稍后重试。";
    case "invalid-input":
      return "输入无效。";
    case "conflict":
      return context === "environment"
        ? "运行环境设置与当前连接状态冲突，请刷新连接后重试。"
        : "操作与当前连接状态冲突，请刷新连接后重试。";
    default:
      return "操作失败。";
  }
}

function credentialLabel(provider: string): string {
  return provider === "qoder" ? "Personal Access Token（PAT）" : "DashScope API Key";
}

export interface ConnectionsPageProps {
  connectionsApi: UseConnectionsResult;
  mode?: "onboarding" | "settings";
  /** 当前工作区活动连接；设置模式下默认选中它。 */
  activeConnectionId?: string | null;
  onConnected?(connectionId?: string): void;
  onBack?(): void;
}

export function ConnectionsPage({
  connectionsApi,
  mode = "settings",
  activeConnectionId = null,
  onConnected,
  onBack,
}: ConnectionsPageProps) {
  const {
    connections,
    loading,
    listError,
    retryList,
    update,
    verify,
    disconnect,
    remove,
    setupEnvironment,
    error,
  } = connectionsApi;
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(activeConnectionId);
  const [editName, setEditName] = useState<string | null>(null);
  const [editWorkspaceId, setEditWorkspaceId] = useState<string | null>(null);
  const [editCredential, setEditCredential] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifiedId, setVerifiedId] = useState<string | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const disconnectingRef = useRef(new Set<string>());
  const [pendingDisconnectId, setPendingDisconnectId] = useState<string | null>(null);
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);
  const [envSetupConnectionId, setEnvSetupConnectionId] = useState<string | null>(null);
  const [envCandidates, setEnvCandidates] = useState<EnvironmentCandidate[]>([]);
  const [envSetupPending, setEnvSetupPending] = useState(false);

  const errorId = "connection-error";

  const onDisconnect = (id: string) => {
    if (disconnectingRef.current.has(id)) return;
    disconnectingRef.current.add(id);
    setDisconnectingId(id);
    void disconnect(id).finally(() => {
      disconnectingRef.current.delete(id);
      setDisconnectingId((current) => (current === id ? null : current));
    });
  };

  const askDisconnect = (id: string) => {
    setPendingDisconnectId(id);
  };

  const confirmDisconnect = () => {
    const id = pendingDisconnectId;
    setPendingDisconnectId(null);
    if (id !== null) onDisconnect(id);
  };

  const cancelDisconnect = () => {
    setPendingDisconnectId(null);
  };

  const startReconnect = (id: string) => setReconnectingId(id);
  const cancelReconnect = () => setReconnectingId(null);
  const finishReconnect = () => {
    setReconnectingId(null);
    onConnected?.();
  };

  const startEnvSetup = (connectionId: string) => {
    setEnvSetupConnectionId(connectionId);
    setEnvCandidates([]);
    setEnvSetupPending(true);
    void setupEnvironment(connectionId)
      .then((result) => {
        if (result.status === "ready") {
          setEnvSetupConnectionId(null);
          setEnvCandidates([]);
          onConnected?.();
        } else {
          setEnvCandidates(result.candidates);
          setEnvSetupConnectionId(connectionId);
        }
      })
      .catch(() => undefined)
      .finally(() => setEnvSetupPending(false));
  };

  const onSelectEnvironment = (environmentId: string) => {
    if (envSetupConnectionId === null) return;
    setEnvSetupPending(true);
    void setupEnvironment(envSetupConnectionId, environmentId)
      .then((result) => {
        if (result.status === "ready") {
          setEnvSetupConnectionId(null);
          setEnvCandidates([]);
          onConnected?.();
        }
      })
      .catch(() => undefined)
      .finally(() => setEnvSetupPending(false));
  };

  const selected =
    connections.find((item) => item.id === selectedId) ??
    connections.find((item) => item.credentialStored) ??
    connections[0] ??
    null;
  const effectiveName = editName ?? selected?.displayName ?? "";
  const effectiveWorkspaceId = editWorkspaceId ?? selected?.workspaceId ?? "";
  const nameChanged = selected !== null && effectiveName.trim() !== selected.displayName;
  const workspaceChanged =
    selected?.provider === "bailian" && effectiveWorkspaceId.trim() !== selected.workspaceId;
  const detailsDirty = nameChanged || workspaceChanged;

  const toggleDetails = (connection: ConnectionView) => {
    setSelectedId(connection.id);
    setEditName(null);
    setEditWorkspaceId(null);
    setEditCredential("");
  };

  const saveDetails = () => {
    if (!selected || !effectiveName.trim() || !detailsDirty) return;
    setSaving(true);
    void update({
      connectionId: selected.id,
      displayName: effectiveName,
      ...(selected.provider === "bailian" ? { workspaceId: effectiveWorkspaceId } : {}),
      ...(workspaceChanged ? { credential: editCredential } : {}),
    })
      .then(() => {
        setEditName(null);
        setEditWorkspaceId(null);
        setEditCredential("");
      })
      .finally(() => setSaving(false));
  };

  const verifyConnection = (id: string) => {
    setVerifyingId(id);
    setVerifiedId(null);
    void verify(id)
      .then(() => setVerifiedId(id))
      .catch(() => undefined)
      .finally(() => setVerifyingId(null));
  };

  if (mode === "onboarding") {
    const connectionToFinish =
      connections.find(
        (connection) => connection.credentialStored && !connection.environmentReady,
      ) ??
      connections.find((connection) => !connection.credentialStored) ??
      null;
    const needsCredential = connectionToFinish !== null && !connectionToFinish.credentialStored;
    const isSelectingEnvironment = envSetupConnectionId === connectionToFinish?.id;

    return (
      <div className="w-full max-w-[440px]">
        {listError ? (
          <Alert variant="destructive">
            加载连接列表失败：{errorText(listError)}
            <Button
              className="ml-3"
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void retryList()}
            >
              重试
            </Button>
          </Alert>
        ) : loading ? (
          <p className="type-supporting text-muted-foreground">加载连接…</p>
        ) : connectionToFinish ? (
          <section className="rounded-[var(--radius-xl)] border border-border bg-card p-6 shadow-[var(--shadow-card)]">
            <div className="mb-5 flex items-center gap-2">
              <ProviderBadge provider={connectionToFinish.provider} />
              <span className="type-caption text-muted-foreground">
                {getProviderDisplayName(connectionToFinish.provider)}
              </span>
            </div>
            <h2 className="m-0 type-section-title">
              {needsCredential
                ? `重新连接 ${connectionToFinish.displayName}`
                : `完成 ${connectionToFinish.displayName} 设置`}
            </h2>
            <p className="mt-2 mb-5 type-supporting text-muted-foreground">
              {needsCredential
                ? connectionToFinish.provider === "bailian"
                  ? "输入 API Key 或登录百炼账号以恢复连接。"
                  : "输入新的访问令牌以恢复连接。"
                : "凭据已安全保存，还需要完成运行环境设置才能创建 Bot 和 Chat。"}
            </p>

            {needsCredential ? (
              <ReconnectForm
                key={connectionToFinish.id}
                connection={connectionToFinish}
                connectionsApi={connectionsApi}
                onConnected={finishReconnect}
              />
            ) : isSelectingEnvironment && envCandidates.length > 0 ? (
              <EnvironmentSetupPanel
                candidates={envCandidates}
                onSelect={onSelectEnvironment}
                pending={envSetupPending}
                showHeader={false}
              />
            ) : (
              <Button
                type="button"
                pending={envSetupPending}
                onClick={() => startEnvSetup(connectionToFinish.id)}
              >
                {envSetupPending ? "检查中…" : "继续设置"}
              </Button>
            )}

            {error ? (
              <div id={errorId} className="mt-4" aria-live="polite">
                <Alert variant="destructive">{errorText(error, "environment")}</Alert>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="rounded-[var(--radius-xl)] border border-border bg-card p-6 shadow-[var(--shadow-card)]">
            <h2 className="m-0 type-section-title">添加 Provider 连接</h2>
            <p className="mt-2 mb-5 type-supporting text-muted-foreground">
              验证凭据并设置运行环境后即可进入工作区。
            </p>
            <Button type="button" onClick={() => setAdding(true)}>
              添加连接
            </Button>
          </section>
        )}

        <AddConnectionDialog
          open={adding}
          onOpenChange={setAdding}
          connectionsApi={connectionsApi}
          onConnected={onConnected}
        />
      </div>
    );
  }

  if (mode === "settings") {
    return (
      <div className="w-full">
        <div className="mb-7 flex items-start justify-between gap-6">
          <div className="flex min-w-0 items-start gap-2">
            {onBack ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-ml-2 mt-px shrink-0"
                onClick={onBack}
                aria-label="返回工作区"
                title="返回工作区"
              >
                <ChevronLeft className="size-[16px]" aria-hidden="true" />
              </Button>
            ) : null}
            <div className="min-w-0">
              <h1 className="m-0 type-page-title">Provider 连接</h1>
              <p className="mt-1 mb-0 type-supporting text-muted-foreground">
                管理用于访问远程 Bot 和 Chat 的 Provider 连接。
              </p>
            </div>
          </div>
          <Button type="button" size="sm" className="shrink-0" onClick={() => setAdding(true)}>
            <Plus className="size-[14px]" aria-hidden="true" /> 添加连接
          </Button>
        </div>

        {listError ? (
          <Alert variant="destructive">
            加载连接列表失败：{errorText(listError)}
            <Button
              className="ml-3"
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void retryList()}
            >
              重试
            </Button>
          </Alert>
        ) : null}

        <div className="grid min-h-[430px] grid-cols-[240px_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card max-md:grid-cols-1">
          <aside
            className={`border-r border-border bg-surface-subtle p-2 max-md:border-r-0 max-md:border-b ${selectedId !== null ? "max-md:hidden" : ""}`}
          >
            {loading ? (
              <p className="px-3 py-4 type-supporting text-muted-foreground">加载中…</p>
            ) : null}
            {!loading && connections.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <p className="m-0 type-body font-medium">还没有连接</p>
                <p className="mt-1 mb-4 type-supporting text-muted-foreground">
                  添加 Provider 后即可开始使用。
                </p>
                <Button type="button" size="sm" onClick={() => setAdding(true)}>
                  添加连接
                </Button>
              </div>
            ) : null}
            <nav aria-label="Provider 连接">
              {connections.map((connection) => {
                const active = selected?.id === connection.id;
                return (
                  <button
                    key={connection.id}
                    type="button"
                    onClick={() => toggleDetails(connection)}
                    className={`mb-1 flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors ${active ? "bg-card shadow-[var(--shadow-card)]" : "hover:bg-surface-hover"}`}
                  >
                    <ProviderBadge provider={connection.provider} />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate type-control">
                        {connection.displayName}
                      </strong>
                      <span className="block truncate type-caption text-muted-foreground">
                        {connection.credentialStored
                          ? connection.environmentReady
                            ? "可用于创建 Bot 和 Chat"
                            : "需要设置运行环境"
                          : "凭据已断开"}
                      </span>
                    </span>
                    <ChevronRight
                      className="size-[14px] text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </nav>
          </aside>

          <section
            className={`min-w-0 p-8 max-md:p-5 ${selectedId === null ? "max-md:hidden" : ""}`}
            aria-live="polite"
          >
            {selected ? (
              <div className="max-w-[520px]">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-3 mb-4 md:hidden"
                  onClick={() => setSelectedId(null)}
                >
                  ← 所有连接
                </Button>
                <div className="mb-7 flex items-start justify-between gap-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <ProviderBadge provider={selected.provider} />
                      <span className="type-caption text-muted-foreground">
                        {getProviderDisplayName(selected.provider)}
                      </span>
                    </div>
                    <h2 className="m-0 type-section-title">{selected.displayName}</h2>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 type-caption ${selected.credentialStored && selected.environmentReady ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"}`}
                  >
                    {selected.credentialStored && selected.environmentReady ? (
                      <Check className="size-[12px]" aria-hidden="true" />
                    ) : null}
                    {!selected.credentialStored
                      ? "凭据已断开"
                      : selected.environmentReady
                        ? "可用于创建"
                        : "需要设置运行环境"}
                  </span>
                </div>

                <div className="grid gap-5">
                  {!selected.environmentReady && selected.credentialStored ? (
                    <Alert variant="warning" title="运行环境设置未完成">
                      当前连接已验证，但还不能创建 Bot 或
                      Chat。继续设置后，应用会检查账号中的可用运行环境；如需选择会继续提示。
                    </Alert>
                  ) : null}
                  <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
                    <form
                      className="grid gap-3 p-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveDetails();
                      }}
                    >
                      <Field>
                        <FieldLabel htmlFor={`edit-name-${selected.id}`}>连接名称</FieldLabel>
                        <Input
                          id={`edit-name-${selected.id}`}
                          value={effectiveName}
                          onChange={(event) => setEditName(event.target.value)}
                        />
                      </Field>
                      {selected.provider === "bailian" ? (
                        <Field>
                          <FieldLabel htmlFor={`edit-workspace-${selected.id}`}>
                            Workspace ID
                          </FieldLabel>
                          <Input
                            id={`edit-workspace-${selected.id}`}
                            value={effectiveWorkspaceId}
                            onChange={(event) => setEditWorkspaceId(event.target.value)}
                          />
                        </Field>
                      ) : null}
                      {workspaceChanged ? (
                        <Field>
                          <FieldLabel htmlFor={`edit-credential-${selected.id}`}>
                            {credentialLabel(selected.provider)}
                          </FieldLabel>
                          <Input
                            id={`edit-credential-${selected.id}`}
                            type="password"
                            value={editCredential}
                            onChange={(event) => setEditCredential(event.target.value)}
                          />
                          <FieldDescription>
                            Workspace 变化后需要重新验证凭据；验证失败时保留原设置。
                          </FieldDescription>
                        </Field>
                      ) : null}
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          size="sm"
                          pending={saving}
                          disabled={
                            !detailsDirty ||
                            !effectiveName.trim() ||
                            (selected.provider === "bailian" && !effectiveWorkspaceId.trim()) ||
                            (workspaceChanged && !editCredential.trim())
                          }
                        >
                          保存更改
                        </Button>
                      </div>
                    </form>

                    <div className="border-t border-border p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className={`grid size-[34px] shrink-0 place-items-center rounded-full ${selected.environmentReady ? "bg-success" : "bg-warning"}`}
                          >
                            <Globe className="size-[16px]" aria-hidden="true" />
                          </span>
                          <span>
                            <span className="block type-caption text-muted-foreground">
                              运行环境
                            </span>
                            <strong className="block type-control">
                              {selected.environmentReady ? "已设置" : "设置未完成"}
                            </strong>
                            <span className="block type-caption text-muted-foreground">
                              {selected.environmentReady
                                ? "Bot 和 Chat 将在该环境中执行"
                                : "继续设置后才能创建 Bot 和 Chat"}
                            </span>
                          </span>
                        </div>
                        {!selected.environmentReady && selected.credentialStored ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            pending={envSetupPending}
                            onClick={() => startEnvSetup(selected.id)}
                          >
                            继续设置
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {envSetupConnectionId === selected.id && envCandidates.length > 0 ? (
                      <div className="border-t border-border p-4">
                        <EnvironmentSetupPanel
                          candidates={envCandidates}
                          onSelect={onSelectEnvironment}
                          pending={envSetupPending}
                          showHeader={false}
                        />
                        <div className="mt-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={envSetupPending}
                            onClick={() => {
                              setEnvSetupConnectionId(null);
                              setEnvCandidates([]);
                            }}
                          >
                            取消
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    <div className="border-t border-border p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-secondary">
                            <ShieldCheck className="size-[16px]" aria-hidden="true" />
                          </span>
                          <span>
                            <span className="block type-caption text-muted-foreground">凭据</span>
                            <strong className="block type-control">本机安全存储</strong>
                            <span className="block type-caption text-muted-foreground">
                              凭据不会显示在日志或配置文件中
                            </span>
                          </span>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {selected.credentialStored ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              pending={verifyingId === selected.id}
                              onClick={() => verifyConnection(selected.id)}
                            >
                              验证连接
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => startReconnect(selected.id)}
                          >
                            {selected.credentialStored ? "更新凭据" : "连接账号"}
                          </Button>
                        </div>
                      </div>
                      {verifiedId === selected.id ? (
                        <p className="mt-2 mb-0 flex items-center gap-1 type-supporting">
                          <Check className="size-[13px]" />
                          连接验证成功
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <section className="border-t border-border pt-5">
                    <h3 className="m-0 type-body font-medium">危险操作</h3>
                    <p className="mt-1 mb-3 type-supporting text-muted-foreground">
                      断开只移除凭据；删除本地连接会移除连接记录，并可同时清理 Managed Bot
                      本地管理资料。
                    </p>
                    <div className="flex gap-2">
                      {selected.credentialStored ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          pending={disconnectingId === selected.id}
                          onClick={() => askDisconnect(selected.id)}
                        >
                          {disconnectingId === selected.id ? "断开中…" : "断开连接"}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setPendingRemoveId(selected.id)}
                      >
                        删除本地连接…
                      </Button>
                    </div>
                  </section>
                </div>
                {error ? (
                  <div id={errorId} className="mt-5">
                    <Alert variant="destructive">
                      {errorText(
                        error,
                        envSetupConnectionId === selected.id ? "environment" : "general",
                      )}
                    </Alert>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <p className="m-0 type-body font-medium">选择一个连接</p>
                  <p className="mt-1 mb-0 type-supporting text-muted-foreground">
                    查看设置、更新凭据或管理连接。
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>

        <AddConnectionDialog
          open={adding}
          onOpenChange={setAdding}
          connectionsApi={connectionsApi}
          onConnected={onConnected}
        />

        <Dialog
          open={reconnectingId !== null}
          onOpenChange={(open) => {
            if (!open) cancelReconnect();
          }}
        >
          <DialogContent>
            <div className="border-b border-border px-5 py-4">
              <DialogTitle>{selected?.credentialStored ? "更新凭据" : "连接 Provider"}</DialogTitle>
              <DialogDescription className="mt-1 type-supporting text-muted-foreground">
                新凭据验证成功后才会保存到本机安全存储，不会写入日志或配置文件。
              </DialogDescription>
            </div>
            {selected && reconnectingId !== null ? (
              <div className="grid gap-4 p-5">
                <ReconnectForm
                  key={reconnectingId}
                  connection={selected}
                  connectionsApi={connectionsApi}
                  onConnected={finishReconnect}
                  onCancel={cancelReconnect}
                />
                {error ? <Alert variant="destructive">{errorText(error)}</Alert> : null}
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={pendingDisconnectId !== null}
          onOpenChange={(open) => {
            if (!open) cancelDisconnect();
          }}
          title="断开连接"
          description="本机安全存储中的凭据将被删除；连接资料和 Managed Bot 本地资料会保留。"
          confirmLabel="断开连接"
          confirmVariant="destructive"
          pending={disconnectingId === pendingDisconnectId && pendingDisconnectId !== null}
          onConfirm={confirmDisconnect}
          onCancel={cancelDisconnect}
        />
        {pendingRemoveId !== null ? (
          <RemoveConnectionDialog
            key={pendingRemoveId}
            connectionId={pendingRemoveId}
            refresh={retryList}
            remove={remove}
            onClose={() => setPendingRemoveId(null)}
            onRemoved={() => {
              setPendingRemoveId(null);
              setSelectedId(null);
            }}
          />
        ) : null}
      </div>
    );
  }
}
