/**
 * SOFTWARE-DEVELOPMENT Owner UX BLOCKER-04 — unit coverage.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { buildOwnerAcceptanceSummary } from '../acceptance-summary';
import {
  allocateUniqueProjectDir,
  deriveProjectFolderName,
  displayProjectsRelativePath,
  resolveDigitalMeProjectsRoot,
} from '../project-location';
import { detectProjectRunInfo } from '../run-detection';
import {
  AWAITING_CONFIRM_LABEL,
  NEEDS_REVISION_LABEL,
  userFacingLabelFromLatestJob,
} from '../../work-runtime/derive';
import type { ExecutionJob } from '../../work-runtime/execution-job';

function job(partial: Partial<ExecutionJob> & Pick<ExecutionJob, 'id' | 'status'>): ExecutionJob {
  return {
    taskId: 't1',
    capabilityId: 'cap',
    createdAt: '2026-08-07T00:00:00.000Z',
    ...partial,
  };
}

describe('software-dev-blocker-04', () => {
  it('验收摘要默认层不暴露关键词命中等机器指标', () => {
    const summary = buildOwnerAcceptanceSummary({
      verification: {
        overall: 'partially_satisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: [
          {
            id: 'goal_alignment',
            title: '目标对齐',
            verdict: 'partially_satisfied',
            detail: '命中关键词 0/1',
          },
          {
            id: 'tests_passed',
            title: '测试',
            verdict: 'unsatisfied',
            detail: 'exit 1',
          },
          {
            id: 'file_changes',
            title: '文件变化',
            verdict: 'satisfied',
            detail: '3 files',
          },
          {
            id: 'scope_boundary',
            title: '范围',
            verdict: 'satisfied',
            detail: 'ok',
          },
        ],
      },
      changedFileCount: 3,
    });
    assert.ok(
      summary.headline === '还有问题需要处理' ||
        /修订|问题|未达标|建议/.test(summary.headline),
    );
    assert.match(summary.executionStatusLabel, /本次处理已结束/);
    assert.ok(summary.bullets.some((b) => /自动测试失败|测试没有通过|测试/.test(b)));
    assert.ok(summary.bullets.every((b) => !/命中关键词/.test(b)));
    assert.ok(summary.technicalBullets.some((b) => /目标核对|目标对齐/.test(b)));
    assert.ok(
      summary.technicalBullets.some((b) => /修改文件/.test(b)),
      '技术证据应含修改文件',
    );
    assert.equal(summary.canAdoptSuggested, false);
    assert.ok(summary.adoptWarnings.length >= 1);
  });

  it('验收通过时建议可以采用', () => {
    const summary = buildOwnerAcceptanceSummary({
      verification: {
        overall: 'satisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: [
          { id: 'tests_passed', title: '测试', verdict: 'satisfied', detail: '' },
          { id: 'scope_boundary', title: '范围', verdict: 'satisfied', detail: '' },
        ],
      },
      changedFileCount: 2,
    });
    assert.equal(summary.canAdoptSuggested, true);
    assert.match(summary.headline, /可以采用|可以试用|达到规划/);
  });

  it('任务列表区分建议继续修改 / 需要你确认 / 已采用', () => {
    const succeeded = [job({ id: 'j1', status: 'succeeded', artifactId: 'a1' })];
    assert.equal(
      userFacingLabelFromLatestJob(succeeded, {
        softwareOutcome: {
          isCodeChange: true,
          verificationOverall: 'partially_satisfied',
          canAdoptSuggested: false,
        },
      }),
      NEEDS_REVISION_LABEL,
    );
    assert.equal(
      userFacingLabelFromLatestJob(succeeded, {
        softwareOutcome: {
          isCodeChange: true,
          verificationOverall: 'satisfied',
          canAdoptSuggested: true,
        },
      }),
      AWAITING_CONFIRM_LABEL,
    );
    assert.equal(
      userFacingLabelFromLatestJob(succeeded, {
        softwareOutcome: {
          isCodeChange: true,
          ownerDecision: 'accepted',
        },
      }),
      '已采用 · 尚未验证',
    );
  });

  it('新项目名从目标安全派生；空目录复用，非空才 (2)', async () => {
    assert.equal(deriveProjectFolderName('开发一个俄罗斯方块游戏。'), '俄罗斯方块');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-projects-'));
    const first = await allocateUniqueProjectDir(root, '开发一个俄罗斯方块游戏');
    const second = await allocateUniqueProjectDir(root, '开发一个俄罗斯方块游戏');
    assert.equal(first.absolutePath, second.absolutePath);
    assert.equal(second.reused, true);
    await fs.writeFile(path.join(first.absolutePath, 'keep.txt'), 'x', 'utf8');
    const third = await allocateUniqueProjectDir(root, '开发一个俄罗斯方块游戏');
    assert.notEqual(third.absolutePath, first.absolutePath);
    assert.match(third.folderName, /俄罗斯方块 \(2\)/);
    const st1 = await fs.stat(first.absolutePath);
    const st3 = await fs.stat(third.absolutePath);
    assert.ok(st1.isDirectory());
    assert.ok(st3.isDirectory());
  });

  it('Documents/Digital Me Projects 路径派生', () => {
    const docs = 'C:\\Users\\demo\\Documents';
    const root = resolveDigitalMeProjectsRoot(docs);
    assert.match(root, /Digital Me Projects$/);
    const display = displayProjectsRelativePath(
      docs,
      path.join(root, '俄罗斯方块'),
    );
    assert.match(display, /Digital Me Projects/);
    assert.match(display, /俄罗斯方块/);
  });

  it('runnable 与非 runnable 探测诚实', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-run-'));
    const empty = await detectProjectRunInfo(root);
    assert.equal(empty.runnable, false);

    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { start: 'node index.js' } }),
      'utf8',
    );
    const npm = await detectProjectRunInfo(root);
    assert.equal(npm.runnable, true);
    assert.equal(npm.kind, 'npm_script');
    assert.equal(npm.command, 'npm run start');

    const htmlRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-html-'));
    await fs.writeFile(path.join(htmlRoot, 'index.html'), '<html></html>', 'utf8');
    const html = await detectProjectRunInfo(htmlRoot);
    assert.equal(html.runnable, true);
    assert.equal(html.kind, 'html');
  });

  it('UI 文案含创建新项目与下一步，不含空文件夹主入口', async () => {
    const html = await fs.readFile(
      path.join(__dirname, '../../../electron/renderer/index.html'),
      'utf8',
    );
    const appJs = await fs.readFile(
      path.join(__dirname, '../../../electron/renderer/app.js'),
      'utf8',
    );
    const css = await fs.readFile(
      path.join(__dirname, '../../../electron/renderer/styles.css'),
      'utf8',
    );
    assert.match(html, /由 Digital Me 创建新项目/);
    assert.match(html, /使用已有项目/);
    assert.match(html, /next-steps-card/);
    assert.match(html, /正在按你的修改要求继续处理/);
    assert.match(html, /技术证据/);
    assert.match(appJs, /renderNextStepsCard/);
    assert.match(appJs, /prepareSoftwareProject/);
    assert.match(appJs, /showRevisionActiveBanner/);
    assert.match(appJs, /forceAdopt/);
    assert.match(appJs, /scrollbar-gutter|has-artifact/);
    assert.match(css, /scrollbar-gutter:\s*stable/);
    assert.doesNotMatch(html, /选择空文件夹开始新项目/);
  });
});
