/**
 * CTO-LOOP-08：Digital Me 独立验收与修订委派（隔离 fixture，不碰 MUHUB）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOwnerAcceptanceSummary } from '../acceptance-summary';
import { buildDigitalMeCtoReview } from '../cto-review';
import { buildExecutionConfirmPreview } from '../task-package';

const ux = require('../../../electron/renderer/work-ux-stage.js') as {
  deriveWorkUxView: (facts: Record<string, unknown>) => {
    stage: string;
    statusLine: string;
    actions: Array<{ id: string; label: string; slot: string }>;
  };
};

function baseChecks(overrides: Record<string, Partial<{ verdict: string; detail: string }>> = {}) {
  const mk = (
    id: string,
    title: string,
    verdict: 'satisfied' | 'partially_satisfied' | 'unsatisfied' | 'unverifiable',
    detail = '',
  ) => ({ id, title, verdict, detail });
  const map: Record<string, ReturnType<typeof mk>> = {
    exit_code: mk('exit_code', '退出码', 'satisfied'),
    file_changes: mk('file_changes', '文件变化', 'satisfied', '3 files'),
    scope_boundary: mk('scope_boundary', '范围', 'satisfied'),
    git_integrity: mk('git_integrity', 'HEAD', 'satisfied'),
    build_check: mk('build_check', '构建', 'satisfied', '命令：npm run build；退出码：0'),
    tests_configured: mk('tests_configured', '测试配置', 'unsatisfied', '没有配置自动测试'),
    tests_passed: mk('tests_passed', '测试结果', 'unverifiable', '未配置测试（not_configured）'),
  };
  for (const [k, v] of Object.entries(overrides)) {
    map[k] = { ...map[k]!, ...v } as (typeof map)[string];
  }
  return Object.values(map);
}

describe('CTO-LOOP-08 digital me cto loop', () => {
  it('自然语言目标形成专业委派确认预览（用户面不含技术指令黑话）', () => {
    const preview = buildExecutionConfirmPreview({
      goal: '优化首页信息层级与视觉品质，保持核心功能',
      workingDirectory: 'D:\\tmp\\fixture-cto',
      executorDisplayName: 'Codex',
      understandingSummary: [
        '目标：优化首页信息层级',
        '方案：调整布局与样式组件',
        '预计交付：可浏览的首页改动',
      ],
      understandingReliable: true,
    });
    assert.match(preview.title, /修改项目文件|创建项目/);
    assert.ok(preview.acceptancePreview.goals.some((g) => /首页|优化/.test(g)));
    assert.ok(preview.forbidden.some((f) => /commit/i.test(f)));
    assert.ok((preview.understandingSummary || []).length >= 1);
    const blob = JSON.stringify(preview);
    assert.doesNotMatch(blob, /tool_calls|DSML|grounded/i);
  });

  it('Coding Agent 未达标时 Digital Me 识别问题并形成修正指令', () => {
    const review = buildDigitalMeCtoReview({
      userGoal: '优化首页信息层级',
      understandingKeyFiles: ['app/page.tsx', 'components/home/hero.tsx'],
      planSteps: ['调整布局', '验证构建'],
      verification: {
        overall: 'unsatisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: baseChecks({
          build_check: {
            verdict: 'unsatisfied',
            detail: '命令：npm run build；退出码：1；构建失败',
          },
        }),
      },
      changedFileCount: 3,
      changedFiles: ['app/page.tsx', 'components/home/hero.tsx', 'app/globals.css'],
    });
    assert.equal(review.primaryAction, 'confirm_continue');
    assert.equal(review.goalAttained, false);
    assert.match(review.report, /尚未达到目标|构建/);
    assert.ok(review.revisionDirective);
    assert.match(String(review.revisionDirective), /Digital Me 修正指令/);
    assert.match(String(review.revisionDirective), /构建/);
    assert.doesNotMatch(review.report, /命中关键词|1\/7/);
  });

  it('用户补充意见后修订载荷仍属同一任务语义（指令+补充）', () => {
    const review = buildDigitalMeCtoReview({
      userGoal: '优化首页',
      verification: {
        overall: 'partially_satisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: baseChecks({
          build_check: { verdict: 'unsatisfied', detail: '构建失败' },
        }),
      },
      changedFileCount: 2,
    });
    const userNote = '标题字号再大一点';
    const payload = `${review.revisionDirective}\n\n【用户补充意见】\n${userNote}`;
    assert.match(payload, /用户补充意见/);
    assert.match(payload, /标题字号/);
    assert.match(payload, /修正指令/);
  });

  it('达标后给出明确建议采用；默认面不依赖技术证据', () => {
    const summary = buildOwnerAcceptanceSummary({
      verification: {
        overall: 'satisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: baseChecks(),
      },
      changedFileCount: 4,
      userGoal: '优化首页信息层级',
      understandingKeyFiles: ['app/page.tsx'],
      evidence: {
        changedFiles: ['app/page.tsx', 'app/globals.css', 'components/home/hero.tsx', 'components/project-card.tsx'],
        unifiedDiff: '+++ b/app/page.tsx\n+x\n',
      },
    });
    assert.equal(summary.canAdoptSuggested, true);
    assert.equal(summary.primaryAction, 'confirm_adopt');
    assert.match(String(summary.ctoReport), /建议采用|达到目标|可以采用/);
    assert.ok(summary.bullets.every((b) => !/命中关键词|exit=|spawnSync/.test(b)));
    assert.ok((summary.technicalBullets || []).some((b) => /修改文件/.test(b)));
  });

  it('多轮 UX：未达标不以「继续修改」为必经主按钮；达标可确认采用', () => {
    const reviseView = ux.deriveWorkUxView({
      workMode: 'task',
      hasArtifact: true,
      decisionStatus: 'undecided',
      canAdoptSuggested: false,
      primaryAction: 'confirm_continue',
      codeChange: true,
      jobStatus: 'succeeded',
    });
    assert.equal(reviseView.stage, 'needs_revision');
    assert.match(reviseView.statusLine, /对话区/);
    assert.ok(reviseView.actions.some((a) => a.id === 'confirm_continue' && a.slot === 'more'));
    assert.ok(!reviseView.actions.some((a) => a.id === 'continue_revise' && a.slot === 'primary'));

    const adoptView = ux.deriveWorkUxView({
      workMode: 'task',
      hasArtifact: true,
      decisionStatus: 'undecided',
      canAdoptSuggested: true,
      primaryAction: 'confirm_adopt',
      codeChange: true,
      jobStatus: 'succeeded',
    });
    assert.equal(adoptView.stage, 'needs_review');
    assert.ok(adoptView.actions.some((a) => a.id === 'accept' && a.label === '确认采用'));
  });

  it('执行失败/越权/无法判断时如实请求决策', () => {
    const scope = buildDigitalMeCtoReview({
      userGoal: '任意',
      verification: {
        overall: 'unsatisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: false,
        checks: baseChecks({
          scope_boundary: { verdict: 'unsatisfied', detail: '范围外：../secret' },
        }),
      },
      changedFileCount: 1,
    });
    assert.equal(scope.primaryAction, 'need_decision');
    assert.equal(scope.requiresUserDecision, true);

    const unclear = buildDigitalMeCtoReview({
      userGoal: '任意',
      verification: {
        overall: 'unverifiable',
        digitalMeVerified: false,
        agentClaimedSuccess: false,
        checks: baseChecks({
          file_changes: { verdict: 'unsatisfied', detail: '无变化' },
        }),
      },
      changedFileCount: 0,
    });
    assert.ok(
      unclear.primaryAction === 'need_decision' || unclear.primaryAction === 'confirm_continue',
    );
    assert.match(unclear.report, /不能|尚未|无法|目标/);
  });

  it('原始技术证据完整保留在折叠层；无关键词任务类型第二事实源', () => {
    const summary = buildOwnerAcceptanceSummary({
      verification: {
        overall: 'unsatisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: baseChecks({
          build_check: { verdict: 'unsatisfied', detail: '命令：npm run build；退出码：1' },
        }),
      },
      changedFileCount: 2,
      userGoal: '设计优化',
      summaryExcerpt: '## 发生了什么\nAgent 自述已完成\n',
      evidence: {
        changedFiles: ['a.ts', 'b.ts'],
        unifiedDiff: '+++ b/a.ts\n+1\n+++ b/b.ts\n+2\n',
      },
    });
    assert.ok(summary.technicalBullets.some((b) => /a\.ts/.test(b)));
    assert.ok(summary.technicalBullets.some((b) => /构建|命令/.test(b)));
    assert.ok(summary.technicalBullets.some((b) => /Coding Agent 摘要|Agent/.test(b)));
    assert.doesNotMatch(String(summary.ctoReport), /命中关键词/);
    assert.ok(!('taskTypeRules' in summary));
  });
});
