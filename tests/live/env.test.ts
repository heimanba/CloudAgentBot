import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLiveEnv } from "./env.mjs";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oab-live-env-"));
  directories.push(root);
  return root;
}

describe("Cloud 验证配置的仓库边界", () => {
  it("允许无本地配置的 CI 注入，且不读取父目录凭据", () => {
    const parent = fixture();
    const repository = join(parent, "checkout");
    mkdirSync(repository);
    writeFileSync(join(parent, ".env"), "QODER_PAT=unrelated-parent-fixture\n");
    expect(readLiveEnv(join(repository, ".env"), {})).toEqual({});
    expect(readLiveEnv(join(repository, ".env"), { QODER_PAT: "ci-fixture" })).toEqual({
      QODER_PAT: "ci-fixture",
    });
  });

  it("解析带引号配置并以显式环境变量覆盖文件", () => {
    const path = join(fixture(), ".env");
    writeFileSync(path, 'QODER_PAT="file-fixture"\nBAILIAN_WORKSPACE_ID="workspace-fixture"\n');
    expect(readLiveEnv(path, { QODER_PAT: "ci-fixture" })).toEqual({
      QODER_PAT: "ci-fixture",
      BAILIAN_WORKSPACE_ID: "workspace-fixture",
    });
  });
});
