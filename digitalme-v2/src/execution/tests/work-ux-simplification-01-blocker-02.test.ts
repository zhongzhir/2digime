/**
 * WORK-UX-SIMPLIFICATION-01-BLOCKER-02 — 项目推进 / 不采用路径 / 成果投影隔离
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ux = require('../../../electron/renderer/work-ux-stage.js') as {
  deriveWorkUxView: (facts: Record<string, unknown>) => {
    stage: string;
    actions: Array<{ id: string; label: string; slot: string; column: string }>;
    statusLine: string;
  };
  assertActionBudget: (view: {
    stage: string;
    actions: Array<{ id: string; label: string; slot: string; column: string }>;
  }) => { ok: boolean; errors: string[] };
};

const root = path.resolve(__dirname, '../../..');

describe('work-ux-simplification-01-blocker-02', () => {
  it('1-5 项目位置就绪后不得 needs_input；进入 capability/confirmation', () => {
    const created = ux.deriveWorkUxView({
      projectDirReady: true,
      projectFolderCard: false,
      executorSetupCard: true,
      modelReady: true,
    });
    assert.equal(created.stage, 'needs_capability');
    assert.equal(created.actions.find((a) => a.slot === 'primary')?.id, 'coding_connect');

    const selected = ux.deriveWorkUxView({
      projectDirReady: true,
      projectFolderCard: false,
      executionConfirmCard: true,
    });
    assert.equal(selected.stage, 'needs_confirmation');
    assert.equal(selected.actions.find((a) => a.slot === 'primary')?.id, 'confirm_execution');

    // 卡片残留但 projectDir 已就绪 → 不困在 needs_input
    const staleCard = ux.deriveWorkUxView({
      projectDirReady: true,
      projectFolderCard: true,
      executionConfirmCard: true,
    });
    assert.equal(staleCard.stage, 'needs_confirmation');

    const stillNeed = ux.deriveWorkUxView({
      projectDirReady: false,
      projectFolderCard: true,
    });
    assert.equal(stillNeed.stage, 'needs_input');
  });

  it('6-10 reject 不自动修订；派生 needs_revision；对话区继续', () => {
    const rejected = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'rejected',
      jobStatus: 'succeeded',
    });
    assert.equal(rejected.stage, 'needs_revision');
    assert.match(rejected.statusLine, /未采用|对话区/);
    assert.ok(!rejected.actions.some((a) => a.id === 'continue_revise' && a.slot === 'primary'));
    assert.ok(!rejected.actions.some((a) => a.id === 'reject'));
    assert.ok(!rejected.actions.some((a) => a.id === 'adopt_anyway'));
    assert.equal(ux.assertActionBudget(rejected).ok, true);

    const withComposer = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'rejected',
      revisionComposerOpen: true,
    });
    assert.equal(withComposer.actions.find((a) => a.slot === 'primary')?.id, 'submit_revision');
  });

  it('11-17 普通文档不进软件动作；预算与 restart', () => {
    const doc = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'undecided',
      codeChange: false,
      jobStatus: 'succeeded',
    });
    assert.equal(doc.stage, 'needs_review');
    assert.ok(!doc.actions.some((a) => a.id === 'open_project' || a.id === 'restore_baseline' || a.id === 'try_run'));

    const rebuilt = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'rejected',
    });
    assert.equal(rebuilt.stage, 'needs_revision');

    assert.equal(ux.assertActionBudget(doc).ok, true);
    assert.equal(ux.assertActionBudget(rebuilt).ok, true);
  });

  it('18-20 renderer：自动推进、reject 路径、投影隔离、BLOCKER-01 入口仍在', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    const stageJs = await fs.readFile(path.join(root, 'electron/renderer/work-ux-stage.js'), 'utf8');
    assert.match(appJs, /advanceAfterProjectLocationReady/);
    assert.match(appJs, /projectDirReady/);
    assert.match(appJs, /const prepared = pendingCreateProject/);
    assert.match(appJs, /resolveArtifactProjection/);
    assert.match(appJs, /isSoftwareExecutionTask|softwareExecIntent/);
    assert.match(appJs, /resetArtifactProjection/);
    assert.match(appJs, /这份成果未采用/);
    assert.match(appJs, /不自动 reviseArtifact|needs_revision/);
    assert.match(stageJs, /decisionStatus === 'rejected'/);
    assert.match(appJs, /function refreshWorkUxView/);
    // BLOCKER-01 机制保留
    assert.match(appJs, /hideArtifactLoading/);
    assert.match(appJs, /处理完成后将在这里显示成果/);
  });
});
