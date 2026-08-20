/**
 * 外部执行器子进程最小环境 — 不得继承 Electron 全部敏感变量。
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync } from 'node:fs';

const BLOCKED_ENV_EXACT = new Set([
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_API_KEY',
  'DIGITALME_MODEL_API_KEY',
  'DIGITALME_OPENAI_API_KEY',
  'DIGITALME_SECRET',
  'DIGITALME_RUNTIME_MODEL_KEY',
]);

const BLOCKED_ENV_PREFIXES = [
  'DIGITALME_',
  'ELECTRON_',
  'CURSOR_AGENT_',
  'npm_config_electron',
];

/** 允许显式写入的 Electron 运行时开关（非密钥）。 */
const ELECTRON_ALLOWLIST = new Set(['ELECTRON_RUN_AS_NODE']);

const ALLOWED_PASS_THROUGH = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'USERPROFILE',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'ComSpec',
  'COMSPEC',
  'LANG',
  'LC_ALL',
  'TERM',
  'COLORTERM',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  // Codex 自身认证可能依赖的用户级配置路径（非 Digital Me 模型密钥）
  'CODEX_HOME',
  // 不透传 OPENAI_BASE_URL / OPENAI_API_KEY：易污染 Codex 指向错误上游
];

function fillMissingUserDirs(
  env: NodeJS.ProcessEnv,
  baseEnv: NodeJS.ProcessEnv,
): void {
  const home = baseEnv.USERPROFILE || baseEnv.HOME || os.homedir();
  if (!home) return;
  if (!env.USERPROFILE) env.USERPROFILE = home;
  if (!env.HOME) env.HOME = home;
  if (process.platform === 'win32') {
    const normalized = home.replace(/\//g, '\\');
    const match = /^([A-Za-z]:)(.*)$/.exec(normalized);
    if (match) {
      if (!env.HOMEDRIVE) env.HOMEDRIVE = match[1];
      if (!env.HOMEPATH) env.HOMEPATH = match[2] || '\\';
    }
    if (!env.APPDATA) {
      env.APPDATA = baseEnv.APPDATA || path.join(home, 'AppData', 'Roaming');
    }
    if (!env.LOCALAPPDATA) {
      env.LOCALAPPDATA = baseEnv.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    }
  }
  if (!env.TEMP) env.TEMP = baseEnv.TEMP || baseEnv.TMP || os.tmpdir();
  if (!env.TMP) env.TMP = baseEnv.TMP || env.TEMP;
  if (!env.SYSTEMROOT && !env.SystemRoot) {
    const root = baseEnv.SYSTEMROOT || baseEnv.SystemRoot || (process.platform === 'win32' ? 'C:\\Windows' : undefined);
    if (root) {
      env.SYSTEMROOT = root;
      env.SystemRoot = root;
    }
  }
  if (!env.COMSPEC && !env.ComSpec && process.platform === 'win32') {
    const comspec =
      baseEnv.COMSPEC ||
      baseEnv.ComSpec ||
      path.join(env.SYSTEMROOT || 'C:\\Windows', 'System32', 'cmd.exe');
    env.COMSPEC = comspec;
    env.ComSpec = comspec;
  }
}

/**
 * 在 Electron 主进程中 process.execPath 是 Electron 本身。
 * 优先使用真实 Node，避免把 Codex CLI 当成 Electron 应用启动。
 */
export function resolveNodeExecutable(
  baseEnv: NodeJS.ProcessEnv = process.env,
): string {
  const candidates = [
    baseEnv.npm_node_execpath,
    baseEnv.NODE_BINARY,
    process.platform === 'win32' ? 'node.exe' : 'node',
  ].filter(Boolean) as string[];

  if (process.versions.electron) {
    for (const c of candidates) {
      if (c === 'node' || c === 'node.exe') continue;
      if (existsSync(c)) return c;
    }
    // Electron 下仍可用 execPath + ELECTRON_RUN_AS_NODE
    return process.execPath;
  }
  return process.execPath;
}

export function buildMinimalExecutorEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  extraAllowed: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_PASS_THROUGH) {
    const v = baseEnv[key];
    if (v !== undefined) env[key] = v;
  }
  // Windows 常把用户 Path 放在 Path；再扫一遍安全的 PATH 类
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v === undefined) continue;
    if (BLOCKED_ENV_EXACT.has(k)) continue;
    if (BLOCKED_ENV_PREFIXES.some((p) => k.startsWith(p))) continue;
    if (/^(API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i.test(k)) continue;
    if (/_API_KEY$|_SECRET$|_TOKEN$/i.test(k)) continue;
    // 仅额外放行明确无害的显示/本地化
    if (/^(DISPLAY|TZ|NODE_OPTIONS)$/i.test(k)) {
      // NODE_OPTIONS 可能注入调试钩子 — 跳过
      if (/^NODE_OPTIONS$/i.test(k)) continue;
      env[k] = v;
    }
  }
  for (const [k, v] of Object.entries(extraAllowed)) {
    if (v !== undefined && v !== '') env[k] = v;
  }
  fillMissingUserDirs(env, baseEnv);

  // Electron 宿主用自身 execPath 跑 JS 时必须开启；不得因 ELECTRON_ 前缀被剥掉
  if (process.versions.electron || extraAllowed.ELECTRON_RUN_AS_NODE === '1') {
    env.ELECTRON_RUN_AS_NODE = '1';
  }

  // 确保不泄漏 Digital Me 密钥与劫持 Codex 的上游地址
  for (const k of Object.keys(env)) {
    if (ELECTRON_ALLOWLIST.has(k)) continue;
    if (BLOCKED_ENV_EXACT.has(k) || BLOCKED_ENV_PREFIXES.some((p) => k.startsWith(p))) {
      delete env[k];
    }
  }
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_BASE_URL;
  return env;
}
