/**
 * FIX-RETURN-EDIT-ACTION-04
 * 返回修改后必须恢复「开始处理」，并可重新生成确认卡。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import {
  buildSoftwareTaskUnderstanding,
  formatUnderstandingSummaryLines,
  isUnderstandingReliable,
} from '../software-task-understanding';
import { buildExecutionConfirmPreview } from '../task-package';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ux = require('../../../electron/renderer/work-ux-stage.js') as {
  deriveWorkUxView: (facts: Record<string, unknown>) => {
    stage: string;
    statusLine: string;
    actions: Array<{ id: string; label: string; slot: string }>;
  };
};

describe('fix-return-edit-action-04', () => {
  it('confirm → return-edit facts restore drafting without legacy start_submit', () => {
    const onConfirm = ux.deriveWorkUxView({
      workMode: 'compose',
      prepBlocked: true,
      prepBlockedKind: 'high_risk',
      understandingReliable: true,
    });
    assert.equal(onConfirm.stage, 'needs_confirmation');
    assert.match(onConfirm.statusLine, /右侧/);
    assert.equal(
      onConfirm.actions.some((a) => a.id === 'start_submit'),
      false,
    );

    // 返回修改后：准备受阻解除，仍为 compose；无规划时不得再出现「开始处理」
    const afterReturn = ux.deriveWorkUxView({
      workMode: 'compose',
      prepBlocked: false,
      jobStatus: null,
      hasArtifact: false,
      decisionStatus: null,
      hasPlanDraft: false,
    });
    assert.equal(afterReturn.stage, 'drafting');
    assert.equal(
      afterReturn.actions.some((a) => a.id === 'start_submit'),
      false,
    );
    assert.match(afterReturn.statusLine, /说明目标|确认规划/);
  });

  it('unreliable confirm card also returns to drafting without start_submit', () => {
    const unreliable = ux.deriveWorkUxView({
      workMode: 'compose',
      prepBlocked: true,
      prepBlockedKind: 'high_risk',
      understandingReliable: false,
    });
    assert.equal(unreliable.stage, 'needs_confirmation');
    const after = ux.deriveWorkUxView({
      workMode: 'compose',
      prepBlocked: false,
      hasPlanDraft: false,
    });
    assert.equal(after.stage, 'drafting');
    assert.equal(
      after.actions.some((a) => a.id === 'start_submit'),
      false,
    );
  });

  it('app.js 返回修改走右栏 prepBlocked 清除，并刷新 UX', async () => {
    const src = await fs.readFile(
      path.join(__dirname, '../../../electron/renderer/app.js'),
      'utf8',
    );
    assert.equal(src.includes('returnFromExecutionConfirmToEdit'), false);
    assert.equal(src.includes('execution-confirm-card'), false);
    assert.match(src, /function clearPrepBlocked\s*\(/);
    assert.match(src, /function showPrepBlocked\s*\(/);
    assert.match(src, /prepBlocked:\s*!!prepBlockedState/);
    const clearBody = src.match(/function clearPrepBlocked\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/)?.[0] ?? '';
    assert.ok(clearBody.length > 20);
    assert.equal(/materials\s*=\s*\[\]/.test(clearBody), false);
  });

  it('product chain: confirm → edit goal → resubmit regenerates understanding without task/job', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ret-edit-'));
    await fs.mkdir(path.join(dir, 'app'), { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    await fs.writeFile(
      path.join(dir, 'app', 'page.tsx'),
      'export default function Page(){ return null; }\n',
      'utf8',
    );
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ret-pkg-'));
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      converseChat: async ({ messages }) => {
        const last = String(messages[messages.length - 1]?.content || '');
        const visual = /视觉品质/.test(last);
        return {
          text: JSON.stringify({
            intent: 'add_goal_info',
            confidence: 0.95,
            reply: visual ? '已按视觉品质更新规划。' : '已整理信息层级规划。',
            planUpdate: visual
              ? '目标：展示页面视觉品质并保持核心功能\n交付：可查看改动\n路径：调整样式\n准备：项目文件夹\n边界：不推送'
              : '目标：展示页面信息层级\n交付：可查看改动\n路径：调整结构\n准备：项目文件夹\n边界：不推送',
          }),
        };
      },
      externalExecutorCapability: {
        forceAvailability: 'ready',
        executeHook: async () => ({ exitCode: 0, summary: 'ok' }),
      },
    });
    await rt.createPackage({ displayName: 'ret', targetDir: pkg });

    const goal1 = '修改这个项目中的展示页面信息层级';
    const planned1 = await rt.converse({
      text: goal1,
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    assert.ok(planned1.plan?.version);
    const first = await rt.submitTask({
      goal: goal1,
      contextRefs: [{ kind: 'folder', path: dir }],
      existingTaskId: planned1.taskId,
      confirmedPlanVersion: planned1.plan!.version,
    });
    assert.ok(first.needsExecutionConfirm);
    assert.equal(first.taskId, '');
    assert.equal(first.jobId, '');
    const folderKept = first.needsExecutionConfirm!.workingDirectory;
    assert.equal(path.resolve(folderKept), path.resolve(dir));

    // 返回修改：对话更新规划，不经无版本 submitTask
    const goal2 = '修改这个项目中的展示页面视觉品质并保持核心功能';
    const planned2 = await rt.converse({
      taskId: planned1.taskId,
      text: goal2,
    });
    assert.ok(planned2.plan && planned2.plan.version > planned1.plan!.version);
    const second = await rt.submitTask({
      goal: goal2,
      contextRefs: [{ kind: 'folder', path: dir }],
      existingTaskId: planned1.taskId,
      confirmedPlanVersion: planned2.plan!.version,
    });
    assert.ok(second.needsExecutionConfirm);
    assert.equal(second.taskId, '');
    assert.equal(second.jobId, '');
    assert.equal(
      path.resolve(second.needsExecutionConfirm!.workingDirectory),
      path.resolve(dir),
    );
    assert.match(
      (second.needsExecutionConfirm!.acceptancePreview.goals || []).join('\n'),
      /视觉品质|核心功能/,
    );
    // 仍未真正执行（确认门未授权）
    const jobs = await rt.workRuntime.listJobsForTask(planned1.taskId);
    assert.equal(jobs.length, 0);

    // 理解层：新目标不得复用旧摘要污染（独立构建）
    const u1 = await buildSoftwareTaskUnderstanding({
      goal: goal1,
      workingDirectory: dir,
      readOnlyLocate: async () => ({
        files: [{ path: 'app/page.tsx', reason: '首页' }],
      }),
    });
    const u2 = await buildSoftwareTaskUnderstanding({
      goal: goal2,
      workingDirectory: dir,
      readOnlyLocate: async () => ({
        files: [{ path: 'app/page.tsx', reason: '首页视觉' }],
      }),
    });
    assert.equal(isUnderstandingReliable(u1), true);
    assert.equal(isUnderstandingReliable(u2), true);
    assert.notEqual(u1.goal, u2.goal);
    const p1 = buildExecutionConfirmPreview({
      goal: u1.goal,
      workingDirectory: dir,
      executorDisplayName: '代码执行能力',
      understandingSummary: formatUnderstandingSummaryLines(u1),
      understandingReliable: true,
    });
    const p2 = buildExecutionConfirmPreview({
      goal: u2.goal,
      workingDirectory: dir,
      executorDisplayName: '代码执行能力',
      understandingSummary: formatUnderstandingSummaryLines(u2),
      understandingReliable: true,
    });
    assert.match(p2.acceptancePreview.goals.join('\n'), /视觉品质/);
    assert.equal(p1.acceptancePreview.goals.join('\n') === p2.acceptancePreview.goals.join('\n'), false);
  });

  it('unreliable confirm preview can also be rebuilt after return-edit', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ret-unrel-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    const u = await buildSoftwareTaskUnderstanding({
      goal: '把量子纠缠 frobulator 改成紫色',
      workingDirectory: dir,
    });
    assert.equal(u.reliability, 'unreliable');
    const preview = buildExecutionConfirmPreview({
      goal: u.goal,
      workingDirectory: dir,
      executorDisplayName: '代码执行能力',
      understandingSummary: formatUnderstandingSummaryLines(u),
      understandingReliable: false,
    });
    assert.equal(preview.understandingReliable, false);
    const after = ux.deriveWorkUxView({
      workMode: 'compose',
      executionConfirmCard: false,
      hasPlanDraft: false,
    });
    assert.equal(
      after.actions.some((a) => a.id === 'start_submit'),
      false,
    );
  });
});
