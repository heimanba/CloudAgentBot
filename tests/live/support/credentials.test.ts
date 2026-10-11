import { describe, expect, it } from "vitest";
import { requireBailian, requireQoderAndBailian, requireQoderPat } from "./credentials";

describe("live credentials", () => {
  it("校验并 trim 已提供的变量", () => {
    expect(requireQoderPat({ QODER_PAT: " pat " })).toBe("pat");
    expect(requireBailian({ DASHSCOPE_API_KEY: " key ", BAILIAN_WORKSPACE_ID: " ws " })).toEqual({
      bailianApiKey: "key",
      bailianWorkspaceId: "ws",
    });
  });

  it("缺失或空白变量报出变量名", () => {
    expect(() => requireQoderPat({})).toThrowError(/QODER_PAT/);
    expect(() => requireQoderPat({ QODER_PAT: "   " })).toThrowError(/QODER_PAT/);
    expect(() =>
      requireQoderAndBailian({ QODER_PAT: "pat", BAILIAN_WORKSPACE_ID: "ws" }),
    ).toThrowError(/DASHSCOPE_API_KEY/);
  });

  it("错误消息不包含任何凭据值", () => {
    const secret = "sk-live-secret-fixture";
    try {
      requireQoderAndBailian({ QODER_PAT: secret, DASHSCOPE_API_KEY: secret });
      expect.unreachable("missing BAILIAN_WORKSPACE_ID should throw");
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).toContain("BAILIAN_WORKSPACE_ID");
    }
  });
});
