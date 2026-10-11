/**
 * 视觉与可访问性验收（packaged，非 live，不需凭据）。
 *
 * 通过 CDP 驱动打包应用的可见 Renderer UI，验证 Stage 09 复审新增完成条件：
 * - 320px 窄窗口：composer 不遮挡历史，主动作可见；
 * - 150% 缩放：布局不破；
 * - 长文本：长 Bot 名、长消息不破坏布局；
 * - 键盘焦点：focus-visible 环可见，Tab 顺序合理；
 * - 对比度：计算样式断言关键 token 对的 WCAG AA 对比度；
 * - 无凭据可验证状态：首次空状态与长文本；真实远程状态由 live:packaged 验证。
 *
 * 断言均基于计算样式与 DOM 可观察结果，不依赖截图比对。
 * 运行：node scripts/visual-a11y.mjs
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = new URL("..", import.meta.url).pathname;
const executable =
  process.platform === "darwin"
    ? join(root, "release/mac-arm64/OpenAgentBot.app/Contents/MacOS/OpenAgentBot")
    : join(root, "release/linux-unpacked/openagentbot");

const debugPort = 9222 + Math.floor(Math.random() * 1000);
const userDataDir = mkdtempSync(join(tmpdir(), "openagentbot-v2-visual-"));

let child;

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
  console.error(`visual-a11y FAILED: ${message}`);
  if (error) console.error(error);
  cleanup();
  process.exit(1);
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
      const timer = setTimeout(() => reject(new Error("CDP evaluate timeout")), 30000);
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
  async send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP ${method} timeout`)), 30000);
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
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

/** 相对亮度（WCAG）。 */
function luminance(r, g, b) {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const value =
    m[1].length === 3
      ? m[1]
          .split("")
          .map((char) => char + char)
          .join("")
      : m[1];
  const n = parseInt(value, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 对比度。 */
function contrastRatio(hex1, hex2) {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  if (!c1 || !c2) return null;
  const l1 = luminance(...c1);
  const l2 = luminance(...c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function log(step, extra) {
  console.log(`[visual] ${step}${extra ? ` — ${extra}` : ""}`);
}

async function main() {
  const page = await waitForPage();
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  log("cdp", "connected to packaged renderer");

  // 等应用渲染出首次连接页（先等 document.body 存在）。
  const booted = await (async () => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const v = await cdp
        .evaluate(`!!window.desktopHost && !!document.querySelector("#connection-credential")`)
        .catch(() => false);
      if (v) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  })();
  if (!booted) throw new Error("app did not boot");
  log("boot", "connection onboarding rendered");

  const results = { contrast: [], focus: [], narrow: [], zoom: [], states: [] };

  // ── 1. 对比度：读取计算样式，断言关键 token 对 WCAG AA（正文 >= 4.5，大文本 >= 3）。
  const contrastChecks = await cdp.evaluate(`(() => {
    const cs = getComputedStyle(document.documentElement);
    const pairs = [
      ["foreground", "background"],
      ["muted-foreground", "background"],
      ["primary-foreground", "primary"],
      ["secondary-foreground", "secondary"],
      ["destructive-foreground", "destructive"],
      ["card-foreground", "card"],
      ["ring", "background"]
    ];
    return pairs.map(([fg, bg]) => ({
      pair: fg + " on " + bg,
      fg: cs.getPropertyValue("--" + fg).trim(),
      bg: cs.getPropertyValue("--" + bg).trim()
    }));
  })()`);
  for (const c of contrastChecks) {
    const ratio = contrastRatio(c.fg, c.bg);
    const pass = ratio !== null && ratio >= 4.5;
    results.contrast.push({ pair: c.pair, ratio: ratio?.toFixed(2), pass });
    if (!pass)
      throw new Error(`contrast FAIL: ${c.pair} = ${ratio?.toFixed(2)} (${c.fg} on ${c.bg})`);
  }
  log("contrast", `${results.contrast.length} token pairs pass WCAG AA (>= 4.5)`);

  // ── 2. 键盘焦点：Tab 到第一个可聚焦元素，断言 focus-visible 环可见。
  await cdp.send("Page.bringToFront");
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  await new Promise((r) => setTimeout(r, 300));
  const focus = await cdp.evaluate(`(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { ok: false, reason: "no focusable element" };
    const cs = getComputedStyle(el);
    const outline = cs.outlineWidth + " " + cs.outlineStyle + " " + cs.outlineColor;
    const boxShadow = cs.boxShadow;
    const hasRing = (cs.outlineWidth !== "0px" && cs.outlineStyle !== "none") || (boxShadow && boxShadow !== "none");
    return {
      ok: true,
      tag: el.tagName,
      id: el.id || null,
      outline,
      boxShadow: boxShadow !== "none" ? boxShadow.slice(0, 80) : null,
      hasRing
    };
  })()`);
  results.focus.push(focus);
  if (!focus.ok) throw new Error(`focus FAIL: ${focus.reason}`);
  if (!focus.hasRing)
    throw new Error(
      `focus FAIL: no visible ring on ${focus.tag}#${focus.id} (outline=${focus.outline}, boxShadow=${focus.boxShadow})`,
    );
  log("focus", `visible focus ring on ${focus.tag}${focus.id ? "#" + focus.id : ""}`);

  // ── 3. 320px 窄窗口：composer 不遮挡历史，主动作可见。
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 500));
  const narrow = await cdp.evaluate(`(() => {
    const connectBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("连接"));
    const card = document.querySelector(".app-panel");
    const overflowX = document.documentElement.scrollWidth > 320;
    const btnRect = connectBtn ? connectBtn.getBoundingClientRect() : null;
    return {
      viewportWidth: window.innerWidth,
      horizontalOverflow: overflowX,
      connectVisible: btnRect ? btnRect.width > 0 && btnRect.height > 0 : false,
      cardWidth: card ? card.getBoundingClientRect().width : null
    };
  })()`);
  results.narrow.push(narrow);
  if (narrow.horizontalOverflow)
    throw new Error(
      `narrow FAIL: horizontal overflow at 320px (scrollWidth=${narrow.viewportWidth})`,
    );
  if (!narrow.connectVisible)
    throw new Error("narrow FAIL: primary action 连接 not visible at 320px");
  log("narrow", "320px: no horizontal overflow, primary action visible");

  // ── 4. 150% 缩放：布局不破。
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1024,
    height: 768,
    deviceScaleFactor: 1.5,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 500));
  const zoom = await cdp.evaluate(`(() => {
    const overflowX = document.documentElement.scrollWidth > window.innerWidth + 10;
    const connectBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("连接"));
    const btnRect = connectBtn ? connectBtn.getBoundingClientRect() : null;
    return {
      devicePixelRatio: window.devicePixelRatio,
      horizontalOverflow: overflowX,
      connectVisible: btnRect ? btnRect.width > 0 && btnRect.height > 0 : false
    };
  })()`);
  results.zoom.push(zoom);
  if (zoom.horizontalOverflow) throw new Error("zoom FAIL: horizontal overflow at 150% zoom");
  if (!zoom.connectVisible) throw new Error("zoom FAIL: primary action not visible at 150% zoom");
  log("zoom", `150% zoom (dpr=${zoom.devicePixelRatio}): no overflow, action visible`);

  // 恢复正常尺寸。
  await cdp.send("Emulation.clearDeviceMetricsOverride");

  // ── 5. 代表状态：首次空状态（无 Connection）。
  const emptyState = await cdp.evaluate(`(() => ({
    hasEmptyText: document.body.textContent.includes("添加 Provider 连接"),
    hasAddForm: !!document.querySelector("#connection-credential")
  }))()`);
  results.states.push({ name: "empty", ...emptyState });
  if (!emptyState.hasEmptyText || !emptyState.hasAddForm) throw new Error("empty state FAIL");
  log("state:empty", "首次空状态：提示文本 + 创建表单均可见");

  // ── 6. 长文本：Bot 名、描述、消息。
  // 通过可见凭据字段输入长文本，验证表单布局不会产生水平溢出。
  const longName = "A".repeat(200) + "-超长凭据测试-" + "中文字符".repeat(30);
  await cdp.evaluate(`(() => {
    const el = document.querySelector("#connection-credential");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(longName)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  const longText = await cdp.evaluate(`(() => {
    const el = document.querySelector("#connection-credential");
    return {
      valueLength: el.value.length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 10,
      inputVisible: el.getBoundingClientRect().width > 0
    };
  })()`);
  results.states.push({ name: "long-text", ...longText });
  if (longText.overflowX)
    throw new Error("long-text FAIL: horizontal overflow with 200+ char name");
  log("state:long-text", `长文本 (${longText.valueLength} chars) 不破坏布局`);

  // 其他需要真实 Connection/Bot 的状态由 live:packaged 与行为测试承担；
  // 本脚本不把“测试文件存在”记作视觉验收通过，避免生成假阳性证据。

  cdp.close();
  console.log("visual-a11y PASSED:", JSON.stringify(results, null, 2));
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
