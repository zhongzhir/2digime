/**
 * 成长工作异步调度 — 有限重试，失败不抛向主任务。
 * 不引入第二状态机或独立 Store。
 */

export interface GrowthAsyncResult {
  ok: boolean;
  attempts: number;
  error?: string;
}

/**
 * 在后台执行成长写入；最多重试 limited 次；永不阻塞调用方。
 */
export function scheduleGrowthWork<T>(
  work: () => Promise<T>,
  options: { maxAttempts?: number; onDone?: (result: GrowthAsyncResult & { value?: T }) => void } = {},
): void {
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 2, 3));
  void (async () => {
    let attempts = 0;
    let lastError: string | undefined;
    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        const value = await work();
        options.onDone?.({ ok: true, attempts, value });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    options.onDone?.({ ok: false, attempts, error: lastError || 'growth work failed' });
  })();
}

/** 同步包装：用于测试中等待异步成长完成。 */
export async function runGrowthWorkWithRetry<T>(
  work: () => Promise<T>,
  maxAttempts = 2,
): Promise<GrowthAsyncResult & { value?: T }> {
  let attempts = 0;
  let lastError: string | undefined;
  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const value = await work();
      return { ok: true, attempts, value };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, attempts, error: lastError || 'growth work failed' };
}
