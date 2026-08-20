/**
 * Coding Agent 编排适配器 — Codex CLI（L1: workspace-write only）。
 * 由 P2B.1 编排脚本直接调用；不注册进常规生产能力白名单（ADAPTER_TYPES）。
 * 仅允许写隔离工作区；不执行 apply / git commit / push。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hiddenSpawnSyncOptions } from '../../execution/hidden-spawn';
import {
  CODING_AGENT_DEFAULT_ACTIONS,
  codingAgentMayHold,
} from './software-engineering-contract';
import type { WorkspaceHandle } from '../../engineering/workspace-manager';

export const CODING_AGENT_CODEX_CAPABILITY_ID = 'cap_coding_agent_codex';
export const CODING_AGENT_CODEX_ADAPTER_ID = 'coding-agent-codex-cli';

export interface CodexCodingAgentResult {
  ok: boolean;
  agentName: 'codex-cli';
  summary: string;
  lastMessage: string;
  exitCode: number | null;
  claimedSuccess: boolean;
  stdoutLogPath: string;
  permissionActions: readonly string[];
}

export function assertL1Only(actions: readonly string[]): void {
  if (!codingAgentMayHold(actions)) {
    throw new Error('coding agent permissions exceed L1');
  }
}

/**
 * 在隔离工作区调用 Codex。sandbox=workspace-write，cwd=workspace。
 * 不传递原仓库可写路径。
 */
export async function runCodexCodingAgent(input: {
  workspace: WorkspaceHandle;
  goal: string;
  planSummary: string;
  logDir: string;
  timeoutMs?: number;
}): Promise<CodexCodingAgentResult> {
  assertL1Only(CODING_AGENT_DEFAULT_ACTIONS);
  await fs.mkdir(input.logDir, { recursive: true });
  const lastMessagePath = path.join(input.logDir, 'codex-last-message.txt');
  const stdoutPath = path.join(input.logDir, 'codex-stdout.jsonl');

  const prompt = [
    '你是被 Digital Me 以 L1 权限调用的 Coding Agent。',
    '硬约束：',
    '1. 只能修改当前工作区文件；禁止访问或修改工作区以外的路径。',
    '2. 禁止 git push、deploy、改远程、读写密钥文件。',
    '3. 完成本目标后停止，不要做额外重构。',
    '',
    `目标：${input.goal}`,
    '',
    '工程计划摘要：',
    input.planSummary,
    '',
    '具体任务：将 src/label.ts 中 PRIMARY_BUTTON_LABEL 从「开始」改为「开始处理」。',
    '不要修改测试以绕过验收；应让文案与产品期望一致。',
  ].join('\n');

  const args = [
    'exec',
    '--cd',
    input.workspace.rootPath,
    '--sandbox',
    'workspace-write',
    '--full-auto',
    '--skip-git-repo-check',
    '--json',
    // 覆盖本机可能不兼容的 config（如 service_tier=priority）
    '-c',
    'service_tier="fast"',
    '--output-last-message',
    lastMessagePath,
    '-',
  ];

  const result = spawnSync(
    process.execPath,
    [resolveCodexJs(), ...args],
    hiddenSpawnSyncOptions({
      encoding: 'utf8',
      timeout: input.timeoutMs ?? 300_000,
      input: prompt,
      env: {
        ...process.env,
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
    }),
  );

  const stdout = String(result.stdout || '');
  const stderr = [
    result.error ? `spawn_error=${result.error.message}` : '',
    String(result.stderr || ''),
  ]
    .filter(Boolean)
    .join('\n');
  await fs.writeFile(stdoutPath, `${stdout}\n${stderr}`, 'utf8');

  let lastMessage = '';
  try {
    lastMessage = await fs.readFile(lastMessagePath, 'utf8');
  } catch {
    lastMessage = stdout.slice(-2000) || stderr.slice(-2000);
  }

  const claimedSuccess =
    result.status === 0 ||
    /开始处理/.test(lastMessage) ||
    /changed|updated|修改|完成/i.test(lastMessage);

  return {
    ok: result.status === 0,
    agentName: 'codex-cli',
    summary: lastMessage.slice(0, 2000) || `codex exit=${result.status}`,
    lastMessage,
    exitCode: result.status,
    claimedSuccess,
    stdoutLogPath: stdoutPath,
    permissionActions: CODING_AGENT_DEFAULT_ACTIONS,
  };
}

function resolveCodexJs(): string {
  const candidates = [
    path.join(
      process.env.APPDATA || '',
      'npm',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    ),
    path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.npm-global',
      'lib',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    ),
  ];
  for (const candidate of candidates) {
    try {
      // sync access via require fs in spawn path — use exists via read
      require('node:fs').accessSync(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  // Fallback: rely on PATH via npx-style resolution failure message
  throw new Error(
    'Codex CLI not found (@openai/codex bin/codex.js). Install: npm i -g @openai/codex',
  );
}
