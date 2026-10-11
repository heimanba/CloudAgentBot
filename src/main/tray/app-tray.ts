import { Menu, nativeImage, Tray } from "electron";
import trayIconPath from "./assets/tray.png?asset";
import trayTemplateIconPath from "./assets/trayTemplate.png?asset";
import trayTemplateRetinaIconPath from "./assets/trayTemplate@2x.png?asset";

export interface TrayActions {
  open(): void;
  quit(): void;
}

function loadTrayImage(path: string) {
  const image = nativeImage.createFromPath(path);
  if (image.isEmpty()) {
    throw new Error(`failed to load tray icon: ${path}`);
  }
  return image;
}

function createTrayIcon(platform: NodeJS.Platform) {
  if (platform !== "darwin") return loadTrayImage(trayIconPath);

  const icon = loadTrayImage(trayTemplateIconPath);
  const retinaIcon = loadTrayImage(trayTemplateRetinaIconPath);
  icon.addRepresentation({
    scaleFactor: 2,
    width: 16,
    height: 16,
    buffer: retinaIcon.toPNG(),
  });
  icon.setTemplateImage(true);
  return icon;
}

/** 创建只承载桌面外壳动作的系统托盘，不依赖任何业务 Module。 */
export function createAppTray(
  actions: TrayActions,
  platform: NodeJS.Platform = process.platform,
): Tray {
  const tray = new Tray(createTrayIcon(platform));
  tray.setToolTip("CloudAgentBot");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 CloudAgentBot", click: actions.open },
      { type: "separator" },
      { label: "退出", click: actions.quit },
    ]),
  );
  tray.on("click", actions.open);
  return tray;
}
