/** 隔离的真实 Electron/IPC 验收：本地连接删除确认、冲突与磁盘结果。先运行 pnpm build。 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "connection-delete-e2e-"));
const port = 19300 + Math.floor(Math.random() * 500);
const child = spawn(
  join(root, "node_modules/.bin/electron"),
  [
    fileURLToPath(new URL("./electron-harness.mjs", import.meta.url)),
    `--user-data-dir=${dir}`,
    `--remote-debugging-port=${port}`,
  ],
  { stdio: "ignore", cwd: root },
);
let ws;
const pause = () => new Promise((r) => setTimeout(r, 100));
async function wait(fn) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await pause();
  }
  throw Error("等待超时");
}
let seq = 0;
const pending = new Map();
const exited = new Promise((resolve) => {
  child.once("exit", resolve);
  child.once("error", resolve);
});
async function command(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      rej(Error("CDP 超时"));
    }, 15000);
    pending.set(id, {
      res: (value) => {
        clearTimeout(timer);
        res(value);
      },
      rej: (error) => {
        clearTimeout(timer);
        rej(error);
      },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function click(text) {
  await evaluate(
    `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('按钮不存在: '+${JSON.stringify(text)});if(b.disabled)throw Error('按钮禁用');b.click();})()`,
  );
}
async function text() {
  return evaluate('document.body?.innerText ?? ""');
}
function scope(name) {
  const root = join(dir, "v2/managed-bots/conn_e2e_delete", name);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({
      version: 1,
      scope: name,
      connectionId: "conn_e2e_delete",
      provider: "qoder",
      projectName: "E2E",
      phase: "new",
    }),
  );
  writeFileSync(join(root, "agents.yaml"), "name: e2e\n");
}
try {
  const page = await wait(async () => {
    try {
      return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
        (t) => t.type === "page",
      );
    } catch {
      return null;
    }
  });
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) {
        p.rej(Error(m.error.message));
      } else {
        p.res(m.result);
      }
    }
  };
  await wait(async () => (await text()).includes("E2E 保留连接"));
  await evaluate(`document.querySelector('button[aria-label="管理连接"]').click()`);
  await wait(async () => (await text()).includes("E2E 删除连接"));
  await click("E2E 删除连接凭据已断开");
  // 列表缓存为零，在弹窗打开前新增本地资料。
  scope("scope_e2e_first");
  await click("删除本地连接…");
  await wait(async () => (await text()).includes("1 份 Managed Bot 本地管理资料"));
  await click("取消");
  assert(existsSync(join(dir, "v2/managed-bots/conn_e2e_delete")));
  console.log("PASS 打开时刷新数量；取消不删除本地资料");
  rmSync(join(dir, "v2/managed-bots/conn_e2e_delete"), { recursive: true });
  // 弹窗显示零后新增资料，由真实 Main 检查产生 conflict。
  await click("删除本地连接…");
  await wait(
    async () =>
      await evaluate(
        `[...document.querySelectorAll('[role="alertdialog"] button')].some(b=>b.textContent==='删除本地连接'&&!b.disabled)`,
      ),
  );
  scope("scope_e2e_race");
  await click("删除本地连接");
  await wait(async () => (await text()).includes("请重新确认"));
  assert(existsSync(join(dir, "v2/managed-bots/conn_e2e_delete/scope_e2e_race/agents.yaml")));
  assert(
    JSON.parse(readFileSync(join(dir, "v2/connections.json"))).connections.some(
      (c) => c.id === "conn_e2e_delete",
    ),
  );
  console.log("PASS 真实 IPC conflict 后弹窗保留，资料和连接仍存在，等待再次确认");
  await click("取消");
  // 破坏临时连接文件以产生真实 list 失败，恢复后重试。
  const connectionFile = join(dir, "v2/connections.json");
  const saved = readFileSync(connectionFile);
  writeFileSync(connectionFile, '{"version":0}');
  await click("删除本地连接…");
  await wait(async () => (await text()).includes("无法读取此连接的最新资料"));
  assert(
    await evaluate(
      `[...document.querySelectorAll('[role="alertdialog"] button')].some(b=>b.textContent==='重新加载')`,
    ),
  );
  writeFileSync(connectionFile, saved);
  await click("重新加载");
  await wait(async () => (await text()).includes("1 份 Managed Bot 本地管理资料"));
  assert(existsSync(join(dir, "v2/managed-bots/conn_e2e_delete")));
  console.log("PASS 刷新失败禁止删除；重新加载只更新范围，不自动删除");
  await click("删除连接及本地管理资料");
  await wait(
    async () => !(await evaluate(`Boolean(document.querySelector('[role="alertdialog"]'))`)),
  );
  assert(!existsSync(join(dir, "v2/managed-bots/conn_e2e_delete")));
  const remaining = JSON.parse(readFileSync(connectionFile)).connections;
  assert.deepEqual(
    remaining.map((c) => c.id),
    ["conn_e2e_keep"],
  );
  assert(await evaluate(`window.desktopHost.connections.list().then(items=>items.length===1)`));
  console.log("PASS 明确确认后真实删除连接与管理资料，保留其他连接");
} finally {
  ws?.close();
  child.kill("SIGKILL");
  await exited;
  rmSync(dir, { recursive: true, force: true });
}
