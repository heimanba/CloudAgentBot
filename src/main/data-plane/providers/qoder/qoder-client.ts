import { QoderHttpClient } from "./qoder-http";
import { toProviderEvent, toProviderSession } from "./qoder-mapper";
import { parseQoderSse } from "./qoder-sse";
import {
  qoderEventSchema,
  qoderEventListSchema,
  qoderFileDownloadSchema,
  qoderListSchema,
  qoderSessionResourceListSchema,
  qoderSessionResourceSchema,
  qoderUploadedFileSchema,
  type EventListOptions,
  type EventStreamOptions,
  type ProviderSessionEvent,
  type ProviderSessionEventList,
  type QoderCreateSessionInput,
  type SessionFilter,
  type SessionListResult,
} from "./qoder-wire";

export interface QoderClientConfig { apiKey: string; gateway?: string }

const AGENTS_PAGE_SIZE = 100;

export class QoderDataClient {
  private readonly http: QoderHttpClient;
  constructor(config: QoderClientConfig) { this.http = new QoderHttpClient(config.apiKey, config.gateway); }

  async validateCredential(): Promise<void> { await this.http.get("/agents?limit=1"); }
  async listAgents(): Promise<Record<string, unknown>[]> {
    const agents: Record<string, unknown>[] = [];
    const visited = new Set<string>();
    let page: string | undefined;
    for (;;) {
      const params = new URLSearchParams({ limit: String(AGENTS_PAGE_SIZE) });
      if (page) params.set("page", page);
      const result = qoderListSchema.parse(await this.http.get(`/agents?${params}`));
      agents.push(...result.data);
      const next = typeof result.next_page === "string" ? result.next_page : undefined;
      if (!(result.has_more ?? next !== undefined)) return agents;
      if (!next || visited.has(next)) throw new Error("Qoder agents pagination cursor did not advance");
      visited.add(next);
      page = next;
    }
  }
  async createSession(input: QoderCreateSessionInput) {
    return toProviderSession(await this.http.post("/sessions", { agent: input.agent_id, environment_id: input.environment_id, ...(input.title ? { title: input.title } : {}), ...(input.metadata ? { metadata: input.metadata } : {}) }));
  }
  async listSessions(filter?: SessionFilter): Promise<SessionListResult> {
    const params = new URLSearchParams();
    if (filter?.agent_id) params.set("agent_id", filter.agent_id);
    if (filter?.limit) params.set("limit", String(filter.limit));
    if (filter?.page) params.set("page", filter.page);
    const query = params.toString();
    const result = qoderListSchema.parse(await this.http.get(`/sessions${query ? `?${query}` : ""}`));
    return { sessions: result.data.map(toProviderSession), has_more: result.has_more ?? result.next_page != null, ...(result.next_page ? { next_page: result.next_page } : {}) };
  }
  async getSession(id: string) { return toProviderSession(await this.http.get(`/sessions/${id}`)); }
  async updateSessionMetadata(id: string, metadata: Record<string, string | null>): Promise<void> {
    await this.http.request(`/sessions/${id}`, {
      method: "POST",
      body: JSON.stringify({ metadata }),
    });
  }
  async archiveSession(id: string): Promise<void> { await this.http.post(`/sessions/${id}/archive`, {}); }
  async deleteSession(id: string): Promise<void> { await this.http.delete(`/sessions/${id}`); }
  async listDeployments(agentId?: string): Promise<Record<string, unknown>[]> {
    const deployments: Record<string, unknown>[] = [];
    const visited = new Set<string>();
    let page: string | undefined;
    for (;;) {
      const params = new URLSearchParams({ limit: "100" });
      if (agentId) params.set("agent_id", agentId);
      if (page) params.set("page", page);
      const result = qoderListSchema.parse(await this.http.get(`/deployments?${params}`));
      deployments.push(...result.data);
      const next = typeof result.next_page === "string" ? result.next_page : undefined;
      if (!(result.has_more ?? next !== undefined)) return deployments;
      if (!next || visited.has(next)) throw new Error("Qoder deployments pagination cursor did not advance");
      visited.add(next);
      page = next;
    }
  }
  async getDeployment(id: string) { return (await this.http.get(`/deployments/${id}`)) as Record<string, unknown>; }
  async createDeployment(body: Record<string, unknown>) {
    return (await this.http.post("/deployments", body)) as Record<string, unknown>;
  }
  async updateDeployment(id: string, body: Record<string, unknown>) {
    return (await this.http.post(`/deployments/${id}`, body)) as Record<string, unknown>;
  }
  async pauseDeployment(id: string) {
    return (await this.http.post(`/deployments/${id}/pause`, {})) as Record<string, unknown>;
  }
  async unpauseDeployment(id: string) {
    return (await this.http.post(`/deployments/${id}/unpause`, {})) as Record<string, unknown>;
  }
  async archiveDeployment(id: string) {
    return (await this.http.post(`/deployments/${id}/archive`, {})) as Record<string, unknown>;
  }
  async runDeployment(id: string) {
    return (await this.http.post(`/deployments/${id}/run`, {})) as Record<string, unknown>;
  }
  async listDeploymentRuns(id: string): Promise<Record<string, unknown>[]> {
    const runs: Record<string, unknown>[] = [];
    const visited = new Set<string>();
    let page: string | undefined;
    for (;;) {
      const params = new URLSearchParams({ limit: "100" });
      if (page) params.set("page", page);
      const result = qoderListSchema.parse(await this.http.get(`/deployments/${id}/runs?${params}`));
      runs.push(...result.data);
      const next = typeof result.next_page === "string" ? result.next_page : undefined;
      if (!(result.has_more ?? next !== undefined)) return runs;
      if (!next || visited.has(next)) throw new Error("Qoder deployment runs pagination cursor did not advance");
      visited.add(next);
      page = next;
    }
  }
  async uploadFile(bytes: ArrayBuffer, filename: string, mimeType: string) {
    const form = new FormData();
    form.append("file", new Blob([bytes], mimeType ? { type: mimeType } : undefined), filename);
    return qoderUploadedFileSchema.parse(await this.http.postForm("/files", form));
  }
  async getFile(fileId: string) {
    return qoderUploadedFileSchema.parse(await this.http.get(`/files/${fileId}`));
  }
  async addSessionFileResource(sessionId: string, fileId: string) {
    return qoderSessionResourceSchema.parse(
      await this.http.post(`/sessions/${sessionId}/resources`, { type: "file", file_id: fileId }),
    );
  }
  async listSessionResources(sessionId: string) {
    const resources: Array<{
      id: string;
      type: string;
      file_id?: string;
      mount_path?: string;
      created_at?: string;
      updated_at?: string;
    }> = [];
    const visited = new Set<string>();
    let page: string | undefined;
    do {
      const query = new URLSearchParams({ limit: "100" });
      if (page) query.set("page", page);
      const result = qoderSessionResourceListSchema.parse(
        await this.http.get(`/sessions/${sessionId}/resources?${query}`),
      );
      resources.push(...result.data);
      const next = result.has_more && result.next_page ? result.next_page : undefined;
      if (next && visited.has(next)) throw new Error("Qoder resources pagination cursor did not advance");
      if (next) visited.add(next);
      page = next;
    } while (page);
    return resources;
  }
  async sendMessage(sessionId: string, text: string, imageFileIds: string[] = []): Promise<string | undefined> {
    const content = [
      ...(text.trim() ? [{ type: "text", text }] : []),
      ...imageFileIds.map((fileId) => ({
        type: "image",
        source: { type: "file", file_id: fileId },
      })),
    ];
    const result = await this.http.post(`/sessions/${sessionId}/events`, { events: [{ type: "user.message", content }] });
    if (!result || typeof result !== "object") return undefined;
    const raw = result as Record<string, unknown>;
    if (typeof raw.id === "string") return raw.id;
    if (typeof raw.event_id === "string") return raw.event_id;
    for (const key of ["data", "events"]) {
      const first = Array.isArray(raw[key]) ? raw[key][0] : undefined;
      if (first && typeof first === "object" && typeof (first as Record<string, unknown>).id === "string") return (first as Record<string, unknown>).id as string;
    }
    return undefined;
  }
  async listEvents(sessionId: string, options?: EventListOptions): Promise<ProviderSessionEventList> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.order) params.set("order", options.order);
    if (options?.after_id) params.set("after_id", options.after_id);
    if (options?.before_id) params.set("before_id", options.before_id);
    const query = params.toString();
    const response = await this.http.get(`/sessions/${sessionId}/events${query ? `?${query}` : ""}`);
    console.log("[CloudAgentBot][qoder-events-raw]", {
      sessionId,
      query,
      response,
    });
    const result = qoderEventListSchema.parse(response);
    return {
      events: result.data.map(toProviderEvent),
      has_more: result.has_more,
      ...(result.first_id ? { first_id: result.first_id } : {}),
      ...(result.last_id ? { last_id: result.last_id } : {}),
    };
  }
  async getFileDownloadUrl(fileId: string): Promise<{ url: string; expires_at?: string }> {
    return qoderFileDownloadSchema.parse(await this.http.get(`/files/${fileId}/content`));
  }
  async *streamEvents(sessionId: string, options?: EventStreamOptions): AsyncGenerator<ProviderSessionEvent> {
    const params = new URLSearchParams();
    for (const type of options?.event_deltas ?? []) params.append("event_deltas[]", type);
    if (options?.include_tool_calls !== undefined) params.set("include_tool_calls", String(options.include_tool_calls));
    if (options?.include_thinking !== undefined) params.set("include_thinking", String(options.include_thinking));
    const query = params.toString();
    const headers: Record<string, string> = {};
    if (options?.last_event_id) headers["Last-Event-ID"] = options.last_event_id;
    if (options?.event_deltas?.includes("agent.thinking")) {
      headers["X-Qoder-Beta"] = "thinking-event-stream-delta-2026-07-20";
    }
    for await (const raw of parseQoderSse(await this.http.stream(
      `/sessions/${sessionId}/events/stream${query ? `?${query}` : ""}`,
      headers,
    ))) {
      const event = qoderEventSchema.parse(raw);
      yield toProviderEvent(event);
    }
  }
}

export function createQoderDataClient(config: QoderClientConfig): QoderDataClient { return new QoderDataClient(config); }
export type { ProviderSessionEvent, ProviderSessionInfo } from "./qoder-wire";
