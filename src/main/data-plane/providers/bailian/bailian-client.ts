import { bailianBaseUrl } from "../../../connections/bailian-verifier";

export class BailianApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly responseBody: string,
  ) {
    super(`Bailian API ${statusCode}`);
  }
}

export interface BailianClientConfig {
  apiKey: string;
  workspaceId: string;
  fetchImpl?: typeof fetch;
}

export class BailianDataClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(config: BailianClientConfig) {
    this.#baseUrl = bailianBaseUrl(config.workspaceId);
    this.#apiKey = config.apiKey;
    this.#fetch = config.fetchImpl ?? fetch;
  }

  async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    const body = await response.text();
    if (!response.ok) throw new BailianApiError(response.status, body);
    return body ? (JSON.parse(body) as Record<string, unknown>) : {};
  }

  async stream(sessionId: string, signal: AbortSignal): Promise<Response> {
    const query = new URLSearchParams();
    query.append("event_deltas[]", "message");
    query.append("event_deltas[]", "reasoning");
    const response = await this.#fetch(
      `${this.#baseUrl}/sessions/${encodeURIComponent(sessionId)}/events/stream?${query}`,
      { headers: { Authorization: `Bearer ${this.#apiKey}`, Accept: "text/event-stream" }, signal },
    );
    if (!response.ok) throw new BailianApiError(response.status, await response.text());
    if (!response.body) throw new Error("Bailian SSE response has no body");
    return response;
  }

  async getSession(sessionId: string): Promise<Record<string, unknown>> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  async updateSessionMetadata(
    sessionId: string,
    metadata: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      body: JSON.stringify({ metadata }),
    });
  }

  async archiveSession(sessionId: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(sessionId)}/archive`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  }

  /**
   * Multipart 直传文件。不设置 Content-Type，交由 fetch 依据 FormData 自动生成含 boundary 的头。
   */
  async uploadFile(
    bytes: ArrayBuffer,
    filename: string,
    mimeType: string,
  ): Promise<Record<string, unknown>> {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mimeType }), filename);
    const response = await this.#fetch(`${this.#baseUrl}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.#apiKey}` },
      body: form,
    });
    const body = await response.text();
    if (!response.ok) throw new BailianApiError(response.status, body);
    return body ? (JSON.parse(body) as Record<string, unknown>) : {};
  }

  /** 查询文件安全审核状态（checking → available/rejected/type_rejected）。 */
  async getFile(fileId: string): Promise<Record<string, unknown>> {
    return this.request(`/files/${encodeURIComponent(fileId)}`);
  }

  /**
   * Deployment（定时任务）端点族。合同见
   * docs/research/bailian-deployment-api-contract-2026-10-08.md：
   * 无删除端点（归档是唯一终态）；update 的 metadata 是整体替换；
   * 未知字段被静默忽略（200 不回显）。
   */
  async listDeployments(agentId?: string): Promise<Record<string, unknown>[]> {
    const deployments: Record<string, unknown>[] = [];
    let page: string | undefined;
    do {
      const query = new URLSearchParams({ limit: "100" });
      if (agentId !== undefined) query.set("agent_id", agentId);
      if (page) query.set("page", page);
      const result = await this.request(`/deployments?${query}`);
      deployments.push(...((result.data as Record<string, unknown>[] | undefined) ?? []));
      page = typeof result.next_page === "string" ? result.next_page : undefined;
    } while (page);
    return deployments;
  }

  async getDeployment(deploymentId: string): Promise<Record<string, unknown>> {
    return this.request(`/deployments/${encodeURIComponent(deploymentId)}`);
  }

  async createDeployment(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("/deployments", { method: "POST", body: JSON.stringify(body) });
  }

  async updateDeployment(
    deploymentId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.request(`/deployments/${encodeURIComponent(deploymentId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async pauseDeployment(deploymentId: string): Promise<Record<string, unknown>> {
    return this.request(`/deployments/${encodeURIComponent(deploymentId)}/pause`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async unpauseDeployment(deploymentId: string): Promise<Record<string, unknown>> {
    return this.request(`/deployments/${encodeURIComponent(deploymentId)}/unpause`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async archiveDeployment(deploymentId: string): Promise<void> {
    await this.request(`/deployments/${encodeURIComponent(deploymentId)}/archive`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async runDeployment(deploymentId: string): Promise<Record<string, unknown>> {
    return this.request(`/deployments/${encodeURIComponent(deploymentId)}/run`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async listDeploymentRuns(deploymentId: string): Promise<Record<string, unknown>[]> {
    const runs: Record<string, unknown>[] = [];
    let page: string | undefined;
    do {
      const query = new URLSearchParams({ limit: "100" });
      if (page) query.set("page", page);
      const result = await this.request(
        `/deployments/${encodeURIComponent(deploymentId)}/runs?${query}`,
      );
      runs.push(...((result.data as Record<string, unknown>[] | undefined) ?? []));
      page = typeof result.next_page === "string" ? result.next_page : undefined;
    } while (page);
    return runs;
  }
}

export async function* parseBailianSse(
  response: Response,
): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const data = chunk
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (data && data !== "[DONE]") yield JSON.parse(data) as Record<string, unknown>;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
