import type { ConnectInput, HostErrorCode } from "@shared/models";
import { hostError, isHostError } from "@shared/errors";
import type { ConnectionVerifier } from "./connection-verifier";

function classifyStatus(status: number): HostErrorCode {
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "unavailable";
  return "invalid-input";
}

export function bailianBaseUrl(workspaceId: string): string {
  if (!isValidBailianWorkspaceId(workspaceId)) {
    throw hostError("invalid-input", "Bailian workspaceId must be a valid DNS label");
  }
  return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio`;
}

/** Workspace ID 是 API hostname 的单一 DNS label；禁止路径、userinfo、端口与片段注入。 */
export function isValidBailianWorkspaceId(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
}

export function createBailianVerifier(fetchImpl: typeof fetch = fetch): ConnectionVerifier {
  return {
    async verify(input: ConnectInput): Promise<void> {
      const workspaceId = input.workspaceId?.trim();
      if (!workspaceId || !isValidBailianWorkspaceId(workspaceId)) {
        throw hostError("invalid-input", "Bailian workspaceId must be a valid DNS label");
      }
      try {
        const response = await fetchImpl(`${bailianBaseUrl(workspaceId)}/agents?limit=1`, {
          headers: { Authorization: `Bearer ${input.credential}` },
        });
        if (!response.ok) {
          throw hostError(
            classifyStatus(response.status),
            `bailian verification rejected with status ${response.status}`,
          );
        }
      } catch (error) {
        if (isHostError(error)) throw error;
        throw hostError("unavailable", "bailian verification unavailable");
      }
    },
  };
}
