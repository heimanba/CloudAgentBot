import { act } from "react";
import { mount, type Mounted } from "../../test-support/mount";
import { ChatDetailPage, type ChatDetailPageProps } from "./chat-detail-page";

/**
 * ChatDetailPage 集成测试的共享渲染与交互夹具。
 * 页面以完整 props 契约渲染（与生产调用方一致），测试只覆盖自己关心的字段；
 * 挂载走共享 mount（含 TooltipProvider，与生产 bootstrap 一致）。
 * 本模块不是测试文件，不会被 vitest 收集。
 */

export type RenderedChatDetailPage = Mounted;

export function renderChatDetailPage(
  overrides: Partial<ChatDetailPageProps> = {},
): RenderedChatDetailPage {
  return mount(
    <ChatDetailPage
      detail={null}
      loading={false}
      error={null}
      sending={false}
      streamingText=""
      archiving={false}
      archiveError={null}
      deleting={false}
      deleteError={null}
      sendError={null}
      onSend={() => {}}
      onReload={() => {}}
      onBack={() => {}}
      onArchiveChat={() => {}}
      onDeleteChat={() => {}}
      {...overrides}
    />,
  );
}

/** 以原生 setter 写入受控 textarea 并派发 input，模拟用户键入草稿。调用方自行包 act。 */
export function typeDraft(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * 派发 Enter keydown 并排空提交路径的微任务。
 * submit 是 async（uploadAll/onSend 各 await 一次），负断言前必须排空两个微任务，
 * 否则守卫被删掉时发送发生在断言之后，负控会因无关原因通过。
 */
export async function pressEnter(
  textarea: HTMLTextAreaElement,
  init: Omit<KeyboardEventInit, "key" | "bubbles"> = {},
): Promise<void> {
  await act(async () => {
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...init }));
    await Promise.resolve();
    await Promise.resolve();
  });
}
