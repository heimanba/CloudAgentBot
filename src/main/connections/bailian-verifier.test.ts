import { describe, expect, it } from "vitest";
import { createBailianVerifier } from "./bailian-verifier";

const input = {
  provider: "bailian",
  displayName: "Bailian",
  credential: "secret",
  workspaceId: "llm-test",
};

describe("createBailianVerifier", () => {
  it("uses workspace routing and bearer authentication", async () => {
    let request: { url: string; authorization?: string } | undefined;
    const verifier = createBailianVerifier(async (url, init) => {
      request = {
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization") ?? undefined,
      };
      return new Response("{}", { status: 200 });
    });
    await verifier.verify(input);
    expect(request).toEqual({
      url: "https://llm-test.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/agents?limit=1",
      authorization: "Bearer secret",
    });
  });

  it("requires workspace and maps authentication failures", async () => {
    await expect(
      createBailianVerifier().verify({ ...input, workspaceId: undefined }),
    ).rejects.toMatchObject({
      code: "invalid-input",
    });
    await expect(
      createBailianVerifier(() => Promise.resolve(new Response("denied", { status: 401 }))).verify(
        input,
      ),
    ).rejects.toMatchObject({ code: "authentication" });
  });

  it.each(["evil.example/a", "user@evil.example", "workspace#fragment", "-workspace"])(
    "rejects workspace host injection %s before sending the credential",
    async (workspaceId) => {
      let called = false;
      const verifier = createBailianVerifier(() => {
        called = true;
        return Promise.resolve(new Response("{}"));
      });
      await expect(verifier.verify({ ...input, workspaceId })).rejects.toMatchObject({
        code: "invalid-input",
      });
      expect(called).toBe(false);
    },
  );
});
