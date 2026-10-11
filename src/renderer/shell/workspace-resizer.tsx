import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "../lib/utils";

export interface WorkspaceResizerProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  className?: string;
  onChange(value: number): void;
  onDrag?(clientX: number): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function WorkspaceResizer({
  label,
  value,
  min,
  max,
  step = 48,
  className,
  onChange,
  onDrag,
}: WorkspaceResizerProps) {
  const [dragging, setDragging] = useState(false);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    onChange(clamp(value + direction * step, min, max));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const element = event.currentTarget;
    const startX = event.clientX;
    const startValue = value;
    element.setPointerCapture(event.pointerId);
    setDragging(true);

    const moveTo = (moveEvent: PointerEvent) => {
      onChange(clamp(startValue + moveEvent.clientX - startX, min, max));
      onDrag?.(moveEvent.clientX);
    };
    const stop = () => {
      setDragging(false);
      element.removeEventListener("pointermove", moveTo);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };

    element.addEventListener("pointermove", moveTo);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      className={cn(
        "h-full w-[5px] shrink-0 cursor-col-resize touch-none bg-transparent transition-colors duration-[var(--duration-fast)] outline-none hover:bg-border/70 focus-visible:bg-border/70 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20",
        dragging && "bg-border/70",
        className,
      )}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
    />
  );
}
