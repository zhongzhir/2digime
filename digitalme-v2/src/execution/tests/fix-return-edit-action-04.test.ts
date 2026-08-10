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
    actions: Array<{ id: string; label: string; slot: string }>;
  };
};

describe('fix-return-edit-action-04', () => {
  it('confirm → return-edit facts restore drafting start_submit', () => {
    const onConfirm = ux.deriveWorkUxView({
      workMode: 'compose',
      executionConfirmCard: true,
      understandingReliable: true,
    });
    assert.equal(onConfirm.stage, 'needs_confirmation');
    assert.ok(onConfirm.actions.some((a) => a.id === 'confirm_execution'));
    assert.ok(onConfirm.actions.some((a) => a.id === 'cancel_execution'));
    assert.equal(
      onConfirm.actions.some((a) => a.id === 'start_submit'),
      false,
    );

    // 返回修改后：确认卡关闭，仍为 compose、无 job/artifact
    const afterReturn = ux.deriveWorkUxView({
      workMode: 'compose',
      executionConfirmCard: false,
      projectFolderCard: false,
      executorSetupCard: false,
      jobStatus: null,
      hasArtifact: false,
      decisionStatus: null,
    });
    assert.equal(afterReturn.stage, 'drafting');
    const start = afterReturn.actions.find((a) => a.id === 'start_submit');
    assert.ok(start);
    assert.equal(start!.label, '开始处理');
    assert.equal(start!.slot, 'primary');
  });

  it('unreliable confirm card also returns to drafting start_submit', () => {
    const unreliable = ux.deriveWorkUxView({
      workMode: 'compose',
      executionConfirmCard: true,
      understandingReliable: false,
    });
    assert.equal(
      unreliable.actions.find((a) => a.id === 'confirm_execution')?.label,
      '仍要继续',
    );
    const after = ux.deriveWorkUxView({
      workMode: 'compose',
      executionConfirmCard: false,
    });
    assert.equal(after.stage, 'drafting');
    assert.ok(after.actions.some((a) => a.id === 'start_submit' && a.label === '开始处理'));
  });

  it('app.js returnFromExecutionConfirmToEdit refreshes UX and keeps materials path', async () => {
    const src = await fs.readFile(
      path.join(__dirname, '../../../electron/renderer/app.js'),
      'utf8',
    );
    assert.match(src, /function returnFromExecutionConfirmToEdit\s*\(/);
    assert.match(src, /returnFromExecutionConfirmToEdit\s*\(\s*\)/);
    assert.match(src, /cancelExecution[\s\S]{0,400}returnFromExecutionConfirmToEdit/);
    assert.match(
      src,
      /function returnFromExecutionConfirmToEdit[\s\S]*?refreshWorkUxView\s*\(\s*\{[\s\S]*?executionConfirmCard:\s*false/,
    );
    assert.match(
      src,
      /function returnFromExecutionConfirmToEdit[\s\S]*?els\.submit\.textContent\s*=\s*["']开始处理["']/,
    );
    // 不得在返回修改时清空 materials
    assert.equal(
      /function returnFromExecutionConfirmToEdit[\s\S]*?materials\s*=\s*\[\]/.test(src),
      false,
    );
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
      externalExecutorCapability: {
        forceAvailability: 'ready',
        executeHook: async () => ({ exitCode: 0, summary: 'ok' }),
      },
    });
    await rt.createPackage({ displayName: 'ret', targetDir: pkg });

    const goal1 = '修改这个项目中的展示页面信息层级';
    const first = await rt.submitTask({
      goal: goal1,
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    assert.ok(first.needsExecutionConfirm);
    assert.equal(first.taskId, '');
    assert.equal(first.jobId, '');
    const folderKept = first.needsExecutionConfirm!.workingDirectory;
    assert.equal(path.resolve(folderKept), path.resolve(dir));

    // 返回修改不经 Runtime 建任务；再次 submit 用新目标
    const goal2 = '修改这个项目中的展示页面视觉品质并保持核心功能';
    const second = await rt.submitTask({
      goal: goal2,
      contextRefs: [{ kind: 'folder', path: dir }],
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
    // 仍未真正执行
    const tasks = await rt.listTasks({ limit: 20 });
    assert.equal((tasks.tasks || []).length, 0);

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
    });
    assert.ok(after.actions.some((a) => a.id === 'start_submit'));
  });
});
