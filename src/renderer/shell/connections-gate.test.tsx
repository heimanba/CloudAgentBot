// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConnectionsGate } from "./connections-gate";
import type { UseConnectionsResult } from "../features/connections/use-connections";

const connectionsApi: UseConnectionsResult = {
  connections: [
    {
      id: "conn-1",
      provider: "qoder",
      displayName: "工作账号",
      credentialStored: true,
      managedBotDataCount: 0,
      environmentReady: false,
    },
  ],
  loading: false,
  error: null,
  listError: null,
  connect: vi.fn(),
  connectBailianConsole: vi.fn(),
  reconnectBailianConsole: vi.fn(),
  cancelBailianConsoleLogin: vi.fn(),
  reconnect: vi.fn(),
  update: vi.fn(),
  verify: vi.fn(),
  disconnect: vi.fn(),
  remove: vi.fn(),
  setupEnvironment: vi.fn(),
  retryList: vi.fn(),
};

describe("连接页面窗口拖动", () => {
  it.each(["onboarding", "settings"] as const)("%s 在工作区导航之外保留拖动标题栏", (mode) => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <ConnectionsGate
        version="0.0.0"
        mode={mode}
        connectionsApi={connectionsApi}
        onBack={vi.fn()}
      />,
    );
    if (mode === "onboarding") expect(container.textContent).toContain("完成连接设置");
    expect(container.querySelector("header")?.className).toContain("[-webkit-app-region:drag]");
    expect(container.querySelector('section[aria-label="连接管理"]')?.className).not.toContain(
      "[-webkit-app-region:drag]",
    );
  });
});
