import {
  createProjectRuntime,
  listSkills,
  resolveProjectConfigFromObject,
  StateManager,
} from "@openagentpack/sdk";
import type { BotSkillOption, BotSkillRef, SkillCatalogEntry } from "@shared/models";
import { hostError } from "@shared/errors";
import type { ResolvedConnection } from "../connections/connection-verifier";
import type { QoderSkillMarketplace } from "./qoder-skill-marketplace";
import { toControlPlaneError } from "./control-plane-errors";

interface SkillCatalogAdapter {
  list(query?: string): Promise<SkillCatalogEntry[]>;
  add(catalogId: string): Promise<BotSkillOption>;
}

function normalize(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, "-");
}

class QoderSkillCatalogAdapter implements SkillCatalogAdapter {
  constructor(
    private readonly marketplace: QoderSkillMarketplace,
    private readonly credential: string,
    private readonly owned: BotSkillOption[],
  ) {}

  async list(query?: string): Promise<SkillCatalogEntry[]> {
    const entries = await this.marketplace.list(query);
    return entries.map((entry) => {
      const added = this.owned.find(
        (skill) =>
          skill.marketplaceSkillId === entry.catalogId ||
          [entry.sourceName, entry.name]
            .map(normalize)
            .filter(Boolean)
            .includes(normalize(skill.name)),
      );
      return added ? { ...entry, addedRef: added } : entry;
    });
  }

  add(catalogId: string): Promise<BotSkillOption> {
    const existing = this.owned.find((skill) => skill.marketplaceSkillId === catalogId);
    return existing
      ? Promise.resolve(existing)
      : this.marketplace.install(catalogId, this.credential);
  }
}

class BailianSkillCatalogAdapter implements SkillCatalogAdapter {
  constructor(private readonly connection: ResolvedConnection) {}

  async list(query?: string): Promise<SkillCatalogEntry[]> {
    try {
      const providerConfig: Record<string, unknown> = { api_key: this.connection.credential };
      if (this.connection.workspaceId !== undefined)
        providerConfig.workspace_id = this.connection.workspaceId;
      const loaded = await resolveProjectConfigFromObject(
        {
          version: "1",
          providers: { bailian: {} },
          defaults: { provider: "bailian" },
        },
        { basePath: ".", projectName: "openagentbot-skill-catalog" },
      );
      const runtime = createProjectRuntime({
        projectName: loaded.projectName,
        config: loaded.config,
        state: StateManager.initialize(":memory:"),
        providers: { bailian: providerConfig },
      });
      const skills = await listSkills(runtime, { provider: "bailian", source: "official" });
      const normalizedQuery = query?.trim().toLocaleLowerCase() ?? "";
      return skills.flatMap((skill) => {
        if (skill.status !== "active" || !skill.latest_version) return [];
        if (
          normalizedQuery &&
          ![skill.name, skill.description, skill.id].some((value) =>
            value?.toLocaleLowerCase().includes(normalizedQuery),
          )
        )
          return [];
        const ref: BotSkillRef = {
          type: "official",
          skillId: skill.id,
          version: skill.latest_version,
        };
        return [
          {
            catalogId: skill.id,
            name: skill.name || skill.id,
            ...(skill.description ? { description: skill.description } : {}),
            version: skill.latest_version,
            addedRef: ref,
          },
        ];
      });
    } catch (error) {
      throw toControlPlaneError(error, "list skill catalog");
    }
  }

  async add(catalogId: string): Promise<BotSkillOption> {
    const entry = (await this.list()).find((candidate) => candidate.catalogId === catalogId);
    if (!entry?.addedRef?.version) {
      throw hostError("not-found", `bailian catalog skill is not attachable: ${catalogId}`);
    }
    return {
      ...entry.addedRef,
      name: entry.name,
      ...(entry.description ? { description: entry.description } : {}),
      latestVersion: entry.addedRef.version,
    };
  }
}

export class SkillCatalog {
  constructor(
    private readonly resolveCredential: (connectionId: string) => Promise<ResolvedConnection>,
    private readonly listOwned: (connectionId: string) => Promise<BotSkillOption[]>,
    private readonly qoderMarketplace: QoderSkillMarketplace,
  ) {}

  async list(connectionId: string, query?: string): Promise<SkillCatalogEntry[]> {
    return (await this.adapter(connectionId)).list(query);
  }

  async add(connectionId: string, catalogId: string): Promise<BotSkillOption> {
    return (await this.adapter(connectionId)).add(catalogId);
  }

  private async adapter(connectionId: string): Promise<SkillCatalogAdapter> {
    const connection = await this.resolveCredential(connectionId);
    if (connection.provider === "qoder") {
      return new QoderSkillCatalogAdapter(
        this.qoderMarketplace,
        connection.credential,
        await this.listOwned(connectionId),
      );
    }
    if (connection.provider === "bailian") return new BailianSkillCatalogAdapter(connection);
    throw hostError("invalid-input", `unsupported provider: ${connection.provider}`);
  }
}
