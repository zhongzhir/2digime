/**
 * BLOCKER-07 — 采用与可运行两维组合状态。
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import type { ExecutionJob } from '../../work-runtime/execution-job';
import type { Artifact } from '../../work-runtime/artifact';
import type { Task } from '../../work-runtime/task';
import {
  ADOPTED_CAN_TRY_LABEL,
  ADOPTED_NEEDS_FIX_LABEL,
  ADOPTED_UNVERIFIED_LABEL,
  TRY_RUN_LABEL,
  EXEC_FAILED_LABEL,
  deriveRunAvailability,
  deriveTaskDisplayState,
  sortTasksByActivityTime,
} from '../../work-runtime/task-display-state';
import { NEEDS_REVISION_LABEL, userFacingLabelFromLatestJob } from '../../work-runtime/derive';

const root = path.resolve(__dirname, '../../..');

function task(partial: Partial<Task> & Pick<Task, 'id' | 'goal'>): Task {
  return {
    subjectId: 'subj',
    createdAt: '2026-08-07T07:00:00.000Z',
    contextRefs: [],
    requestedArtifactType: 'code-change',
    ...partial,
  };
}

function job(
  partial: Partial<ExecutionJob> & Pick<ExecutionJob, 'id' | 'taskId' | 'status' | 'createdAt'>,
): ExecutionJob {
  return {
    capabilityId: 'external-executor-codex',
    ...partial,
  };
}

function art(
  partial: Partial<Artifact> & Pick<Artifact, 'id' | 'taskId' | 'createdAt'>,
): Artifact {
  return {
    jobId: 'job_x',
    subjectId: 'subj',
    type: 'code-change',
    title: 'code',
    storageDir: '/tmp',
    headVersionId: 'ver_1',
    versions: [
      {
        versionId: 'ver_1',
        createdAt: partial.createdAt,
        author: 'capability',
        content: { kind: 'text', format: 'markdown', ref: 'x' },
      },
    ],
    ...partial,
  };
}

const succeededJobs = [
  job({
    id: 'j1',
    taskId: 't1',
    status: 'succeeded',
    createdAt: '2026-08-07T08:00:00.000Z',
    artifactId: 'a1',
  }),
];

describe('software-dev-blocker-07', () => {
  it('adopted + startup satisfied + 验收通过 → 已采用 · 可以试用', () => {
    const d = deriveTaskDisplayState({
      task: task({ id: 't1', goal: 'g' }),
      jobsForTask: succeededJobs,
      artifacts: [art({ id: 'a1', taskId: 't1', createdAt: '2026-08-07T08:00:00.000Z' })],
      softwareOutcome: {
        isCodeChange: true,
        ownerDecision: 'accepted',
        startupCheckVerdict: 'satisfied',
        canSuggestTryRun: true,
        verificationOverall: 'satisfied',
        canAdoptSuggested: true,
      },
    });
    assert.equal(d.label, ADOPTED_CAN_TRY_LABEL);
  });

  it('adopted + startup failed → 已采用 · 仍需修复', () => {
    const d = deriveTaskDisplayState({
      task: task({ id: 't1', goal: 'g' }),
      jobsForTask: succeededJobs,
      artifacts: [art({ id: 'a1', taskId: 't1', createdAt: '2026-08-07T08:00:00.000Z' })],
      softwareOutcome: {
        isCodeChange: true,
        ownerDecision: 'accepted',
        startupCheckVerdict: 'unsatisfied',
        canSuggestTryRun: false,
      },
    });
    assert.equal(d.label, ADOPTED_NEEDS_FIX_LABEL);
  });

  it('adopted + startup unknown → 已采用 · 尚未验证', () => {
    const d = deriveTaskDisplayState({
      task: task({ id: 't1', goal: 'g' }),
      jobsForTask: succeededJobs,
      artifacts: [art({ id: 'a1', taskId: 't1', createdAt: '2026-08-07T08:00:00.000Z' })],
      softwareOutcome: {
        isCodeChange: true,
        ownerDecision: 'accepted',
      },
    });
    assert.equal(d.label, ADOPTED_UNVERIFIED_LABEL);
  });

  it('adopted + startup satisfied 但验收 partial → 仍需修复（不覆盖为仅已采用）', () => {
    const d = deriveTaskDisplayState({
      task: task({ id: 't1', goal: '俄罗斯方块网页' }),
      jobsForTask: succeededJobs,
      artifacts: [art({ id: 'a1', taskId: 't1', createdAt: '2026-08-07T08:21:00.000Z' })],
      softwareOutcome: {
        isCodeChange: true,
        ownerDecision: 'accepted',
        startupCheckVerdict: 'satisfied',
        canSuggestTryRun: true,
        verificationOverall: 'partially_satisfied',
        canAdoptSuggested: false,
      },
    });
    assert.equal(d.label, ADOPTED_NEEDS_FIX_LABEL);
    assert.notEqual(d.label, '已采用');
  });

  it('未采用 + startup satisfied → 可以试用', () => {
    const d = deriveTaskDisplayState({
      task: task({ id: 't1', goal: 'g' }),
      jobsForTask: succeededJobs,
      artifacts: [art({ id: 'a1', taskId: 't1', createdAt: '2026-08-07T08:00:00.000Z' })],
      softwareOutcome: {
        isCodeChange: true,
        startupCheckVerdict: 'satisfied',
        canSuggestTryRun: true,
        verificationOverall: 'satisfied',
        canAdoptSuggested: true,
      },
    });
    assert.equal(d.label, TRY_RUN_LABEL);
  });

  it('未采用 + partial → 建议继续修改', () => {
    const d = deriveTaskDisplayState({
      task: task({ id: 't1', goal: 'g' }),
      jobsForTask: succeededJobs,
      artifacts: [art({ id: 'a1', taskId: 't1', createdAt: '2026-08-07T08:00:00.000Z' })],
      softwareOutcome: {
        isCodeChange: true,
        verificationOverall: 'partially_satisfied',
        canAdoptSuggested: false,
      },
    });
    assert.equal(d.label, NEEDS_REVISION_LABEL);
  });

  it('adoption 不覆盖 startup / acceptance 运行事实', () => {
    assert.equal(
      deriveRunAvailability({
        isCodeChange: true,
        ownerDecision: 'accepted',
        startupCheckVerdict: 'satisfied',
        verificationOverall: 'partially_satisfied',
        canAdoptSuggested: false,
      }),
      'needs_fix',
    );
    assert.equal(
      deriveRunAvailability({
        isCodeChange: true,
        ownerDecision: 'accepted',
        startupCheckVerdict: 'satisfied',
        verificationOverall: 'satisfied',
        canAdoptSuggested: true,
      }),
      'can_try',
    );
  });

  it('list 标签与 userFacingLabelFromLatestJob 组合规则一致', () => {
    const soft = {
      isCodeChange: true as const,
      ownerDecision: 'accepted' as const,
      startupCheckVerdict: 'satisfied',
      canSuggestTryRun: true,
      verificationOverall: 'partially_satisfied',
      canAdoptSuggested: false,
    };
    assert.equal(userFacingLabelFromLatestJob(succeededJobs, { softwareOutcome: soft }), ADOPTED_NEEDS_FIX_LABEL);
  });

  it('失败任务仍为执行失败', () => {
    const d = deriveTaskDisplayState({
      task: task({ id: 'tf', goal: '方块' }),
      jobsForTask: [
        job({
          id: 'jf',
          taskId: 'tf',
          status: 'failed',
          createdAt: '2026-08-07T07:24:00.000Z',
        }),
      ],
      artifacts: [],
    });
    assert.equal(d.label, EXEC_FAILED_LABEL);
  });

  it('排序不回归：activityTime 倒序', () => {
    const sorted = sortTasksByActivityTime([
      { taskId: 'old', activityTime: '2026-08-07T07:00:00.000Z' },
      { taskId: 'new', activityTime: '2026-08-07T08:22:00.000Z' },
      { taskId: 'mid', activityTime: '2026-08-07T07:33:00.000Z' },
    ]);
    assert.deepEqual(
      sorted.map((x) => x.taskId),
      ['new', 'mid', 'old'],
    );
  });

  it('UI 仍按 taskId 定点更新且含组合态文案常量', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    const display = await fs.readFile(
      path.join(root, 'src/work-runtime/task-display-state.ts'),
      'utf8',
    );
    assert.match(appJs, /updateTaskListItemLabel/);
    assert.match(appJs, /data-task-id/);
    assert.match(display, /ADOPTED_NEEDS_FIX_LABEL/);
    assert.match(display, /ADOPTED_CAN_TRY_LABEL/);
    assert.match(display, /deriveRunAvailability/);
  });
});
