/**
 * Qoder Provider 错误到稳定 HostErrorCode 的映射。
 * ApiError message 可能含 Provider 响应正文，因此错误对象只保留状态码；
 * message 由调用侧另行给出，不携带正文或凭据。
 */

import { QoderApiError } from "./qoder-http";
import type { HostErrorCode } from "@shared/models";
import { hostError } from "@shared/errors";

export function classifyQoderStatus(status: number): HostErrorCode {
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "unavailable";
  return "invalid-input";
}

/** 把 Qoder 数据面异常收敛为稳定 HostError；网络错误归为 unavailable。 */
export function toQoderHostError(error: unknown, context: string): unknown {
  if (error instanceof QoderApiError) {
    return hostError(classifyQoderStatus(error.statusCode), `${context} rejected with status ${error.statusCode}`);
  }
  return hostError("unavailable", `${context} failed`);
}
