/**
 * BLOCKER-06 — TaskDisplayState 稳定派生、排序与竞态防护。
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import type { ExecutionJob } from '../../work-runtime/execution-job';
import type { Artifact } from '../../work-runtime/artifact';
import type { Task } from '../../work-runtime/task';
import {
  TRY_RUN_LABEL,
  EXEC_FAILED_LABEL,
  NEEDS_PROJECT_LABEL,
  computeTaskActivityTime,
  deriveTaskDisplayState,
  resolveTaskProjectDir,
  sortTasksByActivityTime,
} from '../../work-runtime/task-display-state';
import { NEEDS_REVISION_LABEL } from '../../work-runtime/derive';

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

describe('software-dev-blocker-06', () => {
  it('四个不同状态 Task 派生稳定且互不串扰', () => {
    const failedA = deriveTaskDisplayState({
      task: task({
        id: 't_fail_a',
        goal: '俄罗斯方块',
        createdAt: '2026-08-07T07:24:00.000Z',
        contextRefs: [{ kind: 'folder', path: 'C:\\a' }],
      }),
      jobsForTask: [
        job({
          id: 'j1',
          taskId: 't_fail_a',
          status: 'failed',
          createdAt: '2026-08-07T07:24:50.000Z',
          externalExecution: { workingDirectory: 'C:\\a', executorId: 'x', readScope: [], writeScope: [] },
        }),
      ],
      artifacts: [],
      softwareOutcome: { isCodeChange: true },
    });
    const failedB = deriveTaskDisplayState({
      task: task({
        id: 't_fail_b',
        goal: '俄罗斯方块',
        createdAt: '2026-08-07T07:25:00.000Z',
        contextRefs: [{ kind: 'folder', path: 'C:\\b' }],
      }),
      jobsForTask: [
        job({
          id: 'j2',
          taskId: 't_fail_b',
          status: 'failed',
          createdAt: '2026-08-07T07:26:00.000Z',
          externalExecution: { workingDirectory: 'C:\\b', executorId: 'x', readScope: [], writeScope: [] },
        }),
      ],
      artifacts: [],
    });
    const needsFix = deriveTaskDisplayState({
      task: task({
        id: 't_fix',
        goal: '俄罗斯方块',
        createdAt: '2026-08-07T07:27:00.000Z',
      }),
      jobsForTask: [
        job({
          id: 'j3',
          taskId: 't_fix',
          status: 'succeeded',
          createdAt: '2026-08-07T07:30:00.000Z',
          artifactId: 'art_fix',
          externalExecution: { workingDirectory: 'D:\\wrong', executorId: 'x', readScope: [], writeScope: [] },
        }),
      ],
      artifacts: [art({ id: 'art_fix', taskId: 't_fix', createdAt: '2026-08-07T07:33:00.000Z' })],
      softwareOutcome: {
        isCodeChange: true,
        verificationOverall: 'partially_satisfied',
        canAdoptSuggested: false,
        canSuggestTryRun: false,
      },
    });
    const canTry = deriveTaskDisplayState({
      task: task({
        id: 't_try',
        goal: '俄罗斯方块网页',
        createdAt: '2026-08-07T08:11:00.000Z',
        contextRefs: [
          {
            kind: 'folder',
            path: 'C:\\game',
            projectOrigin: 'digitalme_created',
          },
        ],
      }),
      jobsForTask: [
        job({
          id: 'j4',
          taskId: 't_try',
          status: 'succeeded',
          createdAt: '2026-08-07T08:19:00.000Z',
          artifactId: 'art_try',
          externalExecution: {
            workingDirectory: 'C:\\game',
            executorId: 'x',
            readScope: [],
            writeScope: [],
            projectOrigin: 'digitalme_created',
          },
        }),
      ],
      artifacts: [art({ id: 'art_try', taskId: 't_try', createdAt: '2026-08-07T08:21:00.000Z' })],
      softwareOutcome: {
        isCodeChange: true,
        verificationOverall: 'satisfied',
        canAdoptSuggested: true,
        startupCheckVerdict: 'satisfied',
        canSuggestTryRun: true,
      },
    });

    assert.equal(failedA.label, EXEC_FAILED_LABEL);
    assert.equal(failedB.label, EXEC_FAILED_LABEL);
    assert.equal(needsFix.label, NEEDS_REVISION_LABEL);
    assert.equal(canTry.label, TRY_RUN_LABEL);
    assert.notEqual(failedA.label, canTry.label);
    assert.equal(canTry.displayId, 'can_try_run');
  });

  it('无 projectDir 才显示项目位置问题；有目录的失败任务不显示', () => {
    const noDir = deriveTaskDisplayState({
      task: task({ id: 't0', goal: '改代码', createdAt: '2026-08-07T07:00:00.000Z' }),
      jobsForTask: [],
      artifacts: [],
      treatMissingProjectAsNeedsProject: true,
    });
    assert.equal(noDir.label, NEEDS_PROJECT_LABEL);
    const withDir = deriveTaskDisplayState({
      task: task({
        id: 't1',
        goal: '改代码',
        createdAt: '2026-08-07T07:00:00.000Z',
        contextRefs: [{ kind: 'folder', path: 'C:\\proj' }],
      }),
      jobsForTask: [
        job({
          id: 'jf',
          taskId: 't1',
          status: 'failed',
          createdAt: '2026-08-07T07:01:00.000Z',
          externalExecution: {
            workingDirectory: 'C:\\proj',
            executorId: 'x',
            readScope: [],
            writeScope: [],
          },
        }),
      ],
      artifacts: [],
      treatMissingProjectAsNeedsProject: true,
    });
    assert.equal(withDir.label, EXEC_FAILED_LABEL);
    assert.equal(
      resolveTaskProjectDir(
        task({
          id: 't1',
          goal: 'x',
          contextRefs: [{ kind: 'folder', path: 'C:\\proj' }],
        }),
        [],
      ),
      'C:\\proj',
    );
  });

  it('最近活动排序：revision/adopt 可置顶；单纯查看不改 activityTime', () => {
    const baseTask = task({
      id: 't_old',
      goal: '旧',
      createdAt: '2026-08-07T07:00:00.000Z',
    });
    const jobs = [
      job({
        id: 'j_old',
        taskId: 't_old',
        status: 'succeeded',
        createdAt: '2026-08-07T07:10:00.000Z',
        artifactId: 'a1',
      }),
    ];
    const artifacts = [art({ id: 'a1', taskId: 't_old', createdAt: '2026-08-07T07:10:00.000Z' })];
    const before = computeTaskActivityTime({ task: baseTask, jobsForTask: jobs, artifacts });
    const afterView = computeTaskActivityTime({ task: baseTask, jobsForTask: jobs, artifacts });
    assert.equal(before, afterView);

    const afterRev = computeTaskActivityTime({
      task: baseTask,
      jobsForTask: [
        ...jobs,
        job({
          id: 'j_rev',
          taskId: 't_old',
          status: 'succeeded',
          createdAt: '2026-08-07T09:00:00.000Z',
          artifactId: 'a1',
          revisionRequest: 'fix',
        }),
      ],
      artifacts,
    });
    assert.ok(afterRev > before);

    const afterAdopt = computeTaskActivityTime({
      task: baseTask,
      jobsForTask: jobs,
      artifacts,
      decisionDecidedAt: '2026-08-07T09:30:00.000Z',
    });
    assert.ok(afterAdopt > before);

    const sorted = sortTasksByActivityTime([
      { taskId: 'a', activityTime: '2026-08-07T07:00:00.000Z' },
      { taskId: 'b', activityTime: '2026-08-07T08:21:00.000Z' },
      { taskId: 'c', activityTime: '2026-08-07T07:33:00.000Z' },
    ]);
    assert.deepEqual(
      sorted.map((x) => x.taskId),
      ['b', 'c', 'a'],
    );
  });

  it('已采用不覆盖可以试用：组合为已采用 · 可以试用', () => {
    const d = deriveTaskDisplayState({
      task: task({ id: 't', goal: 'g', createdAt: '2026-08-07T08:00:00.000Z' }),
      jobsForTask: [
        job({
          id: 'j',
          taskId: 't',
          status: 'succeeded',
          createdAt: '2026-08-07T08:01:00.000Z',
          artifactId: 'a',
        }),
      ],
      artifacts: [art({ id: 'a', taskId: 't', createdAt: '2026-08-07T08:01:00.000Z' })],
      softwareOutcome: {
        isCodeChange: true,
        ownerDecision: 'accepted',
        canSuggestTryRun: true,
        startupCheckVerdict: 'satisfied',
        verificationOverall: 'satisfied',
        canAdoptSuggested: true,
      },
    });
    assert.equal(d.label, '已采用 · 可以试用');
    assert.equal(d.displayId, 'adopted_can_try');
  });

  it('UI 竞态防护与列表按 taskId 定点更新', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(appJs, /updateTaskListItemLabel/);
    assert.match(appJs, /data-task-id/);
    assert.match(appJs, /data-task-state/);
    assert.match(appJs, /正在打开任务/);
    assert.match(appJs, /activeCodeChangeRunInfo = null/);
    assert.match(appJs, /activeAcceptanceSummary = null/);
    assert.match(appJs, /epoch !== uiEpoch \|\| activeTaskId !== taskId/);
    assert.match(appJs, /inspectSoftwareProject/);
    // 切换时先清材料，避免残留
    assert.match(appJs, /materials = \[\]/);
    assert.match(appJs, /clearJobChrome\(\)/);
  });

  it('listTasks/getTask 使用 TaskDisplayState 与 activityTime 排序', async () => {
    const runner = await fs.readFile(path.join(root, 'src/work-runtime/job-runner.ts'), 'utf8');
    const display = await fs.readFile(
      path.join(root, 'src/work-runtime/task-display-state.ts'),
      'utf8',
    );
    assert.match(runner, /deriveTaskDisplayState/);
    assert.match(runner, /sortTasksByActivityTime/);
    assert.match(runner, /startupCheckVerdict/);
    assert.match(runner, /canSuggestTryRun/);
    assert.match(display, /TRY_RUN_LABEL/);
    assert.match(display, /computeTaskActivityTime/);
  });

  it('task/artifact isolation 不回归', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(appJs, /expectedTaskId/);
    assert.match(appJs, /artifactTaskId/);
    assert.match(appJs, /bumpUiEpoch/);
  });
});
