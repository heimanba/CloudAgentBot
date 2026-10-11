import { ApiError, UserError } from "@openagentpack/sdk";
import { hostError } from "@shared/errors";
import type { HostError, HostErrorCode } from "@shared/models";

/**
 * 控制面 HTTP 状态到稳定错误码。
 * 与数据面分类一致，但两平面不共享实现；本文件仅供控制面 Module 使用。
 */
function classifyControlPlaneStatus(status: number): HostErrorCode {
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "unavailable";
  return "invalid-input";
}

/**
 * SDK/Provider 异常收敛为稳定 HostError；不携带凭据或 Provider 正文。
 * 非 SDK 异常（网络、解析等）统一归为 unavailable。
 */
export function toControlPlaneError(error: unknown, context: string): HostError {
  if (error instanceof ApiError) {
    return hostError(
      classifyControlPlaneStatus(error.statusCode),
      `${context} rejected with status ${error.statusCode}`,
    );
  }
  if (error instanceof UserError) {
    // 配置/计划类错误（schema、未知 provider 等）是调用方可修正的输入问题。
    return hostError("invalid-input", `${context} failed: invalid project configuration`);
  }
  return hostError("unavailable", `${context} failed`);
}
