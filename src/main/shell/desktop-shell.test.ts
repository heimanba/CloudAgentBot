import { EventEmitter } from "node:events";
import type { App, BrowserWindow, Tray } from "electron";
import { describe, expect, it, vi } from "vitest";
import { installDesktopShell } from "./desktop-shell";

class FakeApp extends EventEmitter {
  readonly quit = vi.fn();
}

class FakeWindow extends EventEmitter {
  destroyed = false;
  minimized = false;
  maximized = false;
  visible = true;
  readonly hide = vi.fn(() => {
    this.visible = false;
  });
  readonly show = vi.fn(() => {
    this.visible = true;
  });
  readonly focus = vi.fn();
  readonly restore = vi.fn(() => {
    this.minimized = false;
  });

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  isMaximized(): boolean {
    return this.maximized;
  }

  maximize = vi.fn(() => {
    this.maximized = true;
  });

  unmaximize = vi.fn(() => {
    this.maximized = false;
  });

  isVisible(): boolean {
    return this.visible;
  }
}

class FakeTray {
  destroyed = false;
  readonly destroy = vi.fn(() => {
    this.destroyed = true;
  });

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

function createFixture() {
  const app = new FakeApp();
  const windows: FakeWindow[] = [];
  const tray = new FakeTray();
  let trayActions: { open(): void; quit(): void } | undefined;
  const createWindow = vi.fn(() => {
    const win = new FakeWindow();
    windows.push(win);
    return win as unknown as BrowserWindow;
  });
  const createTray = vi.fn((actions: { open(): void; quit(): void }) => {
    trayActions = actions;
    return tray as unknown as Tray;
  });
  const shell = installDesktopShell({ app: app as unknown as App, createWindow, createTray });

  return {
    app,
    windows,
    tray,
    get trayActions() {
      return trayActions;
    },
    createWindow,
    createTray,
    shell,
  };
}

describe("DesktopShell", () => {
  it("starts once with one main window and one tray", () => {
    const fixture = createFixture();

    fixture.shell.start();
    fixture.shell.start();

    expect(fixture.createWindow).toHaveBeenCalledTimes(1);
    expect(fixture.createTray).toHaveBeenCalledTimes(1);
  });

  it("toggles the main window between maximized and restored", () => {
    const fixture = createFixture();
    fixture.shell.start();
    const win = fixture.windows[0];
    if (win === undefined) throw new Error("missing fake window");

    fixture.shell.toggleMainWindowMaximize();
    expect(win.maximize).toHaveBeenCalledOnce();
    expect(win.maximized).toBe(true);

    fixture.shell.toggleMainWindowMaximize();
    expect(win.unmaximize).toHaveBeenCalledOnce();
    expect(win.maximized).toBe(false);
  });

  it("turns an ordinary window close into hide", () => {
    const fixture = createFixture();
    fixture.shell.start();
    const event = { preventDefault: vi.fn() };

    fixture.windows[0]?.emit("close", event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.windows[0]?.hide).toHaveBeenCalledOnce();
    expect(fixture.app.quit).not.toHaveBeenCalled();
  });

  it("restores, shows and focuses the existing window from every activation path", () => {
    const fixture = createFixture();
    fixture.shell.start();
    const win = fixture.windows[0];
    if (win === undefined) throw new Error("missing fake window");
    win.minimized = true;
    win.visible = false;

    fixture.trayActions?.open();
    fixture.app.emit("activate");
    fixture.app.emit("second-instance");

    expect(fixture.createWindow).toHaveBeenCalledTimes(1);
    expect(win.restore).toHaveBeenCalledOnce();
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledTimes(3);
  });

  it("recreates a main window after the old one is closed", () => {
    const fixture = createFixture();
    fixture.shell.start();
    fixture.windows[0]?.emit("closed");

    fixture.trayActions?.open();

    expect(fixture.createWindow).toHaveBeenCalledTimes(2);
    expect(fixture.windows[1]?.focus).toHaveBeenCalledOnce();
  });

  it("queues activation that arrives before ready/start", () => {
    const fixture = createFixture();

    fixture.app.emit("second-instance");
    fixture.shell.start();

    expect(fixture.createWindow).toHaveBeenCalledTimes(1);
    expect(fixture.windows[0]?.focus).toHaveBeenCalledOnce();
  });

  it("allows window close once explicit quit begins", () => {
    const fixture = createFixture();
    fixture.shell.start();
    const event = { preventDefault: vi.fn() };

    fixture.trayActions?.quit();
    fixture.windows[0]?.emit("close", event);

    expect(fixture.app.quit).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(fixture.windows[0]?.hide).not.toHaveBeenCalled();
  });

  it("also allows close when another native quit path emits before-quit", () => {
    const fixture = createFixture();
    fixture.shell.start();
    const event = { preventDefault: vi.fn() };

    fixture.app.emit("before-quit");
    fixture.windows[0]?.emit("close", event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("destroys the tray on will-quit", () => {
    const fixture = createFixture();
    fixture.shell.start();

    fixture.app.emit("will-quit");

    expect(fixture.tray.destroy).toHaveBeenCalledOnce();
  });
});
