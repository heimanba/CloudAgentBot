import { hostError } from "@shared/errors";
import type { BotSkillOption, SkillCatalogEntry } from "@shared/models";

const BASE_URL = "https://qoder.com/api/v1";
const CLOUD_API_URL = "https://api.qoder.com/api/v1/cloud";
const TIMEOUT_MS = 15_000;

type Fetch = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function errorForStatus(status: number) {
  if (status === 401)
    return hostError("authentication", "Qoder skill marketplace authentication failed");
  if (status === 403) return hostError("permission", "Qoder skill marketplace permission denied");
  if (status === 404) return hostError("not-found", "Qoder marketplace skill not found");
  if (status === 409) return hostError("conflict", "Qoder marketplace skill already installed");
  if (status === 429) return hostError("rate-limited", "Qoder skill marketplace rate limited");
  if (status >= 500) return hostError("unavailable", "Qoder skill marketplace unavailable");
  return hostError("invalid-input", "Qoder skill marketplace rejected the request");
}

export class QoderSkillMarketplace {
  constructor(
    private readonly fetchImpl: Fetch = fetch,
    private readonly baseUrl = BASE_URL,
    private readonly cloudApiUrl = CLOUD_API_URL,
  ) {}

  async list(query?: string): Promise<SkillCatalogEntry[]> {
    const params = new URLSearchParams({
      client: "dashboard",
      order_by: "install_count",
      order: "-1",
      page: "1",
      page_size: "100",
    });
    if (query?.trim()) params.set("keyword", query.trim());
    const payload = await this.request(`/marketplace/skills?${params.toString()}`);
    const skills = record(payload)?.skills;
    if (!Array.isArray(skills))
      throw hostError("unavailable", "Qoder skill marketplace returned invalid data");
    return skills.flatMap((value) => {
      const raw = record(value);
      const id = text(raw?.skill_id);
      const sourceName = text(raw?.skill_name);
      const name = text(raw?.display_name) ?? text(raw?.skill_name_cn) ?? text(raw?.skill_name);
      if (!raw || !id || !name || raw.status !== "active") return [];
      return [
        {
          catalogId: id,
          name,
          ...(sourceName ? { sourceName } : {}),
          ...((text(raw.description_cn) ?? text(raw.description))
            ? { description: text(raw.description_cn) ?? text(raw.description) }
            : {}),
          ...(text(raw.version) ? { version: text(raw.version) } : {}),
          ...(text(raw.category) ? { category: text(raw.category) } : {}),
          ...((text(raw.author_name) ?? text(raw.author))
            ? { author: text(raw.author_name) ?? text(raw.author) }
            : {}),
          ...(number(raw.install_count) !== undefined
            ? { installCount: number(raw.install_count) }
            : {}),
        },
      ];
    });
  }

  async install(marketplaceSkillId: string, apiKey: string): Promise<BotSkillOption> {
    const detail = record(
      await this.request(`/marketplace/skills/${encodeURIComponent(marketplaceSkillId)}/detail`),
    );
    const downloadUrl = text(detail?.download_url);
    const marketplaceName =
      text(detail?.display_name) ?? text(detail?.skill_name_cn) ?? text(detail?.skill_name);
    if (!detail || !downloadUrl || !marketplaceName) {
      throw hostError("unavailable", "Qoder marketplace skill detail is incomplete");
    }
    const packageName = text(detail.skill_name) ?? marketplaceSkillId;
    let packageResponse: Response;
    try {
      packageResponse = await this.fetchImpl(downloadUrl, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw hostError("unavailable", "Qoder marketplace skill download failed");
    }
    if (!packageResponse.ok) throw errorForStatus(packageResponse.status);

    const form = new FormData();
    form.append(
      "file",
      new File([await packageResponse.arrayBuffer()], `${packageName}.zip`, {
        type: "application/zip",
      }),
    );
    form.append("name", packageName);
    form.append("type", "custom");
    const description = text(detail.description_cn) ?? text(detail.description);
    if (description) form.append("description", description);

    let installResponse: Response;
    try {
      installResponse = await this.fetchImpl(`${this.cloudApiUrl}/skills`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw hostError("unavailable", "Qoder skill install request failed");
    }
    if (!installResponse.ok) throw errorForStatus(installResponse.status);
    let installed: Record<string, unknown> | null;
    try {
      installed = record(await installResponse.json());
    } catch {
      throw hostError("unavailable", "Qoder skill install returned invalid JSON");
    }
    const skillId = text(installed?.id);
    if (!skillId) throw hostError("unavailable", "Qoder skill install returned invalid data");
    return {
      type: "custom",
      skillId,
      name: text(installed?.display_title) ?? text(installed?.name) ?? marketplaceName,
      ...((text(installed?.description) ?? description)
        ? {
            description: text(installed?.description) ?? description,
          }
        : {}),
      ...(text(installed?.latest_version)
        ? { latestVersion: text(installed?.latest_version) }
        : {}),
      ...(text(installed?.updated_at) ? { updatedAt: text(installed?.updated_at) } : {}),
    };
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "content-type": "application/json",
          "x-qoder-request-source": "web",
          "x-requested-with": "XMLHttpRequest",
          ...init?.headers,
        },
      });
    } catch {
      throw hostError("unavailable", "Qoder skill marketplace request failed");
    }
    if (!response.ok) throw errorForStatus(response.status);
    try {
      return await response.json();
    } catch {
      throw hostError("unavailable", "Qoder skill marketplace returned invalid JSON");
    }
  }
}
