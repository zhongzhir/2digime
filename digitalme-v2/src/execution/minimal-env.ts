/**
 * 外部执行器子进程最小环境 — 不得继承 Electron 全部敏感变量。
 */
const BLOCKED_ENV_EXACT = new Set([
  'OPENAI_API_KEY',
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
  // 确保不泄漏 Digital Me 密钥
  for (const k of Object.keys(env)) {
    if (BLOCKED_ENV_EXACT.has(k) || BLOCKED_ENV_PREFIXES.some((p) => k.startsWith(p))) {
      delete env[k];
    }
  }
  return env;
}
