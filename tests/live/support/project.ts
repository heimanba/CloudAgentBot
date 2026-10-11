import {
  createCloudEnvironment,
  createProjectRuntime,
  resolveProjectConfigFromObject,
  StateManager,
  type ProjectRuntimeContext,
} from "@openagentpack/sdk";
import { QODER_GATEWAY, type Provider } from "./endpoints";
import type { RestCredentialValues } from "./rest";

export interface TestEnvironmentOptions {
  description?: string;
  /** metadata.openagentbot_test 标签；默认 "live"。 */
  testLabel?: string;
  /** metadata.test_run；默认取环境名。 */
  testRun?: string;
}

/**
 * 为单一 Provider 构建内存态生产 ProjectRuntime（SDK 包根公共导出，
 * 与 EnvironmentControlPlane.setup 的创建分支同形）；凭据只进运行时配置，不落盘。
 */
export async function createTestRuntime(
  provider: Provider,
  credentials: RestCredentialValues,
  projectName = "openagentbot-live-environment-setup",
): Promise<ProjectRuntimeContext> {
  const providerConfig: Record<string, unknown> =
    provider === "qoder"
      ? { api_key: credentials.qoderPat, gateway: QODER_GATEWAY }
      : { api_key: credentials.bailianApiKey, workspace_id: credentials.bailianWorkspaceId };
  const loaded = await resolveProjectConfigFromObject(
    { version: "1", providers: { [provider]: providerConfig }, defaults: { provider } },
    { basePath: ".", projectName },
  );
  return createProjectRuntime({
    projectName: loaded.projectName,
    config: loaded.config,
    state: StateManager.initialize(":memory:"),
  });
}

/** 用 SDK 创建带唯一前缀的 Cloud 测试环境；等同 setup 在零环境账号中的内部创建分支。 */
export async function createTestEnvironment(
  provider: Provider,
  name: string,
  credentials: RestCredentialValues,
  options: TestEnvironmentOptions = {},
): Promise<string> {
  const runtime = await createTestRuntime(provider, credentials);
  const created = await createCloudEnvironment(
    runtime,
    name,
    {
      name,
      description: options.description ?? "CloudAgentBot live test environment",
      config: { type: "cloud", networking: { type: "unrestricted" } },
      metadata: {
        openagentbot_test: options.testLabel ?? "live",
        test_run: options.testRun ?? name,
      },
    },
    { provider },
  );
  if (created.id === null) throw new Error("created environment returned null id");
  return created.id;
}
