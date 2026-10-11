import { useState } from "react";
import type { FormEvent } from "react";
import type { EnvironmentCandidate, HostError } from "@shared/models";
import type { UseConnectionsResult } from "./use-connections";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
} from "../../ui/design-system";
import { ProviderBadge } from "../../ui/provider-brand/provider-brand";
import { EnvironmentSetupPanel } from "./environment-setup-panel";

function errorText(error: HostError): string {
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
      return "当前资料存在冲突，请检查后重试。";
    default:
      return "操作失败。";
  }
}

function credentialLabel(provider: string): string {
  return provider === "qoder" ? "Personal Access Token（PAT）" : "DashScope API Key";
}

type DialogStep =
  | { step: "form" }
  | { step: "environment"; connectionId: string; candidates: EnvironmentCandidate[] }
  | { step: "setup-error"; connectionId: string };

const CONNECTION_STEPS = ["选择 Provider", "连接账号", "设置运行环境"];

function ConnectionProgress({ currentStep }: { currentStep: 2 | 3 }) {
  return (
    <ol aria-label="连接进度" className="mt-4 grid grid-cols-3 gap-1">
      {CONNECTION_STEPS.map((label, index) => {
        const step = index + 1;
        const isCurrent = step === currentStep;
        const isComplete = step < currentStep;

        return (
          <li
            key={label}
            aria-current={isCurrent ? "step" : undefined}
            className={`rounded-[var(--radius-md)] px-2 py-1.5 type-caption ${
              isCurrent
                ? "bg-foreground text-background"
                : isComplete
                  ? "bg-secondary text-foreground"
                  : "bg-secondary text-muted-foreground"
            }`}
          >
            {step} {label}
          </li>
        );
      })}
    </ol>
  );
}

export interface AddConnectionDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  connectionsApi: UseConnectionsResult;
  onConnected?(connectionId: string): void;
}

/**
 * 添加连接的 Dialog 表单。成功连接后如需选择环境，在同一 Dialog 内切换到环境选择步骤。
 */
