import { describe, expect, it } from "vitest";
import { createQoderVerifier } from "./qoder-verifier";
import { isHostError } from "@shared/errors";

function fetchWithStatus(status: number): typeof fetch {
  return (() =>
    Promise.resolve(new Response("{}", { status }))) as unknown as typeof fetch;
}

describe("createQoderVerifier", () => {
  it("accepts a valid credential (200, even with empty list)", async () => {
    const verifier = createQoderVerifier(fetchWithStatus(200));
    await expect(verifier.verify("valid-pat")).resolves.toBeUndefined();
  });

  it("maps 401 to stable authentication error", async () => {
    const verifier = createQoderVerifier(fetchWithStatus(401));
    try {
      await verifier.verify("bad-pat");
      expect.unreachable();
    } catch (error) {
      if (!isHostError(error)) throw error;
      expect(error.code).toBe("authentication");
      // 错误消息不携带凭据或 Provider 正文。
      expect(JSON.stringify(error)).not.toContain("bad-pat");
    }
  });

  it("maps 403 to permission and 429 to rate-limited", async () => {
    await expect(createQoderVerifier(fetchWithStatus(403)).verify("p")).rejects.toMatchObject({
      code: "permission",
    });
    await expect(createQoderVerifier(fetchWithStatus(429)).verify("p")).rejects.toMatchObject({
      code: "rate-limited",
    });
  });

  it("maps 5xx and network failure to unavailable", async () => {
    await expect(createQoderVerifier(fetchWithStatus(500)).verify("p")).rejects.toMatchObject({
      code: "unavailable",
    });
    const failing = (() => Promise.reject(new Error("socket hang up"))) as unknown as typeof fetch;
    await expect(createQoderVerifier(failing).verify("p")).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
