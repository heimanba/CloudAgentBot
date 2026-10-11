import type { BotCatalog, BotCatalogView } from "../../chat-data-plane";
import type { ResolvedConnection } from "../../../connections/connection-verifier";
import { hostError } from "@shared/errors";
import { BailianDataClient } from "./bailian-client";
import { toBailianHostError } from "./bailian-errors";
import { readRemoteRoster } from "../../collaboration-roster";
import { API_KEY_SCOPE_METADATA_KEY } from "../../../api-key-scope";

type Wire = Record<string, unknown>;

function clientFor(connection: ResolvedConnection): BailianDataClient {
  if (!connection.workspaceId) throw hostError("invalid-input", "Bailian workspaceId is required");
  return new BailianDataClient({
    apiKey: connection.credential,
    workspaceId: connection.workspaceId,
  });
}

async function listAll(client: BailianDataClient, path: string): Promise<Wire[]> {
  const values: Wire[] = [];
  let page: string | undefined;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (page) query.set("page", page);
    const result = await client.request(`${path}?${query}`);
    values.push(...((result.data as Wire[] | undefined) ?? []));
    page = typeof result.next_page === "string" ? result.next_page : undefined;
  } while (page);
  return values;
}

export function createBailianBotCatalog(connection: ResolvedConnection): BotCatalog {
  const client = clientFor(connection);
  return {
    async listBots(): Promise<BotCatalogView[]> {
      try {
        return (await listAll(client, "/agents")).map((raw) => {
          const metadata =
            raw.metadata && typeof raw.metadata === "object" ? (raw.metadata as Wire) : {};
          const collaboration = readRemoteRoster(raw.multiagent);
          return {
            agentId: String(raw.id),
            name: typeof raw.name === "string" ? raw.name : String(raw.id),
            ...(typeof raw.description === "string" ? { description: raw.description } : {}),
            ...(typeof raw.model === "string" ? { model: raw.model } : {}),
            ...(typeof raw.status === "string" ? { remoteStatus: raw.status } : {}),
            managed:
              typeof metadata["agents.project"] === "string" &&
              typeof metadata["agents.resource"] === "string",
            ...(metadata.openagentbot_shared === "true" ? { shared: true } : {}),
            ...(typeof metadata[API_KEY_SCOPE_METADATA_KEY] === "string" && metadata[API_KEY_SCOPE_METADATA_KEY].length > 0
              ? { keyScopeMarker: metadata[API_KEY_SCOPE_METADATA_KEY] }
              : {}),
            ...(collaboration ? { collaboration } : {}),
          };
        });
      } catch (error) {
        throw toBailianHostError(error, "bailian list agents");
      }
    },
  };
}
