// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "../../test-support/mount";
import { AddConnectionDialog } from "./add-connection-dialog";
import type { UseConnectionsResult } from "./use-connections";

const CONNECTED = {
  id: "conn-test",
  provider: "qoder",
  displayName: "Qoder",
  credentialStored: true,
  managedBotDataCount: 0,
  environmentReady: true,
};

afterEach(() => {
  document.body.innerHTML = "";
});

function makeConnectionsApi(overrides: Partial<UseConnectionsResult> = {}): UseConnectionsResult {
  return {
    connections: [],
    loading: false,
    connect: vi.fn(() => Promise.resolve({ status: "ready" as const, connection: CONNECTED })),
    connectBailianConsole: vi.fn(() =>
      Promise.resolve({ status: "ready" as const, connection: CONNECTED }),
    ),
    reconnectBailianConsole: vi.fn(),
    cancelBailianConsoleLogin: vi.fn(),
    reconnect: vi.fn(),
    update: vi.fn(),
    verify: vi.fn(),
    disconnect: vi.fn(),
    remove: vi.fn(),
    setupEnvironment: vi.fn(),
    error: null,
    listError: null,
    retryList: vi.fn(),
    ...overrides,
  };
}

function renderDialog(connectionsApi: UseConnectionsResult) {
  const view = mount(
    <AddConnectionDialog open onOpenChange={() => undefined} connectionsApi={connectionsApi} />,
  );
  return { unmount: view.unmount };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AddConnectionDialog 连接信息", () => {
  it("新增连接不要求用户预先命名，并提供 Provider 卡片和连接进度", () => {
    const { unmount } = renderDialog(makeConnectionsApi());
    const qoder = document.getElementById("connection-provider-qoder");
    const bailian = document.getElementById("connection-provider-bailian");

    expect(document.getElementById("connection-display-name")).toBeNull();
    expect(qoder).not.toBeNull();
    expect(qoder?.getAttribute("aria-pressed")).toBe("true");
    expect(qoder?.textContent).toContain("Personal Access Token");
    expect(bailian).not.toBeNull();
    expect(bailian?.getAttribute("aria-pressed")).toBe("false");
    expect(document.body.textContent).toContain("1 选择 Provider");
    expect(document.body.textContent).toContain("2 连接账号");
    expect(document.body.textContent).toContain("3 设置运行环境");
    expect(document.body.textContent).toContain("将检查账号中的可用运行环境");
    expect(
      document.querySelector('[aria-label="连接进度"] [aria-current="step"]')?.textContent,
    ).toContain("2 连接账号");
    unmount();
  });

  it("百炼浏览器登录不展示连接名称或凭据字段", async () => {
    const { unmount } = renderDialog(makeConnectionsApi());
    const provider = document.getElementById("connection-provider-bailian") as HTMLButtonElement;
    expect(provider).toBeDefined();
    await act(async () => {
      provider.click();
    });
    expect(document.getElementById("connection-display-name")).toBeNull();
    expect(document.getElementById("connection-workspace-id")).toBeNull();
    expect(document.body.textContent).toContain("百炼账号登录（推荐）");
    expect(document.body.textContent).toContain("自动配置普通按量 API Key 和 Workspace");
    unmount();
  });

  it("百炼默认通过浏览器登录且不要求凭据进入 Renderer", async () => {
    const connectBailianConsole = vi.fn(() =>
      Promise.resolve({ status: "ready" as const, connection: CONNECTED }),
    );
    const { unmount } = renderDialog(makeConnectionsApi({ connectBailianConsole }));
    const provider = document.getElementById("connection-provider-bailian") as HTMLButtonElement;
    await act(async () => provider.click());
    expect(document.getElementById("connection-display-name")).toBeNull();
    expect(document.getElementById("connection-credential")).toBeNull();
    expect(document.getElementById("connection-workspace-id")).toBeNull();
    const submit = [...document.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("打开浏览器并连接"),
    )!;
    await act(async () => submit.click());
    expect(connectBailianConsole).toHaveBeenCalledWith();
    unmount();
  });

  it("百炼保留手动 API Key 入口", async () => {
    const { unmount } = renderDialog(makeConnectionsApi());
    const provider = document.getElementById("connection-provider-bailian") as HTMLButtonElement;
    await act(async () => provider.click());
    const manual = [...document.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("手动输入 API Key"),
    )!;
    await act(async () => manual.click());
    expect(document.getElementById("connection-credential")).not.toBeNull();
    expect(document.getElementById("connection-workspace-id")).not.toBeNull();
    expect(document.body.textContent).toContain("API Key 必须能够访问所填 Workspace");
    unmount();
  });

  it("缺少必填项时不提交并展示字段错误", async () => {
    const connect = vi.fn();
    const { unmount } = renderDialog(makeConnectionsApi({ connect }));
    const credentialInput = document.getElementById("connection-credential") as HTMLInputElement;
    const submit = [...document.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("验证并添加"),
    )!;
    await act(async () => {
      credentialInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(connect).not.toHaveBeenCalled();
    expect(submit.disabled).toBe(true);
    expect(document.body.textContent).toContain("请填写所有必填项");
    expect(document.body.textContent).toContain("请输入凭据");
    expect(credentialInput.getAttribute("aria-invalid")).toBe("true");
    unmount();
  });

  it("Qoder 使用 Provider 英文名且不改写凭据", async () => {
    const connect = vi.fn(() =>
      Promise.resolve({ status: "ready" as const, connection: CONNECTED }),
    );
    const { unmount } = renderDialog(makeConnectionsApi({ connect }));
    const credentialInput = document.getElementById("connection-credential") as HTMLInputElement;
    await act(async () => {
      setInputValue(credentialInput, " token-with-spaces ");
    });
    const submit = [...document.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("验证并添加"),
    )!;
    await act(async () => submit.click());
    expect(connect).toHaveBeenCalledWith({
      provider: "qoder",
      displayName: "Qoder",
      credential: " token-with-spaces ",
    });
    unmount();
  });

  it("运行环境设置失败时标识第三阶段", async () => {
    const connect = vi.fn(() =>
      Promise.resolve({
        status: "setup-error" as const,
        connection: CONNECTED,
        error: { code: "unavailable" as const, message: "设置失败" },
      }),
    );
    const { unmount } = renderDialog(makeConnectionsApi({ connect }));
    const credentialInput = document.getElementById("connection-credential") as HTMLInputElement;
    await act(async () => {
      setInputValue(credentialInput, "test-token");
    });
    const submit = [...document.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("验证并添加"),
    )!;
    await act(async () => submit.click());

    expect(document.body.textContent).toContain("运行环境设置失败");
    expect(
      document.querySelector('[aria-label="连接进度"] [aria-current="step"]')?.textContent,
    ).toContain("3 设置运行环境");
    unmount();
  });

  it("手动添加百炼时使用 Bailian 作为默认名称", async () => {
    const connect = vi.fn(() =>
      Promise.resolve({ status: "ready" as const, connection: CONNECTED }),
    );
    const { unmount } = renderDialog(makeConnectionsApi({ connect }));
    const provider = document.getElementById("connection-provider-bailian") as HTMLButtonElement;
    await act(async () => provider.click());
    const manual = [...document.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("手动输入 API Key"),
    )!;
    await act(async () => manual.click());
    await act(async () => {
      setInputValue(
        document.getElementById("connection-workspace-id") as HTMLInputElement,
        " ws-test ",
      );
      setInputValue(
        document.getElementById("connection-credential") as HTMLInputElement,
        "sk-test",
      );
    });
    const submit = [...document.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("验证并添加"),
    )!;
    await act(async () => submit.click());
    expect(connect).toHaveBeenCalledWith({
      provider: "bailian",
      displayName: "Bailian",
      credential: "sk-test",
      workspaceId: "ws-test",
    });
    unmount();
  });

  it("可以显示和重新隐藏凭据", async () => {
    const { unmount } = renderDialog(makeConnectionsApi());
    const credentialInput = document.getElementById("connection-credential") as HTMLInputElement;
    const toggle = [...document.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("显示凭据"),
    )!;

    await act(async () => toggle.click());
    expect(credentialInput.type).toBe("text");
    expect(toggle.textContent).toContain("隐藏凭据");
    await act(async () => toggle.click());
    expect(credentialInput.type).toBe("password");
    unmount();
  });
});
