import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createProjectRuntime,
  listCloudEnvironments,
  createCloudEnvironment,
  ApiError,
  UserError,
  type EnvironmentDecl,
} from "@openagentpack/sdk";

/**
 * EnvironmentControlPlane 单元测试。
 *
 * 通过 mock @openagentpack/sdk 的 listCloudEnvironments / createCloudEnvironment
 * 控制环境列表与创建结果，验证 setup 的决策逻辑与错误映射。
 * createProjectRuntime 使用真实实现，Cloud 列表/创建边界已替换，不触发网络。
 */

import { EnvironmentControlPlane } from "./environment-control-plane";

vi.mock("@openagentpack/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openagentpack/sdk")>();
  return {
    ...actual,
    createProjectRuntime: vi.fn(actual.createProjectRuntime),
    listCloudEnvironments: vi.fn(),
    createCloudEnvironment: vi.fn(),
  };
});

const mockedListCloudEnvironments = vi.mocked(listCloudEnvironments);
const mockedCreateCloudEnvironment = vi.mocked(createCloudEnvironment);
const mockedCreateProjectRuntime = vi.mocked(createProjectRuntime);

const QODER_CONNECTION = {
  id: "conn_qoder_1",
  provider: "qoder",
  credential: "qoder-pat",
} as const;
const BAILIAN_CONNECTION = {
  id: "conn_bailian_1",
  provider: "bailian",
  credential: "dashscope-key",
  workspaceId: "ws-1",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EnvironmentControlPlane", () => {
  it.each([
    {
      connection: QODER_CONNECTION,
      configProviders: { qoder: {} },
      runtimeProviders: { qoder: { api_key: "qoder-pat" } },
    },
    {
      connection: BAILIAN_CONNECTION,
      configProviders: { bailian: {} },
      runtimeProviders: { bailian: { api_key: "dashscope-key", workspace_id: "ws-1" } },
    },
  ])(
    "keeps $connection.provider credentials out of config and injects runtime providers",
    async ({ connection, configProviders, runtimeProviders }) => {
      mockedListCloudEnvironments.mockResolvedValue([{ id: "env_solo", name: "solo" }]);

      await new EnvironmentControlPlane().setup(connection);

      const input = mockedCreateProjectRuntime.mock.calls.at(-1)?.[0];
      expect(input?.config.providers).toEqual(configProviders);
      expect(input?.providers).toEqual(runtimeProviders);
    },
  );

  it("无未归档环境时创建 CloudAgentBot 管理的默认环境并返回 ready", async () => {
    mockedListCloudEnvironments.mockResolvedValue([
      { id: "env_archived", name: "old", archived_at: "2024-01-01T00:00:00Z" },
    ]);
    mockedCreateCloudEnvironment.mockResolvedValue({ id: "env_created", type: "environment" });

    const plane = new EnvironmentControlPlane();
    const result = await plane.setup({ ...QODER_CONNECTION }, undefined);

    expect(result).toEqual({ status: "ready", environmentId: "env_created" });
    expect(mockedListCloudEnvironments).toHaveBeenCalledTimes(1);
    expect(mockedCreateCloudEnvironment).toHaveBeenCalledTimes(1);
    const call = mockedCreateCloudEnvironment.mock.calls[0]!;
    expect(call[1]).toBe("CloudAgentBot Default oder_1");
    expect((call[2] as EnvironmentDecl).metadata).toMatchObject({
      openagentbot_managed: "true",
      openagentbot_connection_id: "conn_qoder_1",
    });
  });

  it("恰好一个未归档环境时直接选中，不创建新环境", async () => {
    mockedListCloudEnvironments.mockResolvedValue([{ id: "env_solo", name: "solo" }]);

    const plane = new EnvironmentControlPlane();
    const result = await plane.setup({ ...QODER_CONNECTION }, undefined);

    expect(result).toEqual({ status: "ready", environmentId: "env_solo" });
    expect(mockedCreateCloudEnvironment).not.toHaveBeenCalled();
  });

  it("多个未归档环境时返回 selection-required，不创建环境", async () => {
    mockedListCloudEnvironments.mockResolvedValue([
      { id: "env_1", name: "one" },
      { id: "env_2", name: "two" },
      { id: "env_archived", name: "old", archived_at: "2024-01-01T00:00:00Z" },
    ]);

    const plane = new EnvironmentControlPlane();
    const result = await plane.setup({ ...QODER_CONNECTION }, undefined);

    expect(result).toEqual({
      status: "selection-required",
      candidates: [
        { environmentId: "env_1", name: "one" },
        { environmentId: "env_2", name: "two" },
      ],
    });
    expect(mockedCreateCloudEnvironment).not.toHaveBeenCalled();
  });

  it("显式 environmentId 在候选列表中时直接 ready，不创建环境", async () => {
    mockedListCloudEnvironments.mockResolvedValue([
      { id: "env_1", name: "one" },
      { id: "env_2", name: "two" },
    ]);

    const plane = new EnvironmentControlPlane();
    const result = await plane.setup({ ...QODER_CONNECTION }, "env_2");

    expect(result).toEqual({ status: "ready", environmentId: "env_2" });
    expect(mockedCreateCloudEnvironment).not.toHaveBeenCalled();
  });

  it("显式 environmentId 不在候选列表中时抛 not-found", async () => {
    mockedListCloudEnvironments.mockResolvedValue([{ id: "env_1", name: "one" }]);

    const plane = new EnvironmentControlPlane();
    await expect(plane.setup({ ...QODER_CONNECTION }, "env_missing")).rejects.toMatchObject({
      code: "not-found",
    });
    expect(mockedCreateCloudEnvironment).not.toHaveBeenCalled();
  });

  it("SDK ApiError 按状态码映射为稳定 HostError，不携带 Provider 正文", async () => {
    mockedListCloudEnvironments.mockRejectedValue(
      new ApiError(401, '{"error":"bad token"}', "Qoder API"),
    );

    const plane = new EnvironmentControlPlane();
    await expect(plane.setup({ ...QODER_CONNECTION }, undefined)).rejects.toMatchObject({
      code: "authentication",
    });
  });

  it("SDK UserError 映射为 invalid-input，网络失败映射为 unavailable", async () => {
    mockedListCloudEnvironments.mockRejectedValueOnce(new UserError("bad config"));
    const plane = new EnvironmentControlPlane();
    await expect(plane.setup({ ...QODER_CONNECTION }, undefined)).rejects.toMatchObject({
      code: "invalid-input",
    });

    mockedListCloudEnvironments.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(plane.setup({ ...QODER_CONNECTION }, undefined)).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
