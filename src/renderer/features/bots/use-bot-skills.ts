import { useCallback, useEffect, useState } from "react";
import type { BotSkillOption, ConnectionId, HostError } from "@shared/models";
import { isHostError } from "@shared/errors";
import { getDesktopHost } from "../../desktop-host";

export function useBotSkills(connectionId: ConnectionId) {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<{
    loading: boolean;
    options: BotSkillOption[];
    error: HostError | null;
  }>({ loading: true, options: [], error: null });

  useEffect(() => {
    let cancelled = false;
    getDesktopHost()
      .bots.listSkills(connectionId)
      .then((options) => {
        if (!cancelled) setState({ loading: false, options, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState((current) => ({
            loading: false,
            options: current.options,
            error: isHostError(error)
              ? error
              : { code: "unavailable", message: "list skills failed" },
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, generation]);

  const retry = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    setGeneration((value) => value + 1);
  }, []);
  return { ...state, retry };
}
