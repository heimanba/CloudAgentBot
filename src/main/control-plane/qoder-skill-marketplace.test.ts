import { describe, expect, it, vi } from "vitest";
import { QoderSkillMarketplace } from "./qoder-skill-marketplace";

describe("QoderSkillMarketplace", () => {
  it("读取 active 市场技能并保留安装所需展示信息", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          skills: [
            {
              skill_id: "official_1",
              skill_name: "deep-research",
              display_name: "深入研究",
              description_cn: "系统研究",
              version: "1.0.0",
              author_name: "author",
              install_count: 12,
              status: "active",
            },
            { skill_id: "disabled", display_name: "停用", status: "disabled" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const marketplace = new QoderSkillMarketplace(fetchImpl, "https://qoder.test/api/v1");

    await expect(marketplace.list("研究")).resolves.toEqual([
      {
        catalogId: "official_1",
        name: "深入研究",
        sourceName: "deep-research",
        description: "系统研究",
        version: "1.0.0",
        author: "author",
        installCount: 12,
      },
    ]);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("keyword=%E7%A0%94%E7%A9%B6");
  });

  it("用 Connection API Key 上传市场包，不调用依赖 Web Cookie 的安装接口", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            skill_id: "official_1",
            skill_name: "deep-research",
            display_name: "深入研究",
            download_url: "https://qoder-skills.example/deep-research.zip",
            version: "1.0.0",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([80, 75, 3, 4]), {
          status: 200,
          headers: { "content-type": "application/zip" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "skill_installed", display_title: "deep-research" }), {
          status: 200,
        }),
      );
    const marketplace = new QoderSkillMarketplace(
      fetchImpl,
      "https://qoder.test/api/v1",
      "https://api.qoder.test/api/v1/cloud",
    );

    await expect(marketplace.install("official_1", "api-key")).resolves.toMatchObject({
      type: "custom",
      skillId: "skill_installed",
      name: "deep-research",
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://qoder-skills.example/deep-research.zip");
    expect(fetchImpl.mock.calls[2]?.[0]).toBe("https://api.qoder.test/api/v1/cloud/skills");
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer api-key" },
    });
    expect(fetchImpl.mock.calls[2]?.[1]?.body).toBeInstanceOf(FormData);
  });
});
