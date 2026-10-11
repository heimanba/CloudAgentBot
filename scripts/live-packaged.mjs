/**
 * Packaged live 用户流程（MUTATING，真实 Cloud，自动清理）。
 *
 * 与 smoke-packaged.mjs 不同：本脚本通过 CDP 驱动打包应用的可见 Renderer UI，
 * 验证当前 Qoder 用户主流程：
 *   添加 Connection → 显式选择现有共享 Environment → 新任务草稿 → 选择现有 Bot
 *   → 发送时创建 Chat → 等待最终回复 → 刷新并重读远程历史。
 *
 * 断言均为用户可观察结果（DOM 文本、按钮状态、历史可见）。
 *
 * 安全约束：
 * - PAT 只从当前仓库 .env 或环境变量读入并键入密码框；不写入命令行、日志、截图或断言文本。
 * - userData 用 mkdtemp 隔离目录，结束后删除。
 * - 测试只创建一个 Session；结束后删除并复查，不删除既有 Bot 或 Environment。
 *
 * 运行：OPENAGENTBOT_LIVE=1 node scripts/live-packaged.mjs
 * 前置：已执行 pnpm package 生成 release/ 下的打包应用；已按 README 安装 npm 依赖。
 */
import { readLiveEnv } from "../tests/live/env.mjs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const LIVE = process.env.OPENAGENTBOT_LIVE === "1";
if (!LIVE) {
  console.log("live-packaged skipped: set OPENAGENTBOT_LIVE=1 to run the real packaged user flow.");
  process.exit(0);
}

const root = new URL("..", import.meta.url).pathname;
const executable =
  process.platform === "darwin"
    ? join(root, "release/mac-arm64/OpenAgentBot.app/Contents/MacOS/OpenAgentBot")
    : join(root, "release/linux-unpacked/openagentbot");

const GATEWAY = "https://api.qoder.com/api/v1/cloud";
const marker = `LIVE_UI_OK_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

const debugPort = 9222 + Math.floor(Math.random() * 1000);
const userDataDir = mkdtempSync(join(tmpdir(), "openagentbot-v2-live-"));

let child;
let pat = "";
const created = { sessionId: undefined, botRef: undefined, candidateBotRefs: [], beforeSessions: [] };

function loadPat() {
  const pat = readLiveEnv().QODER_PAT?.trim();
  if (!pat) throw new Error("QODER_PAT is required for live validation");
  return pat;
}

/** 日志绝不包含 pat 或完整凭据。 */
function log(step, extra) {
  console.log(`[live] ${step}${extra ? ` — ${extra}` : ""}`);
}

/** 只删除本轮创建的 Session，绝不碰既有 Bot 与共享 Environment。 */
async function cleanupRemote() {
  if (!pat) return;
  let sessionId = created.sessionId;
  if (!sessionId) {
    for (const bot of created.candidateBotRefs) {
      const list = await fetch(`${GATEWAY}/sessions?agent_id=${encodeURIComponent(bot.agentId)}&limit=100`, {
        headers: { Authorization: `Bearer ${pat}` },
      });
      if (!list.ok) continue;
      const body = await list.json();
      for (const session of body.data ?? []) {
        if (created.beforeSessions.includes(session.id)) continue;
        const events = await fetch(`${GATEWAY}/sessions/${session.id}/events?limit=100`, {
          headers: { Authorization: `Bearer ${pat}` },
        });
        if (events.ok && JSON.stringify(await events.json()).includes(marker)) {
          sessionId = session.id;
          break;
        }
      }
      if (sessionId) break;
    }
  }
  if (!sessionId) return;
  const response = await fetch(`${GATEWAY}/sessions/${sessionId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${pat}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`test Session cleanup failed: ${response.status}`);
  }
  log("cleanup", "test Session deleted");
}

