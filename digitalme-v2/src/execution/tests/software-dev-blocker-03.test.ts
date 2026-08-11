/**
 * SOFTWARE-DEVELOPMENT TASK/ARTIFACT isolation + acceptance summary tests (BLOCKER-03).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildOwnerAcceptanceSummary } from '../acceptance-summary';
import { inspectSoftwareProject } from '../../work-runtime/work-intent';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';

describe('software-dev-blocker-03', () => {
  it('验收摘要：测试失败不得建议可以采用', () => {
    const summary = buildOwnerAcceptanceSummary({
      verification: {
        overall: 'unsatisfied',
        digitalMeVerified: false,
        agentClaimedSuccess: true,
        checks: [
          { id: 'file_changes', title: '文件', verdict: 'satisfied', detail: 'ok' },
          { id: 'tests_passed', title: '测试', verdict: 'unsatisfied', detail: 'fail' },
          { id: 'scope_boundary', title: '范围', verdict: 'satisfied', detail: 'ok' },
        ],
      },
      changedFileCount: 2,
    });
    assert.equal(summary.canAdoptSuggested, false);
    assert.notEqual(summary.recommendation, '可以采用');
    assert.equal(summary.agentClaimedSuccess, true);
    assert.equal(summary.digitalMeVerified, false);
  });

  it('验收摘要：越界修改不得显示目标已满足可采用', () => {
    const summary = buildOwnerAcceptanceSummary({
      verification: {
        overall: 'unsatisfied',
        digitalMeVerified: false,
        agentClaimedSuccess: true,
        checks: [
          { id: 'file_changes', title: '文件', verdict: 'satisfied', detail: 'ok' },
          { id: 'scope_boundary', title: '范围', verdict: 'unsatisfied', detail: 'out' },
        ],
      },
      changedFileCount: 1,
    });
    assert.equal(summary.canAdoptSuggested, false);
    assert.notEqual(summary.recommendation, '可以采用');
    assert.ok(
      summary.goalLabel === '未满足' || summary.goalLabel === '无法验证' || summary.goalLabel === '部分满足',
    );
    assert.match(summary.bullets.join('\n') + summary.adoptWarnings.join('\n'), /范围|越权|之外/);
  });

  it('验收摘要：目录不一致时请重新验证', () => {
    const summary = buildOwnerAcceptanceSummary({
      verification: {
        overall: 'satisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: [
          { id: 'file_changes', title: '文件', verdict: 'satisfied', detail: 'ok' },
          { id: 'tests_passed', title: '测试', verdict: 'satisfied', detail: 'ok' },
          { id: 'scope_boundary', title: '范围', verdict: 'satisfied', detail: 'ok' },
        ],
      },
      changedFileCount: 2,
      directoryChangedSinceResult: true,
    });
    assert.equal(summary.canAdoptSuggested, false);
    assert.ok(
      summary.recommendation === '请重新验证' ||
        summary.recommendation === '暂不建议采用' ||
        /重新|目录|变化/.test(summary.recommendation + summary.adoptWarnings.join('')),
    );
  });

  it('空文件夹可作为新软件项目候选', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-empty-proj-'));
    const inspected = await inspectSoftwareProject(dir);
    assert.equal(inspected.isEmptyDirectory, true);
    assert.equal(inspected.isNewProjectCandidate, true);
    assert.equal(inspected.isSoftwareProject, true);
    assert.match(inspected.userFacingHint, /空文件夹|创建/);
  });

  it('无项目目录时返回 needsProjectFolder 且不创建 Task', async () => {
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-npf-pkg-'));
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: {
        executeHook: async () => ({
          exitCode: 0,
          summary: 'ok',
          claimedChangedFiles: ['a.js'],
        }),
      },
    });
    await rt.createPackage({ displayName: 'npf', targetDir: pkg });
    const preview = await rt.submitTask({
      goal: '开发一个俄罗斯方块游戏',
      contextRefs: [],
    });
    assert.ok(preview.needsProjectFolder);
    assert.equal(preview.taskId, '');
    assert.match(preview.needsProjectFolder!.message, /项目位置|文件夹/);
    const listed = await rt.listTasks({ limit: 10 });
    assert.equal(listed.tasks.length, 0);
  });

  it('确认执行只创建一个 Task；两任务成果不串线', async () => {
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-iso-pkg-'));
    const repoA = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-iso-a-'));
    const repoB = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-iso-b-'));
    await fs.writeFile(path.join(repoA, 'package.json'), '{"name":"a"}', 'utf8');
    await fs.writeFile(path.join(repoA, 'a.txt'), 'a0', 'utf8');
    await fs.writeFile(path.join(repoB, 'b.txt'), 'b0', 'utf8');

    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: {
        executeHook: async ({ pkg: taskPkg }) => {
          const name = path.basename(taskPkg.workingDirectory);
          const file = name.startsWith('dm-iso-a') ? 'a.txt' : 'b.txt';
          await fs.writeFile(path.join(taskPkg.workingDirectory, file), `${file}-done`, 'utf8');
          return {
            exitCode: 0,
            summary: `updated ${file}`,
            claimedChangedFiles: [file],
          };
        },
      },
    });
    await rt.createPackage({ displayName: 'iso', targetDir: pkg });

    const prevA = await rt.submitTask({
      goal: '修改这个项目中的 a.txt 内容',
      contextRefs: [{ kind: 'folder', path: repoA }],
    });
    assert.ok(prevA.needsExecutionConfirm);
    assert.equal(prevA.taskId, '');
    const startedA = await rt.submitTask({
      goal: '修改这个项目中的 a.txt 内容',
      contextRefs: [{ kind: 'folder', path: repoA }],
      executionAuthorization: {
        confirmed: true,
        workingDirectory: repoA,
        readScope: ['.'],
        writeScope: ['.'],
      },
    });
    await waitForJobTerminal(rt.workRuntime, startedA.jobId, 20000);
    const afterA = await rt.getTask({ taskId: startedA.taskId });
    assert.equal(afterA.latestJob?.status, 'succeeded');
    const artA = afterA.artifactIds[0];
    assert.ok(artA);

    const prevB = await rt.submitTask({
      goal: '修改这个项目中的 b.txt 内容',
      contextRefs: [{ kind: 'folder', path: repoB }],
    });
    assert.equal(prevB.taskId, '');
    const startedB = await rt.submitTask({
      goal: '修改这个项目中的 b.txt 内容',
      contextRefs: [{ kind: 'folder', path: repoB }],
      executionAuthorization: {
        confirmed: true,
        workingDirectory: repoB,
        readScope: ['.'],
        writeScope: ['.'],
      },
    });
    await waitForJobTerminal(rt.workRuntime, startedB.jobId, 20000);
    const afterB = await rt.getTask({ taskId: startedB.taskId });
    const artB = afterB.artifactIds[0];
    assert.ok(artB);
    assert.notEqual(artA, artB);

    const listed = await rt.listTasks({ limit: 10 });
    assert.equal(listed.tasks.length, 2);

    await assert.rejects(
      () =>
        rt.getContent({
          artifactId: artA,
          expectedTaskId: startedB.taskId,
        }),
      /不属于当前任务/,
    );

    const contentA = (await rt.getContent({
      artifactId: artA,
      expectedTaskId: startedA.taskId,
    })) as { codeChange?: { summary?: string }; text?: string };
    assert.ok(contentA.codeChange);
    assert.match(String(contentA.codeChange?.summary || contentA.text || ''), /a\.txt|updated/);

    const contentB = (await rt.getContent({
      artifactId: artB,
      expectedTaskId: startedB.taskId,
    })) as { codeChange?: unknown };
    assert.ok(contentB.codeChange);

    await assert.rejects(
      () =>
        rt.reviseArtifact({
          taskId: startedB.taskId,
          artifactId: artA,
          revisionRequest: 'x',
        }),
      /does not belong|不属于|artifact/,
    );
  });

  it('UI 成果区无重复采用入口且含验收摘要结构', async () => {
    const html = await fs.readFile(
      path.join(__dirname, '../../../electron/renderer/index.html'),
      'utf8',
    );
    assert.match(html, /id="cc-acceptance-section"/);
    assert.match(html, /Digital Me 检查结果|执行状态/);
    assert.doesNotMatch(html, /id="project-folder-card"/);
    assert.match(html, /id="btn-tw-create-project"/);
    assert.match(html, /由 Digital Me 创建新项目/);
    assert.match(html, /使用已有项目/);
    assert.match(html, /创建新任务/);
    assert.equal((html.match(/id="btn-accept-artifact"/g) || []).length, 1);
    assert.doesNotMatch(html, /id="btn-collab-accept"/);
    assert.match(html, /id="artifact-empty"/);
    assert.match(html, /尚未形成可交付成果/);
  });
});
