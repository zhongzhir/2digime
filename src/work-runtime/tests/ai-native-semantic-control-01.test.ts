/**
 * DIGITALME-AI-NATIVE-SEMANTIC-CONTROL-01
 * AI owns semantics; control owns enforcement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWorkRuntime } from '../create-runtime';
import { waitForJobTerminal } from '../job-runner';
import { CapabilityRegistry } from '../../capability/registry';
import { createFakeDocumentAdapter } from '../../capability/adapters/fake-document';
import { createSearchCapabilityAdapter } from '../../capability/adapters/search-adapter';
import { BASELINE_SEARCH_CAPABILITY_ID } from '../../capability/search-capability-discovery';
import type { CapabilityRegistration } from '../../capability/registration';
import { parsePlannerSemantic, capabilityNeedFromPlan } from '../planner-semantic';
import { resolveSelectedContextRefs } from '../context-candidates';
import { parseConverseModelOutput } from '../work-converse';
import { freezeConfirmedPlanSnapshot } from '../confirmed-plan-execution';
import { structuredDistillToEvents } from '../../subject-core/structured-distill';
import { buildAiCtoEvidencePack } from '../../execution/ai-cto-review';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { nowIso } from '../../shared/ids';

async function tempRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-semctl-${prefix}-`));
}

function searchReg(): CapabilityRegistration {
  return {
    id: BASELINE_SEARCH_CAPABILITY_ID,
    kind: 'tool',
    displayName: '基础搜索',
    description: 'test search',
    inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
    outputArtifactTypes: ['document'],
    permissions: ['network'],
    cost: { estimate: 'free' },
    latencyEstimate: 'seconds',
    location: 'remote',
    availability: 'available',
    adapter: { type: 'local-tool', adapterId: 'baseline-bing-search' },
  };
}

const USABLE = {
  title: 'Industry note 2026',
  url: 'https://example.com/agent-roi-2026',
  snippet: 'AI Agent 辅助软件开发的实测收益与治理风险。',
  sourceClass: 'external' as const,
};

test('A: planner semantic — delivery family is not capability authority', () => {
  const parsed = parsePlannerSemantic({
    requiredCapabilities: ['external_information', 'document_synthesis'],
    planRequirements: ['使用现实来源', '不要编造链接'],
    relevantContextIds: [],
  });
  assert.ok(parsed);
  assert.deepEqual(parsed!.requiredCapabilities, ['external_information', 'document_synthesis']);
  assert.equal(capabilityNeedFromPlan(parsed).needsExternalInformation, true);
  assert.equal(parsePlannerSemantic({ requiredCapabilities: ['not_a_real_cap'] }), null);
  assert.equal(parsePlannerSemantic({}), null);
});

test('A: converse JSON keeps capability needs independent of create_document', () => {
  const parsed = parseConverseModelOutput(
    JSON.stringify({
      intent: 'confirm_start',
      confidence: 0.92,
      reply: '按这个做。',
      executionIntentKind: 'create_document',
      expectedOutputFamily: 'document',
      requiredCapabilities: ['external_information', 'document_synthesis'],
      planRequirements: ['引用可核对来源'],
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed!.executionIntentKind, 'create_document');
  assert.ok(parsed!.semantic?.requiredCapabilities.includes('external_information'));
});

test('A: selectForNeed — document family + planner external_information selects search', () => {
  const registry = new CapabilityRegistry();
  registry.register(createFakeDocumentAdapter());
  registry.register(
    createSearchCapabilityAdapter({
      connector: { id: 't', search: async () => [USABLE] },
      registration: searchReg(),
    }),
  );
  const docOnly = registry.selectForNeed({
    intentKind: 'create_document',
    expectedOutputFamily: 'document',
  });
  assert.equal(docOnly.adapter?.registration.id, 'cap_fake_document');
  const withNeed = registry.selectForNeed({
    intentKind: 'create_document',
    expectedOutputFamily: 'document',
    needsExternalInformation: true,
  });
  assert.equal(withNeed.adapter?.registration.id, BASELINE_SEARCH_CAPABILITY_ID);
});

test('A: natural research phrasing without 搜索/调研/研究 drives search + synthesis', async () => {
  const root = await tempRoot('a-research');
  const searchCalls: string[] = [];
  const registry = new CapabilityRegistry();
  registry.register(
    createFakeDocumentAdapter({
      text: (input, extras) =>
        `摘要\n${(extras?.materialSnippets || []).join('\n')}\n目标：${input.goal}`,
    }),
  );
  registry.register(
    createSearchCapabilityAdapter({
      connector: {
        id: 'live',
        search: async (q) => {
          searchCalls.push(q);
          return [USABLE];
        },
      },
      registration: searchReg(),
    }),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
  });
  await runtime.createPackage({ displayName: 'a', targetDir: path.join(root, 'pkg') });
  try {
    const task = await runtime.workRuntime.createConversationTask({
      goal: '请对照 2026 年企业把 AI Agent 用于软件工程的真实收益与风险，整理一份带来源依据的摘要，不要编造链接。',
      contextRefs: [],
    });
    assert.notEqual(task.intentKind, 'modify_code');
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
    const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.capabilityId, BASELINE_SEARCH_CAPABILITY_ID);
    assert.ok(searchCalls.length >= 1, 'search capability must actually run');
    const content = await runtime.getContent({ artifactId: job.artifactId! });
    assert.match(String(content.text || ''), /example\.com\/agent-roi-2026|Industry note/);
    assert.equal(job.confirmedPlanSnapshot?.requirements?.includes('使用现实来源'), true);
  } finally {
    await runtime.stop();
  }
});

test('A: attachment-only document must not search', async () => {
  const root = await tempRoot('a-local');
  const file = path.join(root, 'notes.txt');
  await fs.writeFile(file, '仅依据本附件整理：本地库存 42 件。', 'utf8');
  let searchCalls = 0;
  const registry = new CapabilityRegistry();
  registry.register(createFakeDocumentAdapter());
  registry.register(
    createSearchCapabilityAdapter({
      connector: {
        id: 'live',
        search: async () => {
          searchCalls += 1;
          return [{ ...USABLE, title: 'web', url: 'https://example.com/x' }];
        },
      },
      registration: searchReg(),
    }),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
  });
  await runtime.createPackage({ displayName: 'local', targetDir: path.join(root, 'pkg') });
  try {
    const task = await runtime.workRuntime.createConversationTask({
      goal: '根据我附的材料写一份说明',
      contextRefs: [{ kind: 'file', path: file }],
    });
    const now = nowIso();
    await runtime.workRuntime.updateTaskPlan(task.id, {
      version: 1,
      status: 'confirmed',
      content: '目标：基于附件成文\n交付：文档',
      updatedAt: now,
      confirmedAt: now,
      source: 'model',
      semantic: {
        requiredCapabilities: ['document_synthesis'],
        requirements: ['只使用已授权附件'],
        relevantContextIds: [],
      },
    });
    const submitted = await runtime.submitTask({
      existingTaskId: task.id,
      goal: task.goal,
      contextRefs: [{ kind: 'file', path: file }],
      requestedArtifactType: 'document',
      intentKind: 'create_document',
      confirmedPlanVersion: 1,
    });
    const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
    assert.equal(job.status, 'succeeded');
    assert.equal(searchCalls, 0);
    assert.notEqual(job.capabilityId, BASELINE_SEARCH_CAPABILITY_ID);
  } finally {
    await runtime.stop();
  }
});

test('B: model preference without 以后/偏好/喜欢 becomes subject preference', async () => {
  const result = await structuredDistillToEvents({
    subjectId: 's1',
    text: '我看这种周报时，最有效的是先看到结论，依据放后面。',
    sourceKind: 'conversation',
    chatComplete: async () => ({
      text: JSON.stringify({
        title: '周报先结论后依据',
        text: '我看这种周报时，最有效的是先看到结论，依据放后面。',
        category: 'user_preference',
        needs_confirmation: false,
        risk: 'low',
        scope: 'general',
        temporary: false,
      }),
      finishReason: 'stop',
    }),
    model: { baseUrl: 'https://example.invalid', model: 'mock' },
  });
  assert.equal(result.mode, 'model');
  assert.ok(result.events[0]);
  assert.equal(result.events[0]!.type, 'preference_observed');
  assert.ok(result.events[0]!.payload.tags?.includes('silent_ok'));
});

test('B: silent-adopted preference is recalled on next matching document task', async () => {
  const root = await tempRoot('b-recall');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    fakeAdapter: {
      text: (input) => {
        const blob = (input.subjectContext.entries || [])
          .map((e) => `${e.title} ${e.detail}`)
          .join('\n');
        return `# 周报\n${blob || '（无主体上下文）'}\n本周进展已核对。`;
      },
    },
  });
  await runtime.createPackage({ displayName: 'recall', targetDir: path.join(root, 'pkg') });
  runtime.subject.setDistillModelRuntime({
    enabled: true,
    chatComplete: async () => ({
      text: JSON.stringify({
        title: '周报阅读：先结论后依据',
        text: '看周报时最有效的是先看到结论，依据放后面。',
        category: 'user_preference',
        needs_confirmation: false,
        risk: 'low',
        scope: 'general',
        temporary: false,
      }),
      finishReason: 'stop',
    }),
    model: { baseUrl: 'https://example.invalid', model: 'mock', providerId: 'mock' },
  });
  const cap = await runtime.captureSubjectInput({
    text: '我看这种周报时，最有效的是先看到结论，依据放后面。',
    sourceKind: 'conversation',
  });
  assert.equal(cap.distillMode, 'model');
  assert.ok((cap.confirmedEventIds || []).length >= 1, 'low-risk model preference silent-adopts');
  const t = await runtime.submitTask({
    goal: '和上次一样写一份周报。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, t.jobId, 20_000);
  assert.equal(job.status, 'succeeded');
  const freeze = await runtime.readSubjectContextFreeze(job.snapshotId!);
  assert.ok(
    (freeze?.entries || []).some((e) => /结论/.test(`${e.title} ${e.detail}`)),
    'next weekly task must inject the preference',
  );
  await runtime.stop();
});

test('B: model empty after repair records nothing (not knowledge_gap)', async () => {
  const result = await structuredDistillToEvents({
    subjectId: 's1',
    text: '我看这种周报时，最有效的是先看到结论，依据放后面。',
    sourceKind: 'conversation',
    chatComplete: async () => ({ text: '{"candidates":[]}', finishReason: 'stop' }),
    model: { baseUrl: 'https://example.invalid', model: 'mock' },
  });
  assert.equal(result.mode, 'model');
  assert.equal(result.events.length, 0);
  assert.ok(!result.events.some((e) => e.type === 'knowledge_gap_noted'));
});

test('B: external fact is not written as owner preference', async () => {
  const result = await structuredDistillToEvents({
    subjectId: 's1',
    text: '公开报道称某公司今年营收增长 40%。',
    sourceKind: 'conversation',
    chatComplete: async () => ({
      text: JSON.stringify({
        title: '某公司营收',
        text: '公开报道称某公司今年营收增长 40%。',
        category: 'external_claim',
        needs_confirmation: false,
        risk: 'low',
        scope: 'general',
        temporary: false,
      }),
      finishReason: 'stop',
    }),
    model: { baseUrl: 'https://example.invalid', model: 'mock' },
  });
  assert.ok(!result.events.some((e) => e.type === 'preference_observed'));
});

test('C: candidate discovery → model selection → executor sees related context only', async () => {
  const root = await tempRoot('c-ctx');
  const related = path.join(root, 'related.md');
  const unrelated = path.join(root, 'unrelated.md');
  await fs.writeFile(related, 'NORTHSTAR_OKR_ALPHA：下一阶段做权限收敛。', 'utf8');
  await fs.writeFile(unrelated, 'UNRELATED_COOKING_RECIPE：先炒洋葱。', 'utf8');
  let lastSnippets: string[] = [];
  const runtime = createWorkRuntime({
    rootDir: root,
    subjectId: 'subj_test',
    registerOpenAiStub: false,
    fakeAdapter: {
      onExecute: ({ materialSnippets }) => {
        lastSnippets = materialSnippets;
      },
    },
  });
  await runtime.recoverOnStartup();
  runtime.start();
  try {
    const a = await runtime.submitTask({
      goal: '整理 NORTHSTAR 项目纪要',
      contextRefs: [{ kind: 'file', path: related }],
      requestedArtifactType: 'document',
    });
    const jobA = await waitForJobTerminal(runtime, a.jobId, 15_000);
    assert.equal(jobA.status, 'succeeded');
    const b = await runtime.submitTask({
      goal: '写一份家常菜步骤',
      contextRefs: [{ kind: 'file', path: unrelated }],
      requestedArtifactType: 'document',
    });
    await waitForJobTerminal(runtime, b.jobId, 15_000);
    const open = await runtime.createConversationTask({
      goal: '帮我把这个项目下一阶段推进方案整理出来。',
      contextRefs: [],
    });
    const candidates = await runtime.listContextCandidates(open.id);
    const relatedCand = candidates.find((c) => /NORTHSTAR/.test(`${c.title} ${c.summary}`));
    const unrelatedCand = candidates.find((c) => /家常菜/.test(`${c.title} ${c.summary}`));
    assert.ok(relatedCand, 'related historical candidate must be discoverable');
    assert.ok(unrelatedCand, 'unrelated historical candidate must still be listed');
    const resolved = resolveSelectedContextRefs(candidates, [relatedCand!.id]);
    assert.equal(resolved.artifactIds.length, 1);
    assert.ok(!resolved.artifactIds.includes(unrelatedCand!.id.replace(/^artifact:/, '')));

    const now = nowIso();
    await runtime.updateTaskPlan(open.id, {
      version: 1,
      status: 'confirmed',
      content: '目标：推进方案\n交付：文档',
      updatedAt: now,
      confirmedAt: now,
      source: 'model',
      semantic: {
        requiredCapabilities: ['document_synthesis'],
        requirements: ['使用已有相关项目上下文'],
        relevantContextIds: [relatedCand!.id],
      },
    });
    lastSnippets = [];
    const submitted = await runtime.submitTask({
      existingTaskId: open.id,
      goal: open.goal,
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'create_document',
      confirmedPlanVersion: 1,
    });
    const job = await waitForJobTerminal(runtime, submitted.jobId, 15_000);
    assert.equal(job.status, 'succeeded');
    const blob = lastSnippets.join('\n');
    assert.match(blob, /NORTHSTAR_OKR_ALPHA/);
    assert.doesNotMatch(blob, /UNRELATED_COOKING_RECIPE/);
    const record = await runtime.getTaskRecord(open.id);
    const frozen = freezeConfirmedPlanSnapshot(record);
    assert.ok(frozen?.requirements?.includes('使用已有相关项目上下文'));
  } finally {
    runtime.stop();
  }
});

test('review evidence pack uses planner requirements, not invented keywords', () => {
  const pack = buildAiCtoEvidencePack({
    userGoal: '写一份说明',
    verification: {
      overall: 'unverifiable',
      checks: [],
      digitalMeVerified: false,
      agentClaimedSuccess: false,
    },
    changedFileCount: 0,
    confirmedPlan: { version: 1, content: '目标：推进方案' },
    planRequirements: ['使用已有相关项目上下文', '引用现实来源'],
    artifactBody: 'NORTHSTAR_OKR_ALPHA 权限收敛方案',
  });
  assert.deepEqual(pack.planRequirements, ['使用已有相关项目上下文', '引用现实来源']);
});

test('D: no trial-case keyword patch in new semantic modules', async () => {
  const repo = path.resolve(__dirname, '../../..');
  const files = [
    'src/work-runtime/planner-semantic.ts',
    'src/work-runtime/context-candidates.ts',
    'src/work-runtime/work-converse.ts',
    'src/subject-core/structured-distill.ts',
  ];
  for (const rel of files) {
    const src = await fs.readFile(path.join(repo, rel), 'utf8');
    assert.doesNotMatch(src, /和上次一样/);
    assert.doesNotMatch(src, /先写结论，再展开依据/);
    assert.doesNotMatch(src, /AI Agent 辅助软件开发/);
  }
});
