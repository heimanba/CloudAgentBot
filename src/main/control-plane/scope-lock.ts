/**
 * ScopeLock：同一 scope 的进程内单写锁。
 * Managed Bot 的控制面写操作（创建、update、Sync）必须串行；
 * 不同 scope 之间允许并行。锁只在本 Main 进程内有效。
 *
 * 实现：每个 scope 维护一个 Promise 链尾。新操作排在上一个之后，
 * 并把自己的完成作为新链尾。因失败不影响后续排队者（链尾用 settled 语义）。
 */
export class ScopeLock {
  /** scope -> 当前链尾 Promise（始终为 settled 语义，不因失败拒绝链）。 */
  readonly #tails = new Map<string, Promise<void>>();

  /** 在 `scope` 的互斥下运行 `fn`；同一时刻同一 scope 只有一个 `fn` 在执行。 */
  async runExclusive<T>(scope: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(scope) ?? Promise.resolve();
    // 当前操作 = 等前一个结束后运行 fn。链尾吞掉拒绝，保证队列不中断。
    const current = previous.then(fn);
    this.#tails.set(
      scope,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    try {
      return await current;
    } finally {
      // 若链尾仍指向本次操作（无后续排队者），惰性移除以避免 Map 无限增长。
      const tail = this.#tails.get(scope);
      void tail?.then(() => {
        if (this.#tails.get(scope) === tail) {
          this.#tails.delete(scope);
        }
      });
    }
  }
}
