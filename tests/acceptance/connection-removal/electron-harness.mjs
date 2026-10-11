import { app, safeStorage, session } from "electron";
import fs from "node:fs";
import path from "node:path";
// 屏蔽 Main 的原生 fetch 与 Renderer 网络，测试不接触 Provider。
globalThis.fetch = async () => {
  throw new Error("验收宿主禁止网络请求");
};
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["https://*/*", "http://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
  const dir = path.join(app.getPath("userData"), "v2");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "credentials.enc"),
    JSON.stringify({
      version: 1,
      secrets: {
        e2e_credential: safeStorage.encryptString("e2e-invalid-no-network").toString("base64"),
      },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "connections.json"),
    JSON.stringify({
      version: 1,
      connections: [
        {
          id: "conn_e2e_keep",
          provider: "qoder",
          displayName: "E2E 保留连接",
          credentialKey: "e2e_credential",
          defaultEnvironmentId: "e2e_env",
        },
        {
          id: "conn_e2e_delete",
          provider: "qoder",
          displayName: "E2E 删除连接",
          credentialKey: "e2e_missing",
        },
      ],
    }),
  );
  await import(new URL("../../../dist/main/index.js", import.meta.url).href);
});
