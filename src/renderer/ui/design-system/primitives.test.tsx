// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { mount } from "../../test-support/mount";
import {
  Button,
  Textarea,
  Alert,
  Input,
  Select,
  Field,
  FieldLabel,
  FieldDescription,
  RefreshAction,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Dialog,
  DialogContent,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  CopyAction,
  Tabs,
  TabsList,
  TabsTrigger,
} from "./index";

function render(el: React.ReactElement): { container: HTMLElement; unmount: () => void } {
  const view = mount(el);
  return { container: view.container, unmount: view.unmount };
}

describe("Design System Primitives", () => {
  it("Tabs 提供标准 tab 语义与受控选中状态", () => {
    const { container, unmount } = render(
      <Tabs value="chats">
        <TabsList aria-label="工作区模式">
          <TabsTrigger value="chats">Chats</TabsTrigger>
          <TabsTrigger value="bots">Bots</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("false");
    unmount();
  });

  it("CopyAction 复制精确文本并提供就地成功反馈", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "desktopHost", {
      configurable: true,
      value: { app: { copyText: writeText } },
    });
    const { container, unmount } = render(<CopyAction value={"**原始 Markdown**\n"} />);
    const button = container.querySelector("button")!;

    await act(async () => button.click());

    expect(writeText).toHaveBeenCalledWith("**原始 Markdown**\n");
    expect(button.getAttribute("aria-label")).toBe("已复制");
    unmount();
  });

  it("CopyAction 复制失败时给出可访问反馈", async () => {
    Object.defineProperty(window, "desktopHost", {
      configurable: true,
      value: { app: { copyText: vi.fn().mockRejectedValue(new Error("denied")) } },
    });
    const { container, unmount } = render(<CopyAction value="text" />);
    const button = container.querySelector("button")!;

    await act(async () => button.click());

    expect(button.getAttribute("aria-label")).toBe("复制失败");
    unmount();
  });

  it("Button pending: disabled + aria-busy + spinner", () => {
    const { container, unmount } = render(<Button pending>Send</Button>);
    const btn = container.querySelector("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("svg.animate-spin")).not.toBeNull();
    unmount();
  });

  it("Button disabled: no spinner", () => {
    const { container, unmount } = render(<Button disabled>Send</Button>);
    const btn = container.querySelector("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBeNull();
    expect(container.querySelector("svg.animate-spin")).toBeNull();
    unmount();
  });

  it("Button pending: 即使显式传入 disabled=false 仍保持禁用", () => {
    const { container, unmount } = render(
      <Button pending disabled={false}>
        Send
      </Button>,
    );
    const btn = container.querySelector("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    unmount();
  });

  it("RefreshAction 提供可访问名称并只触发一次刷新", () => {
    const onRefresh = vi.fn();
    const { container, unmount } = render(
      <RefreshAction label="刷新 Chat" onRefresh={onRefresh} />,
    );
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("刷新 Chat");
    expect(button.getAttribute("title")).toBeNull();
    act(() => button.click());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("DropdownMenu 打开动作菜单并选择菜单项", () => {
    const onSelect = vi.fn();
    const { container, unmount } = render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>更多</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>刷新</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const trigger = container.querySelector("button")!;
    act(() =>
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
      ),
    );
    const menu = document.querySelector("[role=menu]");
    const item = document.querySelector("[role=menuitem]") as HTMLElement;
    expect(menu).not.toBeNull();
    expect(item.textContent).toBe("刷新");
    act(() => item.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("DropdownMenu 支持键盘选择并在关闭后把焦点归还触发器", async () => {
    const onSelect = vi.fn();
    const { container, unmount } = render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>更多</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem disabled>不可用</DropdownMenuItem>
          <DropdownMenuItem onSelect={onSelect}>刷新</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const trigger = container.querySelector("button")!;

    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await Promise.resolve();
    });

    const items = Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem]"));
    expect(items[0].getAttribute("data-disabled")).not.toBeNull();
    expect(document.activeElement).toBe(items[1]);

    await act(async () => {
      items[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[role=menu]")).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(trigger);
    unmount();
  });

  it("Popover 通过触发器展示富交互内容", () => {
    const { container, unmount } = render(
      <Popover>
        <PopoverTrigger asChild>
          <Button>筛选</Button>
        </PopoverTrigger>
        <PopoverContent>
          <Input aria-label="搜索记录" />
        </PopoverContent>
      </Popover>,
    );
    const trigger = container.querySelector("button")!;
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('input[aria-label="搜索记录"]')).not.toBeNull();
    unmount();
  });

  it("Dialog Portal 内容固定在窗口中央而不是落入 body 普通布局", () => {
    const { container, unmount } = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>新建 Chat</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const dialog = document.querySelector("[role=dialog]") as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.className).toContain("fixed");
    expect(dialog.className).toContain("left-1/2");
    expect(dialog.className).toContain("top-1/2");
    expect(dialog.className).toContain("-translate-x-1/2");
    expect(dialog.className).toContain("-translate-y-1/2");
    unmount();
  });

  it("Tooltip 在键盘焦点下展示 icon action 说明", () => {
    const { container, unmount } = render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label="刷新" size="icon">
              R
            </Button>
          </TooltipTrigger>
          <TooltipContent>刷新远程数据</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    const trigger = container.querySelector("button")!;
    act(() => trigger.focus());
    expect(document.querySelector("[role=tooltip]")?.textContent).toContain("刷新远程数据");
    unmount();
  });

  it("RefreshAction 刷新中禁用并旋转图标", () => {
    const { container, unmount } = render(
      <RefreshAction label="刷新 Chat" refreshing onRefresh={() => {}} />,
    );
    const button = container.querySelector("button")!;
    expect(button.disabled).toBe(true);
    expect(container.querySelector("svg.animate-spin")).not.toBeNull();
    unmount();
  });

  it("Button variant 产生语义区分的样式", () => {
    const { container, unmount } = render(
      <>
        <Button>A</Button>
        <Button size="sm" variant="secondary">
          B
        </Button>
        <Button variant="destructive">A</Button>
        <Button variant="outline">C</Button>
      </>,
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons[0].className).toContain("text-primary-foreground");
    expect(buttons[1].className).toContain("text-secondary-foreground");
    expect(buttons[2].className).toContain("bg-destructive");
    expect(buttons[2].className).toContain("text-destructive-foreground");
    expect(buttons[3].className).toContain("border-button-border");
    unmount();
  });

  it("Alert role 与标题正文", () => {
    const { container, unmount } = render(
      <Alert variant="warning" title="Caution">
        Something happened
      </Alert>,
    );
    const alert = container.querySelector("[role=alert]")!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("Caution");
    expect(alert.textContent).toContain("Something happened");
    unmount();
  });

  it("Input 焦点态走描边变量，不叠加 ring 也不切换背景", () => {
    const { container, unmount } = render(<Input aria-label="名称" />);
    const input = container.querySelector("input")!;

    expect(input.className).toContain("border-0");
    expect(input.className).toContain("shadow-[inset_0_0_0_1px_var(--input)]");

    expect(input.className).toContain("focus-visible:shadow-[inset_0_0_0_1px_var(--input-focus)]");
    expect(input.className).not.toContain("focus-visible:ring-2");
    expect(input.className).not.toContain("focus:bg-card");
    unmount();
  });

  it("Input bare 变体由 Primitive 统一移除内嵌输入框的焦点环", () => {
    const { container, unmount } = render(<Input variant="bare" aria-label="内嵌搜索" />);
    const input = container.querySelector("input")!;

    expect(input.className).toContain("focus-visible:shadow-none");
    expect(input.className).not.toContain("focus-visible:ring-2");
    expect([...input.classList]).toContain("bg-transparent");
    unmount();
  });

  it("Textarea bare 变体由 Primitive 统一管理内嵌编辑器状态", () => {
    const { container, unmount } = render(<Textarea variant="bare" aria-label="消息" />);
    const textarea = container.querySelector("textarea")!;

    expect(textarea.className).toContain("focus-visible:shadow-none");
    expect(textarea.className).not.toContain("focus-visible:ring-2");
    expect([...textarea.classList]).toContain("bg-transparent");
    unmount();
  });

  it("Select 渲染触发器并透传 disabled 与 aria-label", () => {
    const { container, unmount } = render(
      <Select
        disabled
        aria-label="Connection"
        placeholder="Pick"
        options={[{ value: "qoder", label: "Qoder" }]}
      />,
    );
    const trigger = container.querySelector("button[role=combobox]")! as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute("aria-label")).toBe("Connection");
    expect(trigger.disabled).toBe(true);
    unmount();
  });

  it("Select 打开后可选中选项并回调值", async () => {
    let selected: string | null = null;
    const { container, unmount } = render(
      <Select
        aria-label="Connection"
        placeholder="Pick"
        onValueChange={(v) => {
          selected = v;
        }}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
      />,
    );
    const trigger = container.querySelector("button[role=combobox]")! as HTMLButtonElement;
    act(() => trigger.click());
    const option = document.querySelector("[role=option][data-state]") as HTMLElement;
    expect(option).not.toBeNull();
    act(() => option.click());
    expect(selected).toBe("a");
    unmount();
  });

  it("Field 渲染 label 关联与描述", () => {
    const { container, unmount } = render(
      <Field>
        <FieldLabel htmlFor="f1">Name</FieldLabel>
        <Input id="f1" />
        <FieldDescription>Help text</FieldDescription>
      </Field>,
    );
    const label = container.querySelector("label")!;
    expect(label.getAttribute("for")).toBe("f1");
    expect(label.textContent).toBe("Name");
    expect(container.textContent).toContain("Help text");
    unmount();
  });

  it("Sheet 通过 Trigger 打开，Escape 关闭后焦点归还 Trigger", async () => {
    function SheetHarness() {
      const [open, setOpen] = useState(false);
      return (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button type="button">打开导航</button>
          </SheetTrigger>
          <SheetContent side="right" aria-label="导航面板">
            <SheetTitle>导航</SheetTitle>
            <div>内容</div>
          </SheetContent>
        </Sheet>
      );
    }
    const { container, unmount } = render(<SheetHarness />);
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    trigger.focus();
    await act(async () => trigger.click());
    // Portal 渲染到 document.body。
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("内容");
    expect(dialog.className).toContain("bg-card");
    expect(dialog.className).toContain("sheet-right-in");
    expect(document.querySelector('[data-slot="sheet-overlay"]')?.className).toContain(
      "surface-fade-in",
    );
    // Escape 触发关闭。
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    unmount();
  });
});
