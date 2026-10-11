import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionView } from "@shared/models";
import { isHostError } from "@shared/errors";
import { ConfirmDialog } from "../../ui/design-system";
import type { UseConnectionsResult } from "./use-connections";

interface RemoveConnectionDialogProps {
  connectionId: string;
  refresh: UseConnectionsResult["retryList"];
  remove: UseConnectionsResult["remove"];
  onClose(): void;
  onRemoved(): void;
}

export function RemoveConnectionDialog({
  connectionId,
  refresh,
  remove,
  onClose,
  onRemoved,
}: RemoveConnectionDialogProps) {
  const [connection, setConnection] = useState<ConnectionView | null>(null);
  const [pending, setPending] = useState(true);
  const [notice, setNotice] = useState("");
  const busy = useRef(false);

  const reload = useCallback(
    (afterConflict = false) =>
      refresh()
        .then((items) => {
          const current = items?.find((item) => item.id === connectionId);
          if (!current) {
            setNotice("无法读取此连接的最新资料，请重新加载或取消后重试。");
            return;
          }
          setConnection(current);
          setNotice(
            afterConflict
              ? "检测到此连接下还有 Bot 本地管理资料，删除范围已更新，请重新确认。"
              : "",
          );
        })
        .catch(() => {
          setNotice("无法读取此连接的最新资料，请重新加载或取消后重试。");
        })
        .finally(() => setPending(false)),
    [connectionId, refresh],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const confirm = async () => {
    if (pending || busy.current) return;
    busy.current = true;
    try {
      if (!connection) {
        setPending(true);
        await reload();
        return;
      }
      setPending(true);
      await remove(connectionId, connection.managedBotDataCount > 0);
      onRemoved();
    } catch (error: unknown) {
      if (isHostError(error) && error.code === "conflict") {
        setConnection(null);
        await reload(true);
      } else {
        setNotice("删除失败，请重试。连接删除尚未确认成功。");
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const hasManagedData = connection !== null && connection.managedBotDataCount > 0;
  return (
    <ConfirmDialog
      open
      title="删除本地连接"
      description={
        <>
          {connection
            ? hasManagedData
              ? `将永久删除本机连接记录、凭据及 ${connection.managedBotDataCount} 份 Managed Bot 本地管理资料。Provider 中的 Bot、Chat 和消息不会删除，但这些 Bot 将无法再由本机更新或同步。`
              : "将永久删除本机连接记录和凭据。Provider 中的 Bot、Chat 和消息不会删除。"
            : pending
              ? "正在读取此连接的最新本地管理资料…"
              : null}
          {notice ? (
            <span role="alert" className="mt-2 block">
              {notice}
            </span>
          ) : null}
        </>
      }
      confirmLabel={
        !connection ? "重新加载" : hasManagedData ? "删除连接及本地管理资料" : "删除本地连接"
      }
      confirmVariant="destructive"
      pending={pending}
      onCancel={onClose}
      onConfirm={(event) => {
        event?.preventDefault();
        void confirm();
      }}
    />
  );
}
