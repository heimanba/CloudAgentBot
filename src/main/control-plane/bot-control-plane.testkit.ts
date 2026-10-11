/**
 * BotControlPlane 测试共享助手。
 * OpenAgentPack SDK 的 Sync/归档被整体 mock（Provider 副作用不进入单元测试）。
 * `vi.mock` 是 per-file hoisted，必须留在各测试文件顶层；各测试文件顶层写内联 factory：
 *   vi.mock("@openagentpack/sdk", async (importOriginal) => ({
 *     ...(await importOriginal()),
 *     syncProjectResourcesWithStateBackend: sdkMocks.syncProjectResourcesWithStateBackend,
 *     ... // 其余三个受控函数同
 *   }));
 * factory 惰性执行，可安全引用本模块的 sdkMocks 单例。
 */
import { vi } from "vitest";
import type { LocalFileStateBackend } from "@openagentpack/sdk";
import { DEFAULT_BOT_INSTRUCTIONS } from "@shared/default-bot-instructions";

// 模块级单例：被各测试文件的 vi.mock factory（惰性执行）与断言共享，无需 vi.hoisted。
// 本模块只做值无关的 mock 与纯数据助手；不 import bot-control-plane/managed-bot-store
// 等会触发 @openagentpack/sdk 加载链的模块，避免 vi.mock factory 执行时本模块仍在 TDZ。
export const sdkMocks = {
  syncProjectResourcesWithStateBackend: vi.fn(),
  resolveProjectConfigFromObject: vi.fn(),
  readProjectRuntime: vi.fn(),
  archiveCloudAgent: vi.fn(),
  createProjectRuntime: vi.fn(),
  listSkills: vi.fn(),
};

/** 测试用 Connection id。 */
export const CONN = "conn_test";
/** 创建路径的固定默认值（project-document.ts）：模型与 Instructions。 */
export const DEFAULT_MODEL = "auto";
export const DEFAULT_INSTRUCTIONS = DEFAULT_BOT_INSTRUCTIONS;

/** mock Sync 收到的 config 来自测试写入的 agents.yaml；窄化一次后读 agents 段。 */
export interface SyncedAgentShape {
  name?: string;
  description?: string;
  instructions?: string;
  model?: string;
}

export function syncedAgents(config: unknown): Record<string, SyncedAgentShape> {
  if (typeof config !== "object" || config === null) return {};
  const agents = (config as Record<string, unknown>).agents;
  if (typeof agents !== "object" || agents === null) return {};
  return agents as Record<string, SyncedAgentShape>;
}

/** mock Sync 收到的 config 中某 agent 条目的原始字段（未声明时返回空对象）。 */
export function syncedAgentRaw(config: unknown, logicalName: string): Record<string, unknown> {
  const agents = (config as { agents?: unknown } | null)?.agents;
  if (typeof agents !== "object" || agents === null) return {};
  const agent = (agents as Record<string, unknown>)[logicalName];
  return typeof agent === "object" && agent !== null ? (agent as Record<string, unknown>) : {};
}

/** mock SDK：resolve 原样返回；sync 记录调用参数，经 stateBackend 写一个 agent remote_id。 */
export function mockSdkSuccess(agentId = "agent-1") {
  sdkMocks.resolveProjectConfigFromObject.mockImplementation(
    (raw: unknown, opts: { projectName: string }) =>
      Promise.resolve({ config: raw, projectName: opts.projectName }),
  );
  sdkMocks.syncProjectResourcesWithStateBackend.mockImplementation(
    async (input: { stateBackend: LocalFileStateBackend; stateScope: { projectId: string } }) => {
      await input.stateBackend.write(input.stateScope, (state) => {
        state.setResource({
          address: { provider: "qoder", type: "agent", name: "Demo" },
          remote_id: agentId,
          content_hash: "h",
        });
      });
      return { planned: [], execution: { results: [], partial: false } };
    },
  );
}

/** mock 归档路径的 readProjectRuntime：调用回调并转发到 archiveCloudAgent。 */
export function mockArchiveRuntime() {
  sdkMocks.readProjectRuntime.mockImplementation(
    async (
      input: {
        providers: Record<string, unknown>;
        stateBackend: LocalFileStateBackend;
        stateScope: { projectId: string };
      },
      fn: (runtime: { providers: Record<string, unknown> }) => Promise<unknown>,
    ) => {
      // 只透传 providers（凭据注入点），不构造真实 Provider client。
      return fn({ providers: input.providers });
    },
  );
}

/** 完整四字段 update 输入（含 roster 空数组 = 普通 Bot）；缺省沿创建默认值。 */
export function fullInput(
  overrides: Partial<{
    name: string;
    description: string;
    instructions: string;
    model: string;
    memberAgentIds: string[];
  }> = {},
) {
  return {
    name: overrides.name ?? "Demo",
    description: overrides.description ?? "old",
    instructions: overrides.instructions ?? DEFAULT_INSTRUCTIONS,
    model: overrides.model ?? DEFAULT_MODEL,
    skills: [],
    memberAgentIds: overrides.memberAgentIds ?? [],
  };
}
