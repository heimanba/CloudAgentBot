import { afterEach, describe, expect, it, vi } from "vitest";
import { BailianConsoleLogin } from "./bailian-console-login";

const openedUrls: string[] = [];

afterEach(() => openedUrls.splice(0));

function broker() {
  return new BailianConsoleLogin({
    openExternal: async (url) => {
      openedUrls.push(url);
    },
    timeoutMs: 2_000,
  });
}

function callbackUrl(): URL {
  const login = new URL(openedUrls[0]!);
  const notice = login.searchParams.get("notice")!;
  const separator = notice.indexOf("?");
  return new URL(`http://${notice.slice(0, separator)}/?${notice.slice(separator + 1)}`);
}

describe("BailianConsoleLogin", () => {
  it("opens the domestic console and resolves a valid one-time callback", async () => {
    const login = broker();
    const pending = login.start();
    await vi.waitFor(() => expect(openedUrls).toHaveLength(1));
    const callback = callbackUrl();
    callback.searchParams.set("api_key", "sk-secret");
    callback.searchParams.set("workspace_id", "ws-valid");
    callback.searchParams.set("console_site", "domestic");
    callback.searchParams.set("console_region", "cn-beijing");
    expect(new URL(openedUrls[0]!).searchParams.get("needapikey")).toBe("true");
    expect((await fetch(callback)).status).toBe(200);
    await expect(pending).resolves.toEqual({ apiKey: "sk-secret", workspaceId: "ws-valid" });
  });

  it("rejects an invalid state without completing the attempt", async () => {
    const login = broker();
    const pending = login.start();
    await vi.waitFor(() => expect(openedUrls).toHaveLength(1));
    const callback = callbackUrl();
    callback.searchParams.set("state", "wrong");
    callback.searchParams.set("api_key", "sk-secret");
    callback.searchParams.set("workspace_id", "ws-valid");
    expect((await fetch(callback)).status).toBe(400);
    login.cancel();
    await expect(pending).rejects.toMatchObject({ code: "unavailable" });
  });

  it("accepts a JSON POST callback without putting secrets in the login URL", async () => {
    const login = broker();
    const pending = login.start();
    await vi.waitFor(() => expect(openedUrls).toHaveLength(1));
    const callback = callbackUrl();
    expect(openedUrls[0]).not.toContain("sk-secret");
    const response = await fetch(callback, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-secret", workspaceId: "ws-json" }),
    });
    expect(response.status).toBe(200);
    await expect(pending).resolves.toEqual({ apiKey: "sk-secret", workspaceId: "ws-json" });
  });

  it("allows only the official console origin to preflight a callback", async () => {
    const login = broker();
    const pending = login.start();
    await vi.waitFor(() => expect(openedUrls).toHaveLength(1));
    const callback = callbackUrl();
    const rejected = await fetch(callback, {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" },
    });
    expect(rejected.status).toBe(403);
    const accepted = await fetch(callback, {
      method: "OPTIONS",
      headers: {
        Origin: "https://bailian.console.aliyun.com",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    expect(accepted.status).toBe(204);
    expect(accepted.headers.get("access-control-allow-origin")).toBe(
      "https://bailian.console.aliyun.com",
    );
    expect(accepted.headers.get("access-control-allow-private-network")).toBe("true");
    login.cancel();
    await expect(pending).rejects.toMatchObject({ message: "Bailian login cancelled" });
  });

  it("rejects international routing and never returns the credential", async () => {
    const login = broker();
    const pending = login.start();
    await vi.waitFor(() => expect(openedUrls).toHaveLength(1));
    const callback = callbackUrl();
    callback.searchParams.set("api_key", "sk-secret");
    callback.searchParams.set("workspace_id", "ws-valid");
    callback.searchParams.set("console_site", "international");
    expect((await fetch(callback)).status).toBe(400);
    login.cancel();
    await expect(pending).rejects.toMatchObject({ code: "unavailable" });
  });

  it("allows only one active attempt", async () => {
    const login = broker();
    const pending = login.start();
    await vi.waitFor(() => expect(openedUrls).toHaveLength(1));
    await expect(login.start()).rejects.toMatchObject({ code: "conflict" });
    login.cancel();
    await expect(pending).rejects.toMatchObject({ code: "unavailable" });
  });

  it("closes the attempt when the system browser cannot be opened", async () => {
    const login = new BailianConsoleLogin({
      openExternal: () => Promise.reject(new Error("browser unavailable")),
      timeoutMs: 2_000,
    });
    await expect(login.start()).rejects.toMatchObject({
      code: "unavailable",
      message: "could not open Bailian login page",
    });
    await expect(login.start()).rejects.toMatchObject({ code: "unavailable" });
  });
});
