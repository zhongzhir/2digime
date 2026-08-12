/**
 * 2DIGIME-BUILD-01-NONGIT-PROJECT-TRUST-FIX-21
 * 非 Git 用户选择目录信任、传播与硬门。
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
  assertCodexProjectTrust,
  isPathInsideDirectory,
  mapTrustedDirectoryError,
  PROJECT_TRUST_ERRORS,
  resolveProjectOrigin,
  shouldSkipGitRepoCheck,
} from '../git-trust';
import { mapCodexFailure } from '../codex-error-map';
import { buildExecutorTaskPackage } from '../task-package';

const root = path.resolve(__dirname, '../../..');

describe('nongit-project-trust-fix-21', () => {
  it('resolveProjectOrigin：缺省文件夹不落成 unknown', () => {
    assert.equal(resolveProjectOrigin({ projectOrigin: 'user_selected' }), 'user_selected');
    assert.equal(resolveProjectOrigin({ projectOrigin: 'digitalme_created' }), 'digitalme_created');
    assert.equal(resolveProjectOrigin({ isNewProject: true }), 'digitalme_created');
    assert.equal(resolveProjectOrigin({}), 'user_selected');
    assert.equal(resolveProjectOrigin({ projectOrigin: 'unknown' }), 'unknown');
  });

  it('user_selected + 非 Git + 精确授权 → skip', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-21-user-'));
    const project = path.join(tmp, 'app');
    await fs.mkdir(project);
    assert.equal(
      await shouldSkipGitRepoCheck({
        workingDirectory: project,
        authorizedWorkingDirectory: project,
        projectOrigin: 'user_selected',
        readScope: ['.'],
        writeScope: ['.'],
      }),
      true,
    );
    const trust = await assertCodexProjectTrust({
      workingDirectory: project,
      authorizedWorkingDirectory: project,
      projectOrigin: 'user_selected',
      readScope: ['.'],
      writeScope: ['.'],
    });
    assert.equal(trust.skipGitRepoCheck, true);
  });

  it('digitalme_created + 非 Git → skip', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-21-created-'));
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
  });

  it('Git 仓库 → 不 skip', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-21-git-'));
    const project = path.join(tmp, 'repo');
    await fs.mkdir(project);
    await fs.mkdir(path.join(project, '.git'));
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
        authorizedWorkingDirectory: project,
        projectOrigin: 'digitalme_created',
      }),
      false,
    );
  });

  it('unknown + 非 Git → 拒绝', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-21-unk-'));
    const project = path.join(tmp, 'x');
    await fs.mkdir(project);
    await assert.rejects(
      () =>
        assertCodexProjectTrust({
          workingDirectory: project,
          authorizedWorkingDirectory: project,
          projectOrigin: 'unknown',
        }),
      (err: Error & { actionable?: string }) => {
        assert.match(String(err.actionable || err.message), /尚未明确授权/);
        return true;
      },
    );
    assert.equal(
      await shouldSkipGitRepoCheck({
        workingDirectory: project,
        authorizedWorkingDirectory: project,
        projectOrigin: 'unknown',
      }),
      false,
    );
  });

  it('workingDirectory 与授权目录不一致 → 拒绝', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-21-mis-'));
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    await fs.mkdir(a);
    await fs.mkdir(b);
    await assert.rejects(
      () =>
        assertCodexProjectTrust({
          workingDirectory: a,
          authorizedWorkingDirectory: b,
          projectOrigin: 'user_selected',
        }),
      (err: Error) => {
        assert.equal(err.message, PROJECT_TRUST_ERRORS.scope_changed);
        return true;
      },
    );
  });

  it('scope 越界 → 拒绝', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-21-scope-'));
    const project = path.join(tmp, 'p');
    await fs.mkdir(project);
    assert.equal(isPathInsideDirectory('..', project), false);
    await assert.rejects(
      () =>
        assertCodexProjectTrust({
          workingDirectory: project,
          authorizedWorkingDirectory: project,
          projectOrigin: 'user_selected',
          readScope: ['..'],
          writeScope: ['.'],
        }),
      (err: Error) => {
        assert.equal(err.message, PROJECT_TRUST_ERRORS.scope_changed);
        return true;
      },
    );
  });

  it('符号链接根目录 → 拒绝', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-21-link-'));
    const real = path.join(tmp, 'real');
    const link = path.join(tmp, 'link');
    await fs.mkdir(real);
    try {
      await fs.symlink(real, link, 'junction');
    } catch {
      // 环境不支持 symlink 时跳过
      return;
    }
    await assert.rejects(
      () =>
        assertCodexProjectTrust({
          workingDirectory: link,
          authorizedWorkingDirectory: link,
          projectOrigin: 'user_selected',
        }),
      (err: Error) => {
        assert.equal(err.message, PROJECT_TRUST_ERRORS.scope_changed);
        return true;
      },
    );
  });

  it('Codex trusted-directory 错误映射为可行动中文', () => {
    const mapped = mapTrustedDirectoryError(
      'Not inside a trusted directory and --skip-git-repo-check was not specified.',
    );
    assert.ok(mapped);
    assert.match(mapped!, /尚未明确授权|重新选择/);
    assert.doesNotMatch(mapped!, /trusted directory/i);

    const failure = mapCodexFailure({
      texts: ['Not inside a trusted directory and --skip-git-repo-check was not specified.'],
      exitCode: 1,
      changedFilesCount: 0,
    });
    assert.match(failure.actionable, /尚未明确授权|文件夹/);
    assert.doesNotMatch(failure.actionable, /trusted directory/i);
  });

  it('选择器入口写入 user_selected；ExecutorTaskPackage 携带 projectOrigin', async () => {
    const appJs = await fs.readFile(path.join(root, 'electron/renderer/app.js'), 'utf8');
    assert.match(appJs, /await addProjectFolderFromPicker\(false\)/);
    assert.match(appJs, /projectOrigin:\s*"user_selected"/);
    assert.doesNotMatch(
      appJs,
      /projectOrigin:\s*preview\.projectOrigin\s*\|\|\s*"unknown"/,
    );

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-21-pkg-'));
    const project = path.join(tmp, 'sel');
    await fs.mkdir(project);
    const pkg = buildExecutorTaskPackage({
      taskId: 'task_x',
      jobId: 'job_x',
      goal: '改代码',
      workingDirectory: project,
      readScope: ['.'],
      writeScope: ['.'],
      projectBrief: 't',
      priorDecisions: [],
      snapshotId: 'snap_x',
      materialPaths: [],
      subjectDecisionBriefs: [],
      timeoutMs: 60_000,
      executorId: 'external-executor-codex-cli',
      executorSelectionReason: 'test',
      projectOrigin: 'user_selected',
    });
    assert.equal(pkg.projectOrigin, 'user_selected');
  });

  it('job-runner 确认预览始终投影 projectOrigin', async () => {
    const src = await fs.readFile(path.join(root, 'src/work-runtime/job-runner.ts'), 'utf8');
    assert.match(src, /resolveProjectOrigin/);
    assert.match(src, /projectOrigin,/);
    assert.match(src, /createConversationTask[\s\S]*resolveProjectOrigin/);
  });
});
