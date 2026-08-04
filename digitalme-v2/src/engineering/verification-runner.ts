/**
 * Digital Me 独立验证 — 不采信 Agent 自报。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { VerificationCheck } from '../capability/adapters/software-engineering-contract';
import type { WorkspaceHandle } from './workspace-manager';

export async function runIndependentVerification(
  workspace: WorkspaceHandle,
  logsDir: string,
): Promise<VerificationCheck[]> {
  await fs.mkdir(logsDir, { recursive: true });
  const checks: VerificationCheck[] = [];

  checks.push(await runCheck('tsc', workspace, logsDir, ['npx', 'tsc', '-p', 'tsconfig.json']));
  checks.push(await runCheck('unit-test', workspace, logsDir, ['npm', 'test']));
  checks.push(await uiStaticCheck(workspace, logsDir));

  return checks;
}

async function runCheck(
  name: string,
  workspace: WorkspaceHandle,
  logsDir: string,
  command: string[],
): Promise<VerificationCheck> {
  const t0 = Date.now();
  const [bin, ...args] = command;
  const result = spawnSync(bin!, args, {
    cwd: workspace.rootPath,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, npm_config_yes: 'true' },
  });
  const logPath = path.join(logsDir, `${name}.log`);
  const body = [
    `$ ${command.join(' ')}`,
    `exit=${result.status}`,
    String(result.stdout || ''),
    String(result.stderr || ''),
  ].join('\n');
  await fs.writeFile(logPath, body, 'utf8');
  const ok = result.status === 0;
  const check: VerificationCheck = {
    name,
    commandOrActionSummary: command.join(' '),
    status: ok ? 'passed' : 'failed',
    durationMs: Date.now() - t0,
    evidenceRef: `logs/${name}.log`,
    reproducible: true,
    verdictSource: 'digitalme_verified',
  };
  if (!ok) {
    check.failureSummary = truncate(String(result.stderr || result.stdout || 'failed'), 400);
  }
  return check;
}

async function uiStaticCheck(
  workspace: WorkspaceHandle,
  logsDir: string,
): Promise<VerificationCheck> {
  const t0 = Date.now();
  const labelPath = path.join(workspace.rootPath, 'src', 'label.ts');
  let text = '';
  try {
    text = await fs.readFile(labelPath, 'utf8');
  } catch (error) {
    const logPath = path.join(logsDir, 'ui-static.log');
    await fs.writeFile(logPath, String(error), 'utf8');
    return {
      name: 'ui-static-label',
      commandOrActionSummary: 'read src/label.ts and assert PRIMARY_BUTTON_LABEL',
      status: 'error',
      durationMs: Date.now() - t0,
      evidenceRef: 'logs/ui-static.log',
      failureSummary: '无法读取 label.ts',
      reproducible: true,
      verdictSource: 'digitalme_verified',
    };
  }
  const ok =
    /PRIMARY_BUTTON_LABEL\s*=\s*['"]开始处理['"]/.test(text) &&
    !/PRIMARY_BUTTON_LABEL\s*=\s*['"]开始['"]/.test(text);
  const logPath = path.join(logsDir, 'ui-static.log');
  await fs.writeFile(
    logPath,
    [`ok=${ok}`, text.slice(0, 2000)].join('\n'),
    'utf8',
  );
  const check: VerificationCheck = {
    name: 'ui-static-label',
    commandOrActionSummary: '静态检查主按钮文案为「开始处理」',
    status: ok ? 'passed' : 'failed',
    durationMs: Date.now() - t0,
    evidenceRef: 'logs/ui-static.log',
    reproducible: true,
    verdictSource: 'digitalme_verified',
  };
  if (!ok) {
    check.failureSummary = '源码未将 PRIMARY_BUTTON_LABEL 设为「开始处理」';
  }
  return check;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
