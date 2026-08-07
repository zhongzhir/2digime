/**
 * 软件项目启动/构建检查 — 与「自动测试」分离。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { detectProjectRunInfo, type ProjectRunInfo } from './run-detection';
import { runCommandShellFalse, resolveNpmExecutable } from './test-command';

export type SoftwareCheckKind =
  | 'auto_test_passed'
  | 'auto_test_failed'
  | 'no_auto_test'
  | 'test_command_unstartable'
  | 'build_failed'
  | 'build_passed'
  | 'startup_failed'
  | 'startup_passed'
  | 'run_not_verified';

export type SoftwareCheckResult = {
  kind: SoftwareCheckKind;
  label: string;
  detail?: string;
  runInfo?: ProjectRunInfo;
  canSuggestTryRun: boolean;
};

async function readPackageScripts(
  workingDirectory: string,
): Promise<Record<string, string> | null> {
  try {
    const raw = await fs.readFile(path.join(workingDirectory, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    if (!parsed.scripts || typeof parsed.scripts !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.scripts)) {
      if (typeof v === 'string' && v.trim()) out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

export async function inspectAutoTestConfig(workingDirectory: string): Promise<{
  hasPackageJson: boolean;
  hasTestScript: boolean;
}> {
  const scripts = await readPackageScripts(workingDirectory);
  if (scripts == null) return { hasPackageJson: false, hasTestScript: false };
  return { hasPackageJson: true, hasTestScript: typeof scripts.test === 'string' };
}

/**
 * 轻量启动检查：确认入口/脚本存在，并对短生命周期命令做失败探测。
 * 不假报「可以试用」。
 */
export async function runStartupCheck(
  workingDirectory: string,
): Promise<SoftwareCheckResult> {
  const runInfo = await detectProjectRunInfo(workingDirectory);
  if (!runInfo.runnable) {
    return {
      kind: 'startup_failed',
      label: '启动检查失败',
      detail: runInfo.reason || '找不到可靠的启动入口',
      runInfo,
      canSuggestTryRun: false,
    };
  }

  if (runInfo.kind === 'html' && runInfo.entryPath) {
    try {
      await fs.access(runInfo.entryPath);
      return {
        kind: 'startup_passed',
        label: '已通过启动检查',
        detail: '已找到可打开的页面入口',
        runInfo,
        canSuggestTryRun: true,
      };
    } catch {
      return {
        kind: 'startup_failed',
        label: '启动检查失败',
        detail: '页面入口文件不存在',
        runInfo,
        canSuggestTryRun: false,
      };
    }
  }

  if (runInfo.kind === 'npm_script' && runInfo.command) {
    const scriptName = runInfo.command.replace(/^npm run\s+/, '').trim();
    // 对 start/dev：仅验证脚本可解析；短超时探测立即崩溃
    const npm = resolveNpmExecutable();
    const probe = runCommandShellFalse({
      command: [npm, 'run', scriptName, '--if-present'],
      cwd: workingDirectory,
      timeoutMs: 8_000,
      env: { ...process.env, npm_config_yes: 'true' },
    });
    // 超时通常表示进程仍在跑（开发服务器）→ 视为启动检查通过
    const timedOut =
      !!probe.error && /ETIMEDOUT|timed out|TIMEOUT/i.test(probe.error);
    if (timedOut) {
      return {
        kind: 'startup_passed',
        label: '已通过启动检查',
        detail: `启动命令可用：${runInfo.command}`,
        runInfo,
        canSuggestTryRun: true,
      };
    }
    if (probe.status === 0) {
      return {
        kind: 'startup_passed',
        label: '已通过启动检查',
        detail: `启动命令已成功结束：${runInfo.command}`,
        runInfo,
        canSuggestTryRun: true,
      };
    }
    const detail = (probe.stderr || probe.stdout || probe.error || '启动命令失败')
      .toString()
      .slice(0, 400);
    return {
      kind: 'startup_failed',
      label: '启动检查失败',
      detail,
      runInfo,
      canSuggestTryRun: false,
    };
  }

  if (runInfo.kind === 'python' && runInfo.entryPath) {
    try {
      await fs.access(runInfo.entryPath);
      return {
        kind: 'startup_passed',
        label: '已通过启动检查',
        detail: '已找到 Python 入口',
        runInfo,
        canSuggestTryRun: true,
      };
    } catch {
      return {
        kind: 'startup_failed',
        label: '启动检查失败',
        detail: 'Python 入口不存在',
        runInfo,
        canSuggestTryRun: false,
      };
    }
  }

  return {
    kind: 'run_not_verified',
    label: '尚未验证实际运行',
    detail: runInfo.label || '已发现可能的运行方式，但尚未完成启动检查',
    runInfo,
    canSuggestTryRun: false,
  };
}

export async function runBuildCheck(
  workingDirectory: string,
): Promise<SoftwareCheckResult | null> {
  const scripts = await readPackageScripts(workingDirectory);
  if (!scripts || !scripts.build) return null;
  const npm = resolveNpmExecutable();
  const r = runCommandShellFalse({
    command: [npm, 'run', 'build', '--if-present'],
    cwd: workingDirectory,
    timeoutMs: 180_000,
    env: { ...process.env, npm_config_yes: 'true' },
  });
  if (r.status === 0) {
    return {
      kind: 'build_passed',
      label: '构建通过',
      detail: 'npm run build 成功',
      canSuggestTryRun: false,
    };
  }
  return {
    kind: 'build_failed',
    label: '构建失败',
    detail: (r.stderr || r.stdout || r.error || '').toString().slice(0, 400),
    canSuggestTryRun: false,
  };
}
