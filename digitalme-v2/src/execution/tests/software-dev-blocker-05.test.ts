/**
 * SOFTWARE-DEVELOPMENT Owner UX BLOCKER-05 — persistence, skip-git, idempotency, semantics, shots, layout.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { buildOwnerAcceptanceSummary } from '../acceptance-summary';
import { shouldSkipGitRepoCheck } from '../git-trust';
import {
  allocateUniqueProjectDir,
  deriveProjectFolderName,
} from '../project-location';
import { deriveAcceptanceCriteria } from '../task-package';

const root = path.resolve(__dirname, '../../..');

describe('software-dev-blocker-05', () => {
  it('无 test script 不得呈现为测试失败', () => {
    const summary = buildOwnerAcceptanceSummary({
      verification: {
        overall: 'partially_satisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: [
          {
            id: 'tests_configured',
            title: '是否配置自动测试',
            verdict: 'unsatisfied',
            detail: 'no test script',
          },
          {
            id: 'tests_passed',
            title: '测试',
            verdict: 'unverifiable',
            detail: 'skipped',
          },
          {
            id: 'run_startup_check',
            title: '启动检查',
            verdict: 'unsatisfied',
            detail: '启动检查失败：找不到入口',
          },
          {
            id: 'file_changes',
            title: '文件变化',
            verdict: 'satisfied',
            detail: '3 files',
          },
        ],
      },
      changedFileCount: 3,
    });
    assert.ok(summary.bullets.some((b) => /没有配置自动测试/.test(b)));
    assert.ok(summary.bullets.every((b) => !/测试失败|测试没有通过|测试无法通过/.test(b)));
    assert.ok(summary.bullets.some((b) => /启动检查失败/.test(b)));
    assert.equal(summary.canAdoptSuggested, false);
  });

  it('自动测试失败 / 构建失败 / 启动失败分别呈现', () => {
    const summary = buildOwnerAcceptanceSummary({
      verification: {
        overall: 'unsatisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: false,
        checks: [
          {
            id: 'tests_configured',
            title: '是否配置自动测试',
            verdict: 'satisfied',
            detail: 'has test',
          },
          {
            id: 'tests_passed',
            title: '测试',
            verdict: 'unsatisfied',
            detail: 'exit 1',
          },
          {
            id: 'build_check',
            title: '构建',
            verdict: 'unsatisfied',
            detail: 'build failed',
          },
          {
            id: 'run_startup_check',
            title: '启动检查',
            verdict: 'unsatisfied',
            detail: 'crash',
          },
          {
            id: 'file_changes',
            title: '文件变化',
            verdict: 'satisfied',
            detail: '2 files',
          },
        ],
      },
      changedFileCount: 2,
    });
    assert.ok(summary.bullets.some((b) => /自动测试失败/.test(b)));
    assert.ok(summary.bullets.some((b) => /构建失败/.test(b)));
    assert.ok(summary.bullets.some((b) => /启动检查失败/.test(b)));
  });

  it('启动检查失败不得建议可以试用；通过才允许', () => {
    const failed = buildOwnerAcceptanceSummary({
      verification: {
        overall: 'partially_satisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: [
          {
            id: 'run_startup_check',
            title: '启动检查',
            verdict: 'unsatisfied',
            detail: 'blank screen',
          },
          {
            id: 'file_changes',
            title: '文件变化',
            verdict: 'satisfied',
            detail: 'ok',
          },
        ],
      },
      changedFileCount: 4,
    });
    assert.equal(failed.canAdoptSuggested, false);
    assert.ok(failed.adoptWarnings.some((w) => /启动检查/.test(w)));

    const passed = buildOwnerAcceptanceSummary({
      verification: {
        overall: 'satisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: [
          {
            id: 'run_startup_check',
            title: '启动检查',
            verdict: 'satisfied',
            detail: 'ok',
          },
          {
            id: 'file_changes',
            title: '文件变化',
            verdict: 'satisfied',
            detail: 'ok',
          },
          {
            id: 'scope_boundary',
            title: '范围',
            verdict: 'satisfied',
            detail: 'ok',
          },
          {
            id: 'tests_configured',
            title: '测试配置',
            verdict: 'unsatisfied',
            detail: 'none',
          },
        ],
      },
      changedFileCount: 4,
    });
    assert.equal(passed.canAdoptSuggested, true);
  });

  it('仅 digitalme_created + 授权目录 + 非 git 才 skip repo check', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-skip-git-'));
    const project = path.join(tmp, 'game');
    await fs.mkdir(project);
    assert.equal(
      await shouldSkipGitRepoCheck({
        workingDirectory: project,
        authorizedWorkingDirectory: project,
        projectOrigin: 'digitalme_created',
      }),
      true,
    );
    assert.equal(
      await shouldSkipGitRepoCheck({
        workingDirectory: project,
        authorizedWorkingDirectory: project,
        projectOrigin: 'user_selected',
      }),
      false,
    );
    assert.equal(
      await shouldSkipGitRepoCheck({
        workingDirectory: project,
        authorizedWorkingDirectory: path.join(tmp, 'other'),
        projectOrigin: 'digitalme_created',
      }),
      false,
    );
    await fs.mkdir(path.join(project, '.git'));
    assert.equal(
      await shouldSkipGitRepoCheck({
        workingDirectory: project,
        authorizedWorkingDirectory: project,
        projectOrigin: 'digitalme_created',
      }),
      false,
    );
  });

  it('retry 复用同名空目录，不创建 (2)', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-proj-'));
    const first = await allocateUniqueProjectDir(rootDir, '开发一个俄罗斯方块游戏');
    assert.equal(first.folderName, '俄罗斯方块');
    assert.equal(first.created, true);
    const second = await allocateUniqueProjectDir(rootDir, '开发一个俄罗斯方块游戏');
    assert.equal(second.absolutePath, first.absolutePath);
    assert.equal(second.reused, true);
    assert.ok(!(await fs.stat(path.join(rootDir, '俄罗斯方块 (2)')).then(() => true).catch(() => false)));
  });

  it('非空目录才分配 (2)，不覆盖已有项目', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-proj2-'));
    const first = await allocateUniqueProjectDir(rootDir, '俄罗斯方块');
    await fs.writeFile(path.join(first.absolutePath, 'index.html'), '<html></html>', 'utf8');
    const second = await allocateUniqueProjectDir(rootDir, '俄罗斯方块');
    assert.equal(second.folderName, '俄罗斯方块 (2)');
    assert.notEqual(second.absolutePath, first.absolutePath);
  });

  it('游戏目标派生启动验收条件', () => {
    const criteria = deriveAcceptanceCriteria('开发一个俄罗斯方块游戏');
    assert.ok(criteria.some((c) => /能够启动/.test(c)));
    assert.ok(criteria.some((c) => /启动检查/.test(c)));
    assert.equal(deriveProjectFolderName('开发一款“俄罗斯方块”游戏。'), '俄罗斯方块');
  });

  it('UI 含截图反馈与成果独立滚动', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    const html = await fs.readFile(path.join(root, 'electron/renderer/index.html'), 'utf8');
    const css = await fs.readFile(path.join(root, 'electron/renderer/styles.css'), 'utf8');
    const main = await fs.readFile(path.join(root, 'electron/main.cjs'), 'utf8');
    assert.match(html, /revision-shots/);
    assert.match(html, /添加截图/);
    assert.match(html, /artifact-scroll/);
    assert.match(appJs, /saveRevisionImage/);
    assert.match(appJs, /attachmentPaths/);
    assert.match(appJs, /addRevisionShotFromDataUrl/);
    assert.match(appJs, /请用文字写清问题要点/);
    assert.match(appJs, /还不能正常运行/);
    assert.match(appJs, /可以试用了/);
    assert.match(main, /shell:saveRevisionImage/);
    assert.match(main, /reuseEmptySameName|prepareSoftwareProject/);
    assert.match(css, /\.artifact-scroll\s*\{/);
    assert.match(css, /scrollbar-gutter:\s*stable/);
    assert.match(css, /height:\s*calc\(100vh/);
  });

  it('Codex 生产路径支持条件性 skip-git-repo-check', async () => {
    const codex = await fs.readFile(
      path.join(root, 'src/capability/adapters/external-executor-codex.ts'),
      'utf8',
    );
    assert.match(codex, /skipGitRepoCheck/);
    assert.match(codex, /shouldSkipGitRepoCheck/);
    assert.match(codex, /--skip-git-repo-check/);
  });

  it('resume 启动器含磁盘诊断且拒绝无 package', async () => {
    const launcher = await fs.readFile(
      path.join(root, 'scripts/start-software-dev-owner-acceptance.cjs'),
      'utf8',
    );
    assert.match(launcher, /inspectResumePackage/);
    assert.match(launcher, /resume_empty_package/);
    assert.match(launcher, /subjects\/default\/manifest\.json/);
    assert.match(launcher, /BLOCKER-05/);
  });

  it('reviseArtifact 接受 attachmentPaths 并入材料链', async () => {
    const runner = await fs.readFile(path.join(root, 'src/work-runtime/job-runner.ts'), 'utf8');
    const cmds = await fs.readFile(path.join(root, 'src/runtime/commands.ts'), 'utf8');
    assert.match(runner, /attachmentPaths/);
    assert.match(runner, /appendContextRefs/);
    assert.match(cmds, /attachmentPaths\?: string\[\]/);
  });

  it('task-artifact isolation 不回归：成果按 task 绑定', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(appJs, /activeTaskId/);
    assert.match(appJs, /artifact\.taskId|taskId !== activeTaskId|不属于/);
  });
});
