// @vitest-environment happy-dom

import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "../../test-support/mount";
import { ConnectionsPage } from "./connections-page";
import type { UseConnectionsResult } from "./use-connections";

afterEach(() => {
  document.body.innerHTML = "";
});

function renderPage(
  connectionsApi: UseConnectionsResult,
  props: {
    mode?: "onboarding" | "settings";
    activeConnectionId?: string | null;
    onConnected?(): void;
  } = {},
) {
  const view = mount(<ConnectionsPage connectionsApi={connectionsApi} {...props} />);
  return { container: view.container, unmount: view.unmount };
}

describe("ConnectionsPage 默认选中", () => {
  const qoderConn = {
    id: "conn-qoder",
    provider: "qoder",
    displayName: "Qoder 工作",
    credentialStored: true,
    managedBotDataCount: 0,
    environmentReady: true,
  };
  const bailianConn = {
    id: "conn-bailian",
    provider: "bailian",
    displayName: "百炼生产",
    credentialStored: true,
    managedBotDataCount: 0,
    environmentReady: true,
    workspaceId: "ws-1",
  };

  it("设置模式默认选中当前活动连接", () => {
    const { container, unmount } = renderPage(
      makeConnectionsApi({ connections: [qoderConn, bailianConn] }),
      { activeConnectionId: "conn-bailian" },
    );
    expect(container.querySelector("h2")?.textContent).toBe("百炼生产");
    unmount();
  });

  it("未提供活动连接时回退到首个已存凭据的连接", () => {
    const { container, unmount } = renderPage(
      makeConnectionsApi({ connections: [qoderConn, bailianConn] }),
    );
    expect(container.querySelector("h2")?.textContent).toBe("Qoder 工作");
    unmount();
  });
});

describe("ConnectionsPage onboarding", () => {
  it("连接建立后仍在添加弹窗内展示运行环境候选", async () => {
    const created = {
      id: "conn-new",
      provider: "qoder",
      displayName: "Qoder",
      credentialStored: true,
      managedBotDataCount: 0,
      environmentReady: false,
    };
    const base = makeConnectionsApi();
    function Scenario() {
      const [connections, setConnections] = useState<typeof base.connections>([]);
      return (
        <ConnectionsPage
          mode="onboarding"
          connectionsApi={{
            ...base,
            connections,
            connect: async () => {
              setConnections([created]);
              return {
                status: "selection-required",
                connection: created,
                candidates: [{ environmentId: "env-a", name: "环境 A" }],
              };
            },
          }}
        />
      );
    }
    const view = mount(<Scenario />);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((item) => item.textContent?.trim() === "添加连接")!
        .click();
    });
    const credential = document.getElementById("connection-credential") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(credential, "test-token");
      credential.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((item) => item.textContent?.includes("验证并添加"))!
        .click();
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("环境 A");
    expect(
      document.querySelector('[aria-label="连接进度"] [aria-current="step"]')?.textContent,
    ).toContain("3 设置运行环境");
    view.unmount();
  });

  it("已有凭据但环境未就绪时引导完成环境设置并进入工作区", async () => {
    const setupEnvironment = vi.fn(() => Promise.resolve({ status: "ready" as const }));
    const onConnected = vi.fn();
    const connectionsApi = makeConnectionsApi({
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
      setupEnvironment,
    });
    const { container, unmount } = renderPage(connectionsApi, {
      mode: "onboarding",
      onConnected,
    });

    expect(container.textContent).toContain("完成 工作账号 设置");
    expect(container.textContent).toContain("还需要完成运行环境设置");
    expect(container.textContent).not.toContain("危险操作");
    expect(container.textContent).not.toContain("删除本地连接");

    const setupButton = [...container.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "继续设置",
    )!;
    await act(async () => setupButton.click());

    expect(setupEnvironment).toHaveBeenCalledWith("conn-1");
    expect(onConnected).toHaveBeenCalledOnce();
    unmount();
  });

  it("需要选择环境时留在 onboarding，选择完成后才进入工作区", async () => {
    const setupEnvironment = vi
      .fn()
      .mockResolvedValueOnce({
        status: "selection-required" as const,
        candidates: [
          { environmentId: "env-a", name: "环境 A" },
          { environmentId: "env-b", name: "环境 B" },
        ],
      })
      .mockResolvedValueOnce({ status: "ready" as const });
    const onConnected = vi.fn();
    const connectionsApi = makeConnectionsApi({
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
      setupEnvironment,
    });
    const { container, unmount } = renderPage(connectionsApi, {
      mode: "onboarding",
      onConnected,
    });

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent?.trim() === "继续设置")!
        .click();
    });
    expect(container.textContent).toContain("环境 A");
    expect(container.textContent).not.toContain("选择运行环境");
    expect(onConnected).not.toHaveBeenCalled();

    await act(async () => {
      (container.querySelector('[role="radio"][value="env-b"]') as HTMLElement | null)?.click();
    });
    const confirmButton = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("使用选定环境"),
    )!;
    await act(async () => confirmButton.click());

    expect(setupEnvironment).toHaveBeenNthCalledWith(2, "conn-1", "env-b");
    expect(onConnected).toHaveBeenCalledOnce();
    unmount();
  });
});

