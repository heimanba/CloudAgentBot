import { randomUUID } from "node:crypto";
import type { McpCatalogEntry, McpToolOption } from "@shared/models";
import { hostError } from "@shared/errors";

const GATEWAY = "https://bailian-cs.console.aliyun.com/data/api.json";
const STORE_URL = "https://bailian.console.aliyun.com/cn-beijing/store/mcp";

type FetchLike = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 百炼 MCP 广场的公开匿名读取适配器。不得在请求中加入用户凭据或 Cookie。 */
export class BailianMcpCatalog {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async list(query?: string): Promise<McpCatalogEntry[]> {
    const data = record(
      await this.request("zeldaEasy.broadscope-bailian.mcp-server.SquarePageList", {
        pageNo: 1,
        pageSize: 100,
        ...(query?.trim() ? { serverName: query.trim() } : {}),
      }),
    );
    const items = data?.mcpServerDetailList;
    if (!Array.isArray(items)) throw hostError("unavailable", "invalid Bailian MCP catalog");
    return items.flatMap((value) => {
      const item = record(value);
      const serverCode = text(item?.serverCode);
      const serverName = text(item?.serverName);
      if (!item || !serverCode || !serverName || item.type !== "OFFICIAL") return [];
      return [
        {
          serverCode,
          serverName,
          ...(text(item.description) ? { description: text(item.description) } : {}),
          ...(text(item.icon) ? { icon: text(item.icon) } : {}),
          ...(text(item.classification) ? { category: text(item.classification) } : {}),
          ...(text(item.sourceName) ? { sourceName: text(item.sourceName) } : {}),
          hasFee: item.hasFee === true,
          hasFreePlan: item.hasFreePlan === true,
        },
      ];
    });
  }

  async listTools(serverCode: string): Promise<McpToolOption[]> {
    const data = await this.request("zeldaEasy.broadscope-bailian.mcp-server.getTools", {
      serverCode,
    });
    if (!Array.isArray(data)) throw hostError("unavailable", "invalid Bailian MCP tool list");
    return data.flatMap((value) => {
      const item = record(value);
      const name = text(item?.name);
      if (!item || !name) return [];
      const inputSchema = record(item.inputSchema);
      return [
        {
          name,
          ...(text(item.description) ? { description: text(item.description) } : {}),
          ...(inputSchema ? { inputSchema } : {}),
        },
      ];
    });
  }

  private async request(api: string, reqDTO: Record<string, unknown>): Promise<unknown> {
    const cornerstoneParam = {
      feTraceId: randomUUID(),
      feURL: STORE_URL,
      protocol: "V2",
      console: "ONE_CONSOLE",
      productCode: "p_efm",
      domain: "bailian.console.aliyun.com",
      consoleSite: "BAILIAN_ALIYUN",
      userNickName: "",
      userPrincipalName: "",
      xsp_lang: "zh-CN",
      "X-Anonymous-Id": randomUUID(),
    };
    const params = JSON.stringify({ Api: api, V: "1.0", Data: { reqDTO, cornerstoneParam } });
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${GATEWAY}?action=BroadScopeAspnGateway&product=sfm_bailian&api=${encodeURIComponent(api)}&_v=`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams({ params, region: "cn-beijing" }),
        },
      );
    } catch {
      throw hostError("unavailable", "Bailian MCP catalog request failed");
    }
    if (!response.ok) throw hostError("unavailable", "Bailian MCP catalog is unavailable");
    const payload = record(await response.json());
    const outer = record(payload?.data);
    const dataV2 = record(outer?.DataV2);
    const envelope = record(dataV2?.data);
    if (outer?.success !== true || envelope?.success !== true) {
      throw hostError("unavailable", "Bailian MCP catalog rejected the request");
    }
    return envelope.data;
  }
}
