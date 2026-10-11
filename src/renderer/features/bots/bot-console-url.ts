export function botConsoleUrl(provider: string | undefined, agentId: string): string | null {
  const id = encodeURIComponent(agentId);
  if (provider === "bailian") return `https://agent.console.aliyun.com/managed-agent/agents/${id}`;
  if (provider === "qoder") return `https://qoder.com/cloud/agents/${id}`;
  return null;
}
