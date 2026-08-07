/**
 * Digital Me 本地测试命令解析 — Windows 优先 npm.cmd，不改 ExecutionPolicy。
 */
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export function resolveNpmExecutable(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function resolveNpxExecutable(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? 'npx.cmd' : 'npx';
}

/** 返回 [executable, ...args]，供 shell:false 的 spawn/spawnSync 使用。 */
export function buildNpmTestCommand(
  extraArgs: string[] = ['--if-present'],
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [resolveNpmExecutable(platform), 'test', ...extraArgs];
}

export function buildNpxTscCommand(
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [resolveNpxExecutable(platform), 'tsc', '-p', 'tsconfig.json', '--noEmit'];
}

export function runCommandShellFalse(input: {
  command: string[];
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}): {
  status: number | null;
  stdout: string;
  stderr: string;
  commandLine: string;
  error?: string;
} {
  const [bin, ...args] = input.command;
  if (!bin) {
    return {
      status: null,
      stdout: '',
      stderr: 'empty command',
      commandLine: '',
      error: 'empty command',
    };
  }
  const result = spawnSync(bin, args, {
    cwd: input.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: input.timeoutMs ?? 180_000,
    env: input.env ?? { ...process.env },
  });
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    commandLine: [bin, ...args].join(' '),
    ...(result.error ? { error: result.error.message } : {}),
  };
}

/** 仅测试辅助：确认带空格 cwd 时可启动。 */
export function canSpawnWithSpacedCwd(executable: string, cwdWithSpaces: string): boolean {
  const probe = spawnSync(executable, ['--version'], {
    cwd: cwdWithSpaces,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 15_000,
  });
  void path;
  return probe.error == null;
}
