/**
 * DIGITALME-SEARCH-FAILURE-CLOSURE-01 — 专业 Web Search 瞬时失败闭环。
 *
 * 正确语义：professional search → bounded retry → transient failure → baseline search fallback
 * → current model synthesis → result。baseline 也失败 → LIMITED/UNAVAILABLE → 诚实告知。
 *
 * 验证：
 *  - selectForNeed exclude：失败/cooldown 能力被排除后选下一可用。
 *  - job-runner 跨能力 fallback：professional 失败 → baseline 接管并成功。
 *  - runtime cooldown：连续任务不再反复撞同一坏能力。
 *  - failureNote：失败时不再显示 stale「正在检索外部来源」。
 *  - double failure：professional + baseline 都失败 → 诚实失败，不假完成。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { CapabilityRegistry } from '../../capability/registry';
import { createFakeDocumentAdapter } from '../../capability/adapters/fake-document';
import { PROFESSIONAL_SEARCH_CAPABILITY_ID, BASELINE_SEARCH_CAPABILITY_ID } from '../../capability/search-capability-discovery';
import { asLocalCapabilityAdapter } from '../../capability/local-adapter-lifecycle';
import type { CapabilityAdapter } from '../../capability/adapter';
import type { CapabilityRegistration } from '../../capability/registration';
import type { CapabilityInput, ExecutionContext } from '../../capability/adapter';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-sfc-${prefix}-`));
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
    latencyEstimate: '',
    location: 'remote',
    availability: 'available',
    adapter: { type: 'local-tool', adapterId: over.adapterId },
    ...over,
  } as CapabilityRegistration;
}

/** 可控失败的 search connector adapter（首次执行抛 transient，可配置 failTimes）。 */
function failingSearchAdapter(id: string, adapterId: string, failTimes = 1, transientMsg = 'server error 503'): CapabilityAdapter {
  const reg = searchReg({ id, adapterId });
  return asLocalCapabilityAdapter({
    registration: reg,
    async execute(input: CapabilityInput, ctx: ExecutionContext) {
      if (failTimes > 0) {
        const err = new Error(transientMsg) as Error & { transient?: boolean; status?: number };
        err.transient = true;
        err.status = 503;
        throw err;
      }
      ctx.reportProgress('正在检索');
      return {
        artifact: { type: 'document', title: '搜索', payload: { kind: 'text', format: 'markdown', text: 'baseline 结果：来源A 来源B' } },
        externalSources: [
          { title: '来源A', url: 'https://example.org/source-a' },
          { title: '来源B', url: 'https://example.org/source-b' },
        ],
        materialUse: { usedPaths: [], includedCount: 0, fullReadCount: 0, truncatedCount: 0 },
      };
    },
  });
}

test('selectForNeed: 排除 professional search 后选 baseline search', async () => {
  const registry = new CapabilityRegistry();
  registry.register(failingSearchAdapter(PROFESSIONAL_SEARCH_CAPABILITY_ID, 'gemini-search'));
  registry.register(failingSearchAdapter(BASELINE_SEARCH_CAPABILITY_ID, 'baseline-bing-search'));

  // 不排除 → 选 professional。
  const first = registry.selectForNeed({ intentKind: 'external_research', expectedOutputFamily: 'document', materialKinds: [] });
  assert.equal(first.adapter!.registration.id, PROFESSIONAL_SEARCH_CAPABILITY_ID);
  // 排除 professional → 选 baseline。
  const second = registry.selectForNeed({
    intentKind: 'external_research',
    expectedOutputFamily: 'document',
    materialKinds: [],
    excludeCapabilityIds: [PROFESSIONAL_SEARCH_CAPABILITY_ID],
  });
  assert.equal(second.adapter!.registration.id, BASELINE_SEARCH_CAPABILITY_ID);
  // 排除两者 → none。
  const third = registry.selectForNeed({
    intentKind: 'external_research',
    expectedOutputFamily: 'document',
    materialKinds: [],
    excludeCapabilityIds: [PROFESSIONAL_SEARCH_CAPABILITY_ID, BASELINE_SEARCH_CAPABILITY_ID],
  });
  assert.equal(third.adapter, undefined);
});

test('job-runner: professional search transient 失败 → 自动 fallback 到 baseline 并成功', async () => {
  const root = await tempDir('fallback');
  // 用自定义 registry：professional 首次失败，baseline 成功。
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: buildRegistryWithFailover(),
  });
  await runtime.createPackage({ displayName: 'fb', targetDir: path.join(root, 'pkg') });
  try {
    const sub = await runtime.submitTask({
      goal: '调研一个现实问题并给出要点',
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'external_research',
    });
    assert.ok(sub.jobId, 'job created');
    const { waitForJobTerminal } = await import('../../work-runtime/job-runner');
    const job = await waitForJobTerminal(runtime.workRuntime, sub.jobId, 30_000);
    assert.equal(job.status, 'succeeded', 'professional 失败后应 fallback 到 baseline 成功');
    assert.equal(job.capabilityId, BASELINE_SEARCH_CAPABILITY_ID, '实际执行用 baseline search');
    const content = await runtime.getContent({ artifactId: job.artifactId! });
    assert.ok((content.text || '').length > 0);
  } finally {
    await runtime.stop();
  }
});

