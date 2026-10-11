import { useCallback, useEffect, useState } from "react";
import type {
  ConnectInput,
  ConnectionView,
  EnvironmentCandidate,
  EnvironmentSetupViewResult,
  HostError,
  ReconnectInput,
  UpdateConnectionInput,
} from "@shared/models";
import { isHostError } from "@shared/errors";
import { getDesktopHost } from "../../desktop-host";

export type ConnectAndSetupResult =
  | { status: "ready"; connection: ConnectionView }
  | {
      status: "selection-required";
      connection: ConnectionView;
      candidates: EnvironmentCandidate[];
    }
  | { status: "setup-error"; connection: ConnectionView; error: HostError };

export interface UseConnectionsResult {
  connections: ConnectionView[];
  loading: boolean;
  connect(input: ConnectInput): Promise<ConnectAndSetupResult>;
  connectBailianConsole(): Promise<ConnectAndSetupResult>;
  reconnectBailianConsole(connectionId: string): Promise<void>;
  cancelBailianConsoleLogin(): Promise<void>;
  reconnect(input: ReconnectInput): Promise<void>;
  update(input: UpdateConnectionInput): Promise<void>;
  verify(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  remove(id: string, removeManagedBotData: boolean): Promise<void>;
  setupEnvironment(
    connectionId: string,
    environmentId?: string,
  ): Promise<EnvironmentSetupViewResult>;
  /** 写操作（connect / reconnect / disconnect）的最近一次错误。 */
  error: HostError | null;
  /** 列表加载失败的错误；与写操作错误独立。 */
  listError: HostError | null;
  /** 重新加载 Connection 列表。 */
  retryList(): Promise<ConnectionView[] | undefined>;
}

export function useConnections(): UseConnectionsResult {
  const [connections, setConnections] = useState<ConnectionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<HostError | null>(null);
  const [listError, setListError] = useState<HostError | null>(null);

  const fetchList = useCallback(async (): Promise<ConnectionView[]> => {
    return getDesktopHost().connections.list();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchList()
      .then((items) => {
        if (!cancelled) setConnections(items);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setListError(
            isHostError(e) ? e : { code: "unavailable" as const, message: "list failed" },
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchList]);

  const retryList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const items = await fetchList();
      setConnections(items);
      return items;
    } catch (e: unknown) {
      setListError(isHostError(e) ? e : { code: "unavailable" as const, message: "list failed" });
    } finally {
      setLoading(false);
    }
  }, [fetchList]);

  const reconnect = useCallback(async (input: ReconnectInput) => {
    setError(null);
    try {
      const updated = await getDesktopHost().connections.reconnect(input);
      setConnections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (e: unknown) {
      const hostError = isHostError(e)
        ? e
        : { code: "unavailable" as const, message: "reconnect failed" };
      setError(hostError);
      throw hostError;
    }
  }, []);

  const reconnectBailianConsole = useCallback(async (connectionId: string) => {
    setError(null);
    try {
      const updated = await getDesktopHost().connections.reconnectBailianConsole(connectionId);
      setConnections((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (e: unknown) {
      const hostError = isHostError(e)
        ? e
        : { code: "unavailable" as const, message: "console reconnect failed" };
      setError(hostError);
      throw hostError;
    }
  }, []);

  const update = useCallback(async (input: UpdateConnectionInput) => {
    setError(null);
    try {
      const updated = await getDesktopHost().connections.update(input);
      setConnections((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (e: unknown) {
      const hostError = isHostError(e)
        ? e
        : { code: "unavailable" as const, message: "update failed" };
      setError(hostError);
      throw hostError;
    }
  }, []);

  const verify = useCallback(async (id: string) => {
    setError(null);
    try {
      await getDesktopHost().connections.verify(id);
    } catch (e: unknown) {
      const hostError = isHostError(e)
        ? e
        : { code: "unavailable" as const, message: "verify failed" };
      setError(hostError);
      throw hostError;
    }
  }, []);

  const disconnect = useCallback(async (id: string) => {
    setError(null);
    try {
      await getDesktopHost().connections.disconnect(id);
      setConnections((prev) =>
        prev.map((c) => (c.id === id ? { ...c, credentialStored: false } : c)),
      );
    } catch (e: unknown) {
      setError(isHostError(e) ? e : { code: "unavailable" as const, message: "disconnect failed" });
    }
  }, []);

  const remove = useCallback(async (id: string, removeManagedBotData: boolean) => {
    setError(null);
    try {
      await getDesktopHost().connections.remove(id, { removeManagedBotData });
      setConnections((prev) => prev.filter((item) => item.id !== id));
    } catch (e: unknown) {
      const hostError = isHostError(e)
        ? e
        : { code: "unavailable" as const, message: "remove failed" };
      setError(hostError);
      throw hostError;
    }
  }, []);

  const setupEnvironment = useCallback(
    async (connectionId: string, environmentId?: string): Promise<EnvironmentSetupViewResult> => {
      setError(null);
      try {
        const result = await getDesktopHost().connections.setupEnvironment(
          connectionId,
          environmentId,
        );
        if (result.status === "ready") {
          setConnections((prev) =>
            prev.map((c) => (c.id === connectionId ? { ...c, environmentReady: true } : c)),
          );
        }
        return result;
      } catch (e: unknown) {
        const hostError = isHostError(e)
          ? e
          : { code: "unavailable" as const, message: "setupEnvironment failed" };
        setError(hostError);
        throw hostError;
      }
    },
    [],
  );

  const finishConnectionSetup = useCallback(async (created: ConnectionView) => {
    setConnections((prev) => [...prev, created]);
    try {
      const result = await getDesktopHost().connections.setupEnvironment(created.id);
      if (result.status === "ready") {
        const readyConnection = { ...created, environmentReady: true };
        setConnections((prev) => prev.map((c) => (c.id === created.id ? readyConnection : c)));
        return { status: "ready" as const, connection: readyConnection };
      }
      return {
        status: "selection-required" as const,
        connection: created,
        candidates: result.candidates,
      };
    } catch (e: unknown) {
      const setupError = isHostError(e)
        ? e
        : { code: "unavailable" as const, message: "setupEnvironment failed" };
      setError(setupError);
      return { status: "setup-error" as const, connection: created, error: setupError };
    }
  }, []);

  const connect = useCallback(
    async (input: ConnectInput): Promise<ConnectAndSetupResult> => {
      setError(null);
      let created: ConnectionView;
      try {
        created = await getDesktopHost().connections.connect(input);
      } catch (e: unknown) {
        const hostError = isHostError(e)
          ? e
          : { code: "unavailable" as const, message: "connect failed" };
        setError(hostError);
        throw hostError;
      }
      return finishConnectionSetup(created);
    },
    [finishConnectionSetup],
  );

  const connectBailianConsole = useCallback(async (): Promise<ConnectAndSetupResult> => {
    setError(null);
    try {
      const created = await getDesktopHost().connections.connectBailianConsole();
      return finishConnectionSetup(created);
    } catch (e: unknown) {
      const loginError = isHostError(e)
        ? e
        : { code: "unavailable" as const, message: "Bailian console login failed" };
      setError(loginError);
      throw loginError;
    }
  }, [finishConnectionSetup]);

  const cancelBailianConsoleLogin = useCallback(
    () => getDesktopHost().connections.cancelBailianConsoleLogin(),
    [],
  );

  return {
    connections,
    loading,
    connect,
    connectBailianConsole,
    reconnectBailianConsole,
    cancelBailianConsoleLogin,
    reconnect,
    update,
    verify,
    disconnect,
    remove,
    setupEnvironment,
    error,
    listError,
    retryList,
  };
}
