/** 在真实 Provider 协作探针存活期间，逐页点击验证打包 Renderer 的 Bot/Session/Thread 展示。 */
import { readLiveEnv } from "../tests/live/env.mjs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = new URL("..", import.meta.url).pathname;
const executable = join(root, "release/mac-arm64/OpenAgentBot.app/Contents/MacOS/OpenAgentBot");
const [provider, botName, sessionId, workerName] = process.argv.slice(2);
if (!["qoder", "bailian"].includes(provider) || !botName || !sessionId || !workerName) throw new Error("provider and fixture identifiers required");
const env = readLiveEnv();
const credential = provider === "qoder" ? env.QODER_PAT : env.DASHSCOPE_API_KEY;
if (!credential || (provider === "bailian" && !env.BAILIAN_WORKSPACE_ID)) throw new Error("Provider test credential missing");
const port = 10222 + Math.floor(Math.random() * 1000);
const userData = mkdtempSync(join(tmpdir(), "openagentbot-v2ma-ui-"));
const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { stdio: "ignore" });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error || message.result?.exceptionDetails) pending.reject(new Error(message.error?.message ?? message.result.exceptionDetails.text));
      else pending.resolve(message.result?.result?.value);
    };
  }
  async open() { await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; }); }
  evaluate(expression) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("CDP timeout")); }, 30000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("CDP timeout")); }, 30000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.ws.close(); }
}

async function waitFor(cdp, expression, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await cdp.evaluate(expression).catch(() => false);
    if (value) return value;
    await sleep(400);
  }
  throw new Error(`timeout: ${label}`);
}
async function typeInto(cdp, selector, value) {
  await cdp.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!input) throw new Error('input missing'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
}
async function click(cdp, selector) {
  const clicked = await cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  if (!clicked) throw new Error(`click target missing: ${selector}`);
}

