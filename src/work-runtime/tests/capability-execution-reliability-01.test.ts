/**
 * DIGITALME-CAPABILITY-EXECUTION-RELIABILITY-01
 *
 * Search 成功后的文档综合瞬时失败，不得当成 search 失败去切换 provider / 丢弃证据。
 * 搜索 Job 不得回退到普通文档能力（假完成）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'os';
import * as path from 'path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { CapabilityRegistry } from '../../capability/registry';
import { createFakeDocumentAdapter } from '../../capability/adapters/fake-document';
import { createSearchCapabilityAdapter } from '../../capability/adapters/search-adapter';
import {
  BASELINE_SEARCH_CAPABILITY_ID,
  PROFESSIONAL_SEARCH_CAPABILITY_ID,
} from '../../capability/search-capability-discovery';
import type { CapabilityRegistration } from '../../capability/registration';
import { waitForJobTerminal, SEARCH_UNAVAILABLE_USER_MESSAGE } from '../job-runner';
import { nowIso } from '../../shared/ids';

async function tempRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-caprel-${prefix}-`));
}

const USABLE = {
  title: 'Industry note 2026',
  url: 'https://example.com/agent-roi-2026',
  snippet: 'AI Agent 辅助软件开发的实测收益与治理风险。',
  sourceClass: 'external' as const,
};

function searchReg(id: string, adapterId: string): CapabilityRegistration {
  return {
    id,
    kind: 'tool',
    displayName: id,
    description: 'test search',
    inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
    outputArtifactTypes: ['document'],
    permissions: ['network'],
    cost: { estimate: 'free' },
    latencyEstimate: 'seconds',
    location: 'remote',
    availability: 'available',
    adapter: { type: 'local-tool', adapterId },
  };
}

async function confirmResearchPlan(
  runtime: ReturnType<typeof createDigitalMeRuntime>,
  goal: string,
): Promise<{ taskId: string; jobId: string }> {
  const task = await runtime.workRuntime.createConversationTask({
    goal,
    contextRefs: [],
  });
  const now = nowIso();
  await runtime.workRuntime.updateTaskPlan(task.id, {
    version: 1,
    status: 'confirmed',
    content: '目标：带来源的摘要\n交付：文档\n路径：先取现实来源再综合',
    updatedAt: now,
    confirmedAt: now,
    source: 'model',
    semantic: {
      requiredCapabilities: ['external_information', 'document_synthesis'],
      requirements: ['使用现实来源', '不要编造链接'],
      relevantContextIds: [],
    },
  });
  const submitted = await runtime.submitTask({
    existingTaskId: task.id,
    goal: task.goal,
    contextRefs: [],
    requestedArtifactType: 'document',
    intentKind: 'create_document',
    confirmedPlanVersion: 1,
  });
  return { taskId: task.id, jobId: submitted.jobId };
}

test('search 成功 + 综合首次 503 → 只重试文档模型并成功，不切换 search', async () => {
  const root = await tempRoot('synth-retry');
  let searchCalls = 0;
  const registry = new CapabilityRegistry();
  registry.register(
    createFakeDocumentAdapter({
      text: (_input, extras) => `综合正文\n${(extras?.materialSnippets || []).join('\n')}`,
      failWith: {
        message: 'model 503 high demand',
        actionable: '请稍后重试',
        stage: 'model',
        transient: true,
      },
      failTimes: 1,
    }),
  );
  registry.register(
    createSearchCapabilityAdapter({
      connector: {
        id: 'live',
        search: async () => {
          searchCalls += 1;
          return [USABLE];
        },
      },
      registration: searchReg(BASELINE_SEARCH_CAPABILITY_ID, 'baseline-bing-search'),
    }),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
  });
  await runtime.createPackage({ displayName: 'r', targetDir: path.join(root, 'pkg') });
  try {
    const submitted = await confirmResearchPlan(
      runtime,
      '请对照 2026 年企业把 AI Agent 用于软件工程的真实收益与风险，整理一份带来源依据的摘要。',
    );
    const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.capabilityId, BASELINE_SEARCH_CAPABILITY_ID);
    assert.equal(searchCalls, 1, 'search 只应成功一次，不得因综合失败重跑/切换');
    assert.ok(
      (job.materialUse?.usedPaths || []).includes('external-information://search-evidence'),
      '必须保留真实检索证据',
    );
    const content = await runtime.getContent({ artifactId: job.artifactId! });
    assert.match(String(content.text || ''), /综合正文|example\.com\/agent-roi-2026/);
  } finally {
    await runtime.stop();
  }
});

test('search 成功 + 综合持续失败 → 诚实失败（模型），不假完成、不改称搜索不可用', async () => {
  const root = await tempRoot('synth-fail');
  let searchCalls = 0;
  const registry = new CapabilityRegistry();
  registry.register(
    createFakeDocumentAdapter({
      failWith: {
        message: 'model 503 high demand',
        actionable: '请稍后重试',
        stage: 'model',
        transient: true,
      },
    }),
  );
  registry.register(
    createSearchCapabilityAdapter({
      connector: {
        id: 'live',
        search: async () => {
          searchCalls += 1;
          return [USABLE];
        },
      },
      registration: searchReg(BASELINE_SEARCH_CAPABILITY_ID, 'baseline-bing-search'),
    }),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
  });
  await runtime.createPackage({ displayName: 'r', targetDir: path.join(root, 'pkg') });
  try {
    const submitted = await confirmResearchPlan(runtime, '整理一份带来源依据的摘要，不要编造链接。');
    const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
    assert.equal(job.status, 'failed');
    assert.equal(job.capabilityId, BASELINE_SEARCH_CAPABILITY_ID);
    assert.equal(searchCalls, 1);
    assert.ok(!job.artifactId, '无假完成');
    assert.equal(job.failure?.stage, 'model');
    const note = String(job.failure?.message || '') + ' ' + String(job.failure?.actionable || '');
    assert.ok(!note.includes(SEARCH_UNAVAILABLE_USER_MESSAGE), '不得把综合失败说成搜索不可用');
    assert.match(note, /整理/);
  } finally {
    await runtime.stop();
  }
});

test('双搜索失败时即使有文档能力也不得假完成', async () => {
  const root = await tempRoot('no-fake');
  const registry = new CapabilityRegistry();
  registry.register(createFakeDocumentAdapter({ text: 'FAKE_DOC_SHOULD_NOT_COMMIT' }));
  registry.register(
    createSearchCapabilityAdapter({
      connector: {
        id: 'g',
        search: async () => {
          throw Object.assign(new Error('professional down'), { transient: true, status: 503 });
        },
      },
      registration: searchReg(PROFESSIONAL_SEARCH_CAPABILITY_ID, 'gemini-search'),
    }),
  );
  registry.register(
    createSearchCapabilityAdapter({
      connector: {
        id: 'b',
        search: async () => {
          throw Object.assign(new Error('baseline down'), { transient: true, status: 503 });
        },
      },
      registration: searchReg(BASELINE_SEARCH_CAPABILITY_ID, 'baseline-bing-search'),
    }),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
  });
  await runtime.createPackage({ displayName: 'r', targetDir: path.join(root, 'pkg') });
  try {
    const submitted = await confirmResearchPlan(runtime, '调研一个现实问题并给出要点');
    const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
    assert.equal(job.status, 'failed');
    assert.ok(!job.artifactId, '不得用普通文档能力顶替搜索失败');
    const note = String(job.failure?.message || '') + ' ' + String(job.failure?.actionable || '');
    assert.ok(note.includes(SEARCH_UNAVAILABLE_USER_MESSAGE));
    assert.ok(!/FAKE_DOC_SHOULD_NOT_COMMIT/.test(note));
  } finally {
    await runtime.stop();
  }
});
