// @vitest-environment happy-dom

import { describe, expect, it, vi, afterEach } from "vitest";
import { act } from "react";
import { mount } from "../../test-support/mount";
import { ArtifactWorkspace } from "./artifact-workspace";
import type { ChatArtifactView, ChatRef } from "@shared/models";

const chatRef: ChatRef = { connectionId: "conn", agentId: "agent", sessionId: "session" };

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as Record<string, unknown>).desktopHost;
  document.body.innerHTML = "";
});

describe("ArtifactWorkspace", () => {
  it("previews HTML in a sandboxed iframe and reports disabled external scripts", async () => {
    const artifact: ChatArtifactView = {
      ref: chatRef,
      fileId: "file-1",
      filename: "report.html",
      contentType: "text/html",
      downloadUrl: "https://files.example/report.html",
      content:
        '<html><body><script type="application/json" src="https://cdn.example/app.js"></script></body></html>',
    };
    (window as unknown as Record<string, unknown>).desktopHost = {
      chats: {
        getArtifact: vi.fn(() => Promise.resolve(artifact)),
      },
    };
    vi.useFakeTimers();
    const view = mount(
      <ArtifactWorkspace
        artifact={{
          id: "event-1",
          rawType: "agent.artifact_delivered",
          kind: "artifact",
          fileId: "file-1",
          filename: "report.html",
          contentType: "text/html",
        }}
        chatRef={chatRef}
        open
        onClose={() => {}}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(document.body.textContent).toContain("安全预览：已禁用 1 个外部脚本");
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("");
    expect(iframe?.getAttribute("csp")).toContain("default-src 'none'");
    expect(iframe?.getAttribute("srcdoc")).toContain("<script");

    view.unmount();
  });

  it("renders inline with fullscreen and close controls", async () => {
    const artifact: ChatArtifactView = {
      ref: chatRef,
      fileId: "file-1",
      filename: "report.html",
      contentType: "text/html",
      downloadUrl: "https://files.example/report.html",
      content: "<html><body>Hello</body></html>",
    };
    const toggleWindowMaximize = vi.fn(() => Promise.resolve());
    (window as unknown as Record<string, unknown>).desktopHost = {
      app: {
        toggleWindowMaximize: toggleWindowMaximize,
      },
      chats: {
        getArtifact: vi.fn(() => Promise.resolve(artifact)),
      },
    };
    const onToggleFullscreen = vi.fn();
    const onClose = vi.fn();
    vi.useFakeTimers();
    const view = mount(
      <ArtifactWorkspace
        artifact={{
          id: "event-1",
          rawType: "agent.artifact_delivered",
          kind: "artifact",
          fileId: "file-1",
          filename: "report.html",
          contentType: "text/html",
        }}
        chatRef={chatRef}
        open
        onClose={onClose}
        layout="inline"
        fullscreen
        onToggleFullscreen={onToggleFullscreen}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(document.querySelector("aside[aria-label='产物预览']")).not.toBeNull();
    expect(document.querySelector('[data-slot="window-drag-region"]')?.className).toContain(
      "[-webkit-app-region:drag]",
    );
    expect(toggleWindowMaximize).not.toHaveBeenCalled();
    act(() => {
      document.querySelector<HTMLButtonElement>("button[aria-label='退出全屏']")?.click();
    });
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
    act(() => {
      document.querySelector<HTMLButtonElement>("button[aria-label='关闭产物预览']")?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    view.unmount();
  });

  it("previews PNG as an image without an HTML iframe", async () => {
    const pngBytes = Uint8Array.from(
      window.atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+2wUAAAAASUVORK5CYII=",
      ),
      (byte) => byte.charCodeAt(0),
    );
    const pngBuffer = new ArrayBuffer(pngBytes.byteLength);
    new Uint8Array(pngBuffer).set(pngBytes);
    const artifact: ChatArtifactView = {
      ref: chatRef,
      fileId: "file-1",
      filename: "diagram.png",
      contentType: "image/png",
      downloadUrl: "https://files.example/diagram.png",
      previewData: { contentType: "image/png", bytes: pngBuffer },
    };
    (window as unknown as Record<string, unknown>).desktopHost = {
      chats: {
        getArtifact: vi.fn(() => Promise.resolve(artifact)),
      },
    };
    vi.useFakeTimers();
    const view = mount(
      <ArtifactWorkspace
        artifact={{
          id: "event-1",
          rawType: "agent.artifact_delivered",
          kind: "artifact",
          fileId: "file-1",
          filename: "diagram.png",
          contentType: "image/png",
        }}
        chatRef={chatRef}
        open
        onClose={() => {}}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(document.body.textContent).toContain("图片预览");
    expect(document.querySelector("iframe")).toBeNull();
    const image = document.querySelector("img");
    expect(image?.getAttribute("src")).toMatch(/^blob:/);
    expect(image?.getAttribute("alt")).toBe("diagram.png");

    view.unmount();
  });

  it("previews SVG as an image without executing scripts", async () => {
    const artifact: ChatArtifactView = {
      ref: chatRef,
      fileId: "file-1",
      filename: "diagram.svg",
      contentType: "image/svg+xml",
      downloadUrl: "https://files.example/diagram.svg",
      content: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    };
    (window as unknown as Record<string, unknown>).desktopHost = {
      chats: {
        getArtifact: vi.fn(() => Promise.resolve(artifact)),
      },
    };
    vi.useFakeTimers();
    const view = mount(
      <ArtifactWorkspace
        artifact={{
          id: "event-1",
          rawType: "agent.artifact_delivered",
          kind: "artifact",
          fileId: "file-1",
          filename: "diagram.svg",
          contentType: "image/svg+xml",
        }}
        chatRef={chatRef}
        open
        onClose={() => {}}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(document.body.textContent).toContain("SVG 图片预览：脚本已禁用");
    expect(document.querySelector("iframe")).toBeNull();
    const image = document.querySelector("img");
    expect(image?.getAttribute("src")).toMatch(/^blob:/);
    expect(image?.getAttribute("alt")).toBe("diagram.svg");

    view.unmount();
  });

  it("previews Markdown as rendered document content", async () => {
    const artifact: ChatArtifactView = {
      ref: chatRef,
      fileId: "file-1",
      filename: "report.md",
      contentType: "text/markdown",
      downloadUrl: "https://files.example/report.md",
      content: "# Report\n\n**Ready**",
    };
    (window as unknown as Record<string, unknown>).desktopHost = {
      chats: {
        getArtifact: vi.fn(() => Promise.resolve(artifact)),
      },
    };
    vi.useFakeTimers();
    const view = mount(
      <ArtifactWorkspace
        artifact={{
          id: "event-1",
          rawType: "agent.artifact_delivered",
          kind: "artifact",
          fileId: "file-1",
          filename: "report.md",
          contentType: "text/markdown",
        }}
        chatRef={chatRef}
        open
        onClose={() => {}}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(document.body.textContent).toContain("文档预览");
    expect(document.querySelector("h1")?.textContent).toBe("Report");
    expect(document.querySelector("strong")?.textContent).toBe("Ready");
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("img")).toBeNull();

    view.unmount();
  });

  it("asks users to restart when the main process returns legacy image content", async () => {
    const artifact: ChatArtifactView = {
      ref: chatRef,
      fileId: "file-1",
      filename: "diagram.png",
      contentType: "image/png",
      downloadUrl: "https://files.example/diagram.png",
      content: "binary-as-text",
    };
    (window as unknown as Record<string, unknown>).desktopHost = {
      chats: {
        getArtifact: vi.fn(() => Promise.resolve(artifact)),
      },
    };
    vi.useFakeTimers();
    const view = mount(
      <ArtifactWorkspace
        artifact={{
          id: "event-1",
          rawType: "agent.artifact_delivered",
          kind: "artifact",
          fileId: "file-1",
          filename: "diagram.png",
          contentType: "image/png",
        }}
        chatRef={chatRef}
        open
        onClose={() => {}}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(document.body.textContent).toContain("当前应用进程还在使用旧版图片预览能力");
    expect(document.querySelector("img")).toBeNull();

    view.unmount();
  });
});
