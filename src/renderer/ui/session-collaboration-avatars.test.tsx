// @vitest-environment happy-dom

import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BotView } from "@shared/models";
import { mount } from "../test-support/mount";
import { SessionCollaborationAvatars } from "./session-collaboration-avatars";

const botRef = { connectionId: "conn-a", agentId: "chief" };
const bots: BotView[] = [
  { ref: botRef, name: "协调者", management: "remote-only" },
  { ref: { connectionId: "conn-a", agentId: "worker-a" }, name: "林", management: "remote-only" },
  {
    ref: { connectionId: "conn-b", agentId: "worker-b" },
    name: "别的连接",
    management: "remote-only",
  },
];

describe("SessionCollaborationAvatars", () => {
  it("uses the Session roster and only resolves names within its Connection", () => {
    const markup = renderToStaticMarkup(
      <SessionCollaborationAvatars
        botName="协调者"
        botRef={botRef}
        bots={bots}
        roster={{ memberAgentIds: ["worker-a", "worker-b", "worker-c"] }}
      />,
    );
    expect(markup).toContain(">协</span>");
    expect(markup).toContain(">林</span>");
    expect(markup).not.toContain("别的连接");
    expect(markup).not.toContain(">?</span>");
    expect(markup).toContain("+2");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("shows the same provider and overflow count in navigation and detail", () => {
    const markup = renderToStaticMarkup(
      <SessionCollaborationAvatars
        botName="协调者"
        botRef={botRef}
        bots={bots}
        roster={{ memberAgentIds: ["worker-a", "worker-b", "worker-c"] }}
        provider="bailian"
      />,
    );
    expect(markup).toContain(">林</span>");
    expect(markup).not.toContain(">?</span>");
    expect(markup).toContain("+2");
    expect(markup).toContain('data-provider-badge="bailian"');
    const unknown = renderToStaticMarkup(
      <SessionCollaborationAvatars
        botName="协调者"
        botRef={botRef}
        bots={bots}
        roster={{ memberAgentIds: ["worker-b"] }}
      />,
    );
    expect(unknown).toContain(">?</span>");
    expect(unknown).not.toContain("别的连接");
  });

  it("opens resolved Bots and the overflow roster from the detail header", () => {
    const onOpenBot = vi.fn();
    const onShowMore = vi.fn();
    const view = mount(
      <SessionCollaborationAvatars
        botName="协调者"
        botRef={botRef}
        bots={bots}
        roster={{ memberAgentIds: ["worker-a", "worker-b", "worker-c"] }}
        onOpenBot={onOpenBot}
        onShowMore={onShowMore}
      />,
    );
    const { container } = view;

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="查看协调者 协调者 的 Bot 详情"]')
        ?.click(),
    );
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="查看成员 林 的 Bot 详情"]')?.click(),
    );
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="查看其余 2 位协作成员"]')?.click(),
    );
    expect(onOpenBot).toHaveBeenNthCalledWith(1, bots[0]);
    expect(onOpenBot).toHaveBeenNthCalledWith(2, bots[1]);
    expect(onShowMore).toHaveBeenCalledOnce();
    expect(container.querySelectorAll("button")).toHaveLength(3);

    view.unmount();
  });
});
