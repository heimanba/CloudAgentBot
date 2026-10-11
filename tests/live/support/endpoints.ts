export type Provider = "qoder" | "bailian";

/** Qoder Cloud OpenAPI 网关（生产 DataClient 同源）。 */
export const QODER_GATEWAY = "https://api.qoder.com/api/v1/cloud";

/** 百炼 AgentStudio REST 域名按工作区拼接。 */
export function bailianBaseUrl(workspaceId: string): string {
  return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio`;
}
