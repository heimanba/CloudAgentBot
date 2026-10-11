// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { BotView, CreateBotInput, HostError } from "@shared/models";
import { mount } from "../../test-support/mount";
import { TeamTemplateCreation } from "./team-template-creation";

function renderTemplate(
  onCreate: (input: CreateBotInput) => Promise<{ bot: BotView | null; error: HostError | null }>,
  bots: BotView[] = [],
) {
  const onCreated = vi.fn();
  const view = mount(
    <TeamTemplateCreation
      bots={bots}
      loading={false}
      error={null}
      onCreate={onCreate}
      onReload={vi.fn()}
      onCreated={onCreated}
      onCancel={vi.fn()}
    />,
  );
  return { ...view, onCreated };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("协作模板创建", () => {
  it("默认直接说明将新建哪些成员，不显示待确认的成员下拉框", () => {
    const view = renderTemplate(vi.fn());
    expect(view.container.textContent).toContain("将新建「Lin」");
    expect(view.container.textContent).toContain("将新建「Pixel」");
    expect(view.container.querySelector("#team-member-lin")).toBeNull();
    view.unmount();
  });

  it("有现有 Bot 时主动展开关联选择，未选择前不能提交", () => {
    const existing: BotView = {
      ref: { connectionId: "c", agentId: "agent-existing" },
      name: "已有助手",
      management: "managed",
    };
    const view = renderTemplate(vi.fn(), [existing]);
    act(() => {
      [...view.container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("改用现有 Bot"))!
        .click();
    });
    expect(view.container.querySelector("#team-member-lin")).not.toBeNull();
    expect(
      [...view.container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("创建协作 Bot"),
      )?.disabled,
    ).toBe(true);
    view.unmount();
  });

  it("先创建独立成员，再以其远程 ID 创建协调者", async () => {
    const calls: CreateBotInput[] = [];
    const onCreate = vi.fn(async (input: CreateBotInput) => {
      calls.push(input);
      return {
        bot: {
          ref: { connectionId: "c", agentId: `agent-${calls.length}` },
          name: input.name,
          management: "managed" as const,
        },
        error: null,
      };
    });
    const view = renderTemplate(onCreate);
    await act(async () => {
      [...view.container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("创建协作 Bot"))!
        .click();
    });
    expect(calls.map((input) => input.name)).toEqual(["Lin", "Pixel", "Rigel", "Ada"]);
    expect(calls.slice(0, 3).every((input) => input.memberAgentIds === undefined)).toBe(true);
    expect(calls.every((input) => Array.isArray(input.skills))).toBe(true);
    expect(new Set(calls.map((input) => input.metadata?.openagentbot_template_run)).size).toBe(1);
    expect(calls[3].metadata?.openagentbot_template).toBe("工程团队");
    expect(calls[3].memberAgentIds).toEqual(["agent-1", "agent-2", "agent-3"]);
    expect(view.onCreated).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("创建中断后继续时保留已创建成员和同一次导入标记", async () => {
    const calls: CreateBotInput[] = [];
    let failed = false;
    const onCreate = vi.fn(async (input: CreateBotInput) => {
      calls.push(input);
      if (input.name === "Pixel" && !failed) {
        failed = true;
        return { bot: null, error: { code: "unavailable" as const, message: "暂不可用" } };
      }
      return {
        bot: {
          ref: { connectionId: "c", agentId: `agent-${calls.length}` },
          name: input.name,
          management: "managed" as const,
        },
        error: null,
      };
    });
    const view = renderTemplate(onCreate);
    const clickCreate = async () => {
      await act(async () => {
        [...view.container.querySelectorAll("button")]
          .find(
            (button) =>
              button.textContent?.includes("创建协作 Bot") ||
              button.textContent?.includes("继续创建"),
          )!
          .click();
      });
    };
    await clickCreate();
    expect(calls.map((input) => input.name)).toEqual(["Lin", "Pixel"]);
    expect(view.container.textContent).toContain("已完成：Lin");
    await clickCreate();
    expect(calls.map((input) => input.name)).toEqual(["Lin", "Pixel", "Pixel", "Rigel", "Ada"]);
    expect(new Set(calls.map((input) => input.metadata?.openagentbot_template_run)).size).toBe(1);
    expect(calls[4].memberAgentIds).toEqual(["agent-1", "agent-3", "agent-4"]);
    expect(view.onCreated).toHaveBeenCalledOnce();
    view.unmount();
  });
});
