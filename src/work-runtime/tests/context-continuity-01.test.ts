/**
 * DIGITALME-CONTEXT-CONTINUITY-01
 * available context → candidate discovery → AI relevance → freeze → executor
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWorkRuntime } from '../create-runtime';
import { waitForJobTerminal } from '../job-runner';
import {
  buildWorkContextCandidates,
  mergeSelectedContextIds,
  resolveSelectedContextRefs,
} from '../context-candidates';
import {
  parseContextRelevanceOutput,
  buildContextRelevanceMessages,
} from '../context-relevance';
import { nowIso } from '../../shared/ids';
import { buildSubjectContextFreeze } from '../../subject-core/subject-context-freeze';
import type { ConfirmedExperienceView } from '../../subject-core/derived-views';

async function tempRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-ctxcont-${prefix}-`));
}

const PREF = {
  eventId: 'gevt_pref_risk_first',
  title: '给上级材料先写卡点和不确定项',
  detail: '写给上级的材料先把卡点、不确定项写清楚，建议放后面，不要先报喜。',
};

function preferenceView(include: boolean): ConfirmedExperienceView {
  return {
    subjectId: 'subj_test',
    derivedAt: nowIso(),
    entries: include
      ? [
          {
            eventId: PREF.eventId,
            title: PREF.title,
            detail: PREF.detail,
            tags: ['category:working_method', 'preference'],
            occurredAt: nowIso(),
            kind: 'preference',
          },
        ]
      : [],
  };
}

test('relevance parser only accepts allowed candidate ids', () => {
  const ids = parseContextRelevanceOutput(
    '{"relevantContextIds":["artifact:a","preference:p","artifact:unknown"]}',
    ['artifact:a', 'preference:p'],
  );
  assert.deepEqual(ids, ['artifact:a', 'preference:p']);
  assert.deepEqual(parseContextRelevanceOutput('not json', ['artifact:a']), []);
});

test('relevance prompt is referent resolution, not keyword routing', () => {
  const messages = buildContextRelevanceMessages({
    goal: '接着把刚才那份收成能对外讲的一页',
    candidates: [
      {
        id: 'artifact:art1',
        kind: 'artifact',
        title: '财务说明',
        summary: '试点预算 184 万',
        taskId: 'task_a',
      },
    ],
  });
  const blob = messages.map((m) => m.content).join('\n');
  assert.match(blob, /指代/);
  assert.doesNotMatch(blob, /下一步最该先啃/);
  assert.doesNotMatch(blob, /这件事情/);
  assert.doesNotMatch(blob, /和上次一样/);
});

test('A: recent-work referent — prior deliverable is a candidate and executor receives it', async () => {
  const root = await tempRoot('a');
  const notes = path.join(root, 'harbor-notes.md');
  await fs.writeFile(notes, 'HARBOR_PILOT_TOKEN：审批流试点预算 184 万，不搬机房。', 'utf8');
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
    resolveContextRelevance: async ({ candidates }) => ({
      decided: true,
      selectedIds: candidates
        .filter((c) => /HARBOR_PILOT_TOKEN|审批流/.test(`${c.title} ${c.summary}`))
        .map((c) => c.id),
    }),
  });
  await runtime.recoverOnStartup();
  runtime.start();
  try {
    const first = await runtime.submitTask({
      goal: '根据纪要写一封给财务的说明',
      contextRefs: [{ kind: 'file', path: notes }],
      requestedArtifactType: 'document',
    });
    const jobA = await waitForJobTerminal(runtime, first.jobId, 15_000);
    assert.equal(jobA.status, 'succeeded');

    const follow = await runtime.createConversationTask({
      goal: '接着把刚才那份收成能对外讲的一页。',
      contextRefs: [],
    });
    const candidates = await runtime.listContextCandidates(follow.id);
    const prior = candidates.find((c) => /HARBOR_PILOT_TOKEN|财务/.test(`${c.title} ${c.summary}`));
    assert.ok(prior, 'recent completed work must be discoverable without restating the project name');

    const now = nowIso();
    await runtime.updateTaskPlan(follow.id, {
      version: 1,
      status: 'confirmed',
      content: '目标：对外一页\n交付：文档',
      updatedAt: now,
      confirmedAt: now,
      source: 'model',
      semantic: {
        requiredCapabilities: ['document_synthesis'],
        requirements: ['使用已有相关项目上下文'],
        relevantContextIds: [],
      },
    });
    lastSnippets = [];
    const submitted = await runtime.submitTask({
      existingTaskId: follow.id,
      goal: follow.goal,
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'create_document',
      confirmedPlanVersion: 1,
    });
    const job = await waitForJobTerminal(runtime, submitted.jobId, 15_000);
    assert.equal(job.status, 'succeeded');
    assert.match(lastSnippets.join('\n'), /HARBOR_PILOT_TOKEN/);
    assert.ok(job.contextContinuity?.selectedIds.some((id) => id.startsWith('artifact:')));
    assert.ok((job.contextContinuity?.attachedRefs || []).some((r) => r.startsWith('historical-artifact:')));
  } finally {
    runtime.stop();
  }
});

test('B: never-seen natural phrasing still selects related context', async () => {
  const root = await tempRoot('b');
  const notes = path.join(root, 'harbor-notes.md');
  await fs.writeFile(notes, 'HARBOR_PILOT_TOKEN：苏州园区继续用现有机房。', 'utf8');
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
    resolveContextRelevance: async ({ candidates, goal }) => {
      assert.match(goal, /开场能直接讲/);
      return {
        decided: true,
        selectedIds: candidates
          .filter((c) => /HARBOR_PILOT_TOKEN|机房/.test(`${c.title} ${c.summary}`))
          .map((c) => c.id),
      };
    },
  });
  await runtime.recoverOnStartup();
  runtime.start();
  try {
    const first = await runtime.submitTask({
      goal: '根据纪要写财务说明',
      contextRefs: [{ kind: 'file', path: notes }],
      requestedArtifactType: 'document',
    });
    await waitForJobTerminal(runtime, first.jobId, 15_000);
    const follow = await runtime.createConversationTask({
      goal: '开场能直接讲的那种，帮我收一版。',
      contextRefs: [],
    });
    const now = nowIso();
    await runtime.updateTaskPlan(follow.id, {
      version: 1,
      status: 'confirmed',
      content: '目标：开场一版\n交付：文档',
      updatedAt: now,
      confirmedAt: now,
      source: 'model',
      semantic: {
        requiredCapabilities: ['document_synthesis'],
        requirements: ['使用已有相关项目上下文'],
        relevantContextIds: [],
      },
    });
    const submitted = await runtime.submitTask({
      existingTaskId: follow.id,
      goal: follow.goal,
      contextRefs: [],
      requestedArtifactType: 'document',
      intentKind: 'create_document',
      confirmedPlanVersion: 1,
    });
    const job = await waitForJobTerminal(runtime, submitted.jobId, 15_000);
    assert.equal(job.status, 'succeeded');
    assert.match(lastSnippets.join('\n'), /HARBOR_PILOT_TOKEN/);
  } finally {
    runtime.stop();
  }
});

test('C: preference candidate → selection → freeze → executor', async () => {
  const root = await tempRoot('c');
  let lastContext = '';
  const runtime = createWorkRuntime({
    rootDir: root,
    subjectId: 'subj_test',
    registerOpenAiStub: false,
    fakeAdapter: {
      onExecute: ({ input }) => {
        lastContext = JSON.stringify(input.subjectContext);
      },
    },
    loadSubjectPreferenceCandidates: async () => [PREF],
    resolveContextRelevance: async ({ candidates }) => ({
      decided: true,
      selectedIds: candidates.filter((c) => c.kind === 'preference').map((c) => c.id),
    }),
    selectSubjectContext: async ({ relevantContextIds }) => {
      const include = (relevantContextIds || []).some((id) => id.includes(PREF.eventId));
      const view = preferenceView(include);
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
          excludedEventIds: include ? [] : [PREF.eventId],
        }),
      };
    },
  });
  await runtime.recoverOnStartup();
  runtime.start();
  try {
    const open = await runtime.createConversationTask({
      goal: '写一份给董事会的月度进展备忘。',
      contextRefs: [],
    });
    const candidates = await runtime.listContextCandidates(open.id);
    assert.ok(candidates.some((c) => c.id === `preference:${PREF.eventId}`));
    const now = nowIso();
    await runtime.updateTaskPlan(open.id, {
      version: 1,
      status: 'confirmed',
      content: '目标：月度备忘\n交付：文档',
      updatedAt: now,
      confirmedAt: now,
      source: 'model',
      semantic: {
        requiredCapabilities: ['document_synthesis'],
        requirements: ['按已确认工作方式组织'],
        relevantContextIds: [],
      },
    });
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
    assert.ok(job.contextContinuity?.selectedIds.includes(`preference:${PREF.eventId}`));
    assert.ok(job.contextContinuity?.freezeEventIds.includes(PREF.eventId));
    assert.match(lastContext, /先把卡点/);
  } finally {
    runtime.stop();
  }
});

test('D: competing context — related history + preference, not the latest unrelated project', async () => {
  const root = await tempRoot('d');
  const related = path.join(root, 'related.md');
  const unrelated = path.join(root, 'unrelated.md');
  await fs.writeFile(related, 'HARBOR_PILOT_TOKEN：审批流试点。', 'utf8');
  await fs.writeFile(unrelated, 'UNRELATED_COOKING_RECIPE：先炒洋葱。', 'utf8');
  let lastBlob = '';
  const runtime = createWorkRuntime({
    rootDir: root,
    subjectId: 'subj_test',
    registerOpenAiStub: false,
    fakeAdapter: {
      onExecute: ({ input, materialSnippets }) => {
        lastBlob = `${materialSnippets.join('\n')}\n${JSON.stringify(input.subjectContext)}`;
      },
    },
    loadSubjectPreferenceCandidates: async () => [PREF],
    resolveContextRelevance: async ({ candidates, goal }) => {
      if (!/对外讲|收一页/.test(goal)) {
        return { decided: false, selectedIds: [] };
      }
      return {
        decided: true,
        selectedIds: candidates
          .filter((c) => {
            const blob = `${c.title} ${c.summary}`;
            if (/家常菜|UNRELATED_COOKING_RECIPE/.test(blob)) return false;
            return (
              c.kind === 'preference' || /HARBOR_PILOT_TOKEN|审批流/.test(blob)
            );
          })
          .map((c) => c.id),
      };
    },
    selectSubjectContext: async ({ relevantContextIds }) => {
      const include = (relevantContextIds || []).some((id) => id.includes(PREF.eventId));
      const view = preferenceView(include);
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
          excludedEventIds: include ? [] : [PREF.eventId],
        }),
      };
    },
  });
  await runtime.recoverOnStartup();
  runtime.start();
  try {
    const a = await runtime.submitTask({
      goal: '整理试点纪要',
      contextRefs: [{ kind: 'file', path: related }],
      requestedArtifactType: 'document',
    });
    await waitForJobTerminal(runtime, a.jobId, 15_000);
    const b = await runtime.submitTask({
      goal: '写一份家常菜步骤',
      contextRefs: [{ kind: 'file', path: unrelated }],
      requestedArtifactType: 'document',
    });
    await waitForJobTerminal(runtime, b.jobId, 15_000);

    const open = await runtime.createConversationTask({
      goal: '把试点这边能对外讲的进展收一页。',
      contextRefs: [],
    });
    const candidates = await runtime.listContextCandidates(open.id);
    const relatedCand = candidates.find((c) => /HARBOR_PILOT_TOKEN|试点/.test(`${c.title} ${c.summary}`));
    const cookingCand = candidates.find((c) => /UNRELATED_COOKING_RECIPE|家常菜/.test(`${c.title} ${c.summary}`));
    const prefCand = candidates.find((c) => c.id === `preference:${PREF.eventId}`);
    assert.ok(relatedCand);
    assert.ok(cookingCand);
    assert.ok(prefCand);

    const now = nowIso();
    await runtime.updateTaskPlan(open.id, {
      version: 1,
      status: 'confirmed',
      content: '目标：试点进展一页\n交付：文档',
      updatedAt: now,
      confirmedAt: now,
      source: 'model',
      semantic: {
        requiredCapabilities: ['document_synthesis'],
        requirements: ['使用相关项目上下文'],
        relevantContextIds: [],
      },
    });
    lastBlob = '';
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
    assert.match(lastBlob, /HARBOR_PILOT_TOKEN/);
    assert.doesNotMatch(lastBlob, /UNRELATED_COOKING_RECIPE/);
    assert.match(lastBlob, /先把卡点/);
    assert.ok(!job.contextContinuity?.selectedIds.includes(cookingCand!.id));
    assert.ok(job.contextContinuity?.freezeEventIds.includes(PREF.eventId));
  } finally {
    runtime.stop();
  }
});

test('discovery and merge helpers stay bounded', () => {
  const candidates = buildWorkContextCandidates({
    currentTaskId: 'task_now',
    tasks: [
      {
        id: 'task_old',
        subjectId: 's',
        createdAt: nowIso(),
        goal: '写财务说明',
        contextRefs: [],
        requestedArtifactType: 'document',
        meta: {
          conversation: {
            turns: [
              {
                turnId: 't1',
                role: 'user',
                content: '根据纪要写财务说明',
                createdAt: nowIso(),
              },
            ],
            intents: [],
          },
        },
      },
    ],
    artifacts: [],
    preferences: [PREF],
  });
  assert.ok(candidates.some((c) => c.kind === 'conversation'));
  assert.ok(candidates.some((c) => c.kind === 'preference'));
  const resolved = resolveSelectedContextRefs(candidates, [`preference:${PREF.eventId}`]);
  assert.deepEqual(resolved.preferenceEventIds, [PREF.eventId]);
  assert.deepEqual(mergeSelectedContextIds(['artifact:a'], ['preference:p']), ['preference:p']);
  assert.deepEqual(mergeSelectedContextIds(['artifact:a'], []), ['artifact:a']);
});
