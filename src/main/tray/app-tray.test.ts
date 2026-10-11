import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const createImage = (name: string) => ({
    name,
    addRepresentation: vi.fn(),
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
    toPNG: vi.fn(() => Buffer.from(name)),
  });

  const template = createImage("template-1x");
  const templateRetina = createImage("template-2x");
  const linux = createImage("linux");
  const tray = {
    on: vi.fn(),
    setContextMenu: vi.fn(),
    setToolTip: vi.fn(),
  };

  const Tray = vi.fn(function TrayMock() {
    return tray;
  });
  const createFromPath = vi.fn((path: string) => {
    if (path.includes("trayTemplate@2x")) return templateRetina;
    if (path.includes("trayTemplate")) return template;
    return linux;
  });

  return {
    buildFromTemplate: vi.fn((menuTemplate) => ({ template: menuTemplate })),
    createFromPath,
    linux,
    template,
    templateRetina,
    tray,
    Tray,
  };
});

vi.mock("electron", () => ({
  Menu: { buildFromTemplate: electron.buildFromTemplate },
  nativeImage: { createFromPath: electron.createFromPath },
  Tray: electron.Tray,
}));

import { createAppTray } from "./app-tray";

const actions = { open: vi.fn(), quit: vi.fn() };

function expectTrayShell(): void {
  expect(electron.tray.setToolTip).toHaveBeenCalledWith("CloudAgentBot");
  expect(electron.buildFromTemplate).toHaveBeenCalledWith([
    { label: "打开 CloudAgentBot", click: actions.open },
    { type: "separator" },
    { label: "退出", click: actions.quit },
  ]);
  expect(electron.tray.on).toHaveBeenCalledWith("click", actions.open);
}

describe("createAppTray", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electron.template.isEmpty.mockReturnValue(false);
    electron.templateRetina.isEmpty.mockReturnValue(false);
    electron.linux.isEmpty.mockReturnValue(false);
  });

  it("builds a macOS Template image from native 1x and 2x assets", () => {
    createAppTray(actions, "darwin");

    expect(electron.createFromPath).toHaveBeenCalledTimes(2);
    expect(electron.createFromPath.mock.calls[0]?.[0]).toContain("trayTemplate");
    expect(electron.createFromPath.mock.calls[1]?.[0]).toContain("trayTemplate@2x");
    expect(electron.templateRetina.toPNG).toHaveBeenCalledOnce();
    expect(electron.template.addRepresentation).toHaveBeenCalledWith({
      scaleFactor: 2,
      width: 16,
      height: 16,
      buffer: Buffer.from("template-2x"),
    });
    expect(electron.template.setTemplateImage).toHaveBeenCalledWith(true);
    expect(electron.Tray).toHaveBeenCalledWith(electron.template);
    expectTrayShell();
  });

  it("uses the native Linux status icon without resizing or Template mode", () => {
    createAppTray(actions, "linux");

    expect(electron.createFromPath).toHaveBeenCalledTimes(1);
    expect(electron.createFromPath.mock.calls[0]?.[0]).toContain("tray.png");
    expect(electron.linux.addRepresentation).not.toHaveBeenCalled();
    expect(electron.linux.setTemplateImage).not.toHaveBeenCalled();
    expect(electron.Tray).toHaveBeenCalledWith(electron.linux);
    expectTrayShell();
  });

  it.each([
    ["macOS 1x", "darwin", electron.template],
    ["macOS 2x", "darwin", electron.templateRetina],
    ["Linux", "linux", electron.linux],
  ] as const)("fails fast when the %s asset is unavailable", (_name, platform, image) => {
    image.isEmpty.mockReturnValue(true);

    expect(() => createAppTray(actions, platform)).toThrow("failed to load tray icon");
    expect(electron.Tray).not.toHaveBeenCalled();
  });
});
