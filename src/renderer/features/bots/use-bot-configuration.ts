/**
 * Bot 配置表单的数据 hook：经 DesktopHost 的 bots.getConfiguration 加载
 * Managed Bot 的期望配置与同步状态，供 BotSettingsForm 初始化。
 * 失败与取消加载展示稳定错误；不缓存、不轮询。
 * 采用 use-bots 相同的 key 模式：ref 变化时以新 key 重新加载，旧 key 状态丢弃。
 */

import { useEffect, useState } from "react";
import type { BotConfigurationView, BotRef, HostError } from "@shared/models";
import { isHostError } from "@shared/errors";
import { getDesktopHost } from "../../desktop-host";

export interface BotConfigurationState {
  loading: boolean;
  config: BotConfigurationView | null;
  error: HostError | null;
}

interface KeyedState extends BotConfigurationState {
  key: string;
}

function refKey(ref: BotRef | null): string {
  return ref === null ? "" : `${ref.connectionId}:${ref.agentId}`;
}

export function useBotConfiguration(ref: BotRef | null): BotConfigurationState {
  const key = refKey(ref);
  const [state, setState] = useState<KeyedState>({
    key,
    loading: ref !== null,
    config: null,
    error: null,
  });

  useEffect(() => {
    if (ref === null) return;
    let cancelled = false;
    getDesktopHost()
      .bots.getConfiguration(ref)
      .then((config) => {
        if (!cancelled) setState({ key, loading: false, config, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            key,
            loading: false,
            config: null,
            error: isHostError(e) ? e : { code: "unavailable", message: "get configuration failed" },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ref, key]);

  // ref 变化时回到加载态（避免在 effect 内同步 setState 造成级联渲染）。
  if (state.key !== key) {
    return { loading: ref !== null, config: null, error: null };
  }
  return { loading: state.loading, config: state.config, error: state.error };
}
