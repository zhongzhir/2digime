/**
 * SearchConnector — Search/Research Connector 契约。
 * 2digime 上层不感知具体搜索 provider；Connector 实现（Bing/Google/Tavily…）都在适配器层。
 *
 * 上层保持统一：conversation domain 不写任何 provider 判断（OpenAI/Bing/Google/Tavily）。
 * evidence retrieval（read）是可选的：provider 可提供原生 source/citation/evidence，
 * 否则由 degraded connector 通过页面抓取提供 evidence chunk。
 */
import type { SearchSource } from './search-contract';

export interface ReadResult {
  /** 抓取到的正文纯文本（evidence chunk）。 */
  content: string;
  /** 检索时间（ISO，UTC）。 */
  retrievedAt: string;
  /** 最终解析后的真实 URL（如经 provider redirect 后）。 */
  resolvedUrl?: string;
}

export interface SearchConnector {
  readonly id: string;
  /** 执行一次真实外部搜索，返回来源条目（去重后）。失败抛错，由调用方按失败语义处理。 */
  search(query: string, options?: { signal?: AbortSignal }): Promise<SearchSource[]>;
  /** 可选：读取并提取指定 URL 的 evidence chunk（claim-grounded 需要）。失败返回 null。 */
  read?(url: string, options?: { signal?: AbortSignal; maxChars?: number }): Promise<ReadResult | null>;
}

/** timeoutMs 变成真实 deadline：到期 abort，调用方不得再消费迟到结果。 */
export function bindTimeoutSignal(input: {
  timeoutMs: number;
  parent?: AbortSignal | undefined;
}): {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const onParent = () => {
    if (!controller.signal.aborted) controller.abort(input.parent?.reason);
  };
  if (input.parent?.aborted) {
    controller.abort(input.parent.reason);
    return { signal: controller.signal, timedOut: () => false, dispose: () => undefined };
  }
  const timer = setTimeout(() => {
    timedOut = true;
    const err = Object.assign(new Error(`timeout after ${input.timeoutMs}ms`), {
      name: 'TimeoutError',
      kind: 'timeout',
      transient: true,
    });
    controller.abort(err);
  }, Math.max(1, input.timeoutMs));
  if (input.parent) input.parent.addEventListener('abort', onParent, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      if (input.parent) input.parent.removeEventListener('abort', onParent);
      if (!controller.signal.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        controller.abort(err);
      }
    },
  };
}

export function isTimeoutAbortReason(reason: unknown): boolean {
  if (!reason) return false;
  if (typeof reason === 'object' && (reason as { kind?: string }).kind === 'timeout') return true;
  if (reason instanceof Error && (reason.name === 'TimeoutError' || /timeout after /i.test(reason.message))) {
    return true;
  }
  return false;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  const err = new Error(typeof reason === 'string' && reason ? reason : 'aborted');
  err.name = 'AbortError';
  throw err;
}

/**
 * 把 timeout/parent abort 接到真实 fetch，并在 deadline 到达时结束等待。
 * 迟到的 fetch 结果被丢弃，不得再写回状态。
 */
export async function fetchWithDeadline(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
  signal: AbortSignal,
): Promise<Response> {
  throwIfAborted(signal);
  const pending = Promise.resolve(fetchImpl(input, { ...(init || {}), signal }));
  const abortWait = new Promise<never>((_, reject) => {
    const onAbort = () => {
      const reason = signal.reason;
      if (reason instanceof Error) reject(reason);
      else {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      }
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([pending, abortWait]);
  } catch (err) {
    void pending.then(
      () => undefined,
      () => undefined,
    );
    throw err;
  }
}