test('failureNote: 失败时不再显示 stale「正在检索外部来源」', async () => {
  const root = await tempDir('note');
  // professional 和 baseline 都失败（failTimes 高）→ 诚实失败。
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: buildRegistryWithFailover({ bothFail: true }),
  });
  await runtime.createPackage({ displayName: 'note', targetDir: path.join(root, 'pkg') });
  try {
    const sub = await runtime.submitTask({
      goal: '调研一个现实问题并给出要点',
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'external_research',
    });
    const { waitForJobTerminal } = await import('../../work-runtime/job-runner');
    const job = await waitForJobTerminal(runtime.workRuntime, sub.jobId, 30_000);
    assert.equal(job.status, 'failed', '双失败 → 诚实失败');
    // 失败文案不得是 stale progress「正在检索外部来源」。
    const note = String(job.progress?.note || '') + ' ' + String(job.failure?.actionable || '');
    assert.ok(!/正在检索外部来源/.test(note), '不显示 stale progress 作为失败文案');
    assert.ok(job.failure?.actionable && job.failure.actionable.length > 0, '有可行动的失败信息');
    // 双失败不假完成：无 artifact。
    assert.ok(!job.artifactId, '不假完成');
  } finally {
    await runtime.stop();
  }
});

function buildRegistryWithFailover(opts?: { bothFail?: boolean }): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(
    createFakeDocumentAdapter({
      text: (_i, extras) => `# 要点\n${(extras?.materialSnippets || []).join('\n')}`,
    }),
  );
  const profFailTimes = opts?.bothFail ? 999 : 1;
  registry.register(failingSearchAdapter(PROFESSIONAL_SEARCH_CAPABILITY_ID, 'gemini-search', profFailTimes));
  registry.register(
    opts?.bothFail
      ? failingSearchAdapter(BASELINE_SEARCH_CAPABILITY_ID, 'baseline-bing-search', 999)
      : failingSearchAdapter(BASELINE_SEARCH_CAPABILITY_ID, 'baseline-bing-search', 0),
  );
  return registry;
}

test('double failure: professional + baseline 都失败 → 诚实失败，不假完成', async () => {
  const root = await tempDir('double');
  const registry = new CapabilityRegistry();
  registry.register(
    createFakeDocumentAdapter({
      text: (_i, extras) => `# 要点\n${(extras?.materialSnippets || []).join('\n')}`,
    }),
  );
  registry.register(failingSearchAdapter(PROFESSIONAL_SEARCH_CAPABILITY_ID, 'gemini-search', 999));
  registry.register(failingSearchAdapter(BASELINE_SEARCH_CAPABILITY_ID, 'baseline-bing-search', 999));
  const runtime = createDigitalMeRuntime({ documentCapability: 'none', registerOpenAiStub: false, capabilityRegistryOverride: registry });
  await runtime.createPackage({ displayName: 'double', targetDir: path.join(root, 'pkg') });
  try {
    const sub = await runtime.submitTask({
      goal: '调研一个现实问题并给出要点',
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'external_research',
    });
    const { waitForJobTerminal } = await import('../../work-runtime/job-runner');
    const job = await waitForJobTerminal(runtime.workRuntime, sub.jobId, 30_000);
    assert.equal(job.status, 'failed');
    assert.ok(!job.artifactId, '无假完成');
    // 不暴露 provider/HTTP。
    const msg = String(job.failure?.message || '') + ' ' + String(job.failure?.actionable || '');
    assert.ok(!/gemini|HTTP|quota|adapter/i.test(msg), '用户面不暴露 provider/HTTP');
  } finally {
    await runtime.stop();
  }
});

test('runtime cooldown: professional transient 耗尽后，新任务不重复首选 professional', async () => {
  // 通过 pickFallbackCapability 无法直接访问（private）。这里验证 selectForNeed 在
  // exclude 语义下能避开 cooldown 能力（cooldown 集合 → excludeCapabilityIds）。
  const registry = new CapabilityRegistry();
  registry.register(failingSearchAdapter(PROFESSIONAL_SEARCH_CAPABILITY_ID, 'gemini-search'));
  registry.register(failingSearchAdapter(BASELINE_SEARCH_CAPABILITY_ID, 'baseline-bing-search', 0));
  // 模拟 cooldown：把 professional 加入 exclude → 新任务直接选 baseline，不撞 professional。
  const sel = registry.selectForNeed({
    intentKind: 'external_research',
    expectedOutputFamily: 'document',
    materialKinds: [],
    excludeCapabilityIds: [PROFESSIONAL_SEARCH_CAPABILITY_ID],
  });
  assert.equal(sel.adapter!.registration.id, BASELINE_SEARCH_CAPABILITY_ID, 'cooldown 期间新任务用 baseline');
});
