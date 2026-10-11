import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "../ui/design-system";

/**
 * Renderer 测试的统一挂载入口。
 * 与生产挂载路径（bootstrap.tsx）保持一致：TooltipProvider delayDuration=500 包裹应用树；
 * 测试文件不再各自 createRoot，需要 tooltip 交互的断言天然可用。
 * 本模块不是测试文件，不会被 vitest 收集。
 */
export interface Mounted {
  container: HTMLElement;
  root: Root;
  unmount: () => void;
}

export function mount(ui: ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<TooltipProvider delayDuration={500}>{ui}</TooltipProvider>);
  });
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
