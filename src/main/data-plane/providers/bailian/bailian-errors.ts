import type { HostErrorCode } from "@shared/models";
import { hostError } from "@shared/errors";
import { BailianApiError } from "./bailian-client";

export function classifyBailianStatus(status: number): HostErrorCode {
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "unavailable";
  return "invalid-input";
}

export function toBailianHostError(error: unknown, context: string): unknown {
  if (error instanceof BailianApiError) {
    return hostError(
      classifyBailianStatus(error.statusCode),
      `${context} rejected with status ${error.statusCode}`,
    );
  }
  return error instanceof Error ? hostError("unavailable", `${context} unavailable`) : error;
}
