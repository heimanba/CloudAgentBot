/**
 * Packaged smoke：启动打包后的应用，通过 CDP 验证 Stage 01/02 的实际验收面：
 * - window.desktopHost 存在、connections:list 可调用；
 * - 首次使用 onboarding、连接表单与工作区入口真实渲染；
 * - 表单门禁随用户输入变化，证明打包后的 React 交互可用。
 * - 第二次启动被已有实例吸收，且原 Renderer 继续可用。
 *
 * 不消费真实 Provider 凭据；不创建远程资源。
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
// 隔离 userData：避免污染开发环境真实连接，也保证 packaged smoke 可重复。
const userDataDir = mkdtempSync(join(tmpdir(), "openagentbot-v2-smoke-"));

let child;
let secondChild;

function cleanup() {
  if (child) {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
  if (secondChild) {
    try {
      secondChild.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
  setTimeout(() => {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }, 500);
}

function fail(message, error) {
  console.error(`Packaged smoke failed: ${message}`);
  if (error) console.error(error);
  cleanup();
  process.exit(1);
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

async function waitForPage() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${debugPort}/json`);
      const page = targets.find(
        (t) => t.type === "page" && (t.url.startsWith("http") || t.url.startsWith("file")),
      );
      if (page) return page;
    } catch {
      // CDP 尚未就绪，继续轮询
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no debuggable page found within 15s");
}

async function sendCommand(webSocketUrl, method, params = {}) {
  const ws = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return new Promise((resolve, reject) => {
    const id = 1;
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === id) {
        ws.close();
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      }
    };
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => reject(new Error("CDP evaluate timeout")), 5000);
  });
}

async function evaluate(webSocketUrl, expression) {
  return sendCommand(webSocketUrl, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
}

async function waitForExit(proc, timeoutMs) {
  if (proc.exitCode !== null) return { code: proc.exitCode, signal: proc.signalCode };
  return Promise.race([
    new Promise((resolve) => proc.once("exit", (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("process did not exit in time")), timeoutMs),
    ),
  ]);
}

async function main() {
  const page = await waitForPage();

  // 1. 基础 bridge 与 connections:list 可调用（Stage 01/02 验收面）。
  const bridgeResult = await evaluate(
    page.webSocketDebuggerUrl,
    `window.desktopHost ? window.desktopHost.connections.list().then(v => ({ ok: true, value: v })).catch(e => ({ ok: false, error: String(e) })) : { ok: false, error: "desktopHost missing" }`,
  );
  const bridgeBody = bridgeResult?.result?.value;
  if (!bridgeBody?.ok) {
    throw new Error(`desktopHost bridge check failed: ${bridgeBody?.error ?? "unknown"}`);
  }
  if (!Array.isArray(bridgeBody.value)) {
    throw new Error(`connections.list() returned non-array: ${JSON.stringify(bridgeBody.value)}`);
  }

  // 2. 首次使用先显示添加连接入口；打开表单后确认凭据字段与提交门禁真实渲染。
  const onboardingResult = await evaluate(
    page.webSocketDebuggerUrl,
    `new Promise((resolve) => {
      const deadline = Date.now() + 4000;
      const inspect = () => {
        const add = [...document.querySelectorAll('button')].find(button => (button.textContent ?? '').includes('添加连接'));
        if (add && !document.querySelector('#connection-credential')) add.click();
        const credential = document.querySelector("#connection-credential");
        const connect = document.querySelector('#connection-credential')?.closest('form')?.querySelector('button[type="submit"]');
        const result = {
          connectionManager: document.querySelector('[aria-label="连接管理"]') instanceof HTMLElement,
          credentialField: credential instanceof HTMLInputElement && credential.type === "password",
          connectDisabled: connect instanceof HTMLButtonElement && connect.disabled,
        };
        if (Object.values(result).every(Boolean) || Date.now() >= deadline) resolve(result);
        else setTimeout(inspect, 100);
      };
      inspect();
    })`,
  );
  const onboarding = onboardingResult?.result?.value;
  if (
    !onboarding?.connectionManager ||
    !onboarding?.credentialField ||
    !onboarding?.connectDisabled
  ) {
    throw new Error(`onboarding check failed: ${JSON.stringify(onboarding)}`);
  }

  // 3. 从可见控件输入内容，连接按钮应解除禁用；不提交，不产生远程调用。
  const interactionResult = await evaluate(
    page.webSocketDebuggerUrl,
    `(() => {
      const setValue = (selector, value) => {
        const input = document.querySelector(selector);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      setValue("#connection-credential", "not-a-real-token");
      return new Promise((resolve) => requestAnimationFrame(() => {
        const connect = document.querySelector('#connection-credential')?.closest('form')?.querySelector('button[type="submit"]');
        resolve({ enabled: connect instanceof HTMLButtonElement && !connect.disabled });
      }));
    })()`,
  );
  const interaction = interactionResult?.result?.value;
  if (!interaction?.enabled) {
    throw new Error(`connection form interaction failed: ${JSON.stringify(interaction)}`);
  }

  // 4. 第二次启动应被单实例锁吸收，已有 Renderer 保持可用。
  secondChild = spawn(executable, [`--user-data-dir=${userDataDir}`], { stdio: "ignore" });
  const secondExit = await waitForExit(secondChild, 5000);
  if (secondExit.code !== 0) {
    throw new Error(
      `second instance did not exit cleanly: code=${secondExit.code} signal=${secondExit.signal}`,
    );
  }
  secondChild = undefined;
  const afterSecondLaunch = await evaluate(
    page.webSocketDebuggerUrl,
    "Boolean(window.desktopHost)",
  );
  if (afterSecondLaunch?.result?.value !== true) {
    throw new Error("original renderer was unavailable after the second launch");
  }

  console.log(
    "Packaged smoke passed: bridge/UI usable and second launch is absorbed by the existing instance.",
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
  .catch((error) => fail("assertion failed", error));

child.on("error", (error) => fail("failed to launch packaged app", error));
child.on("exit", (code, signal) => {
  if (code !== 0 && code !== null) {
    fail(`packaged app exited early with code ${code} signal ${signal}`);
  }
});
