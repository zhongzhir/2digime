import type {
  CapabilityAdapter,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
} from '../adapter';
import type { CapabilityRegistration } from '../registration';

export interface FakeDocumentAdapterOptions {
  /** 确定性正文;默认回显 goal。 */
  text?: string | ((input: CapabilityInput) => string);
  title?: string;
  /** 模拟耗时。 */
  delayMs?: number;
  /** 强制失败(capability 阶段)。 */
  failWith?: { message: string; actionable: string };
  /** failWith 仅生效的前 N 次调用;默认每次都失败。 */
  failTimes?: number;
  /** 忽略 AbortSignal(用于测 Runner 最终落 cancelled)。 */
  ignoreAbort?: boolean;
}

const FAKE_REGISTRATION: CapabilityRegistration = {
  id: 'cap_fake_document',
  kind: 'tool',
  displayName: '测试文档能力',
  description: '确定性 Fake Adapter,仅用于测试与本地验证',
  inputContract: {
    acceptsGoal: true,
    acceptsSnapshot: true,
    acceptsSubjectContext: true,
  },
  outputArtifactTypes: ['document'],
  permissions: [],
  cost: { estimate: 'free' },
  latencyEstimate: 'instant',
  location: 'local',
  availability: 'available',
  adapter: {
    type: 'local-tool',
    adapterId: 'fake-document',
  },
};

/**
 * Fake/Test Adapter — 确定性产出,无 provider 字段,供 P1.2 专项测试。
 */
export function createFakeDocumentAdapter(
  options: FakeDocumentAdapterOptions = {},
): CapabilityAdapter {
  let executeCount = 0;
  return {
    registration: { ...FAKE_REGISTRATION },
    async execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> {
      executeCount += 1;
      ctx.reportProgress('正在生成文档');
      if (options.delayMs && options.delayMs > 0) {
        await sleep(options.delayMs, ctx.signal, options.ignoreAbort === true);
      } else if (!options.ignoreAbort && ctx.signal.aborted) {
        throw abortError();
      }
      const failLimit = options.failTimes ?? Number.POSITIVE_INFINITY;
      if (options.failWith && executeCount <= failLimit) {
        const err = new Error(options.failWith.message) as Error & { actionable?: string };
        err.actionable = options.failWith.actionable;
        throw err;
      }
      const text =
        typeof options.text === 'function'
          ? options.text(input)
          : (options.text ?? `# ${input.goal}\n\n(fake document)`);
      return {
        artifact: {
          type: 'document',
          title: options.title ?? (input.goal.slice(0, 80) || '文档'),
          payload: { kind: 'text', format: 'markdown', text },
        },
      };
    },
  };
}

function sleep(ms: number, signal: AbortSignal, ignoreAbort: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ignoreAbort && signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (!ignoreAbort) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}
