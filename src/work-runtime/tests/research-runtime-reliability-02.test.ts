/**
 * DIGITALME-RESEARCH-RUNTIME-RELIABILITY-02
 *
 * Trial-03 P1：professional search empty/timeout 未 fallback；卡住的 job 拖死后续任务。
 *
 * CASE A empty → baseline
 * CASE B timeout 真正取消 → baseline
 * CASE C 队列隔离：A 卡住后 B 仍能完成
 * CASE D late result 不得覆盖 / 二次完成
 * CASE E cooldown：随后同类任务直接 baseline
 * CASE F 双失败诚实失败
 *
 * 暂不修 Subject：Trial-03 R4（新偏好在没有 distill capability 时未形成可复用主体经验）只记录，不改。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { CapabilityRegistry } from '../../capability/registry';
import {
  PROFESSIONAL_SEARCH_CAPABILITY_ID,
  BASELINE_SEARCH_CAPABILITY_ID,
} from '../../capability/search-capability-discovery';
import { createSearchCapabilityAdapter } from '../../capability/adapters/search-adapter';
import { createGeminiSearchConnector } from '../../capability/adapters/gemini-search';
import { asLocalCapabilityAdapter } from '../../capability/local-adapter-lifecycle';
import { createFakeDocumentAdapter } from '../../capability/adapters/fake-document';
import type { CapabilityAdapter } from '../../capability/adapter';
import type { CapabilityRegistration } from '../../capability/registration';
import type { SearchConnector } from '../../capability/search-connector';
import {
  hasUsableWebEvidence,
  isUsableWebEvidenceItem,
  type SearchSource,
} from '../../capability/search-contract';
import {
  waitForJobTerminal,
  BASELINE_SEARCH_FALLBACK_NOTICE,
  SEARCH_UNAVAILABLE_USER_MESSAGE,
} from '../job-runner';
import { closureViewFromSelection } from '../../capability/capability-closure';

const FORBIDDEN = [
  /\bempty\b/i,
  /timeoutMs/i,
  /\bHTTP\b/,
  /Gemini/i,
  /\bBing\b/i,
  /adapter/i,
  /retry/i,
  /cooldown/i,
];

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-rrr-${prefix}-`));
}

function searchReg(over: Partial<CapabilityRegistration> & { id: string; adapterId: string }): CapabilityRegistration {
  return {
    kind: 'tool',
    displayName: over.id,
    description: over.id,
    inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
    outputArtifactTypes: ['document'],
    permissions: ['network'],
    cost: { estimate: '' },
    latencyEstimate: 'seconds',
    location: 'remote',
    availability: 'available',
    adapter: { type: 'local-tool', adapterId: over.adapterId },
    ...over,
  } as CapabilityRegistration;
}

function usableSource(title: string): SearchSource {
  return { title, url: `https://example.com/${encodeURIComponent(title)}`, sourceClass: 'external' };
}

function connectorOf(id: string, search: SearchConnector['search']): SearchConnector {
  return { id, search };
}

function searchAdapter(id: string, adapterId: string, connector: SearchConnector): CapabilityAdapter {
  return createSearchCapabilityAdapter({
    connector,
    registration: searchReg({ id, adapterId }),
  });
}

function hangingAdapter(id: string, adapterId: string, delayMs: number, title: string): CapabilityAdapter {
  const reg = searchReg({ id, adapterId });
  return asLocalCapabilityAdapter({
    registration: reg,
    async execute(_input, ctx) {
      ctx.reportProgress('正在检索外部来源');
      await new Promise((r) => setTimeout(r, delayMs)); // 忽略 signal：模拟卡死
      return {
        artifact: {
          type: 'document',
          title,
          payload: { kind: 'text', format: 'markdown', text: `PROFESSIONAL_LATE:${title}` },
        },
        materialUse: { usedPaths: [], includedCount: 0, fullReadCount: 0, truncatedCount: 0 },
      };
    },
  });
}

function assertNoTechLeak(text: string, label: string): void {
  for (const re of FORBIDDEN) {
    assert.ok(!re.test(text), `${label} 不得泄漏技术细节（命中 ${re}）：${text}`);
  }
}

test('usable-result contract: 空数组 / 无 URL 不可用；有外部 http 来源可用', () => {
  assert.equal(hasUsableWebEvidence([]), false);
  assert.equal(hasUsableWebEvidence(undefined), false);
  assert.equal(isUsableWebEvidenceItem({ title: 'x', url: '', sourceClass: 'external' }), false);
  assert.equal(hasUsableWebEvidence([usableSource('A')]), true);
});

test('CASE A: professional empty → baseline → result；closure 为 BASELINE', async () => {
  const root = await tempDir('a');
  const registry = new CapabilityRegistry();
  registry.register(
    searchAdapter(
      PROFESSIONAL_SEARCH_CAPABILITY_ID,
      'gemini-search',
      connectorOf('empty-prof', async () => []),
    ),
  );
  registry.register(
    searchAdapter(
      BASELINE_SEARCH_CAPABILITY_ID,
      'baseline-bing-search',
      connectorOf('base', async () => [usableSource('baseline-source')]),
    ),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
  });
  await runtime.createPackage({ displayName: 'a', targetDir: path.join(root, 'pkg') });
  try {
    const sub = await runtime.submitTask({
      goal: '调研一个现实问题并给出要点',
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'external_research',
    });
    const job = await waitForJobTerminal(runtime.workRuntime, sub.jobId, 15_000);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.capabilityId, BASELINE_SEARCH_CAPABILITY_ID);
    const content = await runtime.getContent({ artifactId: job.artifactId! });
    const text = content.text || '';
    assert.ok(/baseline-source/.test(text));
    assert.ok(text.includes(BASELINE_SEARCH_FALLBACK_NOTICE));
    assertNoTechLeak(text, 'CASE A artifact');
    const view = closureViewFromSelection({
      need: { domain: 'current_web' },
      selectedAdapterType: 'local-tool',
      selectedCapabilityId: job.capabilityId,
    });
    assert.equal(view.level, 'baseline', '不得因 professional 曾被选中就标成 OPTIMAL');
  } finally {
    await runtime.stop();
  }
});

test('CASE B: professional timeout 真正结束 → baseline → result', async () => {
  const root = await tempDir('b');
  const registry = new CapabilityRegistry();
  registry.register(
    createSearchCapabilityAdapter({
      connector: createGeminiSearchConnector({
        apiKey: 'test-key',
        timeoutMs: 70,
        maxRetries: 0,
        fetchImpl: (async () => {
          await new Promise((r) => setTimeout(r, 8_000)); // 忽略 abort：迟到请求
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: { parts: [{ text: 'late' }] },
                  groundingMetadata: {
                    groundingChunks: [{ web: { uri: 'https://late.example', title: 'LATE' } }],
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }) as unknown as typeof fetch,
      }),
      registration: searchReg({
        id: PROFESSIONAL_SEARCH_CAPABILITY_ID,
        adapterId: 'gemini-search',
      }),
    }),
  );
  registry.register(
    searchAdapter(
      BASELINE_SEARCH_CAPABILITY_ID,
      'baseline-bing-search',
      connectorOf('base', async () => [usableSource('timeout-fallback')]),
    ),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
  });
  await runtime.createPackage({ displayName: 'b', targetDir: path.join(root, 'pkg') });
  try {
    const started = Date.now();
    const sub = await runtime.submitTask({
      goal: '调研一个现实问题并给出要点',
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'external_research',
    });
    const job = await waitForJobTerminal(runtime.workRuntime, sub.jobId, 15_000);
    const elapsed = Date.now() - started;
    assert.equal(job.status, 'succeeded');
    assert.equal(job.capabilityId, BASELINE_SEARCH_CAPABILITY_ID);
    assert.ok(elapsed < 3_000, `timeout 后应迅速 fallback，实际 ${elapsed}ms`);
    const content = await runtime.getContent({ artifactId: job.artifactId! });
    assert.ok(/timeout-fallback/.test(content.text || ''));
    assert.ok(!(content.text || '').includes('LATE'));
  } finally {
    await runtime.stop();
  }
});

test('CASE C: JOB A 卡住后 JOB B 能继续完成', async () => {
  const root = await tempDir('c');
  const registry = new CapabilityRegistry();
  registry.register(createFakeDocumentAdapter({ text: 'DOC_B_OK' }));
  registry.register(hangingAdapter(PROFESSIONAL_SEARCH_CAPABILITY_ID, 'gemini-search', 8_000, 'hang-a'));
  registry.register(
    searchAdapter(
      BASELINE_SEARCH_CAPABILITY_ID,
      'baseline-bing-search',
      connectorOf('base', async () => [usableSource('after-hang')]),
    ),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
    searchAttemptDeadlineMs: 220,
  });
  await runtime.createPackage({ displayName: 'c', targetDir: path.join(root, 'pkg') });
  try {
    const started = Date.now();
    const subA = await runtime.submitTask({
      goal: '调研一个现实问题并给出要点',
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'external_research',
    });
    const subB = await runtime.submitTask({
      goal: '写一份简短会议纪要',
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'create_document',
    });
    const [jobA, jobB] = await Promise.all([
      waitForJobTerminal(runtime.workRuntime, subA.jobId, 15_000),
      waitForJobTerminal(runtime.workRuntime, subB.jobId, 15_000),
    ]);
    const elapsed = Date.now() - started;
    assert.equal(jobB.status, 'succeeded', '后续文档任务必须能完成');
    const doc = await runtime.getContent({ artifactId: jobB.artifactId! });
    assert.ok(/DOC_B_OK/.test(doc.text || ''));
    assert.equal(jobA.status, 'succeeded');
    assert.equal(jobA.capabilityId, BASELINE_SEARCH_CAPABILITY_ID);
    assert.ok(elapsed < 4_000, `B 不得等待 A 的 8s 卡死，实际 ${elapsed}ms`);
  } finally {
    await runtime.stop();
  }
});

test('CASE D: timeout/fallback 后迟到 professional 结果不得覆盖 baseline、不得二次完成', async () => {
  const root = await tempDir('d');
  let lateReturned = false;
  const registry = new CapabilityRegistry();
  registry.register(
    hangingAdapter(PROFESSIONAL_SEARCH_CAPABILITY_ID, 'gemini-search', 600, 'late-prof'),
  );
  registry.register(
    searchAdapter(
      BASELINE_SEARCH_CAPABILITY_ID,
      'baseline-bing-search',
      connectorOf('base', async () => [usableSource('baseline-stable')]),
    ),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
    searchAttemptDeadlineMs: 150,
  });
  await runtime.createPackage({ displayName: 'd', targetDir: path.join(root, 'pkg') });
  try {
    const sub = await runtime.submitTask({
      goal: '调研一个现实问题并给出要点',
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'external_research',
    });
    const job = await waitForJobTerminal(runtime.workRuntime, sub.jobId, 15_000);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.capabilityId, BASELINE_SEARCH_CAPABILITY_ID);
    const firstText = (await runtime.getContent({ artifactId: job.artifactId! })).text || '';
    assert.ok(/baseline-stable/.test(firstText));
    assert.ok(!/PROFESSIONAL_LATE/.test(firstText));
    await new Promise((r) => setTimeout(r, 700));
    lateReturned = true;
    const again = await runtime.workRuntime.getJob(sub.jobId);
    assert.equal(again?.status, 'succeeded');
    const secondText = (await runtime.getContent({ artifactId: again!.artifactId! })).text || '';
    assert.equal(secondText, firstText, '迟到结果不得覆盖 baseline');
    assert.ok(!/PROFESSIONAL_LATE/.test(secondText));
    void lateReturned;
  } finally {
    await runtime.stop();
  }
});

test('CASE E: empty 后 cooldown，紧接着同类任务直接 baseline', async () => {
  const root = await tempDir('e');
  let profCalls = 0;
  const registry = new CapabilityRegistry();
  registry.register(
    searchAdapter(
      PROFESSIONAL_SEARCH_CAPABILITY_ID,
      'gemini-search',
      connectorOf('empty-prof', async () => {
        profCalls += 1;
        return [];
      }),
    ),
  );
  registry.register(
    searchAdapter(
      BASELINE_SEARCH_CAPABILITY_ID,
      'baseline-bing-search',
      connectorOf('base', async () => [usableSource('cooldown-baseline')]),
    ),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
  });
  await runtime.createPackage({ displayName: 'e', targetDir: path.join(root, 'pkg') });
  try {
    const first = await runtime.submitTask({
      goal: '调研一个现实问题并给出要点',
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'external_research',
    });
    const job1 = await waitForJobTerminal(runtime.workRuntime, first.jobId, 15_000);
    assert.equal(job1.status, 'succeeded');
    assert.equal(profCalls, 1);
    const started = Date.now();
    const second = await runtime.submitTask({
      goal: '再调研一次同类现实问题',
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'external_research',
    });
    const job2 = await waitForJobTerminal(runtime.workRuntime, second.jobId, 15_000);
    const elapsed = Date.now() - started;
    assert.equal(job2.status, 'succeeded');
    assert.equal(job2.capabilityId, BASELINE_SEARCH_CAPABILITY_ID);
    assert.equal(profCalls, 1, 'cooldown 期间不得再等完整 professional timeout');
    assert.ok(elapsed < 2_000, `第二次应直接 baseline，实际 ${elapsed}ms`);
  } finally {
    await runtime.stop();
  }
});

test('CASE F: professional + baseline 都 unusable → 诚实失败，无假完成', async () => {
  const root = await tempDir('f');
  const registry = new CapabilityRegistry();
  registry.register(
    searchAdapter(
      PROFESSIONAL_SEARCH_CAPABILITY_ID,
      'gemini-search',
      connectorOf('empty-prof', async () => []),
    ),
  );
  registry.register(
    searchAdapter(
      BASELINE_SEARCH_CAPABILITY_ID,
      'baseline-bing-search',
      connectorOf('empty-base', async () => []),
    ),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
  });
  await runtime.createPackage({ displayName: 'f', targetDir: path.join(root, 'pkg') });
  try {
    const sub = await runtime.submitTask({
      goal: '调研一个现实问题并给出要点',
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'external_research',
    });
    const job = await waitForJobTerminal(runtime.workRuntime, sub.jobId, 15_000);
    assert.equal(job.status, 'failed');
    assert.ok(!job.artifactId, '不假完成');
    const msg = `${job.failure?.message || ''} ${job.failure?.actionable || ''} ${job.progress?.note || ''}`;
    assert.ok(msg.includes(SEARCH_UNAVAILABLE_USER_MESSAGE));
    assertNoTechLeak(msg, 'CASE F user message');
  } finally {
    await runtime.stop();
  }
});
