/**
 * 架构守卫：Renderer 与 shared 不得 import Node/Electron。
 * Stage 01 最小检查；后续随模块边界扩展。
 */
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

// 匹配 import ... from "x"、import "x"、import("x")、require("x") 中的模块名，
// 允许子路径（如 fs/promises）被前缀规则捕获。
const IMPORT_RE = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;

// 禁止的模块或其前缀；node: 前缀统一禁止。
const FORBIDDEN = ["electron", "node:", "fs", "path", "os", "net", "tls", "ipcRenderer"];

function isForbidden(spec) {
  if (spec.startsWith("node:")) return true;
  for (const token of FORBIDDEN) {
    if (spec === token || spec.startsWith(`${token}/`)) return true;
  }
  return false;
}

let failed = false;

for (const dirName of ["src/renderer", "src/shared"]) {
  const dir = join(root, dirName);
  for await (const file of glob("**/*.{ts,tsx,mts,cts}", { cwd: dir })) {
    const path = join(dir, file);
    const content = readFileSync(path, "utf8");
    for (const match of content.matchAll(IMPORT_RE)) {
      const spec = match[1];
      if (spec !== undefined && isForbidden(spec)) {
        console.error(`Architecture violation in ${dirName}/${file}: forbidden import "${spec}"`);
        failed = true;
      }
    }
  }
}

for await (const file of glob("**/*.{ts,tsx,mts,cts}", { cwd: join(root, "src") })) {
  const path = join(root, "src", file);
  const content = readFileSync(path, "utf8");
  const isControlPlane = file.startsWith("main/control-plane/");
  for (const match of content.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (
      spec?.startsWith("@openagentpack/sdk") &&
      (!isControlPlane || spec !== "@openagentpack/sdk")
    ) {
      console.error(
        `Architecture violation in src/${file}: OpenAgentPack is control-plane only (found "${spec}")`,
      );
      failed = true;
    }
    if (spec?.includes("src/internal")) {
      console.error(
        `Architecture violation in src/${file}: cross-repository internal import "${spec}"`,
      );
      failed = true;
    }
  }
}

// 表单 Primitive 的 hover/focus/invalid/disabled 状态必须由 design-system 统一定义。
// Feature/Shell 若需要无边框输入等视觉形态，应选择 Primitive 的正式 variant，不能在调用点
// 用 Tailwind 状态类覆盖，否则不同伪类（如 focus 与 focus-visible）会同时生效并产生双重描边。
for await (const file of glob("{features,shell}/**/*.tsx", {
  cwd: join(root, "src/renderer"),
})) {
  const path = join(root, "src/renderer", file);
  const content = readFileSync(path, "utf8");
  for (const match of content.matchAll(/<(Input|Textarea|Select)\b[\s\S]*?\/>/g)) {
    const stateOverride = match[0].match(
      /\b(?:hover|focus|focus-visible|disabled|aria-invalid):[^\s"']+/,
    );
    if (stateOverride !== null) {
      console.error(
        `Design-system violation in src/renderer/${file}: ${match[1]} interaction state must use a Primitive variant (found "${stateOverride[0]}")`,
      );
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(
  "Architecture check passed: renderer/shared privileges, OpenAgentPack boundaries, and form Primitive state ownership hold.",
);