function makeConnectionsApi(overrides: Partial<UseConnectionsResult> = {}): UseConnectionsResult {
  return {
    connections: [],
    loading: false,
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
    error: null,
    listError: null,
    retryList: vi.fn(async () => overrides.connections ?? []),
    ...overrides,
  };
}

function getAlertDialog() {
  return document.querySelector('[role="alertdialog"]');
}

describe("ConnectionsPage 移除凭据", () => {
  it("移除凭据前弹出二次确认，确认后才调用 disconnect", async () => {
    const deferred = Promise.withResolvers<void>();
    const disconnect = vi.fn(() => deferred.promise);
    const connectionsApi = makeConnectionsApi({
      connections: [
        {
          id: "conn-1",
          provider: "qoder",
          displayName: "工作账号",
          credentialStored: true,
          managedBotDataCount: 0,
          environmentReady: true,
        },
      ],
      disconnect,
    });
    const { container, unmount } = renderPage(connectionsApi);
    act(() =>
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent?.includes("工作账号"))!
        .click(),
    );
    // 已删除的“常规”设置分区不得回潮。
    expect(container.textContent).not.toContain("常规");
    const removeButton = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("断开连接"),
    )!;

    act(() => removeButton.click());

    const dialog = getAlertDialog();
    expect(dialog).not.toBeNull();
    const confirmButton = [...(dialog?.querySelectorAll("button") ?? [])].find((item) =>
      item.textContent?.includes("断开连接"),
    )!;
    expect(confirmButton).toBeDefined();

    act(() => confirmButton.click());

    expect(disconnect).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledWith("conn-1");

    await act(async () => deferred.resolve());
    unmount();
  });

  it("移除期间禁用当前动作并阻止重复提交", async () => {
    const deferred = Promise.withResolvers<void>();
    const disconnect = vi.fn(() => deferred.promise);
    const connectionsApi = makeConnectionsApi({
      connections: [
        {
          id: "conn-1",
          provider: "qoder",
          displayName: "工作账号",
          credentialStored: true,
          managedBotDataCount: 0,
          environmentReady: true,
        },
      ],
      disconnect,
    });
    const { container, unmount } = renderPage(connectionsApi);
    act(() =>
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent?.includes("工作账号"))!
        .click(),
    );
    const removeButton = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("断开连接"),
    )!;

    act(() => removeButton.click());

    expect(disconnect).not.toHaveBeenCalled();
    expect(getAlertDialog()).not.toBeNull();

    // 重复点击原按钮不应打开第二个确认弹窗。
    act(() => removeButton.click());
    expect(document.querySelectorAll('[role="alertdialog"]').length).toBe(1);
    expect(disconnect).not.toHaveBeenCalled();

    const confirmButton = [...(getAlertDialog()?.querySelectorAll("button") ?? [])].find((item) =>
      item.textContent?.includes("断开连接"),
    )!;
    act(() => confirmButton.click());

    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeButton.disabled).toBe(true);
    expect(removeButton.getAttribute("aria-busy")).toBe("true");
    expect(removeButton.textContent).toContain("断开中");

    await act(async () => deferred.resolve());
    unmount();
  });
});

