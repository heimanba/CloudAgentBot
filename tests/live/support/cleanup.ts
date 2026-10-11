export interface CleanupCollector {
  /** 执行一项清理；失败被收集而不是立即中断后续清理。 */
  attempt(cleanup: () => Promise<unknown>): Promise<void>;
  /** 全部清理结束后统一抛出 AggregateError；无失败时不动作。 */
  flush(): void;
}

/** afterAll 清理聚合器：保证每项都执行，最后一次性暴露失败。 */
export function createCleanupCollector(message = "live resource cleanup failed"): CleanupCollector {
  const errors: unknown[] = [];
  return {
    async attempt(cleanup: () => Promise<unknown>): Promise<void> {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    },
    flush(): void {
      if (errors.length > 0) throw new AggregateError(errors, message);
    },
  };
}
