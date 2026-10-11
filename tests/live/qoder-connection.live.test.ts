/**
 * 真实 Qoder 凭据验证（负向路径）。
 * 运行：OPENAGENTBOT_LIVE=1 pnpm vitest run tests/live/
 * 正向路径（有效 PAT）由后续阶段的 live smoke 在真实 Cloud 流程中覆盖。
 */

import { describe, expect, it } from "vitest";
import { createQoderVerifier } from "../../src/main/connections/qoder-verifier";

const LIVE = process.env.OPENAGENTBOT_LIVE === "1";

describe.skipIf(!LIVE)("qoder verifier live", () => {
  it("invalid PAT produces stable authentication error", async () => {
    const verifier = createQoderVerifier();
    await expect(verifier.verify("invalid-pat-live-probe")).rejects.toMatchObject({
      code: "authentication",
    });
  }, 20_000);
});
