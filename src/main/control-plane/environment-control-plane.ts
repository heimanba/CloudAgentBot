import {
  createCloudEnvironment,
  createProjectRuntime,
  listCloudEnvironments,
  resolveProjectConfigFromObject,
  StateManager,
  type EnvironmentDecl,
  type ProjectRuntimeContext,
} from "@openagentpack/sdk";
import { hostError } from "@shared/errors";
import type { EnvironmentCandidate, EnvironmentSetupResult } from "@shared/models";
import { toControlPlaneError } from "./control-plane-errors";

/**
 * EnvironmentControlPlane：Connection 运行环境设置的控制面 Module。
 *
 * 只消费 @openagentpack/sdk 包根公共导出，在内存 runtime 中执行：
 * 不写 Project Document，不落 agents.state.json，不修改 Provider 侧现有资源。
 * 它把「列出未归档环境」「创建 CloudAgentBot 管理的默认环境」「按指定 ID 选中」
 * 收敛为一个 setup 方法，返回 ready 或候选列表。
 */

export interface EnvironmentControlPlaneConnection {
  id: string;
  provider: string;
  credential: string;
  workspaceId?: string;
}

const DEFAULT_PROJECT_NAME = "openagentbot-environment-setup";

async function createEnvironmentRuntime(
  connection: EnvironmentControlPlaneConnection,
): Promise<ProjectRuntimeContext> {
  const providerConfig: Record<string, unknown> = { api_key: connection.credential };
  if (connection.workspaceId !== undefined) {
    providerConfig.workspace_id = connection.workspaceId;
  }
  const loaded = await resolveProjectConfigFromObject(
    {
      version: "1",
      providers: { [connection.provider]: {} },
      defaults: { provider: connection.provider },
    },
    { basePath: ".", projectName: DEFAULT_PROJECT_NAME },
  );
  const state = StateManager.initialize(":memory:");
  return createProjectRuntime({
    projectName: loaded.projectName,
    config: loaded.config,
    state,
    providers: { [connection.provider]: providerConfig },
  });
}

function isEnvironmentLive(environment: { archived_at?: string | null }): boolean {
  return environment.archived_at === undefined || environment.archived_at === null;
}

function toEnvironmentCandidate(environment: { id: string; name?: string }): EnvironmentCandidate {
  return {
    environmentId: environment.id,
    // 空字符串也回退到 ID（Provider 可能返回 name: ""）。
    name: environment.name ? environment.name : environment.id,
  };
}

export class EnvironmentControlPlane {
  /**
   * 为 Connection 准备运行环境。
   *
   * - environmentId 存在：在凭据可见的未归档列表中校验，存在则直接 ready，不存在抛 not-found。
   * - environmentId 不存在：列出未归档环境；0 个时创建默认环境，1 个时直接选中，多个时返回候选。
   *
   * 任何 SDK/网络失败抛 HostError；不解释 Provider 错误消息，不携带凭据或 Provider 正文。
   */
  async setup(
    connection: EnvironmentControlPlaneConnection,
    environmentId?: string,
  ): Promise<EnvironmentSetupResult> {
    let runtime: ProjectRuntimeContext;
    try {
      runtime = await createEnvironmentRuntime(connection);
    } catch (error) {
      throw toControlPlaneError(error, "environment setup runtime");
    }

    let environments;
    try {
      environments = await listCloudEnvironments(runtime, { provider: connection.provider });
    } catch (error) {
      throw toControlPlaneError(error, "list environments");
    }

    const live = environments.filter(isEnvironmentLive);

    if (environmentId !== undefined) {
      const selected = live.find((env) => env.id === environmentId);
      if (selected === undefined) {
        throw hostError("not-found", `environment not found: ${environmentId}`);
      }
      return { status: "ready", environmentId: selected.id };
    }

    if (live.length === 0) {
      const name = `CloudAgentBot Default ${connection.id.slice(-6)}`;
      const decl: EnvironmentDecl = {
        name,
        description: "Shared runtime environment for CloudAgentBot",
        config: { type: "cloud", networking: { type: "unrestricted" } },
        metadata: {
          openagentbot_managed: "true",
          openagentbot_connection_id: connection.id,
        },
      };
      let created;
      try {
        created = await createCloudEnvironment(runtime, name, decl, {
          provider: connection.provider,
        });
      } catch (error) {
        throw toControlPlaneError(error, "create environment");
      }
      if (created.id === null) {
        throw hostError("unavailable", "created environment returned null id");
      }
      return { status: "ready", environmentId: created.id };
    }

    if (live.length === 1) {
      return { status: "ready", environmentId: live[0]!.id };
    }

    return {
      status: "selection-required",
      candidates: live.map(toEnvironmentCandidate),
    };
  }
}
