// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { mount } from "../test-support/mount";
import { WorkspaceResizer } from "./workspace-resizer";

describe("WorkspaceResizer", () => {
  it("renders an accessible separator and supports keyboard resizing", () => {
    const onChange = vi.fn();
    const view = mount(
      <WorkspaceResizer label="调整聊天区宽度" value={320} min={0} max={800} onChange={onChange} />,
    );
    const { container } = view;

    const separator = container.querySelector<HTMLDivElement>('[role="separator"]');
    expect(separator?.getAttribute("aria-label")).toBe("调整聊天区宽度");
    expect(separator?.getAttribute("aria-valuenow")).toBe("320");

    act(() => {
      separator?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(272);

    view.unmount();
  });
});
