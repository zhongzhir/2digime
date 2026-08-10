/**
 * 项目命令执行入口 — 跨平台、可审计、Windows 避免 npm.cmd + shell:false → EINVAL。
 * 不拼接不受控 shell 字符串；优先 node + npm-cli.js。
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export type ProjectCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  /** 面向证据展示的命令行（不含绝对 node/cli 噪声时可简化为 npm …） */
  commandLine: string;
  error?: string;
  failureKind?: 'spawn_failed' | 'timeout' | 'non_zero_exit' | null;
};

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

/** 返回 [executable, ...args]；实际执行请走 runCommandShellFalse / runProjectCommand。 */
export function buildNpmTestCommand(
  extraArgs: string[] = ['--if-present'],
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [resolveNpmExecutable(platform), 'test', ...extraArgs];
}

export function buildNpmRunCommand(
  scriptName: string,
  extraArgs: string[] = ['--if-present'],
  platform: NodeJS.Platform = process.platform,
): string[] {
  const script = String(scriptName || '').trim();
  return [resolveNpmExecutable(platform), 'run', script, ...extraArgs];
}

export function buildNpxTscCommand(
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [resolveNpxExecutable(platform), 'tsc', '-p', 'tsconfig.json', '--noEmit'];
}

function firstWhere(bin: string): string | null {
  try {
    const r = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [bin], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 8_000,
    });
    if (r.status !== 0) return null;
    const line = String(r.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    return line || null;
  } catch {
    return null;
  }
}

/** 解析 npm-cli.js（Windows 上避免直接 spawn .cmd）。 */
export function resolveNpmCliJs(): string | null {
  const candidates: string[] = [];
  candidates.push(
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  );
  if (process.env.ProgramFiles) {
    candidates.push(
      path.join(process.env.ProgramFiles, 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    );
  }
  if (process.env['ProgramFiles(x86)']) {
    candidates.push(
      path.join(
        process.env['ProgramFiles(x86)']!,
        'nodejs',
        'node_modules',
        'npm',
        'bin',
        'npm-cli.js',
      ),
    );
  }
  if (process.env.APPDATA) {
    candidates.push(
      path.join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    );
  }
  const whereNpm = firstWhere('npm.cmd') || firstWhere('npm');
  if (whereNpm) {
    candidates.push(
      path.join(path.dirname(whereNpm), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    );
  }
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

export function resolveNpxCliJs(): string | null {
  const npmCli = resolveNpmCliJs();
  if (npmCli) {
    const npx = path.join(path.dirname(npmCli), 'npx-cli.js');
    if (existsSync(npx)) return npx;
  }
  return null;
}

/** cmd.exe 参数转义：仅用于受控 argv，不接受自由文本。 */
export function quoteCmdArg(arg: string): string {
  const s = String(arg ?? '');
  if (s.length === 0) return '""';
  if (!/[\s"&<>|^%!()]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function materializeSpawn(command: string[]): {
  bin: string;
  args: string[];
  display: string;
} {
  const cleaned = command.map((c) => String(c ?? '')).filter((c, i) => i === 0 || c.length > 0);
  const [head, ...rest] = cleaned;
  if (!head) {
    return { bin: '', args: [], display: '' };
  }
  const base = path.basename(head).toLowerCase();
  const displayHead =
    base === 'npm.cmd' || base === 'npm'
      ? 'npm'
      : base === 'npx.cmd' || base === 'npx'
        ? 'npx'
        : head;
  const display = [displayHead, ...rest].join(' ');

  if (process.platform === 'win32') {
    if (base === 'npm' || base === 'npm.cmd') {
      const cli = resolveNpmCliJs();
      if (cli) {
        return { bin: process.execPath, args: [cli, ...rest], display };
      }
      const comspec = process.env.ComSpec || 'cmd.exe';
      const line = ['npm', ...rest].map(quoteCmdArg).join(' ');
      return {
        bin: comspec,
        args: ['/d', '/s', '/c', line],
        display,
      };
    }
    if (base === 'npx' || base === 'npx.cmd') {
      const cli = resolveNpxCliJs();
      if (cli) {
        return { bin: process.execPath, args: [cli, ...rest], display };
      }
      const comspec = process.env.ComSpec || 'cmd.exe';
      const line = ['npx', ...rest].map(quoteCmdArg).join(' ');
      return {
        bin: comspec,
        args: ['/d', '/s', '/c', line],
        display,
      };
    }
    if (/\.(cmd|bat)$/i.test(base)) {
      const comspec = process.env.ComSpec || 'cmd.exe';
      const line = [head, ...rest].map(quoteCmdArg).join(' ');
      return {
        bin: comspec,
        args: ['/d', '/s', '/c', line],
        display,
      };
    }
  }

  return { bin: head, args: rest, display };
}

/**
 * 统一项目命令执行（构建 / 测试 / lint / 启动探测共用）。
 * Windows 不直接 spawn npm.cmd（会 EINVAL）。
 */
export function runProjectCommand(input: {
  command: string[];
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}): ProjectCommandResult {
  const [bin0] = input.command;
  if (!bin0) {
    return {
      status: null,
      stdout: '',
      stderr: 'empty command',
      commandLine: '',
      error: 'empty command',
      failureKind: 'spawn_failed',
    };
  }

  const spawned = materializeSpawn(input.command);
  if (!spawned.bin) {
    return {
      status: null,
      stdout: '',
      stderr: 'empty command',
      commandLine: '',
      error: 'empty command',
      failureKind: 'spawn_failed',
    };
  }

  const result = spawnSync(spawned.bin, spawned.args, {
    cwd: input.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: input.timeoutMs ?? 180_000,
    env: input.env ?? { ...process.env },
    ...(process.platform === 'win32' && path.basename(spawned.bin).toLowerCase() === 'cmd.exe'
      ? { windowsVerbatimArguments: true }
      : {}),
  });

  let failureKind: ProjectCommandResult['failureKind'] = null;
  if (result.error) {
    const msg = result.error.message || '';
    failureKind = /ETIMEDOUT|timed out|TIMEOUT/i.test(msg) ? 'timeout' : 'spawn_failed';
  } else if (result.status !== 0) {
    failureKind = 'non_zero_exit';
  }

  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    commandLine: spawned.display || [spawned.bin, ...spawned.args].join(' '),
    ...(result.error ? { error: result.error.message } : {}),
    failureKind,
  };
}

/** @deprecated 名称保留；实现已改为安全的 runProjectCommand。 */
export function runCommandShellFalse(input: {
  command: string[];
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}): ProjectCommandResult {
  return runProjectCommand(input);
}

/** 仅测试辅助：确认带空格 cwd 时可启动。 */
export function canSpawnWithSpacedCwd(executable: string, cwdWithSpaces: string): boolean {
  const probe = runProjectCommand({
    command: [executable, '--version'],
    cwd: cwdWithSpaces,
    timeoutMs: 15_000,
  });
  void path;
  return probe.failureKind !== 'spawn_failed';
}