let cdp;
try {
  let page;
  for (let i = 0; i < 80 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((item) => item.type === "page" && /^(http|file)/.test(item.url)); } catch {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("packaged renderer unavailable");
  cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  await waitFor(cdp, `!!document.querySelector('#connection-provider')`, "connection form");
  if (provider === "bailian") {
    await click(cdp, "#connection-provider");
    await waitFor(cdp, `Array.from(document.querySelectorAll('[role="option"]')).some(x => x.textContent.includes('百炼'))`, "Bailian provider option");
    await cdp.evaluate(`Array.from(document.querySelectorAll('[role="option"]')).find(x => x.textContent.includes('百炼')).click()`);
    await waitFor(cdp, `Array.from(document.querySelectorAll('button')).some(x => x.textContent.includes('手动输入 API Key'))`, "Bailian manual method");
    await cdp.evaluate(`Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('手动输入 API Key')).click()`);
    await waitFor(cdp, `!!document.querySelector('#connection-workspace-id')`, "Bailian workspace input");
    await typeInto(cdp, "#connection-workspace-id", env.BAILIAN_WORKSPACE_ID);
  }
  await waitFor(cdp, `!!document.querySelector('#connection-credential')`, "credential input");
  await typeInto(cdp, "#connection-credential", credential);
  await cdp.evaluate(`document.querySelector('#connection-credential')?.closest('form')?.querySelector('button[type="submit"]')?.click()`);
  const state = await waitFor(cdp, `document.querySelector('[aria-label="可选运行环境"]') ? 'select' : document.body.textContent.includes('全部任务') ? 'ready' : false`, "connection result", 60000);
  if (state === "select") {
    await cdp.evaluate(`(() => { const label = document.querySelector('[aria-label="可选运行环境"] label'); if (!label) return false; label.click(); return true; })()`);
    await waitFor(cdp, `Array.from(document.querySelectorAll('button')).some(x => x.textContent.includes('使用选定环境') && !x.disabled)`, "environment selected");
    await cdp.evaluate(`Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('使用选定环境')).click()`);
  }
  await waitFor(cdp, `window.desktopHost.connections.list().then(async cs => { const c = cs.find(x => x.provider === ${JSON.stringify(provider)}); return c && (await window.desktopHost.bots.list(c.id)).some(x => x.name === ${JSON.stringify(botName)}); })`, "coordinator in remote directory", 60000);
  await cdp.evaluate(`Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('管理助手'))?.click()`);
  await waitFor(cdp, `!!document.querySelector('button[aria-label="打开 ${botName} 的 Chat"]')`, "coordinator in Bot list", 60000);
  console.log("packaged collaboration: connection and coordinator loaded");
  const botBadge = await cdp.evaluate(`document.querySelector('button[aria-label="打开 ${botName} 的 Chat"]')?.textContent.includes('协作')`);
  if (!botBadge) throw new Error("Bot collaboration badge missing");
  await click(cdp, `button[aria-label="打开 ${botName} 的 Chat"]`);
  await waitFor(cdp, `document.body.textContent.includes('当前远程协作成员')`, "Bot remote roster");
  await cdp.evaluate(`Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('当前远程协作成员')).click()`);
  await waitFor(cdp, `document.body.textContent.includes(${JSON.stringify(workerName)})`, "worker name in Bot roster");
  console.log("packaged collaboration: Bot roster visible");
  const chatRef = await waitFor(cdp, `window.desktopHost.connections.list().then(async cs => { const c = cs.find(x => x.provider === ${JSON.stringify(provider)}); if (!c) return false; const b = (await window.desktopHost.bots.list(c.id)).find(x => x.name === ${JSON.stringify(botName)}); if (!b) return false; const chat = (await window.desktopHost.chats.list(b.ref)).find(x => x.ref.sessionId === ${JSON.stringify(sessionId)}); return chat ? {bot:b.ref, chat:chat.ref, roster:chat.collaboration?.memberAgentIds} : false; })`, "Session list bridge", 60000);
  if (!chatRef.roster?.length) throw new Error("Session snapshot missing in bridge");
  console.log("packaged collaboration: Session snapshot returned by bridge");
  const rowFound = await cdp.evaluate(`(() => { const rows = Array.from(document.querySelectorAll('li')); const row = rows.find(x => x.textContent.includes('协作任务') && x.querySelector('button')); if (!row) return false; row.querySelector('button').click(); return true; })()`);
  if (!rowFound) throw new Error("Session collaboration badge missing in list");
  await waitFor(cdp, `document.body.textContent.includes('创建此任务时的协作成员')`, "Session snapshot header");
  await waitFor(cdp, `Array.from(document.querySelectorAll('[data-work-group]')).some(x => x.textContent.includes('协作子任务'))`, "delegation work group", 60000);
  await cdp.evaluate(`Array.from(document.querySelectorAll('[data-work-group] > button')).forEach(x => x.click())`);
  try {
    await waitFor(cdp, `document.body.textContent.includes('发送跨线程消息') && document.body.textContent.includes('收到跨线程消息')`, "expanded bidirectional delegation");
  } catch (error) {
    const state = await cdp.evaluate(`({ groups: Array.from(document.querySelectorAll('[data-work-group]')).map(x => x.textContent.slice(0,300)), labels: Array.from(document.querySelectorAll('[data-timeline-event-id]')).map(x => x.textContent.slice(0,100)) })`);
    throw new Error(`${error.message}: ${JSON.stringify(state)}`);
  }
  const coherentGroup = await cdp.evaluate(`Array.from(document.querySelectorAll('[data-work-group]')).some(x => x.textContent.includes('发送跨线程消息') && x.textContent.includes('收到跨线程消息'))`);
  if (!coherentGroup) throw new Error("delegation send and reply appear in separate work groups");
  await click(cdp, 'button[aria-label="刷新任务"]');
  await waitFor(cdp, `Array.from(document.querySelectorAll('[data-work-group]')).some(x => x.textContent.includes('协作子任务'))`, "delegation after refresh", 60000);
  console.log("packaged collaboration: Session snapshot and delegation visible");
  for (const [width, height] of [[1024,700],[790,650],[640,600]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    const result = await cdp.evaluate(`({ overflow: document.documentElement.scrollWidth > innerWidth + 1, snapshot: !!document.querySelector('[data-chat-reading-lane]'), work: !!document.querySelector('[data-work-group]') })`);
    if (result.overflow || !result.snapshot || !result.work) throw new Error(`layout ${width}x${height}: ${JSON.stringify(result)}`);
  }
  console.log(`packaged ${provider} collaboration E2E passed: Bot badge/roster, Session snapshot, expanded delegation, refresh, three viewport sizes`);
} finally {
  cdp?.close();
  child.kill("SIGKILL");
  if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("exit", resolve));
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