export function AddConnectionDialog({
  open,
  onOpenChange,
  connectionsApi,
  onConnected,
}: AddConnectionDialogProps) {
  const { connect, connectBailianConsole, cancelBailianConsoleLogin, setupEnvironment, error } =
    connectionsApi;
  const [credential, setCredential] = useState("");
  const [showCredential, setShowCredential] = useState(false);
  const [provider, setProvider] = useState<"qoder" | "bailian">("qoder");
  const [bailianMethod, setBailianMethod] = useState<"console" | "manual">("console");
  const [workspaceId, setWorkspaceId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [consolePending, setConsolePending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState({
    workspaceId: false,
    credential: false,
  });
  const [dialogStep, setDialogStep] = useState<DialogStep>({ step: "form" });
  const [envSetupPending, setEnvSetupPending] = useState(false);

  const credentialId = "connection-credential";
  const manualBailian = provider === "bailian" && bailianMethod === "manual";
  const browserBailian = provider === "bailian" && bailianMethod === "console";
  const workspaceIdInvalid = manualBailian && workspaceId.trim().length === 0;
  const credentialInvalid =
    provider === "qoder" || manualBailian ? credential.trim().length === 0 : false;
  const submitDisabled = submitting || credentialInvalid || workspaceIdInvalid;

  const resetForm = () => {
    setCredential("");
    setShowCredential(false);
    setWorkspaceId("");
    setProvider("qoder");
    setBailianMethod("console");
    setSubmitted(false);
    setTouched({ workspaceId: false, credential: false });
    setDialogStep({ step: "form" });
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      if (consolePending) void cancelBailianConsoleLogin();
      resetForm();
    }
    onOpenChange(isOpen);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (submitDisabled) return;
    setSubmitting(true);
    const operation = browserBailian
      ? connectBailianConsole()
      : connect({
          provider,
          displayName: provider === "qoder" ? "Qoder" : "Bailian",
          credential,
          ...(provider === "bailian" ? { workspaceId: workspaceId.trim() } : {}),
        });
    setConsolePending(browserBailian);
    void operation
      .then((result) => {
        // Connection 已持久化后不再让 credential 停留在 Renderer state；
        // 后续选择或重试只使用安全存储中的凭据。
        setCredential("");
        if (result.status === "ready") {
          resetForm();
          onOpenChange(false);
          onConnected?.(result.connection.id);
        } else if (result.status === "selection-required") {
          setDialogStep({
            step: "environment",
            connectionId: result.connection.id,
            candidates: result.candidates,
          });
        } else if (result.status === "setup-error") {
          setDialogStep({ step: "setup-error", connectionId: result.connection.id });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        setSubmitting(false);
        setConsolePending(false);
      });
  };

  const onSelectEnvironment = (environmentId: string) => {
    if (dialogStep.step !== "environment") return;
    const connectionId = dialogStep.connectionId;
    setEnvSetupPending(true);
    void setupEnvironment(connectionId, environmentId)
      .then((result) => {
        if (result.status === "ready") {
          resetForm();
          onOpenChange(false);
          onConnected?.(connectionId);
        }
      })
      .catch(() => undefined)
      .finally(() => setEnvSetupPending(false));
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        {dialogStep.step === "form" ? (
          <>
            <div className="border-b border-border px-5 py-4">
              <DialogTitle>添加 Provider 连接</DialogTitle>
              <DialogDescription className="mt-1 type-supporting text-muted-foreground">
                验证连接后，将检查账号中的可用运行环境；如需选择会继续提示。
              </DialogDescription>
              <ConnectionProgress currentStep={2} />
            </div>
            <form onSubmit={onSubmit} className="grid gap-3 overflow-auto p-4">
              <Field>
                <FieldLabel id="connection-provider-label">Provider</FieldLabel>
                <div
                  role="group"
                  aria-labelledby="connection-provider-label"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <Button
                    id="connection-provider-qoder"
                    type="button"
                    variant={provider === "qoder" ? "default" : "outline"}
                    className="h-auto min-h-[76px] justify-start px-3 py-3 text-left"
                    aria-pressed={provider === "qoder"}
                    disabled={submitting}
                    onClick={() => setProvider("qoder")}
                  >
                    <ProviderBadge provider="qoder" className="size-[20px]" />
                    <span className="grid gap-0.5">
                      <span className="type-control">Qoder</span>
                      <span className="type-caption opacity-75">Personal Access Token</span>
                    </span>
                  </Button>
                  <Button
                    id="connection-provider-bailian"
                    type="button"
                    variant={provider === "bailian" ? "default" : "outline"}
                    className="h-auto min-h-[76px] justify-start px-3 py-3 text-left"
                    aria-pressed={provider === "bailian"}
                    disabled={submitting}
                    onClick={() => setProvider("bailian")}
                  >
                    <ProviderBadge provider="bailian" className="size-[20px]" />
                    <span className="grid gap-0.5">
                      <span className="type-control">百炼</span>
                      <span className="type-caption opacity-75">浏览器授权或 API Key</span>
                    </span>
                  </Button>
                </div>
              </Field>
              {provider === "bailian" ? (
                <Field>
                  <FieldLabel>连接方式</FieldLabel>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant={bailianMethod === "console" ? "default" : "outline"}
                      disabled={submitting}
                      onClick={() => setBailianMethod("console")}
                    >
                      百炼账号登录（推荐）
                    </Button>
                    <Button
                      type="button"
                      variant={bailianMethod === "manual" ? "default" : "outline"}
                      disabled={submitting}
                      onClick={() => setBailianMethod("manual")}
                    >
                      手动输入 API Key
                    </Button>
                  </div>
                  <FieldDescription>
                    {bailianMethod === "console"
                      ? "将在系统浏览器打开百炼中国站，授权后自动配置普通按量 API Key 和 Workspace。"
                      : "适用于已有普通 API Key、企业受限 Key，或浏览器登录不可用。"}
                  </FieldDescription>
                </Field>
              ) : null}
              {manualBailian ? (
                <Field>
                  <FieldLabel htmlFor="connection-workspace-id">Workspace ID（必填）</FieldLabel>
                  <Input
                    id="connection-workspace-id"
                    value={workspaceId}
                    onChange={(event) => setWorkspaceId(event.target.value)}
                    onBlur={() => setTouched((current) => ({ ...current, workspaceId: true }))}
                    required
                    disabled={submitting}
                    aria-invalid={(submitted || touched.workspaceId) && workspaceIdInvalid}
                    aria-describedby="connection-workspace-description"
                  />
                  <FieldDescription id="connection-workspace-description">
                    填写该 API Key 所属的 Workspace ID。
                    {(submitted || touched.workspaceId) && workspaceIdInvalid ? (
                      <span className="block text-destructive">请输入 Workspace ID。</span>
                    ) : null}
                  </FieldDescription>
                </Field>
              ) : null}
              {provider === "qoder" || manualBailian ? (
                <Field>
                  <FieldLabel htmlFor={credentialId}>
                    {credentialLabel(provider)}（必填）
                  </FieldLabel>
                  <Input
                    id={credentialId}
                    type={showCredential ? "text" : "password"}
                    value={credential}
                    onChange={(event) => setCredential(event.target.value)}
                    onBlur={() => setTouched((current) => ({ ...current, credential: true }))}
                    required
                    disabled={submitting}
                    autoComplete="off"
                    aria-invalid={(submitted || touched.credential) && credentialInvalid}
                    aria-describedby="connection-credential-description"
                  />
                  <div className="flex items-start justify-between gap-3">
                    <FieldDescription id="connection-credential-description">
                      {provider === "bailian"
                        ? "API Key 必须能够访问所填 Workspace。凭据仅保存到本机安全存储。"
                        : "用于访问该 Provider 中的 Bot 和 Chat，仅保存到本机安全存储。"}
                      {(submitted || touched.credential) && credentialInvalid ? (
                        <span className="block text-destructive">请输入凭据。</span>
                      ) : null}
                    </FieldDescription>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      disabled={submitting}
                      onClick={() => setShowCredential((current) => !current)}
                    >
                      {showCredential ? "隐藏凭据" : "显示凭据"}
                    </Button>
                  </div>
                </Field>
              ) : null}
              {error ? <Alert variant="destructive">{errorText(error)}</Alert> : null}
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                {submitDisabled && !submitting ? (
                  <span className="mr-auto self-center type-supporting text-muted-foreground">
                    请填写所有必填项。
                  </span>
                ) : null}
                <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                  取消
                </Button>
                <Button type="submit" pending={submitting} disabled={submitDisabled}>
                  {consolePending
                    ? "等待浏览器授权…"
                    : submitting
                      ? "验证中…"
                      : provider === "bailian" && bailianMethod === "console"
                        ? "打开浏览器并连接"
                        : "验证并添加"}
                </Button>
              </div>
            </form>
          </>
        ) : dialogStep.step === "environment" ? (
          <>
            <div className="border-b border-border px-5 py-4">
              <DialogTitle>设置运行环境</DialogTitle>
              <DialogDescription className="mt-1 type-supporting text-muted-foreground">
                连接已创建。请选择 Bot 和 Chat 使用的运行环境，完成后即可进入工作区。
              </DialogDescription>
              <ConnectionProgress currentStep={3} />
            </div>
            <div className="min-h-0 overflow-y-auto p-5">
              {error ? (
                <div className="mb-4" aria-live="polite">
                  <Alert variant="destructive">{errorText(error)}</Alert>
                </div>
              ) : null}
              <EnvironmentSetupPanel
                candidates={dialogStep.candidates}
                onSelect={onSelectEnvironment}
                pending={envSetupPending}
                showHeader={false}
              />
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-border px-5 py-4">
              <DialogTitle>运行环境设置失败</DialogTitle>
              <DialogDescription className="mt-1 type-supporting text-muted-foreground">
                连接已创建，但运行环境设置未完成。你可以重试或稍后在连接设置中完成。
              </DialogDescription>
              <ConnectionProgress currentStep={3} />
            </div>
            <div className="p-5">
              {error ? (
                <div className="mb-4" aria-live="polite">
                  <Alert variant="destructive">{errorText(error)}</Alert>
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                  关闭
                </Button>
                <Button
                  type="button"
                  pending={envSetupPending}
                  onClick={() => {
                    if (dialogStep.step !== "setup-error") return;
                    setEnvSetupPending(true);
                    void setupEnvironment(dialogStep.connectionId)
                      .then((result) => {
                        if (result.status === "ready") {
                          resetForm();
                          onOpenChange(false);
                          onConnected?.(dialogStep.connectionId);
                        } else if (result.status === "selection-required") {
                          setDialogStep({
                            step: "environment",
                            connectionId: dialogStep.connectionId,
                            candidates: result.candidates,
                          });
                        }
                      })
                      .catch(() => undefined)
                      .finally(() => setEnvSetupPending(false));
                  }}
                >
                  {envSetupPending ? "重试中…" : "重试环境设置"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
