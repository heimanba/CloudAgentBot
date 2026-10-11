/**
 * 共享错误构造与 IPC 转换。
 * 跨 preload 只携带小型稳定分类与非敏感消息；
 * Provider 响应正文、凭据、文件内容不得进入 message。
 */

import type { HostError, HostErrorCode } from "./models";

export function hostError(code: HostErrorCode, message: string): HostError {
  return { code, message };
}

export function isHostError(value: unknown): value is HostError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as HostError).code === "string" &&
    typeof (value as HostError).message === "string"
  );
}

/**
 * 把 Main 内部异常转换为可跨 preload 的 HostError。
 * 未知异常一律归为 unavailable，且不回传原始消息（可能含敏感上下文）。
 */
export function toHostError(error: unknown): HostError {
  if (isHostError(error)) return error;
  return hostError("unavailable", "internal error");
}

/**
 * IPC 结果信封。
 * ipcMain.handle 抛出的普通对象会被 Electron 序列化为
 * "Error invoking remote method: [object Object]"，错误码全部丢失；
 * 因此错误走返回值通道（信封可以结构化克隆），由 Preload 还原抛出。
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: HostError };

export function ipcOk<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

export function ipcErr(error: HostError): IpcResult<never> {
  return { ok: false, error };
}
