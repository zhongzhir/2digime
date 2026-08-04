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
          : defaultFakeDocumentText(input, options.text);
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

function defaultFakeDocumentText(input: CapabilityInput, override?: string): string {
  if (override !== undefined) return override;
  // 保持可辨识的测试替身标记，同时保证正文长于协作成功门槛（非空壳）。
  const base = `# ${input.goal}\n\n(fake document)\n\n这是用于本地验证的确定性文档正文，覆盖目标要点并保证可读长度。`;
  if (input.subjectContext.entries.length === 0) return base;
  const byKind = (kind: string) =>
    input.subjectContext.entries.filter((e) => (e.kind || 'experience') === kind);
  const sections: string[] = [base];
  const identity = byKind('identity');
  const goals = byKind('goal');
  const principles = byKind('principle');
  const experiences = byKind('experience');
  const boundaries = byKind('boundary');
  if (identity.length || goals.length || principles.length) {
    sections.push('## 主体要点');
    for (const e of [...identity, ...goals, ...principles]) {
      sections.push(`- [${e.kind || 'item'}|${e.eventId}] ${e.title}: ${e.detail}`);
    }
  }
  if (experiences.length) {
    sections.push('## 沿用经验');
    for (const e of experiences) {
      sections.push(`- [${e.eventId}] ${e.title}: ${e.detail}`);
    }
  }
  if (boundaries.length) {
    sections.push('## 边界');
    for (const e of boundaries) {
      sections.push(`- [${e.eventId}] ${e.title}: ${e.detail}`);
    }
  }
  // 明显禁止项不得出现在正文中(验收:边界未泄漏为禁止内容)
  let text = sections.join('\n');
  if (boundaries.some((b) => /融资/.test(`${b.title}${b.detail}`))) {
    text = text.replace(/未公开融资详情|融资进展秘闻/g, '[已按边界省略]');
  }
  return text;
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
