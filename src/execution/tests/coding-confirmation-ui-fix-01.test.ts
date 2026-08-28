/**
 * DIGITALME-CODING-CONFIRMATION-UI-FIX-01
 * Coding 规划就绪后必须对称恢复 #btn-start-development；
 * 文档自动推进 / 纯对话 / 已完成 / 过期 Task 不得显示错误确认按钮。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tw = require('../../../electron/renderer/task-workspace.js') as {
  startDevelopmentPresentation: (facts: object) => {
    visible: boolean;
    taskId: string | null;
    originTurnId: string | null;
  };
  deriveWorkspaceMode: (facts: object) => string;
};

const root = path.resolve(__dirname, '../../..');

function codingReady(extra?: Record<string, unknown>) {
  return {
    workMode: 'task',
    workspaceMode: 'planning',
    bindable: true,
    displayedTaskId: 'task_coding',
    detailTaskId: 'task_coding',
    taskId: 'task_coding',
    originTurnId: 'turn_origin',
    hasPlan: true,
    planSource: 'model',
    hasJob: false,
    hasArtifact: false,
    confirmationRequired: true,
    ...extra,
  };
}

describe('DIGITALME-CODING-CONFIRMATION-UI-FIX-01', () => {
  it('Coding planning pending → button hidden', () => {
    const pending = tw.startDevelopmentPresentation(
      codingReady({ hasPlan: false, workspaceMode: tw.deriveWorkspaceMode({ hasPlan: false }) }),
    );
    assert.equal(pending.visible, false);
    assert.equal(pending.taskId, null);
  });

  it('Coding planning ready + confirmation required → button visible with identity', () => {
    const ready = tw.startDevelopmentPresentation(codingReady());
    assert.equal(ready.visible, true);
    assert.equal(ready.taskId, 'task_coding');
    assert.equal(ready.originTurnId, 'turn_origin');
  });

  it('completed Coding Task → button hidden', () => {
    const done = tw.startDevelopmentPresentation(
      codingReady({
        hasJob: true,
        hasArtifact: true,
        workspaceMode: tw.deriveWorkspaceMode({
          hasPlan: true,
          jobStatus: 'succeeded',
          hasArtifact: true,
        }),
      }),
    );
    assert.equal(done.visible, false);
    assert.equal(done.taskId, null);
  });

  it('document/research auto task → 不显示 Coding start button', () => {
    const doc = tw.startDevelopmentPresentation(codingReady({ confirmationRequired: false }));
    assert.equal(doc.visible, false);
  });

  it('stale Task callback → 不污染当前 Task button', () => {
    const stale = tw.startDevelopmentPresentation(
      codingReady({
        displayedTaskId: 'task_current',
        detailTaskId: 'task_stale',
        taskId: 'task_stale',
        originTurnId: 'turn_stale',
      }),
    );
    assert.equal(stale.visible, false);
    assert.equal(stale.taskId, null);
  });

  it('compose / missing origin → hidden', () => {
    assert.equal(tw.startDevelopmentPresentation(codingReady({ workMode: 'compose' })).visible, false);
    assert.equal(tw.startDevelopmentPresentation(codingReady({ originTurnId: '' })).visible, false);
    assert.equal(tw.startDevelopmentPresentation(codingReady({ bindable: false })).visible, false);
    assert.equal(
      tw.startDevelopmentPresentation(codingReady({ planSource: 'seed_internal' })).visible,
      false,
    );
  });

  it('app.js：enterCompose hide 与 planning ready show 对称；点击走当前 identity', async () => {
    const app = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(app, /function setStartDevelopmentVisible/);
    assert.match(app, /function taskNeedsUserPlanConfirmation/);
    assert.match(app, /bindStartButton\(null, null\);\s*setStartDevelopmentVisible\(false\)/s);
    assert.match(app, /startDevelopmentPresentation/);
    assert.match(app, /setStartDevelopmentVisible\(showStart\)/);
    assert.match(app, /kind === "folder"/);
    assert.match(app, /if \(refs\.some\(\(m\) => m && m\.kind === "folder"\)\) return;/);
    assert.match(app, /confirmPlanAndStartDevelopment\(bound\)/);
    assert.match(app, /dataset && els\.startDevelopment\.dataset\.taskId/);
    assert.match(app, /payload\.workUnit = "confirm"/);
  });
});
