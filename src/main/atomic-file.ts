/**
 * 同目录临时文件 + rename 的原子写。
 * 应用自己管理的 JSON 文件（connections.json、credentials.enc）统一走这里；
 * 覆盖写不产生半写文件，读取侧只看到旧版本或新版本。
 */

import { open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export async function writeFileAtomic(
  filePath: string,
  content: string | Buffer,
): Promise<void> {
  const dir = join(filePath, "..");
  const tmp = join(dir, `.${randomBytes(8).toString("hex")}.tmp`);
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    await rename(tmp, filePath);
  } catch (error) {
    // 写入或 rename 失败时清理孤儿临时文件；原目标文件保持不动。
    await handle.close().catch(() => undefined);
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}
