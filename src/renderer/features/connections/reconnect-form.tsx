import { useEffect, useRef, useState } from "react";
import type { ConnectionView } from "@shared/models";
import type { UseConnectionsResult } from "./use-connections";
import { Button, Field, FieldDescription, FieldLabel, Input } from "../../ui/design-system";

export function ReconnectForm({
  connection,
  connectionsApi,
  onConnected,
  onCancel,
}: {
  connection: ConnectionView;
  connectionsApi: UseConnectionsResult;
  onConnected(): void;
  onCancel?(): void;
}) {
  const [method, setMethod] = useState<"console" | "manual">("manual");
  const [credential, setCredential] = useState("");
  const [workspaceId, setWorkspaceId] = useState(connection.workspaceId ?? "");
  const isBailian = connection.provider === "bailian";
  const workspaceChanged = isBailian && workspaceId.trim() !== connection.workspaceId;
  const manualInvalid = !credential.trim() || (isBailian && !workspaceId.trim());
  const [pending, setPending] = useState<"console" | "manual" | null>(null);
  const attempt = useRef<"console" | "manual" | null>(null);
  const active = useRef(true);
  const { reconnect, update, reconnectBailianConsole, cancelBailianConsoleLogin } = connectionsApi;

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (attempt.current === "console") void cancelBailianConsoleLogin().catch(() => undefined);
    };
  }, [cancelBailianConsoleLogin]);

  async function submit(kind: "console" | "manual") {
    if (attempt.current || (kind === "manual" && manualInvalid)) return;
    attempt.current = kind;
    setPending(kind);
    try {
      if (kind === "console") await reconnectBailianConsole(connection.id);
      else if (workspaceChanged) {
        await update({
          connectionId: connection.id,
          displayName: connection.displayName,
          workspaceId: workspaceId.trim(),
          credential,
        });
      } else await reconnect({ connectionId: connection.id, credential });
      attempt.current = null;
      if (active.current) {
        setCredential("");
        onConnected();
      }
    } catch {
      // 错误由 connectionsApi 在页面展示，保留表单供重试或更换方式。
    } finally {
      attempt.current = null;
      if (active.current) setPending(null);
    }
  }

  return (
    <div className="grid gap-4">
      {connection.provider === "bailian" ? (
        <div role="group" aria-label="连接方式" className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={method === "manual" ? "secondary" : "outline"}
            aria-pressed={method === "manual"}
            disabled={pending !== null}
            onClick={() => setMethod("manual")}
          >
            手动输入 API Key
          </Button>
          <Button
            type="button"
            variant={method === "console" ? "secondary" : "outline"}
            aria-pressed={method === "console"}
            disabled={pending !== null}
            onClick={() => setMethod("console")}
          >
            百炼账号登录
          </Button>
        </div>
      ) : null}
      {pending === "console" ? (
        <p className="m-0 type-body text-muted-foreground">
          正在等待浏览器授权。请在百炼中国站完成登录并确认 API Key。
        </p>
      ) : method === "manual" ? (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit("manual");
          }}
        >
          {isBailian ? (
            <Field>
              <FieldLabel htmlFor={`reconnect-workspace-${connection.id}`}>
                Workspace ID（必填）
              </FieldLabel>
              <Input
                id={`reconnect-workspace-${connection.id}`}
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
                required
                autoComplete="off"
                disabled={pending !== null}
              />
              <FieldDescription>
                {workspaceChanged
                  ? "切换 Workspace 后需要重新设置运行环境，已有 Bot 和 Chat 不会迁移到新 Workspace。"
                  : "填写该 API Key 所属的 Workspace ID。"}
              </FieldDescription>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor={`reconnect-credential-${connection.id}`}>
              {connection.provider === "bailian"
                ? "DashScope API Key"
                : "Personal Access Token（PAT）"}
            </FieldLabel>
            <Input
              id={`reconnect-credential-${connection.id}`}
              type="password"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              required
              autoFocus
              autoComplete="off"
              disabled={pending !== null}
            />
            <FieldDescription>
              {connection.provider === "bailian"
                ? "请输入可访问上述 Workspace 的 API Key。"
                : "用于验证并访问该 Provider 中的 Bot 和 Chat。"}
            </FieldDescription>
          </Field>
          <Button
            type="submit"
            pending={pending === "manual"}
            disabled={manualInvalid || pending !== null}
          >
            {pending === "manual" ? "验证中…" : "验证并保存"}
          </Button>
        </form>
      ) : (
        <div className="grid gap-4">
          <p className="m-0 type-supporting text-muted-foreground">
            在浏览器中登录百炼中国站，授权后自动获取 API Key 和 Workspace。
          </p>
          <Button type="button" onClick={() => void submit("console")}>
            打开浏览器并连接
          </Button>
        </div>
      )}
      {pending === "console" ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void cancelBailianConsoleLogin().catch(() => undefined);
          }}
        >
          取消授权
        </Button>
      ) : onCancel ? (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
        </div>
      ) : null}
    </div>
  );
}
