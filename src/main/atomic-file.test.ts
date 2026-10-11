import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileAtomic } from "./atomic-file";

describe("writeFileAtomic", () => {
  it("writes content and leaves no temp files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-atomic-"));
    try {
      const file = join(dir, "data.json");
      await writeFileAtomic(file, '{"a":1}');
      expect(await readFile(file, "utf8")).toBe('{"a":1}');

      await writeFileAtomic(file, '{"a":2}');
      expect(await readFile(file, "utf8")).toBe('{"a":2}');
      expect(await readdir(dir)).toEqual(["data.json"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cleans up temp file when rename fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-atomic-"));
    try {
      const file = join(dir, "data.json");
      // 临时文件仍可正常创建；rename 不能把文件替换为非空目录。
      await mkdir(file);
      await writeFile(join(file, "sentinel"), "original", "utf8");

      await expect(writeFileAtomic(file, "new")).rejects.toThrow();

      expect(await readdir(dir)).toEqual(["data.json"]);
      expect(await readFile(join(file, "sentinel"), "utf8")).toBe("original");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("overwrites corrupt content completely", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v2-atomic-"));
    try {
      const file = join(dir, "data.json");
      await writeFile(file, "garbage-prefix", "utf8");
      await writeFileAtomic(file, "ok");
      expect(await readFile(file, "utf8")).toBe("ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