describe("ConnectionsPage 删除本地连接", () => {
  it("刷新过期数量，冲突后保留弹窗并要求重新确认", async () => {
    const connection = {
      id: "conn-1",
      provider: "qoder",
      displayName: "工作账号",
      credentialStored: true,
      managedBotDataCount: 0,
      environmentReady: true,
    };
    const retryList = vi
      .fn()
      .mockResolvedValueOnce([connection])
      .mockResolvedValueOnce([{ ...connection, managedBotDataCount: 2 }]);
    const remove = vi
      .fn()
      .mockRejectedValueOnce({ code: "conflict", message: "explicit removal required" })
      .mockResolvedValueOnce(undefined);
    const { container, unmount } = renderPage(
      makeConnectionsApi({
        connections: [connection],
        retryList,
        remove,
      }),
    );
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "删除本地连接…")!
        .click();
    });
    expect(retryList).toHaveBeenCalledTimes(1);
    await act(async () => {
      [...getAlertDialog()!.querySelectorAll("button")]
        .find((button) => button.textContent === "删除本地连接")!
        .click();
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenLastCalledWith("conn-1", false);
    expect(getAlertDialog()?.textContent).toContain("2 份 Managed Bot 本地管理资料");
    expect(getAlertDialog()?.textContent).toContain("请重新确认");
    await act(async () => {
      [...getAlertDialog()!.querySelectorAll("button")]
        .find((button) => button.textContent === "删除连接及本地管理资料")!
        .click();
    });
    expect(remove).toHaveBeenLastCalledWith("conn-1", true);
    expect(getAlertDialog()).toBeNull();
    unmount();
  });

  it("资料刷新失败时不能删除，重新加载成功后才允许确认", async () => {
    const connection = {
      id: "conn-1",
      provider: "qoder",
      displayName: "工作账号",
      credentialStored: true,
      managedBotDataCount: 0,
      environmentReady: true,
    };
    const retryList = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ ...connection, managedBotDataCount: 3 }]);
    const remove = vi.fn().mockResolvedValue(undefined);
    const { container, unmount } = renderPage(
      makeConnectionsApi({
        connections: [connection],
        retryList,
        remove,
      }),
    );
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "删除本地连接…")!
        .click();
    });
    expect(getAlertDialog()?.textContent).toContain("无法读取此连接的最新资料");
    await act(async () => {
      [...getAlertDialog()!.querySelectorAll("button")]
        .find((button) => button.textContent === "重新加载")!
        .click();
    });
    expect(remove).not.toHaveBeenCalled();
    expect(getAlertDialog()?.textContent).toContain("3 份 Managed Bot 本地管理资料");
    await act(async () => {
      [...getAlertDialog()!.querySelectorAll("button")]
        .find((button) => button.textContent === "删除连接及本地管理资料")!
        .click();
    });
    expect(remove).toHaveBeenCalledWith("conn-1", true);
    unmount();
  });

  it("明确展示并确认 Managed Bot 本地管理资料的永久删除", async () => {
    const remove = vi.fn(() => Promise.resolve());
    const connectionsApi = makeConnectionsApi({
      connections: [
        {
          id: "conn-1",
          provider: "qoder",
          displayName: "工作账号",
          credentialStored: true,
          managedBotDataCount: 2,
          environmentReady: true,
        },
      ],
      remove,
    });
    const { container, unmount } = renderPage(connectionsApi);
    act(() =>
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent?.includes("工作账号"))!
        .click(),
    );
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent?.includes("删除本地连接"))!
        .click(),
    );

    const dialog = getAlertDialog();
    expect(dialog?.textContent).toContain("2 份 Managed Bot 本地管理资料");
    expect(dialog?.textContent).toContain("Provider 中的 Bot、Chat 和消息不会删除");
    await act(async () =>
      [...(dialog?.querySelectorAll("button") ?? [])]
        .find((item) => item.textContent?.includes("删除连接及本地管理资料"))!
        .click(),
    );

    expect(remove).toHaveBeenCalledWith("conn-1", true);
    unmount();
  });
});

