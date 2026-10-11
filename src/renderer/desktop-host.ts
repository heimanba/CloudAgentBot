/**
 * Renderer 侧 DesktopHost 访问点。
 * 单一全局声明，页面与 hook 从这里取 host，避免重复 declare global。
 */

import type { DesktopHost } from "@shared/desktop-host-contract";

type ExposedHost = Pick<DesktopHost, "app" | "connections" | "bots" | "chats" | "deployments">;

declare global {
  interface Window {
    desktopHost: ExposedHost;
  }
}

export function getDesktopHost(): ExposedHost {
  return window.desktopHost;
}
