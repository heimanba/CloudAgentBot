import type { App, BrowserWindow, Tray } from "electron";

export interface DesktopShell {
  start(): void;
  toggleMainWindowMaximize(): void;
}

export interface DesktopShellOptions {
  app: Pick<App, "on" | "quit">;
  createWindow(): BrowserWindow;
  createTray(actions: { open(): void; quit(): void }): Tray;
}

/**
 * 安装桌面外壳生命周期。
 *
 * Module 在构造时先监听 app 事件，避免 ready 前的第二实例激活丢失；
 * start() 只能在 app ready 后调用，届时才创建 BrowserWindow 与 Tray。
 */
export function installDesktopShell(options: DesktopShellOptions): DesktopShell {
  let mainWindow: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let started = false;
  let isQuitting = false;
  let pendingShow = false;

  const attachWindow = (win: BrowserWindow): BrowserWindow => {
    mainWindow = win;

    win.on("close", (event) => {
      if (isQuitting) return;
      event.preventDefault();
      win.hide();
    });
    win.once("closed", () => {
      if (mainWindow === win) mainWindow = null;
    });

    return win;
  };

  const getOrCreateWindow = (): BrowserWindow => {
    if (mainWindow === null || mainWindow.isDestroyed()) {
      return attachWindow(options.createWindow());
    }
    return mainWindow;
  };

  const showMainWindow = (): void => {
    if (!started) {
      pendingShow = true;
      return;
    }

    const win = getOrCreateWindow();
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  };

  const toggleMainWindowMaximize = (): void => {
    const win = getOrCreateWindow();
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  };

  const requestQuit = (): void => {
    if (isQuitting) return;
    isQuitting = true;
    options.app.quit();
  };

  const onActivate = (): void => showMainWindow();
  const onSecondInstance = (): void => showMainWindow();
  const onBeforeQuit = (): void => {
    isQuitting = true;
  };
  // 注册该监听器即表示最后一个窗口关闭后由应用自行决定是否退出。
  const onWindowAllClosed = (): void => {};
  const onWillQuit = (): void => {
    if (tray !== null && !tray.isDestroyed()) tray.destroy();
    tray = null;
  };

  options.app.on("activate", onActivate);
  options.app.on("second-instance", onSecondInstance);
  options.app.on("before-quit", onBeforeQuit);
  options.app.on("window-all-closed", onWindowAllClosed);
  options.app.on("will-quit", onWillQuit);

  return {
    start() {
      if (started) return;

      started = true;
      getOrCreateWindow();
      tray = options.createTray({ open: showMainWindow, quit: requestQuit });

      if (pendingShow) {
        pendingShow = false;
        showMainWindow();
      }
    },
    toggleMainWindowMaximize,
  };
}
