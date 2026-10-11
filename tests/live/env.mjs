import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/** 只读取当前仓库的可选 .env；显式环境变量优先，不向父目录寻找凭据。 */
export function readLiveEnv(
  path = new URL("../../.env", import.meta.url),
  environment = process.env,
) {
  let values = {};
  try {
    values = parseEnv(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("无法读取当前仓库的 Cloud 验证配置");
  }
  return { ...values, ...environment };
}
