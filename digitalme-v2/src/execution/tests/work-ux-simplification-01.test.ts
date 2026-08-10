/**
 * WORK-UX-SIMPLIFICATION-01 — 动作预算与阶段派生回归
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
  hasInternalLeak: (text: string) => boolean;
};

const root = path.resolve(__dirname, '../../..');

describe('work-ux-simplification-01', () => {
  it('每阶段主动作≤1、次动作≤2', () => {
    const samples = [
      { workMode: 'compose' },
      { projectFolderCard: true },
      { projectCreateConfirm: true },
      { executorSetupCard: true, modelReady: true },
      { modelReady: false },
      { executionConfirmCard: true },
      { jobStatus: 'running', jobCancelSupported: true },
      { hasArtifact: true, decisionStatus: 'undecided', canAdoptSuggested: true, jobStatus: 'succeeded' },
      { hasArtifact: true, decisionStatus: 'undecided', canAdoptSuggested: false, jobStatus: 'succeeded' },
      { adoptWarningOpen: true, canAdoptSuggested: false, hasArtifact: true },
      { hasArtifact: true, decisionStatus: 'rejected', jobStatus: 'succeeded' },
      { decisionStatus: 'accepted', canTryRun: true, codeChange: true, hasWorkingDirectory: true },
      { decisionStatus: 'accepted', startupFailed: true, codeChange: true, hasWorkingDirectory: true },
      { jobStatus: 'failed' },
      { jobStatus: 'cancelled' },
      { hasArtifact: true, decisionStatus: 'undecided', codeChange: false },
    ];
    for (const facts of samples) {
      const view = ux.deriveWorkUxView(facts);
      const check = ux.assertActionBudget(view);
      assert.equal(check.ok, true, `${view.stage} ${JSON.stringify(check.errors)} ${JSON.stringify(facts)}`);
      const primary = view.actions.filter((a) => a.slot === 'primary');
      const secondary = view.actions.filter((a) => a.slot === 'secondary');
      assert.ok(primary.length <= 1, view.stage);
      assert.ok(secondary.length <= 2, view.stage);
    }
  });

  it('drafting 不显示采用/恢复；running 不显示采用', () => {
    const d = ux.deriveWorkUxView({ workMode: 'compose' });
    assert.equal(d.stage, 'drafting');
    assert.ok(!d.actions.some((a) => a.id === 'accept' || a.id === 'restore_baseline'));
    const r = ux.deriveWorkUxView({ jobStatus: 'running' });
    assert.equal(r.stage, 'running');
    assert.ok(!r.actions.some((a) => a.id === 'accept'));
  });

  it('needs_review / adopted 不显示开始处理；右栏不承载确认采用', () => {
    const review = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'undecided',
      canAdoptSuggested: true,
      jobStatus: 'succeeded',
    });
    assert.equal(review.stage, 'needs_review');
    assert.ok(!review.actions.some((a) => a.id === 'start_submit'));
    assert.ok(!review.actions.some((a) => a.id === 'accept'));
    assert.match(review.statusLine, /对话区/);

    const adopted = ux.deriveWorkUxView({
      decisionStatus: 'accepted',
      canTryRun: true,
      codeChange: true,
      hasWorkingDirectory: true,
    });
    assert.equal(adopted.stage, 'adopted');
    assert.ok(!adopted.actions.some((a) => a.id === 'start_submit'));
    assert.ok(!adopted.actions.some((a) => a.id === 'accept' && a.slot === 'primary'));
  });

  it('restore 进入更多；中右栏不重复成果决策动作', () => {
    const review = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'undecided',
      canAdoptSuggested: true,
      hasWorkingDirectory: true,
      jobStatus: 'succeeded',
    });
    const restore = review.actions.find((a) => a.id === 'restore_baseline');
    assert.ok(restore);
    assert.equal(restore!.slot, 'more');
    assert.equal(ux.assertActionBudget(review).ok, true);
  });

  it('needs_capability 不显示执行确认/开始处理', () => {
    const v = ux.deriveWorkUxView({ executorSetupCard: true, modelReady: true });
    assert.equal(v.stage, 'needs_capability');
    assert.ok(!v.actions.some((a) => a.id === 'confirm_execution' || a.id === 'start_submit'));
    assert.equal(v.actions.find((a) => a.slot === 'primary')?.id, 'coding_connect');
  });

  it('blocked 重试为辅助；未达标引导对话；达标采用仅在对话区', () => {
    const blocked = ux.deriveWorkUxView({ jobStatus: 'failed' });
    assert.equal(blocked.stage, 'blocked');
    assert.match(blocked.statusLine, /对话区/);
    assert.equal(blocked.actions.find((a) => a.id === 'retry_job')?.slot, 'more');
    assert.notEqual(blocked.actions.find((a) => a.slot === 'primary')?.id, 'retry_job');

    const bad = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'undecided',
      canAdoptSuggested: false,
      jobStatus: 'succeeded',
    });
    assert.equal(bad.stage, 'needs_revision');
    assert.match(bad.statusLine, /对话区/);
    assert.ok(!bad.actions.some((a) => a.slot === 'primary' && /继续修改|确认继续/.test(a.label)));

    const ok = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'undecided',
      canAdoptSuggested: true,
      jobStatus: 'succeeded',
    });
    assert.equal(ok.stage, 'needs_review');
    assert.ok(!ok.actions.some((a) => a.id === 'accept'));
  });

  it('普通非软件任务同样适用；用户面无内部词', () => {
    const doc = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'undecided',
      codeChange: false,
      jobStatus: 'succeeded',
    });
    assert.equal(doc.stage, 'needs_review');
    for (const a of doc.actions) {
      assert.equal(ux.hasInternalLeak(a.label), false, a.label);
    }
    assert.equal(ux.hasInternalLeak(doc.stage), false);
  });

  it('UI 接入 work-ux-stage 且恢复进更多、决策说明默认隐藏', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    const html = await fs.readFile(path.join(root, 'electron/renderer/index.html'), 'utf8');
    assert.match(html, /work-ux-stage\.js/);
    assert.match(html, /work-more-menu/);
    assert.match(appJs, /DigitalMeWorkUx/);
    assert.match(appJs, /refreshWorkUxView/);
    assert.match(appJs, /applyWorkUxChrome/);
    assert.match(appJs, /deriveWorkUxView/);
    assert.match(html, /artifact-decision-hint[\s\S]*hidden/);
    assert.match(html, /连接代码执行能力/);
  });

  it('screenshot revision / isolation 相关入口仍在 renderer', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(appJs, /revisionShot|add-revision-shot|paste/);
    assert.match(appJs, /uiEpoch|bumpUiEpoch/);
    assert.match(appJs, /restore_baseline|restoreBaseline/);
  });
});
