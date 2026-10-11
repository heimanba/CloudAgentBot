/**
 * OpenAgentPack LocalFileStateBackend 的接入位置。
 *
 * 本客户端把每个 Managed Bot scope 的 statePath 固定为该 scope 目录下的
 * agents.state.json。LocalFileStateBackend 独占该文件的写入；其他 Module
 * 只判断文件是否存在、可解析，绝不解析或修改其内部字段。
 *
 * 本 Module 是本客户端接触 LocalFileStateBackend 的唯一位置，便于后续切换
 * statePath 约定或在 SDK 提供更高层公共 Interface 时收敛。
 */
import { LocalFileStateBackend } from "@openagentpack/sdk";

export type ManagedStateFile = "agents.state.json" | "backup/agents.state.json";

/**
 * 为一个 scope 创建 LocalFileStateBackend，state 落在 `scopeDir/<file>`。
 * 只构造 Backend，不触发任何远程调用；真实 apply/Sync 由 Stage 07 的
 * BotControlPlane 在持有 credential 与 scope lock 时调用。
 *
 * `backup/agents.state.json` 变体只用于把历史 agentId 关联只读取出，供
 * state-missing 诊断；backup 绝不进入 SDK apply/Sync 输入。
 */
export function createManagedStateBackend(
  scopeDir: string,
  file: ManagedStateFile = "agents.state.json",
): LocalFileStateBackend {
  return new LocalFileStateBackend({ statePath: `${scopeDir}/${file}` });
}
