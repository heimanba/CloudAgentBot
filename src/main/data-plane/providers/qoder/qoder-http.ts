export class QoderApiError extends Error {
  constructor(public readonly statusCode: number, public readonly responseBody: string, prefix = "Qoder API") { super(`${prefix} ${statusCode}: ${responseBody}`); }
  static isNotFound(error: unknown): boolean { return error instanceof QoderApiError && error.statusCode === 404; }
}
export class QoderConflictError extends QoderApiError {}

export class QoderHttpClient {
  constructor(private readonly apiKey: string, private readonly baseUrl = "https://api.qoder.com/api/v1/cloud") {}
  private headers(accept?: string): Record<string, string> { return { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}`, ...(accept ? { Accept: accept } : {}) }; }
  private async assertOk(response: Response): Promise<void> {
    if (response.ok) return;
    const body = await response.text();
    if (response.status === 409) throw new QoderConflictError(response.status, body);
    throw new QoderApiError(response.status, body);
  }
  async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { ...this.headers(), ...init?.headers } });
    await this.assertOk(response);
    return response;
  }
  async json(path: string, init?: RequestInit): Promise<unknown> { return (await this.request(path, init)).json(); }
  get(path: string): Promise<unknown> { return this.json(path, { method: "GET" }); }
  post(path: string, body: unknown): Promise<unknown> { return this.json(path, { method: "POST", body: JSON.stringify(body) }); }
  async postForm(path: string, body: FormData): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body,
    });
    await this.assertOk(response);
    return response.json();
  }
  async delete(path: string): Promise<void> { await this.request(path, { method: "DELETE" }); }
  stream(path: string, headers?: Record<string, string>): Promise<Response> {
    return this.request(path, { method: "GET", headers: { Accept: "text/event-stream", ...headers } });
  }
}
