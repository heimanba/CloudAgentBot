import { join } from "node:path";
import { BrowserWindow, session, shell } from "electron";
import appIconPath from "../../shared/assets/app.png?asset";

/**
 * Stage 01：创建最小 BrowserWindow。
 * contextIsolation 与 sandbox 显式开启，preload 指向构建产物（CJS）。
 */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    icon: appIconPath,
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // 外部链接交给系统浏览器；本窗口不打开新窗口。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // 禁止导航离开已加载的页面（dev URL 或本地 index.html）。
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

/** 默认拒绝所有权限请求（通知、媒体、剪贴板等）。 */
export function installPermissionGuard(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}
