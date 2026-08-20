/**
 * FIX-05：Windows 命令执行 + 技术证据 + 目标判断（隔离 fixture，不碰 MUHUB）。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
  buildOwnerAcceptanceSummary,
  summarizeDiffStats,
} from '../acceptance-summary';
import { runBuildCheck, runStartupCheck } from '../startup-check';
import {
  buildNpmRunCommand,
  quoteCmdArg,
  resolveNpmCliJs,
  runProjectCommand,
} from '../test-command';

async function writePkg(
  dir: string,
  scripts: Record<string, string>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fix05-fixture', private: true, scripts, ...extra }, null, 2),
    'utf8',
  );
}

describe('FIX-05 windows validation evidence', () => {
  it('根因：Windows 上 npm.cmd + shell:false 产生 EINVAL', () => {
    if (process.platform !== 'win32') return;
    const bad = spawnSync('npm.cmd', ['--version'], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 8_000,
    });
    assert.ok(bad.error, '预期 spawn 失败');
    assert.match(String(bad.error?.message || ''), /EINVAL/i);
  });

  it('runProjectCommand：成功拿到 npm 版本（无 EINVAL）', () => {
    const v = runProjectCommand({
      command: [process.platform === 'win32' ? 'npm.cmd' : 'npm', '--version'],
      cwd: process.cwd(),
      timeoutMs: 20_000,
    });
    assert.notEqual(v.failureKind, 'spawn_failed', v.error || v.stderr);
    assert.equal(v.status, 0);
    assert.match(v.stdout.trim(), /^\d+\.\d+/);
    assert.ok(!/EINVAL/i.test(v.error || ''));
    if (process.platform === 'win32') {
      assert.ok(typeof resolveNpmCliJs() === 'string' || resolveNpmCliJs() === null);
    }
  });

  it('非零退出码正确回报', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-fix05-fail-'));
    await writePkg(dir, { build: 'node -e "process.exit(2)"' });
    const r = runProjectCommand({
      command: buildNpmRunCommand('build', []),
      cwd: dir,
      timeoutMs: 60_000,
    });
    assert.equal(r.failureKind, 'non_zero_exit');
    assert.notEqual(r.status, 0);
    assert.ok(r.commandLine.includes('build'));
  });

  it('缺少 script：构建检查为 not_configured，不是 execution_failed', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-fix05-noscript-'));
    await writePkg(dir, { start: 'node -e "console.log(1)"' });
    const build = await runBuildCheck(dir);
    assert.ok(build);
    assert.equal(build!.kind, 'not_configured');
    assert.doesNotMatch(build!.detail || '', /EINVAL/i);
  });

  it('超时：failureKind=timeout；启动探测可把超时视为命令可启动', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-fix05-to-'));
    await writePkg(dir, {
      start: 'node -e "setTimeout(()=>{}, 60000)"',
    });
    const probe = runProjectCommand({
      command: buildNpmRunCommand('start', []),
      cwd: dir,
      timeoutMs: 1_500,
    });
    assert.equal(probe.failureKind, 'timeout');

    const startup = await runStartupCheck(dir);
    assert.equal(startup.kind, 'startup_passed');
    assert.ok(startup.commandLine);
    assert.doesNotMatch(startup.detail || '', /EINVAL/i);
  });

  it('路径含空格时仍可执行', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'dm fix05 space '));
    const dir = path.join(parent, 'proj with spaces');
    await fs.mkdir(dir, { recursive: true });
    await writePkg(dir, { build: 'node -e "console.log(\'ok-space\')"' });
    const r = runProjectCommand({
      command: buildNpmRunCommand('build', []),
      cwd: dir,
      timeoutMs: 60_000,
    });
    assert.notEqual(r.failureKind, 'spawn_failed', r.error || '');
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /ok-space/);
  });

  it('quoteCmdArg 对危险字符加引号', () => {
    assert.equal(quoteCmdArg('plain'), 'plain');
    assert.equal(quoteCmdArg('a b'), '"a b"');
    assert.equal(quoteCmdArg('a"b'), '"a""b"');
  });

  it('真实 build 检查在 Windows fixture 上通过', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-fix05-build-'));
    await writePkg(dir, { build: 'node -e "console.log(\'built\')"' });
    const build = await runBuildCheck(dir);
    assert.ok(build);
    assert.equal(build!.kind, 'build_passed');
    assert.match(build!.detail || '', /命令：/);
    assert.match(build!.detail || '', /退出码：0/);
    assert.doesNotMatch(build!.detail || '', /EINVAL/i);
  });

  it('技术证据含完整文件列表、diff 摘要、命令结果，并区分 not_configured', () => {
    const files = ['app/page.tsx', 'components/home/hero.tsx'];
    const diff = [
      'diff --git a/app/page.tsx b/app/page.tsx',
      '+++ b/app/page.tsx',
      '+line1',
      '+line2',
      '-old',
      'diff --git a/components/home/hero.tsx b/components/home/hero.tsx',
      '+++ b/components/home/hero.tsx',
      '+hero',
    ].join('\n');
    const stats = summarizeDiffStats(diff, files);
    assert.equal(stats[0]!.added, 2);
    assert.equal(stats[0]!.deleted, 1);

    const summary = buildOwnerAcceptanceSummary({
      verification: {
        overall: 'partially_satisfied',
        digitalMeVerified: true,
        agentClaimedSuccess: true,
        checks: [
          {
            id: 'goal_alignment',
            title: '目标',
            verdict: 'partially_satisfied',
            detail:
              '已有 2 个文件变更；已结合执行前说明与 diff；辅助词命中 1/7（不作为主判定）',
          },
          {
            id: 'file_changes',
            title: '文件变化',
            verdict: 'satisfied',
            detail: '2 files',
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
            detail: '这个项目没有配置自动测试',
          },
          {
            id: 'tests_executed',
            title: '自动测试是否执行',
            verdict: 'unverifiable',
            detail: '未配置测试（not_configured），未执行',
          },
          {
            id: 'tests_passed',
            title: '自动测试结果',
            verdict: 'unverifiable',
            detail: '未配置测试（not_configured）',
          },
          {
            id: 'build_check',
            title: '构建检查',
            verdict: 'satisfied',
            detail: '命令：npm run build；退出码：0',
          },
          {
            id: 'run_startup_check',
            title: '启动检查',
            verdict: 'satisfied',
            detail: '命令：npm run start；退出码：无；启动命令可用',
          },
          {
            id: 'git_integrity',
            title: '是否存在未说明的提交或 HEAD 移动',
            verdict: 'satisfied',
            detail: '未检测到禁止的提交操作',
          },
        ],
      },
      changedFileCount: 2,
      evidence: {
        changedFiles: files,
        unifiedDiff: diff,
        outOfScopeChanges: [],
      },
    });

    assert.ok(summary.technicalBullets.some((b) => b.includes('app/page.tsx')));
    assert.ok(summary.technicalBullets.some((b) => b.includes('components/home/hero.tsx')));
    assert.ok(summary.technicalBullets.some((b) => /变更摘要 app\/page\.tsx：\+2 \/ -1/.test(b)));
    assert.ok(summary.technicalBullets.some((b) => /构建：通过/.test(b)));
    assert.ok(summary.technicalBullets.some((b) => /启动：通过/.test(b)));
    assert.ok(summary.technicalBullets.some((b) => /未配置（not_configured）/.test(b)));
    assert.ok(summary.technicalBullets.some((b) => /越界修改：无/.test(b)));
    assert.ok(summary.technicalBullets.some((b) => /自动 commit \/ HEAD：未移动/.test(b)));
    assert.ok(summary.technicalBullets.some((b) => /不作为主判定/.test(b)));
    assert.ok(summary.bullets.every((b) => !/命中关键词 1\/7/.test(b)));
  });
});
