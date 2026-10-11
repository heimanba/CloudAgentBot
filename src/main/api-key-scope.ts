import { createHash } from "node:crypto";

export const API_KEY_SCOPE_METADATA_KEY = "openagentbot_key_scope";
export const SESSION_SHARED_METADATA_KEY = "openagentbot_shared";

/**
 * Deployment 到期日期 metadata 键（ISO 8601 日期）。公开 API 无到期字段，
 * 该标记是 CloudAgentBot 的展示层语义：到期后 UI 引导手动暂停，不做本地定时暂停。
 */
export const DEPLOYMENT_EXPIRES_AT_METADATA_KEY = "openagentbot_expires_at";

/** Stable CloudAgentBot-local grouping ID. This is not a Provider credential or ACL. */
export function apiKeyScopeId(provider: string, credential: string): string {
  return `oab-key-v1-${createHash("sha256")
    // 种子字符串是身份的一部分，不是品牌文案：改动会使所有既有 Bot 的 scope ID 变化，
    // 线上已标记的归属与分组全部失效。品牌改名时保留原值。
    .update("OpenAgentBot API Key scope\0v1\0", "utf8")
    .update(provider, "utf8")
    .update("\0", "utf8")
    .update(credential, "utf8")
    .digest("hex")}`;
}

export type ApiKeyScopeView = "current" | "other" | "ungrouped";

export function classifyApiKeyScope(
  marker: unknown,
  currentScopeId: string,
): ApiKeyScopeView {
  if (typeof marker !== "string" || marker.length === 0) return "ungrouped";
  return marker === currentScopeId ? "current" : "other";
}
