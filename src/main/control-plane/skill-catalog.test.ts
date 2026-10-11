import { beforeEach, describe, expect, it, vi } from "vitest";
import { sdkMocks } from "./bot-control-plane.testkit";

vi.mock("@openagentpack/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openagentpack/sdk")>();
  return {
    ...actual,
    resolveProjectConfigFromObject: sdkMocks.resolveProjectConfigFromObject,
    createProjectRuntime: sdkMocks.createProjectRuntime,
    listSkills: sdkMocks.listSkills,
  };
});

import { SkillCatalog } from "./skill-catalog";
import { QoderSkillMarketplace } from "./qoder-skill-marketplace";

beforeEach(() => {
  vi.clearAllMocks();
  sdkMocks.resolveProjectConfigFromObject.mockResolvedValue({
    projectName: "openagentbot-skill-catalog",
    config: { defaults: { provider: "bailian" } },
  });
  sdkMocks.createProjectRuntime.mockReturnValue({});
});

describe("SkillCatalog", () => {
  it("Bailian 把 active official Skill 映射为可直接添加的具体版本引用", async () => {
    sdkMocks.listSkills.mockResolvedValue([
      {
        id: "skill_official",
        name: "Official PDF",
        description: "Read PDF",
        source: "official",
        status: "active",
        latest_version: "2.1",
      },
      {
        id: "skill_checking",
        name: "Checking",
        source: "official",
        status: "checking",
        latest_version: "1.0",
      },
      {
        id: "skill_no_version",
        name: "No version",
        source: "official",
        status: "active",
      },
    ]);
    const qoder = { list: vi.fn(), install: vi.fn() } as unknown as QoderSkillMarketplace;
    const catalog = new SkillCatalog(
      async () => ({ provider: "bailian", credential: "SECRET", workspaceId: "ws-1" }),
      async () => [],
      qoder,
    );

    await expect(catalog.list("pdf")).resolves.toEqual([
      {
        catalogId: "skill_official",
        name: "Official PDF",
        description: "Read PDF",
        version: "2.1",
        addedRef: { type: "official", skillId: "skill_official", version: "2.1" },
      },
    ]);
    expect(sdkMocks.listSkills).toHaveBeenCalledWith(expect.anything(), {
      provider: "bailian",
      source: "official",
    });
    expect(qoder.list).not.toHaveBeenCalled();
  });

  it("Bailian add 重新读取目录并返回最终 Agent 引用，不执行 Qoder 安装", async () => {
    sdkMocks.listSkills.mockResolvedValue([
      {
        id: "skill_official",
        name: "Official",
        source: "official",
        status: "active",
        latest_version: "3.0",
      },
    ]);
    const qoder = { list: vi.fn(), install: vi.fn() } as unknown as QoderSkillMarketplace;
    const catalog = new SkillCatalog(
      async () => ({ provider: "bailian", credential: "SECRET", workspaceId: "ws-1" }),
      async () => [],
      qoder,
    );

    await expect(catalog.add("conn", "skill_official")).resolves.toEqual({
      type: "official",
      skillId: "skill_official",
      version: "3.0",
      latestVersion: "3.0",
      name: "Official",
    });
    expect(qoder.install).not.toHaveBeenCalled();
  });

  it("Qoder 市场项使用精确 metadata 关联已安装引用", async () => {
    const qoder = {
      list: vi
        .fn()
        .mockResolvedValue([{ catalogId: "market_1", name: "研究", sourceName: "research" }]),
      install: vi.fn(),
    } as unknown as QoderSkillMarketplace;
    const owned = {
      type: "custom" as const,
      skillId: "skill_installed",
      name: "research",
      marketplaceSkillId: "market_1",
    };
    const catalog = new SkillCatalog(
      async () => ({ provider: "qoder", credential: "SECRET" }),
      async () => [owned],
      qoder,
    );

    await expect(catalog.list("研究")).resolves.toEqual([
      expect.objectContaining({ catalogId: "market_1", addedRef: owned }),
    ]);
    await expect(catalog.add("conn", "market_1")).resolves.toEqual(owned);
    expect(qoder.install).not.toHaveBeenCalled();
  });
});
