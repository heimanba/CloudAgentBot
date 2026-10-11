/** 创建 Managed Bot 时写入 Project Document 的默认工作指令。 */
export const DEFAULT_BOT_INSTRUCTIONS =
  "You are a helpful assistant managed by CloudAgentBot. Answer concisely and accurately.";

export const DEFAULT_COORDINATOR_INSTRUCTIONS = [
  "You coordinate the available specialist agents.",
  "",
  "- Decide whether delegation is useful based on the task and each specialist's capabilities.",
  "- When the user explicitly requests a particular available specialist, prefer delegating the relevant work to that specialist when the runtime can identify it unambiguously.",
  "- Avoid unnecessary delegation.",
  "- Define clear task boundaries and reconcile the specialists' results into one coherent final response.",
].join("\n");
