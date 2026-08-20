/**
 * 软件项目启动/构建检查 — 与「自动测试」分离。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { detectProjectRunInfo, type ProjectRunInfo } from './run-detection';
import {
  buildNpmRunCommand,
  runProjectCommand,
} from './test-command';

export type SoftwareCheckKind =
  | 'auto_test_passed'
  | 'auto_test_failed'
  | 'no_auto_test'
  | 'test_command_unstartable'
  | 'not_configured'
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
  commandLine?: string;
  exitCode?: number | null;
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

function formatCmdEvidence(input: {
  commandLine: string;
  status: number | null;
  error?: string;
  tail?: string;
}): string {
  const parts = [
    `命令：${input.commandLine}`,
    `退出码：${input.status == null ? '无' : String(input.status)}`,
  ];
  if (input.error) parts.push(`错误：${input.error.slice(0, 160)}`);
  if (input.tail) parts.push(input.tail.slice(0, 200));
  return parts.join('；');
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
      kind: 'not_configured',
      label: '未配置可用启动方式',
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
    const scripts = await readPackageScripts(workingDirectory);
    if (!scripts || !scripts[scriptName]) {
      return {
        kind: 'not_configured',
        label: '未配置启动脚本',
        detail: `package.json 中无脚本 ${scriptName}`,
        runInfo,
        canSuggestTryRun: false,
      };
    }
    const command = buildNpmRunCommand(scriptName, ['--if-present']);
    const probe = runProjectCommand({
      command,
      cwd: workingDirectory,
      timeoutMs: 8_000,
      env: { ...process.env, npm_config_yes: 'true' },
    });
    const timedOut = probe.failureKind === 'timeout';
    if (timedOut) {
      return {
        kind: 'startup_passed',
        label: '已通过启动检查',
        detail: formatCmdEvidence({
          commandLine: probe.commandLine,
          status: probe.status,
          tail: `启动命令可用：${runInfo.command}`,
        }),
        runInfo,
        canSuggestTryRun: true,
        commandLine: probe.commandLine,
        exitCode: probe.status,
      };
    }
    if (probe.failureKind === 'spawn_failed') {
      return {
        kind: 'startup_failed',
        label: '启动检查失败',
        detail: formatCmdEvidence({
          commandLine: probe.commandLine,
          status: probe.status,
          ...(probe.error ? { error: probe.error } : {}),
        }),
        runInfo,
        canSuggestTryRun: false,
        commandLine: probe.commandLine,
        exitCode: probe.status,
      };
    }
    if (probe.status === 0) {
      return {
        kind: 'startup_passed',
        label: '已通过启动检查',
        detail: formatCmdEvidence({
          commandLine: probe.commandLine,
          status: 0,
          tail: `启动命令已成功结束：${runInfo.command}`,
        }),
        runInfo,
        canSuggestTryRun: true,
        commandLine: probe.commandLine,
        exitCode: 0,
      };
    }
    const tail = (probe.stderr || probe.stdout || '').toString().slice(0, 200);
    return {
      kind: 'startup_failed',
      label: '启动检查失败',
      detail: formatCmdEvidence({
        commandLine: probe.commandLine,
        status: probe.status,
        ...(probe.error ? { error: probe.error } : {}),
        tail,
      }),
      runInfo,
      canSuggestTryRun: false,
      commandLine: probe.commandLine,
      exitCode: probe.status,
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
  if (scripts == null) {
    return {
      kind: 'not_configured',
      label: '未配置构建',
      detail: '未发现 package.json',
      canSuggestTryRun: false,
    };
  }
  if (!scripts.build) {
    return {
      kind: 'not_configured',
      label: '未配置构建脚本',
      detail: 'package.json 中无 build 脚本',
      canSuggestTryRun: false,
    };
  }
  const command = buildNpmRunCommand('build', ['--if-present']);
  const r = runProjectCommand({
    command,
    cwd: workingDirectory,
    timeoutMs: 180_000,
    env: { ...process.env, npm_config_yes: 'true' },
  });
  if (r.status === 0) {
    return {
      kind: 'build_passed',
      label: '构建通过',
      detail: formatCmdEvidence({ commandLine: r.commandLine, status: 0 }),
      canSuggestTryRun: false,
      commandLine: r.commandLine,
      exitCode: 0,
    };
  }
  if (r.failureKind === 'spawn_failed') {
    return {
      kind: 'build_failed',
      label: '构建失败',
      detail: formatCmdEvidence({
        commandLine: r.commandLine,
        status: r.status,
        ...(r.error ? { error: r.error } : {}),
      }),
      canSuggestTryRun: false,
      commandLine: r.commandLine,
      exitCode: r.status,
    };
  }
  return {
    kind: 'build_failed',
    label: '构建失败',
    detail: formatCmdEvidence({
      commandLine: r.commandLine,
      status: r.status,
      ...(r.error ? { error: r.error } : {}),
      tail: (r.stderr || r.stdout || '').toString().slice(0, 200),
    }),
    canSuggestTryRun: false,
    commandLine: r.commandLine,
    exitCode: r.status,
  };
}
