/**
 * Qoder credential 验证与错误分类。
 * 以 GET /api/v1/cloud/agents?limit=1 作为只读探针：
 * 空列表同样视为验证成功（凭据有效即可，不要求已有资源）。
 * PAT 不出现在错误消息、日志或返回值中。
 */

import type { HostErrorCode } from "@shared/models";
import { hostError } from "@shared/errors";
import type { ConnectionVerifier } from "./connection-verifier";

const QODER_AGENTS_URL = "https://api.qoder.com/api/v1/cloud/agents";
const QODER_VERIFY_TIMEOUT_MS = 15_000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function classifyHttpStatus(status: number): HostErrorCode {
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 429) return "rate-limited";
  if (status === 404) return "not-found";
  if (status >= 500) return "unavailable";
  // 其余 4xx 是客户端侧确定性拒绝（400/418 等），不是瞬时不可用。
  return "invalid-input";
}

export interface QoderVerifier extends ConnectionVerifier {
  verify(input: Parameters<ConnectionVerifier["verify"]>[0] | string): Promise<void>;
}

export function createQoderVerifier(
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = QODER_VERIFY_TIMEOUT_MS,
): QoderVerifier {
  return {
    async verify(input): Promise<void> {
      const pat = typeof input === "string" ? input : input.credential;
      let response: Response;
      try {
        response = await fetchImpl(`${QODER_AGENTS_URL}?limit=1`, {
          headers: { Authorization: `Bearer ${pat}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        throw hostError(
          "unavailable",
          timedOut ? "verification timed out" : "network error during verification",
        );
      }
      if (!response.ok) {
        const code = classifyHttpStatus(response.status);
        // 不携带 Provider 响应正文：正文可能回显请求头中的凭据片段。
        throw hostError(code, `qoder verification rejected with status ${response.status}`);
      }
    },
  };
}
