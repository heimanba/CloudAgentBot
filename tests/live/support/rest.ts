import { bailianBaseUrl, QODER_GATEWAY, type Provider } from "./endpoints";

export type ResourceKind = "agent" | "environment";

/** Provider REST 响应体的宽松 JSON 形状。 */
export type Json = Record<string, unknown>;

/** restTarget 接受的最小凭据形状；字段缺失只在对应 Provider 组合时报错。 */
export interface RestCredentialValues {
  qoderPat?: string;
  bailianApiKey?: string;
  bailianWorkspaceId?: string;
}

export interface RestTarget {
  provider: Provider;
  base: string;
  token: string;
}

const PROVIDER_LABEL: Record<Provider, string> = { qoder: "Qoder", bailian: "Bailian" };

/** 按 Provider 组合 REST 基地址与 Bearer 凭据；凭据只进内存请求头。 */
export function restTarget(provider: Provider, credentials: RestCredentialValues): RestTarget {
  if (provider === "qoder") {
    if (!credentials.qoderPat) throw new Error("qoder REST target requires QODER_PAT");
    return { provider, base: QODER_GATEWAY, token: credentials.qoderPat };
  }
  if (!credentials.bailianApiKey || !credentials.bailianWorkspaceId) {
    throw new Error("bailian REST target requires DASHSCOPE_API_KEY and BAILIAN_WORKSPACE_ID");
  }
  return {
    provider,
    base: bailianBaseUrl(credentials.bailianWorkspaceId),
    token: credentials.bailianApiKey,
  };
}

/** 带 Bearer 与 JSON Content-Type 的 Provider REST 请求；init.headers 可覆盖默认头。 */
export async function restRequest(
  target: RestTarget,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${target.base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${target.token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

/** POST /{kind}s/{id}/archive —— Qoder 与百炼共用的正式归档路径。 */
export function archiveResource(
  target: RestTarget,
  kind: ResourceKind,
  id: string,
): Promise<Response> {
  return restRequest(target, `/${kind}s/${id}/archive`, { method: "POST", body: "{}" });
}

/** JSON 请求：非 2xx 抛带 Provider 标签的错误（不含凭据）；空体返回 {}。 */
export async function jsonRequest(
  target: RestTarget,
  path: string,
  init: RequestInit = {},
): Promise<Json> {
  const response = await restRequest(target, path, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${PROVIDER_LABEL[target.provider]} ${init.method ?? "GET"} ${path}: ${response.status}`,
    );
  }
  if (!text) return {};
  return JSON.parse(text) as Json;
}

/** 列表响应归一化：裸数组原样；{data|items|threads} 取其一；否则空数组。 */
export function jsonRows(body: Json | Json[]): Json[] {
  if (Array.isArray(body)) return body;
  const rows = body.data ?? body.items ?? body.threads;
  return Array.isArray(rows) ? (rows as Json[]) : [];
}

/**
 * 惰性请求闭包：describe 收集期只建闭包不读凭据（skipIf 标记跳过时 describe 回调仍会执行），
 * 调用时才校验凭据并组合 restTarget。
 */
export function providerRequester(
  provider: Provider,
  credentials: RestCredentialValues,
): (path: string, init?: RequestInit) => Promise<Json> {
  return async (path, init = {}) => jsonRequest(restTarget(provider, credentials), path, init);
}

/**
 * Qoder 资源清理：DELETE；404/410 视为已清理；Environment 被引用（409）时按正式协议归档。
 * 其他失败抛错，调用方决定是否吞掉（afterAll 常见 .catch(() => {})）。
 */
export async function deleteQoderResource(
  pat: string,
  kind: ResourceKind,
  id: string,
): Promise<void> {
  const response = await fetch(`${QODER_GATEWAY}/${kind}s/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${pat}` },
  });
  if (response.ok || response.status === 404 || response.status === 410) return;
  if (response.status === 409 && kind === "environment") {
    const archived = await fetch(`${QODER_GATEWAY}/environments/${id}/archive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}` },
    });
    if (archived.ok) return;
    throw new Error(`Qoder environment archive failed: ${archived.status}`);
  }
  throw new Error(`Qoder ${kind} cleanup failed: ${response.status}`);
}
