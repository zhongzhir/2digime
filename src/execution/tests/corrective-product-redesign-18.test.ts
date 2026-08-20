/**
 * 2DIGIME-BUILD-01-CORRECTIVE-PRODUCT-REDESIGN-18
 * Owner 真机五条根因纠偏：咨询不降智、CTO 结论、无歧义按钮、
 * 未达标无采用、重启不回到开始开发、ownerDecision 可见、静默 spawn。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  buildGroundedConsultReply,
  formatCtoUserConclusion,
  isCurrentTaskConsult,
} from '../../work-runtime/work-cto-consult';
import { decideConverseEffects, CONVERSE_UNPARSEABLE_NOTICE } from '../../work-runtime/work-converse';
import { buildDigitalMeCtoReview } from '../cto-review';
import { userFacingLabelFromLatestJob } from '../../work-runtime/derive';
import { hiddenSpawnOptions, assertSilentSpawn } from '../hidden-spawn';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const conv = require('../../../electron/renderer/work-conversation.js') as {
  buildWorkTimeline: (input: Record<string, unknown>) => Array<{
    kind: string;
    actions?: Array<{ id: string; label: string }>;
  }>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ux = require('../../../electron/renderer/work-ux-stage.js') as {
  deriveWorkUxView: (facts: Record<string, unknown>) => {
    stage: string;
    actions: Array<{ id: string; label: string; slot: string }>;
  };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tw = require('../../../electron/renderer/task-workspace.js') as {
  titleForMode: (mode: string) => string;
  deriveWorkspaceMode: (facts: Record<string, unknown>) => string;
};

const root = path.resolve(__dirname, '../../..');

describe('corrective product redesign 18', () => {
  it('1. 当前任务咨询不会落入没听懂', () => {
    assert.equal(isCurrentTaskConsult('我看不懂这份结果。能不能用、要不要改、有什么风险？'), true);
    const ctx = {
      goal: '改 formatLabel',
      stageLabel: '建议继续修改',
      hasArtifact: true,
      jobRunning: false,
      latestJobStatus: 'succeeded',
      ownerDecision: 'undecided' as const,
      canAdoptSuggested: false,
      ctoReport: '尚未达到目标。',
    };
    const d = decideConverseEffects({
      parsed: null,
      modelAvailable: true,
      hasArtifact: true,
      jobRunning: false,
      userText: '能不能用？要不要改？有什么风险？',
      consultContext: ctx,
    });
    assert.equal(d.needsClarification, false);
    assert.doesNotMatch(d.reply, /没听懂|没有把你的意思理解清楚/);
    assert.notEqual(d.reply, CONVERSE_UNPARSEABLE_NOTICE);
    assert.match(d.reply, /现在能不能用/);
    assert.match(d.reply, /建议下一步/);
    assert.match(d.reply, /暂时根据已有记录|还不是完整的 AI CTO/);
  });

  it('2. CTO 结论含能否使用、是否建议修改/采用及风险', () => {
    const review = buildDigitalMeCtoReview({
      userGoal: '改 formatLabel 并跑测试',
      verification: {
        overall: 'partially_satisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: [
          { id: 'file_changes', title: '文件变化', verdict: 'satisfied', detail: '2 个文件' },
          { id: 'scope_boundary', title: '范围', verdict: 'satisfied', detail: '未越界' },
          { id: 'git_integrity', title: '版本', verdict: 'satisfied', detail: '无提交' },
        ],
      },
      changedFileCount: 2,
    });
    assert.match(review.report, /现在能不能用/);
    assert.match(review.report, /是否达到目标/);
    assert.match(review.report, /还需不需要修改/);
    assert.match(review.report, /风险/);
    assert.match(review.report, /建议下一步/);
    const formatted = formatCtoUserConclusion({
      canUse: '可以试用',
      goalAttained: '已达到',
      needChange: '不是必须',
      risks: '不会自动发布',
      nextStep: '建议采用',
    });
    assert.match(formatted, /建议采用/);
  });

  it('3. 各阶段不存在歧义旧按钮', async () => {
    const html = await fs.readFile(path.join(root, 'electron/renderer/index.html'), 'utf8');
    const convJs = await fs.readFile(path.join(root, 'electron/renderer/work-conversation.js'), 'utf8');
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.doesNotMatch(html, />前往处理</);
    assert.doesNotMatch(html, />撤销授权</);
    assert.doesNotMatch(convJs, /稍后重新验收/);
    assert.match(html, />确认规划并开始开发</);
    assert.match(appJs, /decisionStatus\.textContent = "尚未决定"/);
    assert.match(appJs, /decisionStatus\.textContent = "已采用"/);
    assert.match(appJs, /decisionStatus\.textContent = "未采用"/);
    assert.match(appJs, /setElVisible\(els\.workMoreMenu, false\)/);
    const review = ux.deriveWorkUxView({
      hasArtifact: true,
      decisionStatus: 'undecided',
      canAdoptSuggested: false,
      jobStatus: 'succeeded',
    });
    assert.ok(!review.actions.some((a) => /更多|前往处理|撤销授权|稍后重新验收/.test(a.label)));
  });

  it('4. 未达标不出现采用入口', () => {
    const turns = conv.buildWorkTimeline({
      goal: '改 formatLabel',
      ctoReport: buildGroundedConsultReply({
        goal: '改 formatLabel',
        stageLabel: '建议继续修改',
        hasArtifact: true,
        jobRunning: false,
        canAdoptSuggested: false,
      }),
      canAdoptSuggested: false,
      hasArtifact: true,
    });
    const acceptance = turns.find((t) => t.kind === 'acceptance');
    assert.ok(!acceptance?.actions?.some((a) => a.id === 'confirm_adopt'));
  });

  it('5. 已有成果时工作区标题是成果不是开始开发', () => {
    assert.equal(tw.titleForMode('complete'), '任务工作区 · 成果');
    assert.match(tw.titleForMode('planning'), /开发规划/);
    assert.equal(
      tw.deriveWorkspaceMode({
        hasPlan: true,
        hasArtifact: true,
        jobStatus: 'succeeded',
        artifactIds: ['a1'],
      }),
      'complete',
    );
    assert.equal(
      tw.deriveWorkspaceMode({
        hasPlan: true,
        hasArtifact: false,
        jobStatus: '',
      }),
      'planning',
    );
  });

  it('6. undecided / adopted / rejected 均能正确恢复', () => {
    const jobs = [
      {
        id: 'j1',
        taskId: 't1',
        status: 'succeeded' as const,
        artifactId: 'a1',
        createdAt: '2026-08-12T00:01:00.000Z',
        capabilityId: 'cap',
      },
    ];
    assert.equal(
      userFacingLabelFromLatestJob(jobs, {
        softwareOutcome: { isCodeChange: true, ownerDecision: 'undecided', canAdoptSuggested: true },
      }),
      '建议采用',
    );
    assert.match(
      userFacingLabelFromLatestJob(jobs, {
        softwareOutcome: {
          isCodeChange: true,
          ownerDecision: 'accepted',
          canSuggestTryRun: true,
          startupCheckVerdict: 'satisfied',
        },
      }),
      /已采用/,
    );
    assert.equal(
      userFacingLabelFromLatestJob(jobs, {
        softwareOutcome: { isCodeChange: true, ownerDecision: 'rejected' },
      }),
      '未采用',
    );
  });

  it('7. Coding Agent 不启动可见控制台窗口', async () => {
    const opts = hiddenSpawnOptions({ env: process.env });
    assertSilentSpawn({
      shell: opts.shell ?? false,
      windowsHide: opts.windowsHide === true,
      detached: opts.detached === true,
    });
    const codex = await fs.readFile(
      path.join(root, 'src/capability/adapters/external-executor-codex.ts'),
      'utf8',
    );
    assert.match(codex, /hiddenSpawnOptions/);
    assert.doesNotMatch(codex, /shell:\s*true/);
  });

  it('8. 对话修改规划与咨询不授权新 Job', () => {
    const d = decideConverseEffects({
      parsed: {
        intent: 'modify_plan',
        confidence: 0.9,
        reply: '已按你的意见更新规划。',
        planUpdate: '目标：改成 done',
      },
      modelAvailable: true,
      hasArtifact: true,
      jobRunning: false,
      userText: '规划里把交付改成 done',
    });
    assert.equal(d.startAuthorized, false);
    assert.equal(d.adoptRequested, false);
    const consult = decideConverseEffects({
      parsed: { intent: 'query_status', confidence: 0.9, reply: '看一下' },
      modelAvailable: true,
      hasArtifact: true,
      jobRunning: false,
      userText: '现在怎么样？',
      consultContext: {
        goal: 'g',
        stageLabel: '尚未决定',
        hasArtifact: true,
        jobRunning: false,
        ownerDecision: 'undecided',
      },
    });
    assert.equal(consult.startAuthorized, false);
    assert.equal(consult.reply, '看一下');
  });
});
