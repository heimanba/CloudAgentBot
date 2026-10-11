import type { ChatEventView } from "../../../src/shared/models";

const LOG_CAP = 60;
const LOG_ENTRY_LIMIT = 160;

export interface SseObserver {
  /** 按 event.type 计数。 */
  counts: Record<string, number>;
  /** 截断的原始事件日志（上限 60 条、单条 160 字符），失败时一次性打印取证。 */
  log: string[];
  /** error 事件的 error.code 列表。 */
  errors: string[];
  /** token 帧计数（coordinator 回合可能为 0，仅作观察记录）。 */
  readonly tokenFrames: number;
  /** 是否收到 done 帧。 */
  readonly doneSeen: boolean;
  track(event: ChatEventView): void;
}

/** SSE 订阅回调观察器：计数 + 截断日志 + 错误收集；语义与既有 live 观察块一致。 */
export function createSseObserver(): SseObserver {
  const counts: Record<string, number> = {};
  const log: string[] = [];
  const errors: string[] = [];
  let tokenFrames = 0;
  let doneSeen = false;
  return {
    counts,
    log,
    errors,
    get tokenFrames() {
      return tokenFrames;
    },
    get doneSeen() {
      return doneSeen;
    },
    track(event: ChatEventView): void {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
      if (log.length < LOG_CAP) log.push(JSON.stringify(event).slice(0, LOG_ENTRY_LIMIT));
      if (event.type === "token") tokenFrames += 1;
      else if (event.type === "done") doneSeen = true;
      else if (event.type === "error") errors.push(event.error.code);
    },
  };
}

/**
 * 有界轮询：read 返回非 null 即成功；超时抛带标签的错误（毫秒换算为秒）。
 * 默认 2s 间隔对齐既有 live 轮询；单测用毫秒级间隔。
 */
export async function pollUntil<T>(
  read: () => Promise<T | null>,
  label: string,
  timeoutMs: number,
  pollMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (result !== null) return result;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, pollMs);
    await promise;
  }
  throw new Error(`${label} did not complete within ${Math.round(timeoutMs / 1000)}s`);
}