function cleanup() {
  if (child) {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  setTimeout(() => {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }, 500);
}

function fail(message, error) {
  console.error(`live-packaged failed: ${message}`);
  if (error) console.error(error);
  return cleanupRemote()
    .catch((cleanupError) => {
      console.error("test Session cleanup also failed:", cleanupError);
    })
    .finally(() => {
      cleanup();
      process.exit(1);
    });
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return r.json();
}

async function waitForPage() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${debugPort}/json`);
      const page = targets.find(
        (t) => t.type === "page" && (t.url.startsWith("http") || t.url.startsWith("file")),
      );
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no debuggable page within 20s");
}

/**
 * 持久 CDP 会话：一次连接复用，避免每次 evaluate 新建 WebSocket。
 * 只暴露 evaluate(expression, {awaitPromise})；message handler 常驻。
 */
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.id !== undefined && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else if (m.result?.exceptionDetails) {
          reject(
            new Error(
              (m.result.exceptionDetails.text || "") +
                " " +
                (m.result.exceptionDetails.exception?.description ?? ""),
            ),
          );
        } else resolve(m.result?.result?.value);
      }
    };
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
  }
  evaluate(expression, awaitPromise = true) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP evaluate timeout")), 120000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise },
        }),
      );
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP ${method} timeout`)), 30000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function waitFor(cdp, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // 页面未就绪时 evaluate 可能抛错（如 document.body 为 null），继续轮询。
    const v = await cdp.evaluate(expression).catch(() => false);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timeout waiting for: ${label}`);
}

/** 用原生 setter 触发 React onChange（输入框/文本域）。 */
async function typeInto(cdp, selector, text) {
  await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error("no element " + ${JSON.stringify(selector)});
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
}

async function clickButton(cdp, textMatch) {
  const ok = await cdp.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => (x.textContent || "").trim().includes(${JSON.stringify(textMatch)}) && !x.disabled);
    if (!b) return false;
    b.scrollIntoView(); b.click(); return true;
  })()`);
  if (!ok) throw new Error(`button not found or disabled: ${textMatch}`);
}

async function clickAria(cdp, label) {
  const ok = await cdp.evaluate(`(() => {
    const button = document.querySelector('button[aria-label=${JSON.stringify(label)}]');
    if (!button || button.disabled) return false;
    button.click(); return true;
  })()`);
  if (!ok) throw new Error(`button not found or disabled: aria-label=${label}`);
}

