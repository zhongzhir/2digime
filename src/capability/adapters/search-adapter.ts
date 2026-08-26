/**
 * SearchAdapter — 把 SearchConnector（Bing baseline / Gemini professional）包装为 CapabilityAdapter。
 * 品牌/API/探测逻辑只存在于 adapter 层；上层只按 availability 判断。
 * 不新增 connector：复用 bing-html-search / gemini-search 既有 connector。
 */
import type {
  CapabilityAdapter,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
} from '../adapter';
import type { CapabilityRegistration } from '../registration';
import { asLocalCapabilityAdapter } from '../local-adapter-lifecycle';
import type { SearchConnector } from '../search-connector';
import { hasUsableWebEvidence } from '../search-contract';

function unusableSearchError(): Error {
  return Object.assign(new Error('search returned no usable evidence'), {
    kind: 'empty' as const,
    transient: true,
    stage: 'capability' as const,
  });
}

function searchRegistration(input: {
  id: string;
  adapterId: string;
  displayName: string;
  description: string;
}): CapabilityRegistration {
  return {
    id: input.id,
    kind: 'tool',
    displayName: input.displayName,
    description: input.description,
    inputContract: {
      acceptsGoal: true,
      acceptsSnapshot: true,
      acceptsSubjectContext: true,
    },
    outputArtifactTypes: ['document'],
    permissions: ['network'],
    cost: { estimate: 'free' },
    latencyEstimate: 'seconds',
    location: 'remote',
    availability: 'available',
    adapter: {
      type: 'local-tool',
      adapterId: input.adapterId,
    },
  };
}

function formatSearchDocument(
  query: string,
  sources: Array<{ title?: string; url?: string; snippet?: string }>,
): string {
  const lines: string[] = [`# 搜索要点：${query.slice(0, 80)}`, ''];
  if (sources.length === 0) {
    lines.push('（本次未检索到可核对的外部来源。）');
    return lines.join('\n');
  }
  for (const s of sources) {
    lines.push(`- ${s.title || s.url || '未命名来源'}`);
    if (s.url) lines.push(`  来源：${s.url}`);
    if (s.snippet) lines.push(`  摘要：${s.snippet.slice(0, 200)}`);
  }
  lines.push('');
  lines.push('> 提示：以上为检索来源清单，供进一步阅读；综合结论以 2digime 后续分析为准。');
  return lines.join('\n');
}

export function createSearchCapabilityAdapter(input: {
  connector: SearchConnector;
  registration: CapabilityRegistration;
}): CapabilityAdapter {
  const { connector, registration } = input;
  return asLocalCapabilityAdapter({
    registration,
    async execute(capInput: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> {
      if (ctx.signal.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      ctx.reportProgress('正在检索外部来源');
      const query = (capInput.goal || '').trim() || '最新信息';
      const sources = await connector.search(query, { signal: ctx.signal });
      if (ctx.signal.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      if (!hasUsableWebEvidence(sources)) throw unusableSearchError();
      const text = formatSearchDocument(query, sources);
      return {
        artifact: {
          type: 'document',
          title: `搜索要点：${query.slice(0, 60)}`,
          payload: { kind: 'text', format: 'markdown', text },
        },
        materialUse: {
          usedPaths: [],
          includedCount: 0,
          fullReadCount: 0,
          truncatedCount: 0,
        },
      };
    },
  });
}