/**
 * QoderBotCatalog：远程 Agent 列表只读来源。
 * 独立的 Provider 目录 seam，不属于 ChatAdapter（Chat 数据面）；
 * wire agent 对象在本文件内映射为中立的 view，
 * connectionId 绑定与 BotView 组装由 ChatDataPlane 完成。
 */

import type { BotCatalogView } from "../../chat-data-plane";
import { createQoderDataClient, type QoderDataClient } from "./qoder-client";
import { toQoderHostError } from "./qoder-errors";
import type { ResolvedConnection } from "../../../connections/connection-verifier";
import { readRemoteRoster } from "../../collaboration-roster";
import { API_KEY_SCOPE_METADATA_KEY } from "../../../api-key-scope";

export function toBotCatalogView(raw: Record<string, unknown>): BotCatalogView {
  const metadata = (raw.metadata ?? {}) as Record<string, unknown>;
  const managed =
    typeof metadata["agents.project"] === "string" &&
    typeof metadata["agents.resource"] === "string";
  const collaboration = readRemoteRoster(raw.multiagent);
  return {
    agentId: raw.id as string,
    name: (raw.name as string | undefined) ?? (raw.id as string),
    description: (raw.description as string | null | undefined) ?? undefined,
    model: typeof raw.model === "string" ? raw.model : undefined,
    remoteStatus: (raw.status as string | undefined) ?? undefined,
    managed,
    ...(metadata.openagentbot_shared === "true" ? { shared: true } : {}),
    ...(typeof metadata[API_KEY_SCOPE_METADATA_KEY] === "string" && metadata[API_KEY_SCOPE_METADATA_KEY].length > 0
      ? { keyScopeMarker: metadata[API_KEY_SCOPE_METADATA_KEY] }
      : {}),
    ...(collaboration ? { collaboration } : {}),
  };
}

export function createQoderBotCatalog(connection: ResolvedConnection | string): {
  listBots(): Promise<BotCatalogView[]>;
} {
  const client: QoderDataClient = createQoderDataClient({
    apiKey: typeof connection === "string" ? connection : connection.credential,
  });
  return {
    async listBots(): Promise<BotCatalogView[]> {
      try {
        const agents = await client.listAgents();
        return agents.map(toBotCatalogView);
      } catch (error) {
        throw toQoderHostError(error, "qoder list agents");
      }
    },
  };
}
