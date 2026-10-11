import { useCallback, useState } from "react";
import type { BotSkillOption, HostError, SkillCatalogEntry } from "@shared/models";
import { isHostError } from "@shared/errors";
import { getDesktopHost } from "../../desktop-host";

export function useSkillCatalog(connectionId: string) {
  const [state, setState] = useState<{
    loaded: boolean;
    loading: boolean;
    options: SkillCatalogEntry[];
    error: HostError | null;
  }>({ loaded: false, loading: false, options: [], error: null });
  const [installingId, setInstallingId] = useState<string | null>(null);

  const search = useCallback(
    async (query = "") => {
      const list = getDesktopHost().bots.listSkillCatalog;
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const options = await list(connectionId, query);
        setState({ loaded: true, loading: false, options, error: null });
      } catch (error) {
        setState((current) => ({
          ...current,
          loaded: true,
          loading: false,
          error: isHostError(error)
            ? error
            : { code: "unavailable", message: "list skill catalog failed" },
        }));
      }
    },
    [connectionId],
  );

  const install = useCallback(
    async (catalogId: string): Promise<BotSkillOption | null> => {
      const action = getDesktopHost().bots.addSkillFromCatalog;
      setInstallingId(catalogId);
      try {
        return await action(connectionId, catalogId);
      } finally {
        setInstallingId(null);
      }
    },
    [connectionId],
  );

  return { ...state, installingId, search, install };
}
