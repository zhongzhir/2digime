/**
 * DIGITALME-RESEARCH-RESULT-QUALITY-01
 * search hit ≠ research success：query → judge evidence → bounded re-search → synthesis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { CapabilityRegistry } from '../../capability/registry';
import { createFakeDocumentAdapter } from '../../capability/adapters/fake-document';
import { createSearchCapabilityAdapter } from '../../capability/adapters/search-adapter';
import { BASELINE_SEARCH_CAPABILITY_ID } from '../../capability/search-capability-discovery';
import type { CapabilityRegistration } from '../../capability/registration';
import type { SearchSource } from '../../capability/search-contract';
import { waitForJobTerminal } from '../job-runner';
import { nowIso } from '../../shared/ids';
import {
  parseResearchQueries,
  parseEvidenceJudgment,
  buildResearchQueryMessages,
  buildEvidenceJudgmentMessages,
  isSearchDumpText,
  SEARCH_DUMP_MARKER,
  toResearchCandidates,
  judgeResearchEvidenceWithChat,
} from '../research-evidence';
import { parseBingSearchResults } from '../../capability/adapters/bing-html-search';

async function tempRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-rrq-${prefix}-`));
}

function searchReg(): CapabilityRegistration {
  return {
    id: BASELINE_SEARCH_CAPABILITY_ID,
    kind: 'tool',
    displayName: 'search',
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

function src(title: string, url: string, extra?: Partial<SearchSource>): SearchSource {
  return { title, url, sourceClass: 'external', ...extra };
}

async function confirmResearchPlan(
  runtime: ReturnType<typeof createDigitalMeRuntime>,
  goal: string,
): Promise<{ taskId: string; jobId: string }> {
  const task = await runtime.workRuntime.createConversationTask({ goal, contextRefs: [] });
  const now = nowIso();
  await runtime.workRuntime.updateTaskPlan(task.id, {
    version: 1,
    status: 'confirmed',
    content: '目标：基于外部证据回答问题\n交付：带来源的综合说明\n路径：检索→筛选→综合',
    updatedAt: now,
    confirmedAt: now,
    source: 'model',
    semantic: {
      requiredCapabilities: ['external_information', 'document_synthesis'],
      requirements: ['使用相关现实来源', '综合成可直接使用的判断', '不要只交链接清单'],
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

test('parser: research JSON stays bounded; dump marker detected', () => {
  assert.deepEqual(parseResearchQueries('{"queries":["EU AI Act hiring 2026","US EEOC AI selection"]}'), [
    'EU AI Act hiring 2026',
    'US EEOC AI selection',
  ]);
  const judged = parseEvidenceJudgment('{"selectedIndexes":[2],"sufficient":false,"followupQueries":["NYC AEDT 2026"]}', 3);
  assert.deepEqual(judged?.selectedIndexes, [2]);
  assert.equal(judged?.sufficient, false);
  assert.ok(isSearchDumpText(`x\n> 提示：${SEARCH_DUMP_MARKER}`));
});

test('query prompt is referent-free and not a T1 case patch', () => {
  const blob = buildResearchQueryMessages({
    goal: '最近某领域政策有没有变化，对我们产品意味着什么',
  })
    .map((m) => m.content)
    .join('\n');
  assert.match(blob, /精炼搜索查询/);
  assert.doesNotMatch(blob, /YouTube/);
  assert.doesNotMatch(blob, /欧盟和美国对招聘/);
  const judge = buildEvidenceJudgmentMessages({
    goal: 'x',
    queries: ['a'],
    candidates: [{ index: 1, title: 't', url: 'https://example.com' }],
  })
    .map((m) => m.content)
    .join('\n');
  assert.match(judge, /排名不等于相关性/);
  assert.match(judge, /标题、摘要或 URL 已能看出与问题相关的，必须选入/);
});

test('Bing parser prefers organic b_algo over stray video h2', () => {
  const html = `
<h2><a href="https://www.bing.com/ck/a?u=a1aHR0cHM6Ly93d3cueW91dHViZS5jb20v">YouTube</a></h2>
<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?&u=a1aHR0cHM6Ly9kaWdpdGFsLXN0cmF0ZWd5LmVjLmV1cm9wYS5ldS8&ntb=1">EU AI Act</a></h2><p>High-risk employment systems</p></li>
`;
  const parsed = parseBingSearchResults(html);
  assert.equal(parsed.length, 1);
  const first = parsed[0];
  assert.ok(first);
  assert.match(first.title, /EU AI Act/);
  assert.match(first.url, /europa\.eu/);
});

test('A: current-change research synthesizes, not a link list', async () => {
  const root = await tempRoot('a');
  const queries: string[] = [];
  const registry = new CapabilityRegistry();
  registry.register(
    createFakeDocumentAdapter({
      text: (_input, extras) =>
        `# 综合判断\n欧盟高风险招聘系统需透明度与人工复核。\n来源：${(extras?.materialSnippets || []).join('\n')}`,
    }),
  );
  registry.register(
    createSearchCapabilityAdapter({
      connector: {
        id: 'live',
        search: async (q) => {
          queries.push(q);
          return [
            src('EU AI Act employment', 'https://digital-strategy.ec.europa.eu/ai-act', {
              snippet: 'High-risk AI in recruitment',
              evidenceChunk: 'Annex III covers employment and worker management.',
            }),
          ];
        },
      },
      registration: searchReg(),
    }),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
    resolveResearchEvidence: async (input) => {
      if (input.phase === 'queries') {
        return { decided: true, queries: ['EU AI Act hiring high-risk 2026'] };
      }
      return { decided: true, selectedIndexes: [1], sufficient: true, followupQueries: [] };
    },
  });
  await runtime.createPackage({ displayName: 'a', targetDir: path.join(root, 'pkg') });
  try {
    const submitted = await confirmResearchPlan(
      runtime,
      '最近企业用生成式模型做人事筛选，监管上有什么该盯的变化，对我们产品意味着什么。',
    );
    const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
    assert.equal(job.status, 'succeeded');
    assert.deepEqual(queries, ['EU AI Act hiring high-risk 2026']);
    assert.ok(!queries.some((q) => /对我们产品意味着什么/.test(q)));
    assert.ok((job.materialUse?.usedPaths || []).includes('external-information://search-evidence'));
    assert.equal(job.researchEvidence?.sufficient, true);
    assert.equal(job.researchEvidence?.selectedUrls[0], 'https://digital-strategy.ec.europa.eu/ai-act');
    const content = await runtime.getContent({ artifactId: job.artifactId! });
    const text = String(content.text || '');
    assert.match(text, /综合判断|人工复核/);
    assert.equal(isSearchDumpText(text), false);
  } finally {
    await runtime.stop();
  }
});

test('B: noisy ranking is filtered; unrelated hit not synthesized', async () => {
  const root = await tempRoot('b');
  const registry = new CapabilityRegistry();
  registry.register(
    createFakeDocumentAdapter({
      text: (_input, extras) => `# 判断\n${(extras?.materialSnippets || []).join('\n')}`,
    }),
  );
  registry.register(
    createSearchCapabilityAdapter({
      connector: {
        id: 'live',
        search: async () => [
          src('Cooking shorts home', 'https://www.example-video.test/home', {
            snippet: 'Subscribe for recipes',
          }),
          src('EEOC AI selection guidance', 'https://www.eeoc.gov/ai-selection', {
            snippet: 'Title VII and algorithmic hiring',
            evidenceChunk: 'Employers remain liable for discriminatory selection tools.',
          }),
        ],
      },
      registration: searchReg(),
    }),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
    resolveResearchEvidence: async (input) => {
      if (input.phase === 'queries') return { decided: true, queries: ['US EEOC algorithmic hiring'] };
      const eeoc = (input.candidates || []).find((c) => /eeoc\.gov/.test(c.url));
      return {
        decided: true,
        selectedIndexes: eeoc ? [eeoc.index] : [],
        sufficient: true,
        followupQueries: [],
      };
    },
  });
  await runtime.createPackage({ displayName: 'b', targetDir: path.join(root, 'pkg') });
  try {
    const submitted = await confirmResearchPlan(runtime, '美国对算法筛人有没有执法口径变化');
    const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
    assert.equal(job.status, 'succeeded');
    assert.ok(job.researchEvidence?.selectedUrls.includes('https://www.eeoc.gov/ai-selection'));
    assert.ok(job.researchEvidence?.rejectedUrls.some((u) => /example-video/.test(u)));
    const content = await runtime.getContent({ artifactId: job.artifactId! });
    assert.match(String(content.text || ''), /eeoc\.gov|EEOC/);
    assert.doesNotMatch(String(content.text || ''), /Cooking shorts/);
  } finally {
    await runtime.stop();
  }
});

test('C: insufficient first round triggers bounded follow-up search', async () => {
  const root = await tempRoot('c');
  const queries: string[] = [];
  const registry = new CapabilityRegistry();
  registry.register(
    createFakeDocumentAdapter({
      text: (_input, extras) => `# 补齐后的判断\n${(extras?.materialSnippets || []).join('\n')}`,
    }),
  );
  registry.register(
    createSearchCapabilityAdapter({
      connector: {
        id: 'live',
        search: async (q) => {
          queries.push(q);
          if (/followup|NYC|AEDT/.test(q)) {
            return [
              src('NYC AEDT law', 'https://www.nyc.gov/aedt', {
                evidenceChunk: 'Local Law 144 requires bias audits for automated employment decision tools.',
              }),
            ];
          }
          return [src('Generic HR blog', 'https://hr-tips.example/post', { snippet: 'AI is changing HR' })];
        },
      },
      registration: searchReg(),
    }),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
    resolveResearchEvidence: async (input) => {
      if (input.phase === 'queries') return { decided: true, queries: ['AI hiring regulation overview'] };
      const nyc = (input.candidates || []).find((c) => /nyc\.gov/.test(c.url));
      if (!nyc) {
        return {
          decided: true,
          selectedIndexes: [],
          sufficient: false,
          followupQueries: ['NYC AEDT Local Law 144'],
          missingQuestions: ['地方立法对自动雇佣决策工具的审计要求'],
        };
      }
      return { decided: true, selectedIndexes: [nyc.index], sufficient: true, followupQueries: [] };
    },
  });
  await runtime.createPackage({ displayName: 'c', targetDir: path.join(root, 'pkg') });
  try {
    const submitted = await confirmResearchPlan(runtime, '自动雇佣决策工具在地方层还有哪些硬约束');
    const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
    assert.equal(job.status, 'succeeded');
    assert.ok(queries.includes('AI hiring regulation overview'));
    assert.ok(queries.includes('NYC AEDT Local Law 144'));
    assert.equal(job.researchEvidence?.rounds, 2);
    assert.ok(job.researchEvidence?.selectedUrls.includes('https://www.nyc.gov/aedt'));
  } finally {
    await runtime.stop();
  }
});

test('D: conflicting sources stay visible instead of silently picking one', async () => {
  const root = await tempRoot('d');
  const registry = new CapabilityRegistry();
  registry.register(
    createFakeDocumentAdapter({
      text: (_input, extras) => {
        const blob = (extras?.materialSnippets || []).join('\n');
        return `# 差异\n来源存在分歧：一说已生效，一说仍在草案。\n${blob}`;
      },
    }),
  );
  registry.register(
    createSearchCapabilityAdapter({
      connector: {
        id: 'live',
        search: async () => [
          src('Source A in force', 'https://example.org/in-force', {
            evidenceChunk: 'The rule took effect in March.',
          }),
          src('Source B still draft', 'https://example.org/draft', {
            evidenceChunk: 'The proposal remains in draft and is not yet binding.',
          }),
        ],
      },
      registration: searchReg(),
    }),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
    resolveResearchEvidence: async (input) => {
      if (input.phase === 'queries') return { decided: true, queries: ['status of the rule 2026'] };
      return { decided: true, selectedIndexes: [1, 2], sufficient: true, followupQueries: [] };
    },
  });
  await runtime.createPackage({ displayName: 'd', targetDir: path.join(root, 'pkg') });
  try {
    const submitted = await confirmResearchPlan(runtime, '这项规则到底生效了没有');
    const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.researchEvidence?.selectedUrls.length, 2);
    const content = await runtime.getContent({ artifactId: job.artifactId! });
    assert.match(String(content.text || ''), /分歧|草案/);
    assert.match(String(content.text || ''), /in-force/);
    assert.match(String(content.text || ''), /draft/);
  } finally {
    await runtime.stop();
  }
});

test('empty selection cannot invent facts: job fails without synthesis artifact', async () => {
  const root = await tempRoot('empty-select');
  let synthCalls = 0;
  const registry = new CapabilityRegistry();
  registry.register(
    createFakeDocumentAdapter({
      text: () => {
        synthCalls += 1;
        return '内部知识编造的最新事实';
      },
    }),
  );
  registry.register(
    createSearchCapabilityAdapter({
      connector: {
        id: 'live',
        search: async () => [
          src('On-topic rule page', 'https://example.gov/rule', { snippet: 'employment decision tools' }),
        ],
      },
      registration: searchReg(),
    }),
  );
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    capabilityRegistryOverride: registry,
    resolveResearchEvidence: async (input) => {
      if (input.phase === 'queries') return { decided: true, queries: ['employment decision tools 2026'] };
      return { decided: true, selectedIndexes: [], sufficient: false, followupQueries: [] };
    },
  });
  await runtime.createPackage({ displayName: 'e', targetDir: path.join(root, 'pkg') });
  try {
    const submitted = await confirmResearchPlan(runtime, '这项人事工具规则最近有没有实质变化');
    const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 20_000);
    assert.equal(job.status, 'failed');
    assert.equal(synthCalls, 0);
    assert.ok(!job.artifactId);
    assert.match(String(job.failure?.message || job.failure?.actionable || ''), /证据|相关/);
  } finally {
    await runtime.stop();
  }
});

test('judgment retry: empty first pass then select related titles', async () => {
  const calls: string[] = [];
  const judged = await judgeResearchEvidenceWithChat(
    async ({ messages }) => {
      calls.push(messages.map((m) => m.content).join('\n'));
      if (calls.length === 1) return { text: '{"selectedIndexes":[],"sufficient":false,"followupQueries":[]}' };
      return { text: '{"selectedIndexes":[1],"sufficient":true,"followupQueries":[]}' };
    },
    {
      goal: '人事决策工具监管近况',
      queries: ['employment AI high-risk'],
      candidates: [
        { index: 1, title: 'High-risk employment systems', url: 'https://example.gov/ai', snippet: 'hiring' },
      ],
    },
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(judged.selectedIndexes, [1]);
  assert.equal(judged.sufficient, true);
});

test('grounding segments become candidate snippets', () => {
  const cands = toResearchCandidates([
    {
      title: 'EEOC guidance',
      url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
      sourceClass: 'external',
      groundingSupport: [{ segment: 'Adverse impact in automated hiring tools' }],
    },
  ]);
  assert.equal(cands.length, 1);
  assert.match(String(cands[0]?.snippet || ''), /Adverse impact/);
});

test('no YouTube/domain/T1 query patch in research modules', async () => {
  const files = [
    path.join('src', 'work-runtime', 'research-evidence.ts'),
    path.join('src', 'capability', 'adapters', 'search-adapter.ts'),
    path.join('src', 'work-runtime', 'job-runner.ts'),
  ];
  for (const rel of files) {
    const text = await fs.readFile(path.join(process.cwd(), rel), 'utf8');
    assert.doesNotMatch(text, /youtube\.com/i);
    assert.doesNotMatch(text, /欧盟和美国对招聘场景/);
    assert.doesNotMatch(text, /newsHosts|黑名单|whitelist of news/);
  }
});