async function assertVisibleLayout(cdp, label, selector, narrowSelector = selector) {
  const inspect = (currentSelector) =>
    cdp.evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(currentSelector)});
    const rect = target?.getBoundingClientRect();
    return {
      targetVisible: !!rect && rect.width > 0 && rect.height > 0,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  })()`);
  for (const [width, height] of [
    [1024, 700],
    [790, 650],
    [640, 600],
  ]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const result = await inspect(width < 768 ? narrowSelector : selector);
    if (!result?.targetVisible || result.horizontalOverflow) {
      throw new Error(`${label} ${width}x${height} layout failed: ${JSON.stringify(result)}`);
    }
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  log(`layout:${label}`, "1024×700、790×650、640×600 target visible, no horizontal overflow");
}

async function main() {
  pat = loadPat();

  const page = await waitForPage();
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  log("cdp", `connected to packaged renderer`);

  // ── 0. 初始空状态（代表状态：empty）。确认 bridge 与首个渲染（等 document.body）。
  await waitFor(
    cdp,
    `!!window.desktopHost && !!document.querySelector("#connection-credential")`,
    20000,
    "app boot",
  );
  log("boot", "desktopHost bridge present, connection onboarding rendered");

  // ── 1. 添加 Connection（可见 UI 表单）。
  await typeInto(cdp, "#connection-credential", pat);
  await clickButton(cdp, "验证并添加");
  const needsSelection = await waitFor(
    cdp,
    `document.body.textContent.includes('全部任务') ? 'ready' : document.querySelector('[role="dialog"]') && document.querySelector('[aria-label="可选运行环境"]') ? 'select' : false`,
    60000,
    "connection result",
  );
  if (needsSelection === "select") {
    const pickedEnvironment = await cdp.evaluate(
      `(() => { const list = document.querySelector('[aria-label="可选运行环境"]'); const label = Array.from(list?.querySelectorAll('label') ?? []).find(x => x.textContent.includes('Agents/base')) ?? list?.querySelector('label'); if (!label) return false; label.click(); return true; })()`,
    );
    if (!pickedEnvironment) throw new Error("no existing Environment candidate available");
    await clickButton(cdp, "使用选定环境");
  }
  await waitFor(
    cdp,
    `document.body.textContent.includes("全部任务") || document.body.textContent.includes("新任务")`,
    30000,
    "workspace ready",
  );
  await assertVisibleLayout(
    cdp,
    "workspace",
    'button[aria-label="新任务"]',
    'button[aria-label="打开导航"]',
  );
  log("connection", "credential verified, existing Environment selected, task workspace opened");
  const selectedConnectionId = await cdp.evaluate(
    `window.desktopHost.connections.list().then(items => items.find(item => item.provider === 'qoder' && item.environmentReady)?.id ?? null)`,
  );
  if (!selectedConnectionId) throw new Error("ready Qoder connection missing");
  const testBots = await cdp.evaluate(
    `window.desktopHost.bots.list(${JSON.stringify(selectedConnectionId)}).then(items => items.filter(item => item.name === 'QA助手').map(item => item.ref))`,
  );
  if (!testBots.length) throw new Error("QA test Bot missing");
  created.candidateBotRefs = testBots;
  const beforeSessions = await cdp.evaluate(
    `Promise.all(${JSON.stringify(testBots)}.map(ref => window.desktopHost.chats.list(ref))).then(groups => groups.flatMap(items => items.map(item => item.ref.sessionId)))`,
  );
  created.beforeSessions = beforeSessions;
  await clickAria(cdp, "新任务");
  await waitFor(
    cdp,
    `!!document.querySelector('textarea[aria-label="任务内容"]')`,
    10000,
    "new task composer",
  );
  await assertVisibleLayout(cdp, "new-task", 'textarea[aria-label="任务内容"]');
  await typeInto(cdp, 'textarea[aria-label="任务内容"]', `真机体验测试。请只回复 ${marker}。`);
  const beforeSelection = await cdp.evaluate(
    `Promise.all(${JSON.stringify(testBots)}.map(ref => window.desktopHost.chats.list(ref))).then(groups => groups.reduce((sum, items) => sum + items.length, 0))`,
  );
  if (beforeSelection !== beforeSessions.length)
    throw new Error("new task created a Session before send");
  const openedPicker = await cdp.evaluate(
    `(() => { const button = document.querySelector('textarea[aria-label="任务内容"]')?.parentElement?.parentElement?.querySelector('button'); if (!button) return false; button.click(); return true; })()`,
  );
  if (!openedPicker) throw new Error("Bot picker trigger missing");
  await waitFor(
    cdp,
    `!!document.querySelector('[data-radix-popper-content-wrapper]')`,
    10000,
    "Bot picker",
  );
  await typeInto(cdp, 'input[aria-label="搜索助手"]', "QA助手");
  await waitFor(
    cdp,
    `Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper] button')).some(x => x.textContent.includes('QA助手'))`,
    10000,
    "QA Bot search result",
  );
  const picked = await cdp.evaluate(
    `(() => { const button = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper] button')).find(x => x.textContent.includes('QA助手')); if (!button) return false; button.click(); return true; })()`,
  );
  if (!picked) throw new Error("QA Bot candidate missing");
  const afterSelection = await cdp.evaluate(
    `Promise.all(${JSON.stringify(testBots)}.map(ref => window.desktopHost.chats.list(ref))).then(groups => groups.reduce((sum, items) => sum + items.length, 0))`,
  );
  if (afterSelection !== beforeSessions.length)
    throw new Error("selecting a Bot created a Session");
  await clickAria(cdp, "发送任务");
  await waitFor(
    cdp,
    `!!document.querySelector('textarea[placeholder*="发送消息"]')`,
    90000,
    "created Chat composer",
  );
  await assertVisibleLayout(cdp, "chat-composer", 'textarea[placeholder*="发送消息"]');
  const createdChat = await waitFor(
    cdp,
    `Promise.all(${JSON.stringify(testBots)}.map(ref => window.desktopHost.chats.list(ref))).then(groups => groups.flat().find(item => !${JSON.stringify(beforeSessions)}.includes(item.ref.sessionId))?.ref ?? null)`,
    30000,
    "new remote Session",
  );
  const createdSessionId = createdChat.sessionId;
  const testBot = { connectionId: createdChat.connectionId, agentId: createdChat.agentId };
  created.sessionId = createdSessionId;
  created.botRef = testBot;
  log("chat-create", "new Session opened only after sending task");
  await waitFor(
    cdp,
    `Array.from(document.querySelectorAll('[data-message-role="assistant"]')).some(x => x.textContent.includes(${JSON.stringify(marker)})) && !document.querySelector('button[aria-label="发送中"]')`,
    120000,
    "assistant reply settled",
  );
  log("send", "composer sent and assistant reply appeared");
  await clickAria(cdp, "刷新任务");
  await waitFor(
    cdp,
    `window.desktopHost.chats.get(${JSON.stringify({ ...testBot, sessionId: createdSessionId })}).then(detail => detail.events.some(item => item.kind === 'message' && item.role === 'assistant' && item.content.includes(${JSON.stringify(marker)})))`,
    30000,
    "remote history persisted",
  );
  log("history", "assistant reply remains after remote reload");
  await clickAria(cdp, "打开工作记录工具");
  await waitFor(
    cdp,
    `!!document.querySelector('[aria-label="筛选事件"]')`,
    10000,
    "work record tools",
  );
  log("work tools", "filter and search controls visible");
  const timelineCounts = await cdp.evaluate(
    `({groups: document.querySelectorAll('[data-work-group]').length, messages: document.querySelectorAll('[data-message-role]').length, failures: document.querySelectorAll('[data-event-type*="error"]').length})`,
  );
  log("timeline", JSON.stringify(timelineCounts));
  await clickAria(cdp, "跳转到消息、错误或产物");
  const anchorVisible = await cdp.evaluate(
    `Array.from(document.querySelectorAll('button')).some(x => x.textContent.includes(${JSON.stringify(marker)}))`,
  );
  if (!anchorVisible) throw new Error("assistant reply anchor missing");
  log("anchors", "assistant reply appears in jump list");
  await clickButton(cdp, "管理助手");
  await waitFor(
    cdp,
    `!!document.querySelector('button[aria-label="新建 Bot"]')`,
    10000,
    "Bots management mode",
  );
  await clickAria(cdp, "新建 Bot");
  await waitFor(cdp, `!!document.querySelector('#create-bot-name')`, 10000, "Bot creation form");
  await assertVisibleLayout(cdp, "bot-create", "#create-bot-name");
  await waitFor(
    cdp,
    `!!document.querySelector('button[aria-label="添加协作成员"]')`,
    10000,
    "collaboration member selector",
  );
  log("bot-form", "creation form and collaboration member selector available without creating an Agent");
  await cleanupRemote();
  await waitFor(
    cdp,
    `window.desktopHost.chats.list(${JSON.stringify(testBot)}).then(items => !items.some(item => item.ref.sessionId === ${JSON.stringify(createdSessionId)}))`,
    30000,
    "test Session absent from roster",
  );
  created.sessionId = undefined;
  cdp.close();
  console.log(
    "live-packaged PASSED: Qoder connection, environment selection, Chat creation, send, history reload and cleanup.",
  );
}

child = spawn(
  executable,
  [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`],
  { stdio: "ignore" },
);

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((e) => fail(e.message, e));

child.on("error", (e) => fail("failed to launch packaged app", e));
child.on("exit", (code) => {
  if (code !== 0 && code !== null) fail(`packaged app exited early: ${code}`);
});
