import {
  formatCapabilityTaskAndPlan,
  type CapabilityAdapter,
  type CapabilityInput,
  type CapabilityOutput,
  type ExecutionContext,
} from '../adapter';
import type { CapabilityRegistration } from '../registration';
import { asLocalCapabilityAdapter } from '../local-adapter-lifecycle';

export interface FakeDocumentAdapterOptions {
  /** 确定性正文;默认回显 goal。 */
  text?: string | ((input: CapabilityInput, extras?: { materialSnippets: string[] }) => string);
  title?: string;
  /** 模拟耗时。 */
  delayMs?: number;
  /** 强制失败(capability 阶段)。 */
  failWith?: {
    message: string;
    actionable: string;
    stage?: 'capability' | 'model';
    transient?: boolean;
    kind?: string;
  };
  /** failWith 仅生效的前 N 次调用;默认每次都失败。 */
  failTimes?: number;
  /** 忽略 AbortSignal(用于测 Runner 最终落 cancelled)。 */
  ignoreAbort?: boolean;
  /** 测试钩子：每次执行后回调（不得用于产品面）。 */
  onExecute?: (info: {
    input: CapabilityInput;
    materialSnippets: string[];
    text: string;
  }) => void;
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
  return asLocalCapabilityAdapter({
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
        const err = new Error(options.failWith.message) as Error & {
          actionable?: string;
          stage?: string;
          transient?: boolean;
          kind?: string;
        };
        err.actionable = options.failWith.actionable;
        if (options.failWith.stage) err.stage = options.failWith.stage;
        if (options.failWith.transient != null) err.transient = options.failWith.transient;
        if (options.failWith.kind) err.kind = options.failWith.kind;
        throw err;
      }
      const { snippets: materialSnippets, usedPaths, items } = await collectMaterialSnippets(
        input,
        ctx.readExtractedText,
      );
      const text =
        typeof options.text === 'function'
          ? options.text(input, { materialSnippets })
          : defaultFakeDocumentText(input, options.text, materialSnippets);
      options.onExecute?.({ input, materialSnippets, text });
      const fullReadCount = items.filter((i) => i.completeness === 'full').length;
      const truncatedCount = items.filter((i) => i.completeness === 'truncated').length;
      return {
        artifact: {
          type: 'document',
          title: options.title ?? (input.goal.slice(0, 80) || '文档'),
          payload: { kind: 'text', format: 'markdown', text },
        },
        materialUse: {
          usedPaths,
          includedCount: usedPaths.length,
          fullReadCount,
          truncatedCount,
          items,
        },
      };
    },
  });
}

function defaultFakeDocumentText(
  input: CapabilityInput,
  override?: string,
  materialSnippets: string[] = [],
): string {
  if (override !== undefined) return override;
  const goal = formatCapabilityTaskAndPlan(input).trim() || input.goal.trim();
  const revisionNote = input.revision?.request?.trim() || '';
  const rejection = input.revision?.rejectionReason?.trim() || '';
  // 标题紧扣目标；修订时必须产生可见正文变化，避免“版本号变、正文不变”
  const title = revisionNote
    ? `# ${goal}（已按说明修改）`
    : `# ${goal}`;
  const sections: string[] = [
    title,
    '',
    '(fake document)',
    '',
    '这是用于本地验证的确定性文档正文，围绕任务目标撰写，不以某一篇材料整篇顶替答案。',
  ];
  if (rejection) {
    sections.push('', `不采用理由已吸收：${rejection.slice(0, 240)}`);
  }
  if (revisionNote) {
    sections.push('', `## 修改说明落实\n${revisionNote}`);
  }

  // 仅摘录与目标相关的材料片段；无关长文不整篇粘贴
  const relevant = materialSnippets.filter((s) => materialLikelyRelevant(goal, s));
  const chosen = (relevant.length ? relevant : materialSnippets).slice(0, 4);
  if (chosen.length > 0) {
    sections.push('', '## 依据材料摘录');
    for (const snippet of chosen) {
      sections.push(snippet.slice(0, 1200));
    }
  }

  if (input.subjectContext.entries.length === 0) {
    return padToGoalLength(sections.join('\n'), goal, revisionNote);
  }
  const byKind = (kind: string) =>
    input.subjectContext.entries.filter((e) => (e.kind || 'experience') === kind);
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
  const preferences = byKind('preference');
  if (preferences.length) {
    sections.push('## 工作偏好');
    for (const e of preferences) {
      sections.push(`- [${e.eventId}] ${e.title}: ${e.detail}`);
    }
  }
  if (boundaries.length) {
    sections.push('## 边界');
    for (const e of boundaries) {
      sections.push(`- [${e.eventId}] ${e.title}: ${e.detail}`);
    }
  }
  let text = padToGoalLength(sections.join('\n'), goal, revisionNote);
  if (boundaries.some((b) => /融资/.test(`${b.title}${b.detail}`))) {
    text = text.replace(/未公开融资详情|融资进展秘闻/g, '[已按边界省略]');
  }
  return text;
}

function materialLikelyRelevant(goal: string, snippet: string): boolean {
  const tokens = goal.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) || [];
  const hay = snippet.toLowerCase();
  return tokens.some((t) => hay.includes(t.toLowerCase()));
}

function padToGoalLength(text: string, goal: string, revisionNote: string): string {
  const m = /不少于\s*(\d{2,5})\s*字/.exec(goal) || /约\s*(\d{2,5})\s*字/.exec(goal);
  if (!m) return text;
  const need = Number(m[1]);
  if (!Number.isFinite(need) || need <= 0) return text;
  let out = text;
  const filler = revisionNote
    ? `补充段落：已按修改要求围绕「${goal.slice(0, 40)}」扩展说明。`
    : `补充段落：围绕「${goal.slice(0, 40)}」继续说明产品定位、能力与价值。`;
  while (out.replace(/\s+/g, '').length < Math.floor(need * 0.92)) {
    out += `\n\n${filler}`;
    if (out.length > need * 4) break;
  }
  return out;
}

async function collectMaterialSnippets(
  input: CapabilityInput,
  readExtractedText?: (ref: string) => Promise<string>,
): Promise<{
  snippets: string[];
  usedPaths: string[];
  items: Array<{
    path: string;
    completeness: 'full' | 'truncated' | 'unread';
    sourceChars: number;
    usedChars: number;
  }>;
}> {
  if (!readExtractedText || !input.snapshot?.items?.length) {
    return { snippets: [], usedPaths: [], items: [] };
  }
  const snippets: string[] = [];
  const usedPaths: string[] = [];
  const items: Array<{
    path: string;
    completeness: 'full' | 'truncated' | 'unread';
    sourceChars: number;
    usedChars: number;
  }> = [];
  for (const item of input.snapshot.items) {
    if (item.status !== 'ok' || !item.extractedTextRef) continue;
    try {
      const body = (await readExtractedText(item.extractedTextRef)).trim();
      if (body) {
        snippets.push(body);
        usedPaths.push(item.sourcePath);
        items.push({
          path: item.sourcePath,
          completeness: item.truncated ? 'truncated' : 'full',
          sourceChars: body.length,
          usedChars: body.length,
        });
      }
    } catch {
      /* 单条读取失败不阻断 Fake 生成 */
    }
  }
  return { snippets, usedPaths, items };
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
