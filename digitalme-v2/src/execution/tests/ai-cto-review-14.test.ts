import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAiDigitalMeCtoReview,
  buildAiCtoEvidencePack,
  parseAiCtoReviewOutput,
} from '../ai-cto-review';
import { buildOwnerAcceptanceSummaryAsync } from '../acceptance-summary';

const input = {
  userGoal: '修复首页在手机上的导航显示',
  verification: {
    overall: 'satisfied' as const,
    digitalMeVerified: true,
    agentClaimedSuccess: true,
    checks: [
      { id: 'file_changes', title: '文件变化', verdict: 'satisfied' as const, detail: '已核对' },
      { id: 'scope_boundary', title: '范围', verdict: 'satisfied' as const, detail: '已核对' },
      { id: 'git_integrity', title: '版本状态', verdict: 'satisfied' as const, detail: '已核对' },
      { id: 'build_check', title: '构建', verdict: 'satisfied' as const, detail: '已通过' },
    ],
  },
  changedFileCount: 2,
  changedFiles: ['src/nav.ts', 'src/nav.css'],
};

test('D11-C：模型结论映射为可采用建议', async () => {
  const review = await buildAiDigitalMeCtoReview(input, async () => ({
    text: JSON.stringify({
      decision: 'meets_plan',
      userSummary: '手机导航已完成调整，并通过现有构建核对。',
      completed: ['完成导航布局调整'],
      gaps: [],
      evidenceRefs: ['check:file_changes', 'check:build_check', 'file:src/nav.ts'],
      risks: [],
      nextAction: '你可以确认采用这一版成果。',
    }),
  }));
  assert.equal(review.primaryAction, 'confirm_adopt');
  assert.equal(review.goalAttained, true);
  assert.equal(review.decision, 'meets_plan');
  assert.deepEqual(review.evidenceRefs, ['check:file_changes', 'check:build_check', 'file:src/nav.ts']);
});

test('D11-C：硬门覆盖模型的可采用结论', async () => {
  const review = await buildAiDigitalMeCtoReview(
    {
      ...input,
      verification: {
        ...input.verification,
        checks: input.verification.checks.map((check) =>
          check.id === 'scope_boundary' ? { ...check, verdict: 'unsatisfied' as const } : check,
        ),
      },
    },
    async () => ({
      text: JSON.stringify({
        decision: 'meets_plan',
        userSummary: '模型认为成果可采用。',
        completed: ['完成修改'],
        gaps: [],
        evidenceRefs: ['check:scope_boundary'],
        risks: [],
        nextAction: '确认采用。',
      }),
    }),
  );
  assert.equal(review.decision, 'blocked');
  assert.equal(review.primaryAction, 'need_decision');
  assert.equal(review.goalAttained, false);
});

test('D11-C：关键工程证据缺失时不得判为可采用', async () => {
  const review = await buildAiDigitalMeCtoReview(
    {
      ...input,
      verification: {
        ...input.verification,
        digitalMeVerified: false,
        checks: input.verification.checks.filter((check) => check.id !== 'build_check'),
      },
    },
    async () => ({
      text: JSON.stringify({
        decision: 'meets_plan',
        userSummary: '模型认为可以采用。',
        completed: ['完成修改'],
        gaps: [],
        evidenceRefs: ['check:file_changes'],
        risks: [],
        nextAction: '确认采用。',
      }),
    }),
  );
  assert.equal(review.decision, 'insufficient_evidence');
  assert.equal(review.primaryAction, 'need_decision');
  assert.equal(review.goalAttained, false);
});

test('D11-C：模型不可用或引用伪造时不得回退模板结论', async () => {
  const unavailable = await buildAiDigitalMeCtoReview(input, null);
  assert.equal(unavailable.decision, 'insufficient_evidence');
  assert.equal(unavailable.primaryAction, 'need_decision');
  assert.equal(unavailable.goalAttained, false);
  assert.match(unavailable.report, /无法完成独立验收/);

  const malformed = await buildAiDigitalMeCtoReview(input, async () => ({
    text: '{"decision":"meets_plan","evidenceRefs":["invented"]}',
  }));
  assert.equal(malformed.decision, 'insufficient_evidence');
  assert.equal(malformed.primaryAction, 'need_decision');
});

test('D11-C：needs_revision 生成专业修正计划，不创建任务', async () => {
  const summary = await buildOwnerAcceptanceSummaryAsync(input, async () => ({
    text: JSON.stringify({
      decision: 'needs_revision',
      userSummary: '导航改动已完成，但自动测试尚未覆盖手机宽度。',
      completed: ['完成导航布局调整'],
      gaps: ['缺少手机宽度的自动验证'],
      evidenceRefs: ['check:file_changes'],
      risks: ['不同设备上仍可能出现显示差异'],
      nextAction: '请确认是否继续补充验证。',
      revisionPlan: '补充手机宽度下的导航自动验证；确认构建通过后提供结果。',
    }),
  }));
  assert.equal(summary.primaryAction, 'confirm_continue');
  assert.equal(summary.canAdoptSuggested, false);
  assert.match(String(summary.revisionDirective), /补充手机宽度/);
});

test('D11-C：解析只接受证据包内的引用', () => {
  const pack = buildAiCtoEvidencePack(input);
  const parsed = parseAiCtoReviewOutput(
    JSON.stringify({
      decision: 'blocked',
      userSummary: '范围异常。',
      completed: [],
      gaps: ['范围异常'],
      evidenceRefs: ['other:unknown'],
      risks: [],
      nextAction: '人工核对。',
    }),
    pack.evidenceRefs,
  );
  // 伪造引用被丢弃后回退到真实证据引用，决策仍可形成
  assert.ok(parsed);
  assert.equal(parsed!.decision, 'blocked');
  assert.ok(parsed!.evidenceRefs.every((ref) => pack.evidenceRefs.includes(ref)));
});
