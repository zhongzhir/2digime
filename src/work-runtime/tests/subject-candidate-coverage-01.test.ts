/**
 * DIGITALME-SUBJECT-CANDIDATE-COVERAGE-01
 *
 * Long-session Subject coverage: adopted preferences must remain visible
 * as candidates after many recent artifacts/conversations. AI still decides
 * relevance — discovery must not drop a source lane before that.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CONTEXT_CANDIDATE_LANES,
  buildWorkContextCandidates,
  formatContextCandidateBrief,
  resolveSelectedContextRefs,
} from '../context-candidates';
import { createWorkRuntime } from '../create-runtime';
import { waitForJobTerminal } from '../job-runner';
import { nowIso } from '../../shared/ids';
import { buildSubjectContextFreeze } from '../../subject-core/subject-context-freeze';
import type { Artifact } from '../artifact';
import type { Task } from '../task';
import type { ConfirmedExperienceView } from '../../subject-core/derived-views';

const RISK_PREF = {
  eventId: 'gevt_pref_risk_first',
  title: '给上级材料先写卡点和不确定项',
  detail: '写给上级的材料先把卡点、不确定项写清楚，建议放后面，不要先报喜。',
};

const COOK_PREF = {
  eventId: 'gevt_pref_cook_list',
  title: '备菜笔记用清单',
  detail: '备菜和家常做法写成一步一步清单，不要散文。',
};

function task(id: string, goal: string, opts?: { folder?: string; talk?: boolean }): Task {
  return {
    id,
    subjectId: 's',
    createdAt: nowIso(),
    goal,
    contextRefs: opts?.folder ? [{ kind: 'folder', path: opts.folder }] : [],
    requestedArtifactType: 'document',
    ...(opts?.talk
      ? {
          meta: {
            conversation: {
              turns: [
                {
                  turnId: `${id}_u`,
                  role: 'user',
                  content: goal,
                  createdAt: nowIso(),
                },
              ],
              intents: [],
            },
          },
        }
      : {}),
  };
}

function art(id: string, taskId: string, title: string): Artifact {
  return {
    id,
    taskId,
    jobId: `job_${id}`,
    subjectId: 's',
    createdAt: nowIso(),
    type: 'document',
    title,
    versions: [],
    headVersionId: 'v1',
    storageDir: '/tmp',
  };
}

function bodies(map: Record<string, string>) {
  return (a: Artifact) => map[a.id];
}

function countKind(
  candidates: ReturnType<typeof buildWorkContextCandidates>,
  kind: string,
): number {
  return candidates.filter((c) => c.kind === kind).length;
}

test('lane caps are source-local, not one shared pool of 16', () => {
  assert.equal(CONTEXT_CANDIDATE_LANES.artifact, 10);
  assert.equal(CONTEXT_CANDIDATE_LANES.conversation, 6);
  assert.equal(CONTEXT_CANDIDATE_LANES.preference, 6);
  const total =
    CONTEXT_CANDIDATE_LANES.artifact +
    CONTEXT_CANDIDATE_LANES.task_folder +
    CONTEXT_CANDIDATE_LANES.conversation +
    CONTEXT_CANDIDATE_LANES.preference;
  assert.ok(total > 16, 'merged lanes may exceed the old global 16');
  assert.ok(total <= 24, 'not an unbounded global budget');
});

test('Final Gate C2 shape: preference survives 10 artifacts + folder + 6 conversations', () => {
  const tasks: Task[] = [];
  const artifacts: Artifact[] = [];
  const text: Record<string, string> = {};
  const titles = [
    '合规调研',
    '诉讼综述',
    '引用号实现',
    '管理层进展',
    '周一讲稿',
    '先动一件',
    '招聘监管',
    '番茄炒蛋',
    '财务说明 184 万',
    '打印机没墨备忘',
  ];
  for (let i = 0; i < titles.length; i++) {
    const id = `task_${i}`;
    tasks.push(
      task(id, titles[i]!, i === 2 ? { folder: 'C:\\tmp\\lot-format', talk: true } : { talk: true }),
    );
    artifacts.push(art(`art_${i}`, id, titles[i]!));
    text[`art_${i}`] = titles[i] === '财务说明 184 万' ? 'WEIZHOU 试点预算 184 万，审批 11 天。' : titles[i]!;
  }
  const candidates = buildWorkContextCandidates({
    currentTaskId: 'task_now',
    tasks,
    artifacts,
    readArtifactText: bodies(text),
    preferences: [RISK_PREF],
  });
  assert.equal(countKind(candidates, 'preference'), 1);
  assert.ok(candidates.some((c) => c.id === `preference:${RISK_PREF.eventId}`));
  assert.ok(candidates.some((c) => /184|WEIZHOU/.test(`${c.title} ${c.summary}`)));
  assert.ok(countKind(candidates, 'artifact') <= CONTEXT_CANDIDATE_LANES.artifact);
  assert.ok(countKind(candidates, 'conversation') <= CONTEXT_CANDIDATE_LANES.conversation);
  assert.ok(countKind(candidates, 'task_folder') <= CONTEXT_CANDIDATE_LANES.task_folder);
});

test('A short session: few tasks, preference is a candidate', () => {
  const t = task('task_old', '给财务写说明', { talk: true });
  const candidates = buildWorkContextCandidates({
    currentTaskId: 'task_now',
    tasks: [t],
    artifacts: [art('art_old', 'task_old', '财务说明')],
    readArtifactText: bodies({ art_old: '预算 184 万' }),
    preferences: [RISK_PREF],
  });
  assert.ok(candidates.some((c) => c.kind === 'preference'));
  assert.ok(candidates.some((c) => c.kind === 'artifact'));
  assert.ok(candidates.some((c) => c.kind === 'conversation'));
});

test('B medium session: several conversations + artifacts, preference still listed', () => {
  const tasks: Task[] = [];
  const artifacts: Artifact[] = [];
  for (let i = 0; i < 6; i++) {
    tasks.push(task(`task_${i}`, `备忘 ${i}`, { talk: true }));
    artifacts.push(art(`art_${i}`, `task_${i}`, `备忘 ${i}`));
  }
  const candidates = buildWorkContextCandidates({
    currentTaskId: 'now',
    tasks,
    artifacts,
    preferences: [RISK_PREF],
  });
  assert.ok(candidates.some((c) => c.id === `preference:${RISK_PREF.eventId}`));
  assert.equal(countKind(candidates, 'artifact'), 6);
});

test('C long session: many recent artifacts do not drop Subject preference', () => {
  const tasks: Task[] = [];
  const artifacts: Artifact[] = [];
  for (let i = 0; i < 18; i++) {
    tasks.push(
      task(
        `task_${i}`,
        i === 17 ? '旧试点财务说明' : `近期备忘 ${i}`,
        i === 3 ? { talk: true, folder: '/tmp/proj' } : { talk: true },
      ),
    );
    artifacts.push(art(`art_${i}`, `task_${i}`, i === 17 ? '旧试点财务说明' : `近期备忘 ${i}`));
  }
  const candidates = buildWorkContextCandidates({
    currentTaskId: 'now',
    tasks,
    artifacts,
    readArtifactText: (a) => (a.id === 'art_17' ? 'WEIZHOU 184 万' : a.title),
    preferences: [RISK_PREF, COOK_PREF],
  });
  assert.equal(countKind(candidates, 'artifact'), CONTEXT_CANDIDATE_LANES.artifact);
  assert.equal(countKind(candidates, 'conversation'), CONTEXT_CANDIDATE_LANES.conversation);
  assert.equal(countKind(candidates, 'preference'), 2);
  assert.ok(candidates.some((c) => c.id === `preference:${RISK_PREF.eventId}`));
  assert.ok(candidates.some((c) => c.id === `preference:${COOK_PREF.eventId}`));
  assert.ok(
    candidates.every((c) => c.kind !== 'preference' || c.eventId),
    'preference candidates keep eventId',
  );
});

test('D competing sources stay visible; AI selection not discovery drops the unrelated', () => {
  const relatedTask = task('task_old', '整理试点纪要', { talk: true });
  const cookTask = task('task_cook', '写一份家常菜步骤', { talk: true });
  const recentTask = task('task_recent', '打印机没墨了记一下', { talk: true });
  const candidates = buildWorkContextCandidates({
    currentTaskId: 'task_open',
    tasks: [recentTask, cookTask, relatedTask],
    artifacts: [
      art('art_recent', 'task_recent', '打印机备忘'),
      art('art_cook', 'task_cook', '番茄炒蛋'),
      art('art_old', 'task_old', '试点财务说明'),
    ],
    readArtifactText: bodies({
      art_recent: '打印机没墨',
      art_cook: 'UNRELATED_COOKING_RECIPE 先炒洋葱',
      art_old: 'HARBOR_PILOT_TOKEN 审批流试点 184 万',
    }),
    preferences: [RISK_PREF, COOK_PREF],
  });
  assert.ok(candidates.some((c) => /HARBOR_PILOT_TOKEN/.test(c.summary)));
  assert.ok(candidates.some((c) => /UNRELATED_COOKING_RECIPE/.test(c.summary)));
  assert.ok(candidates.some((c) => c.id === `preference:${RISK_PREF.eventId}`));
  assert.ok(candidates.some((c) => c.id === `preference:${COOK_PREF.eventId}`));
  assert.ok(candidates.some((c) => c.id === 'conversation:task_cook'));

  const selected = candidates
    .filter((c) => {
      const blob = `${c.title} ${c.summary}`;
      if (/家常|UNRELATED_COOKING_RECIPE|备菜清单|打印机/.test(blob)) return false;
      if (c.kind === 'preference') return c.eventId === RISK_PREF.eventId;
      return /HARBOR_PILOT_TOKEN|审批流|试点/.test(blob);
    })
    .map((c) => c.id);
  const resolved = resolveSelectedContextRefs(candidates, selected);
  assert.deepEqual(resolved.preferenceEventIds, [RISK_PREF.eventId]);
  assert.ok(resolved.artifactIds.includes('art_old'));
  assert.ok(!resolved.artifactIds.includes('art_cook'));
  assert.ok(!resolved.preferenceEventIds.includes(COOK_PREF.eventId));
});

test('planner/model bare ids still map onto preference and artifact candidates', () => {
  const t = task('task_old', '给财务写说明', { talk: true });
  const candidates = buildWorkContextCandidates({
    currentTaskId: 'now',
    tasks: [t],
    artifacts: [art('art_old', 'task_old', '财务说明')],
    readArtifactText: bodies({ art_old: '184 万' }),
    preferences: [RISK_PREF],
  });
  const resolved = resolveSelectedContextRefs(candidates, [RISK_PREF.eventId, 'art_old', t.id]);
  assert.deepEqual(resolved.preferenceEventIds, [RISK_PREF.eventId]);
  assert.ok(resolved.artifactIds.includes('art_old'));
  assert.ok(resolved.conversationTaskIds.includes(t.id));
});

test('preference lane is a bounded shortlist, not full dump', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    eventId: `gevt_p${i}`,
    title: `偏好 ${i}`,
    detail: `细节 ${i}`,
  }));
  const candidates = buildWorkContextCandidates({
    currentTaskId: 'now',
    tasks: [],
    artifacts: [],
    preferences: many,
  });
  assert.equal(countKind(candidates, 'preference'), CONTEXT_CANDIDATE_LANES.preference);
});

test('candidate brief groups sources; relevance is still the model, not 周报 regex', () => {
  const brief = formatContextCandidateBrief([
    {
      id: 'artifact:a',
      kind: 'artifact',
      title: '财务说明',
      summary: '184 万',
      taskId: 't1',
    },
    {
      id: `preference:${RISK_PREF.eventId}`,
      kind: 'preference',
      title: RISK_PREF.title,
      summary: RISK_PREF.detail,
      taskId: 'now',
      eventId: RISK_PREF.eventId,
    },
  ]);
  assert.match(brief, /已确认工作偏好/);
  assert.match(brief, /近期成果/);
  assert.doesNotMatch(brief, /周报|进展稿|对上/);
});

async function tempRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-subjcand-${prefix}-`));
}

function preferenceView(ids: string[]): ConfirmedExperienceView {
  const catalog = [RISK_PREF, COOK_PREF];
  return {
    subjectId: 'subj_test',
    derivedAt: nowIso(),
    entries: catalog
      .filter((p) => ids.includes(p.eventId))
      .map((p) => ({
        eventId: p.eventId,
        title: p.title,
        detail: p.detail,
        tags: ['category:working_method', 'preference'],
        occurredAt: nowIso(),
        kind: 'preference' as const,
      })),
  };
}

test('long session runtime: preference still a candidate and can freeze when AI selects it', async () => {
  const root = await tempRoot('long');
  let lastContext = '';
  const runtime = createWorkRuntime({
    rootDir: root,
    subjectId: 'subj_test',
    registerOpenAiStub: false,
    fakeAdapter: {
      delayMs: 5,
      onExecute: ({ input }) => {
        lastContext = JSON.stringify(input.subjectContext);
      },
    },
    loadSubjectPreferenceCandidates: async () => [RISK_PREF, COOK_PREF],
    resolveContextRelevance: async ({ candidates, goal }) => {
      if (!/进展|对上|管理层/.test(goal)) return { decided: true, selectedIds: [] };
      const relatedPref = candidates.filter((c) => c.eventId === RISK_PREF.eventId).map((c) => c.id);
      const relatedArts = candidates
        .filter((c) => c.kind === 'artifact' && !/家常|番茄|备菜/.test(`${c.title} ${c.summary}`))
        .slice(0, 3)
        .map((c) => c.id);
      return { decided: true, selectedIds: [...relatedArts, ...relatedPref] };
    },
    selectSubjectContext: async ({ relevantContextIds }) => {
      const includeRisk = (relevantContextIds || []).some((id) => id.includes(RISK_PREF.eventId));
      const includeCook = (relevantContextIds || []).some((id) => id.includes(COOK_PREF.eventId));
      const ids = [...(includeRisk ? [RISK_PREF.eventId] : []), ...(includeCook ? [COOK_PREF.eventId] : [])];
      const view = preferenceView(ids);
      return {
        subjectContext: view,
        freeze: buildSubjectContextFreeze({
          subjectId: view.subjectId,
          entries: view.entries.map((e) => ({
            eventId: e.eventId,
            kind: e.kind || 'preference',
            title: e.title,
            detail: e.detail,
            tags: e.tags,
            occurredAt: e.occurredAt,
          })),
          selectionReasons: view.entries.map((e) => ({
            eventId: e.eventId,
            reason: 'planner_selected' as const,
          })),
          excludedEventIds: [RISK_PREF.eventId, COOK_PREF.eventId].filter((id) => !ids.includes(id)),
        }),
      };
    },
  });
  await runtime.recoverOnStartup();
  runtime.start();
  try {
    for (let i = 0; i < 12; i++) {
      const submitted = await runtime.submitTask({
        goal: i === 2 ? '写一份番茄炒蛋家常做法' : `记下第 ${i} 条事务备忘`,
        contextRefs: [],
        requestedArtifactType: 'document',
      });
      const job = await waitForJobTerminal(runtime, submitted.jobId, 15_000);
      assert.equal(job.status, 'succeeded');
    }
    const open = await runtime.createConversationTask({
      goal: '给管理层写一版这个阶段的进展，开会能直接看。',
      contextRefs: [],
    });
    const candidates = await runtime.listContextCandidates(open.id);
    assert.ok(
      candidates.some((c) => c.id === `preference:${RISK_PREF.eventId}`),
      'related preference must remain a candidate in a long session',
    );
    assert.ok(
      candidates.some((c) => c.id === `preference:${COOK_PREF.eventId}`),
      'unrelated preference is listed for the model, not auto-frozen',
    );
    const now = nowIso();
    await runtime.updateTaskPlan(open.id, {
      version: 1,
      status: 'confirmed',
      content: '目标：进展备忘\n交付：文档',
      updatedAt: now,
      confirmedAt: now,
      source: 'model',
      semantic: {
        requiredCapabilities: ['document_synthesis'],
        requirements: ['按已确认工作方式组织'],
        relevantContextIds: [],
      },
    });
    lastContext = '';
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
    assert.ok(job.contextContinuity?.candidateIds?.includes(`preference:${RISK_PREF.eventId}`));
    assert.ok(job.contextContinuity?.selectedIds.includes(`preference:${RISK_PREF.eventId}`));
    assert.ok(job.contextContinuity?.freezeEventIds.includes(RISK_PREF.eventId));
    assert.ok(!job.contextContinuity?.freezeEventIds.includes(COOK_PREF.eventId));
    assert.match(lastContext, /先把卡点/);
    assert.doesNotMatch(lastContext, /备菜和家常做法/);
  } finally {
    runtime.stop();
  }
});