describe("ConnectionsPage 重新验证", () => {
  it("凭据已移除的连接显示重新验证按钮", () => {
    const connectionsApi = makeConnectionsApi({
      connections: [
        {
          id: "conn-1",
          provider: "qoder",
          displayName: "工作账号",
          credentialStored: false,
          managedBotDataCount: 0,
          environmentReady: true,
        },
      ],
    });
    const { container, unmount } = renderPage(connectionsApi);

    act(() =>
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent?.includes("工作账号"))!
        .click(),
    );
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "连接账号",
    );
    expect(button).toBeDefined();

    unmount();
  });

  it("点击重新验证后展开凭据表单，提交时调用 reconnect", async () => {
    const deferred = Promise.withResolvers<void>();
    const reconnect = vi.fn(() => deferred.promise);
    const connectionsApi = makeConnectionsApi({
      connections: [
        {
          id: "conn-1",
          provider: "qoder",
          displayName: "工作账号",
          credentialStored: false,
          managedBotDataCount: 0,
          environmentReady: true,
        },
      ],
      reconnect,
    });
    const { container, unmount } = renderPage(connectionsApi);

    act(() => {
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent?.includes("工作账号"))
        ?.click();
    });
    act(() => {
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent?.trim() === "连接账号")
        ?.click();
    });

    const input = document.querySelector("input[type='password']") as HTMLInputElement;
    expect(input).toBeDefined();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "new-pat");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = [...document.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("验证并保存"),
    )!;
    await act(async () => submit.click());

    expect(reconnect).toHaveBeenCalledWith({ connectionId: "conn-1", credential: "new-pat" });
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toContain("验证中");

    await act(async () => deferred.resolve());
    unmount();
  });

  it.each([
    ["settings", false],
    ["onboarding", false],
    ["settings", true],
    ["onboarding", true],
  ] as const)(
    "百炼 %s 手动重连（切换 Workspace：%s），失败后重试",
    async (mode, changeWorkspace) => {
      const save = vi
        .fn()
        .mockRejectedValueOnce(new Error("invalid key"))
        .mockResolvedValueOnce(undefined);
      const reconnect = changeWorkspace ? vi.fn() : save;
      const update = changeWorkspace ? save : vi.fn();
      const reconnectBailianConsole = vi.fn();
      const onConnected = vi.fn();
      const api = makeConnectionsApi({
        connections: [
          {
            id: "conn-bailian",
            provider: "bailian",
            displayName: "Bailian",
            workspaceId: "ws-old",
            credentialStored: false,
            managedBotDataCount: 0,
            environmentReady: true,
          },
        ],
        reconnect,
        update,
        reconnectBailianConsole,
      });
      const { unmount } = renderPage(api, { mode, onConnected });
      const click = async (label: string) => {
        await act(async () => {
          [...document.querySelectorAll("button")]
            .find((button) => button.textContent?.trim() === label)!
            .click();
        });
      };
      if (mode === "settings")
        act(() => {
          [...document.querySelectorAll("button")]
            .find((button) => button.textContent?.includes("Bailian"))!
            .click();
        });
      if (mode === "settings") await click("连接账号");
      expect(document.querySelector("input[type='password']")).not.toBeNull();
      expect(
        document.querySelector('[aria-label="连接方式"] [aria-pressed="true"]')?.textContent,
      ).toContain("手动输入 API Key");
      const workspace = document.querySelector(
        "#reconnect-workspace-conn-bailian",
      ) as HTMLInputElement;
      expect(workspace).not.toBeNull();
      expect(workspace.value).toBe("ws-old");
      const fillWorkspace = async (value: string) => {
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
            workspace,
            value,
          );
          workspace.dispatchEvent(new Event("input", { bubbles: true }));
        });
      };
      const input = document.querySelector("input[type='password']") as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          "replacement-key",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await fillWorkspace("   ");
      const submit = [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "验证并保存",
      )!;
      expect(submit.disabled).toBe(true);
      await fillWorkspace(changeWorkspace ? " ws-new " : " ws-old ");
      await click("验证并保存");
      expect(workspace.value).toBe(changeWorkspace ? " ws-new " : " ws-old ");
      expect(input.value).toBe("replacement-key");
      expect(onConnected).not.toHaveBeenCalled();
      expect(document.querySelector("input[type='password']")).not.toBeNull();
      await click("验证并保存");
      expect(save).toHaveBeenLastCalledWith({
        connectionId: "conn-bailian",
        credential: "replacement-key",
        ...(changeWorkspace ? { displayName: "Bailian", workspaceId: "ws-new" } : {}),
      });
      expect(changeWorkspace ? reconnect : update).not.toHaveBeenCalled();
      expect(reconnectBailianConsole).not.toHaveBeenCalled();
      expect(onConnected).toHaveBeenCalledOnce();
      if (mode === "settings") expect(document.querySelector("input[type='password']")).toBeNull();
      else expect(input.value).toBe("");
      unmount();
    },
  );

  it("百炼重新连接先选择方式，再显式打开 Console 登录", async () => {
    const deferred = Promise.withResolvers<void>();
    const reconnectBailianConsole = vi.fn(() => deferred.promise);
    const connectionsApi = makeConnectionsApi({
      connections: [
        {
          id: "conn-bailian",
          provider: "bailian",
          displayName: "Bailian",
          workspaceId: "ws-old",
          credentialStored: false,
          managedBotDataCount: 0,
          environmentReady: true,
        },
      ],
      reconnectBailianConsole,
    });
    const { container, unmount } = renderPage(connectionsApi);

    act(() => {
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent?.includes("Bailian"))
        ?.click();
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent?.trim() === "连接账号")
        ?.click();
    });

    expect(reconnectBailianConsole).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("手动输入 API Key");
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((item) => item.textContent?.trim() === "百炼账号登录")!
        .click();
    });
    expect(reconnectBailianConsole).not.toHaveBeenCalled();
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((item) => item.textContent?.trim() === "打开浏览器并连接")!
        .click();
    });
    expect(reconnectBailianConsole).toHaveBeenCalledWith("conn-bailian");
    expect(document.querySelector("input[type='password']")).toBeNull();
    expect(document.body.textContent).toContain("正在等待浏览器授权");

    await act(async () => deferred.resolve());
    unmount();
  });
});

describe("ConnectionsPage 列表加载失败", () => {
  it("展示列表错误并提供重试按钮", () => {
    const retryList = vi.fn();
    const connectionsApi = makeConnectionsApi({
      listError: { code: "unavailable", message: "list failed" },
      retryList,
    });
    const { container, unmount } = renderPage(connectionsApi);

    const alert = container.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("加载连接列表失败");

    const retryButton = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("重试"),
    )!;
    act(() => retryButton.click());
    expect(retryList).toHaveBeenCalledOnce();

    unmount();
  });
});
