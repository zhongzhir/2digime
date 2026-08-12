/**
 * 2DIGIME-BUILD-01-CORRECTIVE-18A-AI-CTO-RUNTIME-CLOSE
 * 四项退出缺口：咨询不覆盖模型回答、CTO 五项合同、低/高风险成对、重启恢复合同。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  assertConsultReplyConsistent,
  buildDegradedConsultReply,
  DEGRADED_CONSULT_NOTICE,
  formatCtoUserConclusion,
} from '../../work-runtime/work-cto-consult';
import { decideConverseEffects } from '../../work-runtime/work-converse';
import { buildAiDigitalMeCtoReview } from '../ai-cto-review';
import { hiddenSpawnOptions, assertSilentSpawn } from '../hidden-spawn';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tw = require('../../../electron/renderer/task-workspace.js') as {
  isHighRiskExecution: (
    goal: string,
    preview: { workingDirectory?: string; writeScope?: string[] },
  ) => boolean;
  deriveWorkspaceMode: (facts: Record<string, unknown>) => string;
  titleForMode: (mode: string) => string;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const proj = require('../../../electron/renderer/work-artifact-projection.js') as {
  resolveArtifactProjection: (d: Record<string, unknown>) => { kind: string };
};

const root = path.resolve(__dirname, '../../..');

const consultCtx = {
  goal: '改 formatLabel',
  stageLabel: '尚未决定',
  hasArtifact: true,
  jobRunning: false,
  latestJobStatus: 'succeeded',
  ownerDecision: 'undecided' as const,
  canAdoptSuggested: false,
  ctoReport: '现在能不能用：可以试用。\n是否达到目标：已达到。',
};

describe('corrective 18A runtime close', () => {
  it('1. 模型合法咨询保留原回答，不套关键词模板', () => {
    const modelReply =
      '按这份成果，现在可以试用；目标基本达到；不是必须再改。风险是尚未采用、也不会自动发布。建议你先试用再决定。';
    const d = decideConverseEffects({
      parsed: {
        intent: 'query_status',
        confidence: 0.91,
        reply: modelReply,
      },
      modelAvailable: true,
      hasArtifact: true,
      jobRunning: false,
      userText: '能不能用、要不要改、有什么风险？',
      consultContext: consultCtx,
    });
    assert.equal(d.reply, modelReply);
    assert.doesNotMatch(d.reply, new RegExp(DEGRADED_CONSULT_NOTICE));
    assert.equal(d.startAuthorized, false);
    assert.equal(d.adoptRequested, false);
    assert.equal(d.confirmPlan, false);
  });

  it('2. 仅模型不可用/不可解析才用暂时性降级回答', () => {
    const unavailable = decideConverseEffects({
      parsed: null,
      modelAvailable: false,
      hasArtifact: true,
      jobRunning: false,
      userText: '能不能用？',
      consultContext: consultCtx,
    });
    assert.match(unavailable.reply, /暂时根据已有记录|还不是完整的 AI CTO/);
    assert.equal(unavailable.degraded, true);
    assert.equal(unavailable.startAuthorized, false);

    const unparseable = decideConverseEffects({
      parsed: null,
      modelAvailable: true,
      hasArtifact: true,
      jobRunning: false,
      userText: '要不要改？',
      consultContext: consultCtx,
    });
    assert.equal(unparseable.reply, buildDegradedConsultReply(consultCtx));
    assert.equal(unparseable.degraded, true);

    const falseAdopt = assertConsultReplyConsistent(
      '你已经采用了这份成果，可以直接上线。',
      consultCtx,
    );
    assert.match(falseAdopt, /尚未采用/);
    const falseNotStarted = assertConsultReplyConsistent(
      '目前还没有开始执行，我会先按这个目标来规划。',
      consultCtx,
    );
    assert.match(falseNotStarted, /已有成果/);
  });

  it('3. AI CTO 四类 decision 均输出五项自然语言结论', async () => {
    const baseInput = {
      userGoal: '改 formatLabel 并跑测试',
      verification: {
        overall: 'satisfied' as const,
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: [
          { id: 'file_changes', title: '文件变化', verdict: 'satisfied' as const, detail: '已核对' },
          { id: 'scope_boundary', title: '范围', verdict: 'satisfied' as const, detail: '已核对' },
          { id: 'git_integrity', title: '版本', verdict: 'satisfied' as const, detail: '已核对' },
          { id: 'build_check', title: '构建', verdict: 'satisfied' as const, detail: '已通过' },
        ],
      },
      changedFileCount: 1,
      changedFiles: ['formatLabel.js'],
    };
    const cases: Array<{
      decision: 'meets_plan' | 'needs_revision' | 'blocked' | 'insufficient_evidence';
      extra?: Partial<typeof baseInput>;
    }> = [
      { decision: 'meets_plan' },
      { decision: 'needs_revision' },
      { decision: 'blocked' },
      { decision: 'insufficient_evidence' },
    ];
    for (const c of cases) {
      const review = await buildAiDigitalMeCtoReview(
        {
          ...baseInput,
          ...(c.decision === 'blocked'
            ? {
                verification: {
                  ...baseInput.verification,
                  overall: 'unsatisfied',
                  checks: baseInput.verification.checks.map((check) =>
                    check.id === 'scope_boundary'
                      ? { ...check, verdict: 'unsatisfied' as const }
                      : check,
                  ),
                },
              }
            : c.decision === 'insufficient_evidence'
              ? { changedFileCount: 0, verification: { ...baseInput.verification, digitalMeVerified: false } }
              : {}),
        },
        async () => ({
          text: JSON.stringify({
            decision: c.decision,
            canUse: c.decision === 'meets_plan' ? '可以试用。' : '现在还不建议当作可用版本。',
            goalAttained: c.decision === 'meets_plan' ? '已达到本轮目标。' : '尚未达到目标。',
            needChange: c.decision === 'meets_plan' ? '不是必须再改。' : '需要继续修改。',
            nextStep:
              c.decision === 'meets_plan'
                ? '建议采用。'
                : c.decision === 'needs_revision'
                  ? '按修订建议继续。'
                  : '先处理问题再决定。',
            userSummary: `模型判断 ${c.decision}`,
            completed: ['已改文件'],
            gaps: c.decision === 'meets_plan' ? [] : ['仍有缺口'],
            evidenceRefs: ['check:file_changes'],
            risks: ['不会自动发布'],
            nextAction: '由你决定下一步',
            ...(c.decision === 'needs_revision' ? { revisionPlan: '补齐测试证据。' } : {}),
          }),
        }),
      );
      assert.match(review.report, /现在能不能用/);
      assert.match(review.report, /是否达到目标/);
      assert.match(review.report, /还需不需要修改/);
      assert.match(review.report, /风险/);
      assert.match(review.report, /建议下一步/);
      assert.doesNotMatch(review.report, /\bmeets_plan\b|\bneeds_revision\b|\bfile_changes\b/);
      assert.notEqual(review.report, formatCtoUserConclusion({
        canUse: 'satisfied',
        goalAttained: 'partially_satisfied',
        needChange: 'unsatisfied',
        risks: 'unverifiable',
        nextStep: 'confirm_adopt',
      }));
    }
  });

  it('4. 项目内普通修改为低风险；越界/删除/推送/部署为高风险', () => {
    const wd = 'D:/tmp/18a-app';
    assert.equal(
      tw.isHighRiskExecution('修改 formatLabel 并运行测试', { workingDirectory: wd, writeScope: ['.'] }),
      false,
    );
    assert.equal(
      tw.isHighRiskExecution('构建并跑测试', { workingDirectory: wd, writeScope: ['./src'] }),
      false,
    );
    assert.equal(
      tw.isHighRiskExecution('改项目内文件', { workingDirectory: wd, writeScope: [wd] }),
      false,
    );
    assert.equal(
      tw.isHighRiskExecution('改项目内文件', {
        workingDirectory: 'D:\\tmp\\18a-app',
        writeScope: ['D:/tmp/18a-app/src'],
      }),
      false,
    );
    assert.equal(
      tw.isHighRiskExecution('改文件', { workingDirectory: wd, writeScope: ['D:/other/secret'] }),
      true,
    );
    assert.equal(
      tw.isHighRiskExecution('删除整个项目目录', { workingDirectory: wd, writeScope: ['.'] }),
      true,
    );
    assert.equal(
      tw.isHighRiskExecution('提交并 push 到远程', { workingDirectory: wd, writeScope: ['.'] }),
      true,
    );
    assert.equal(
      tw.isHighRiskExecution('部署到生产环境', { workingDirectory: wd, writeScope: ['.'] }),
      true,
    );
  });

  it('5. 已有成果时工作区必须是成果视图，投影以 codeChange 为准', () => {
    assert.equal(
      tw.deriveWorkspaceMode({
        hasPlan: true,
        hasArtifact: true,
        jobStatus: 'succeeded',
        artifactIds: ['a1'],
      }),
      'complete',
    );
    assert.match(tw.titleForMode('complete'), /成果/);
    assert.equal(
      proj.resolveArtifactProjection({
        taskIntent: 'modify_code',
        artifactType: 'document',
        artifactContent: { codeChange: { workingDirectory: 'D:/x' } },
      }).kind,
      'code-change',
    );
  });

  it('6. 静默 spawn 选项含 windowsHide 且不使用 shell', async () => {
    const opts = hiddenSpawnOptions({ env: { PATH: 'C:\\Windows' } });
    assertSilentSpawn({
      shell: opts.shell ?? false,
      windowsHide: opts.windowsHide === true,
      detached: opts.detached === true,
    });
    assert.equal((opts.env as NodeJS.ProcessEnv).ELECTRON_NO_ATTACH_CONSOLE, '1');
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(appJs, /readyArtifactId/);
    assert.match(appJs, /ccTechEvidence\.open = false/);
  });
});
