import { describe, expect, it, vi } from "vitest";
import { BailianMcpCatalog } from "./bailian-mcp-catalog";

function success(data: unknown): Response {
  return new Response(
    JSON.stringify({
      data: { success: true, DataV2: { data: { success: true, data } } },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("BailianMcpCatalog", () => {
  it("匿名读取公开 MCP 并只返回选择器字段", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      success({
        mcpServerDetailList: [
          {
            type: "OFFICIAL",
            serverCode: "TextGenerateImage",
            serverName: "图像生成",
            description: "生成图片",
            sourceName: "阿里云百炼",
            hasFee: true,
            hasFreePlan: true,
          },
        ],
      }),
    );
    const result = await new BailianMcpCatalog(fetchImpl).list("图像");

    expect(result).toEqual([
      {
        serverCode: "TextGenerateImage",
        serverName: "图像生成",
        description: "生成图片",
        sourceName: "阿里云百炼",
        hasFee: true,
        hasFreePlan: true,
      },
    ]);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    expect(body).toContain("serverName");
    expect(body).not.toContain("api_key");
    expect(body).not.toContain("workspace");
    expect(init.headers).toEqual({
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    });
  });

  it("读取工具名称、说明与输入 Schema", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      success([
        {
          name: "bailian_image_gen",
          description: "图像生成工具",
          inputSchema: { type: "object", required: ["prompt"] },
        },
      ]),
    );
    await expect(new BailianMcpCatalog(fetchImpl).listTools("TextGenerateImage")).resolves.toEqual([
      {
        name: "bailian_image_gen",
        description: "图像生成工具",
        inputSchema: { type: "object", required: ["prompt"] },
      },
    ]);
  });
});
