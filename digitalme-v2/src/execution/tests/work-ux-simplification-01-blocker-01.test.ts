/**
 * WORK-UX-SIMPLIFICATION-01-BLOCKER-01 — 阶段可达性与原子刷新回归
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

function primaryId(facts: Record<string, unknown>) {
  const view = ux.deriveWorkUxView(facts);
  return view.actions.find((a) => a.slot === 'primary')?.id || null;
}

describe('work-ux-simplification-01-blocker-01', () => {
  it('1-3 loading 不是永久 stage；派生不含打开中', () => {
    const running = ux.deriveWorkUxView({ jobStatus: 'running' });
    assert.equal(running.stage, 'running');
    assert.ok(!/正在打开任务/.test(running.statusLine || ''));
    const review = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'undecided',
      jobStatus: 'succeeded',
    });
    assert.equal(review.stage, 'needs_review');
  });

  it('4-7 needs_input：创建/选用项目动作齐全；确认子态；有项目后不停留', () => {
    const folder = ux.deriveWorkUxView({ projectFolderCard: true });
    assert.equal(folder.stage, 'needs_input');
    assert.equal(primaryId({ projectFolderCard: true }), 'create_project');
    assert.ok(folder.actions.some((a) => a.id === 'pick_existing_project' && a.slot === 'secondary'));

    const confirm = ux.deriveWorkUxView({ projectCreateConfirm: true, projectFolderCard: true });
    assert.equal(confirm.stage, 'needs_input');
    assert.equal(primaryId({ projectCreateConfirm: true }), 'confirm_create_project');

    const nextCap = ux.deriveWorkUxView({
      executorSetupCard: true,
      modelReady: true,
      projectFolderCard: false,
    });
    assert.equal(nextCap.stage, 'needs_capability');
    assert.notEqual(nextCap.stage, 'needs_input');

    const nextConfirm = ux.deriveWorkUxView({ executionConfirmCard: true });
    assert.equal(nextConfirm.stage, 'needs_confirmation');
  });

  it('8-9 needs_revision 引导对话区；「按建议继续」仅作辅助', () => {
    const v = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'undecided',
      canAdoptSuggested: false,
      jobStatus: 'succeeded',
    });
    assert.equal(v.stage, 'needs_revision');
    assert.match(v.statusLine, /对话区/);
    assert.ok(v.actions.some((a) => a.id === 'confirm_continue' && a.slot === 'more'));
    assert.ok(!v.actions.some((a) => a.id === 'continue_revise' && a.slot === 'primary'));
    assert.ok(!v.actions.some((a) => a.id === 'propose_revision' && a.slot === 'primary'));
  });

  it('10-14 running terminal 后离开 running；review/revision/blocked/adopted', () => {
    assert.equal(ux.deriveWorkUxView({ jobStatus: 'running' }).stage, 'running');
    assert.equal(
      ux.deriveWorkUxView({
        jobStatus: 'succeeded',
        hasArtifact: true,
        decisionStatus: 'undecided',
        canAdoptSuggested: true,
      }).stage,
      'needs_review',
    );
    assert.equal(
      ux.deriveWorkUxView({
        jobStatus: 'succeeded',
        hasArtifact: true,
        decisionStatus: 'undecided',
        canAdoptSuggested: false,
      }).stage,
      'needs_revision',
    );
    assert.equal(ux.deriveWorkUxView({ jobStatus: 'failed' }).stage, 'blocked');
    assert.equal(
      ux.deriveWorkUxView({ decisionStatus: 'accepted', codeChange: false }).stage,
      'adopted',
    );
  });

  it('15-17 跨 stage 动作预算；restart 从 facts 重建', () => {
    const stages = [
      { projectFolderCard: true },
      { jobStatus: 'running' },
      { hasArtifact: true, decisionStatus: 'undecided', jobStatus: 'succeeded' },
      { hasArtifact: true, decisionStatus: 'undecided', canAdoptSuggested: false },
      { decisionStatus: 'accepted' },
      { jobStatus: 'failed' },
    ];
    for (const facts of stages) {
      const view = ux.deriveWorkUxView(facts);
      const check = ux.assertActionBudget(view);
      assert.equal(check.ok, true, `${view.stage} ${JSON.stringify(check.errors)}`);
      assert.ok(view.actions.filter((a) => a.slot === 'primary').length <= 1);
      assert.ok(view.actions.filter((a) => a.slot === 'secondary').length <= 2);
    }
    // restart：仅凭 facts，无缓存 stage
    const rebuilt = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'undecided',
      jobStatus: 'succeeded',
    });
    assert.equal(rebuilt.stage, 'needs_review');
    assert.ok(rebuilt.actions.some((a) => a.id === 'accept'));
  });

  it('18-19 普通文档任务不进软件项目/不投影 code-change 动作', () => {
    const doc = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'undecided',
      codeChange: false,
      jobStatus: 'succeeded',
    });
    assert.equal(doc.stage, 'needs_review');
    assert.ok(!doc.actions.some((a) => a.id === 'create_project' || a.id === 'open_project'));
    assert.ok(!doc.actions.some((a) => a.id === 'try_run' || a.id === 'restore_baseline'));
  });

  it('20 renderer：refreshWorkUxView、loading 清理、项目前进、revision 映射、文档防误投影', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(appJs, /function refreshWorkUxView/);
    assert.match(appJs, /hideArtifactLoading\(\)/);
    assert.match(appJs, /advanceAfterProjectLocationReady/);
    assert.match(appJs, /applySubmitTaskResult/);
    assert.match(appJs, /resolveArtifactProjection|softwareExecIntent|softwareCodeChangeIntent|DigitalMeArtifactProjection/);
    assert.match(appJs, /resolveWorkUxActionEl/);
    assert.match(appJs, /showProjectCreateConfirmUi/);
    // running 不再用「正在打开任务」作为处理中文案
    assert.ok(!/showArtifactLoading\(rev \?/.test(appJs));
    assert.match(appJs, /处理完成后将在这里显示成果/);
    // 决策按钮跨 stage 可恢复
    assert.match(appJs, /el\.disabled = false/);
    assert.match(appJs, /els\.acceptArtifact\.disabled = false/);
  });
});
