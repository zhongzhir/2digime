/**
 * Owner 验收场景环境 → Runtime 选项补丁。
 * 仅 Electron 启动边界 / 验收启动器读取环境变量；正式业务代码只消费派生后的 options。
 * 不得写入用户设置或 package。
 */
'use strict';

const ALLOWED_FORCE = new Set([
  'ready',
  'needs_login',
  'needs_setup',
  'unavailable',
  'unsupported',
]);

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{
 *   patch: Record<string, unknown>,
 *   active: boolean,
 *   forceAvailability: string | null,
 *   injectUnsupported: boolean,
 *   hideCodexPath: string | null,
 * }}
 */
function resolveOwnerScenarioRuntimePatch(env = process.env) {
  const forceRaw = String(env.DIGITALME_CODING_CAPABILITY_FORCE || '').trim();
  const forceAvailability = ALLOWED_FORCE.has(forceRaw) ? forceRaw : null;
  const injectUnsupported = env.DIGITALME_INJECT_UNSUPPORTED_DESKTOP === '1';
  const hideCodexPath = String(env.DIGITALME_CODEX_JS_PATH || '').trim() || null;
  const cliKindRaw = String(env.DIGITALME_EXECUTOR_CLI_KIND || '').trim();
  const cliKind = cliKindRaw === 'atomcode' || cliKindRaw === 'codex' ? cliKindRaw : '';
  const atomcodeExe = String(env.DIGITALME_ATOMCODE_EXE || '').trim();
  const secondaryUrl = String(env.DIGITALME_SECONDARY_HTTP_BASE_URL || '').trim();
  const secondaryPassword = String(env.DIGITALME_SECONDARY_HTTP_PASSWORD || '').trim();
  const secondaryModel = String(env.DIGITALME_SECONDARY_HTTP_MODEL || '').trim();
  const mcpRoot = String(env.DIGITALME_MCP_ALLOWED_DIR || '').trim();

  /** @type {Record<string, unknown>} */
  const patch = {};
  if (forceAvailability || hideCodexPath || cliKind) {
    /** @type {Record<string, unknown>} */
    const exec = {};
    if (forceAvailability) exec.forceAvailability = forceAvailability;
    if (hideCodexPath) exec.codexJsPath = hideCodexPath;
    if (cliKind) {
      exec.cliKind = cliKind;
      if (cliKind === 'atomcode') {
        exec.disableAutoContinue = true;
        exec.defaultTimeoutMs = 600_000;
      }
    }
    if (atomcodeExe) exec.atomcodeExePath = atomcodeExe;
    patch.externalExecutorCapability = exec;
  }
  if (injectUnsupported) {
    patch.unsupportedDesktopCodingCapability = {
      displayName: '某桌面代码工具',
      detected: true,
    };
  }
  if (secondaryUrl && secondaryPassword && secondaryModel) {
    patch.secondaryExecutorCapability = {
      http: {
        baseUrl: secondaryUrl,
        username: String(env.DIGITALME_SECONDARY_HTTP_USERNAME || 'opencode').trim() || 'opencode',
        password: secondaryPassword,
        internalModel: secondaryModel,
        timeoutMs: 600_000,
      },
    };
  }
  if (mcpRoot) {
    const lookupDir = String(env.DIGITALME_MCP_LOOKUP_DIR || '').trim() || mcpRoot;
    const toolsRaw = String(env.DIGITALME_MCP_ALLOWED_TOOLS || '').trim();
    const allowedTools = toolsRaw
      ? toolsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    patch.mcpReadonlyCapability = {
      serverCommand:
        process.platform === 'win32'
          ? ['cmd.exe', '/c', 'npx', '-y', '@modelcontextprotocol/server-filesystem', mcpRoot]
          : ['npx', '-y', '@modelcontextprotocol/server-filesystem', mcpRoot],
      serverCwd: mcpRoot,
      handshake: true,
      queryMode: 'filesystem-lookup',
      allowedDirectory: mcpRoot,
      lookupDirectory: lookupDir,
      forceAvailability: 'available',
      responseTimeoutMs: 90_000,
      ...(allowedTools ? { allowedTools } : {}),
    };
  }
  return {
    patch,
    active: Object.keys(patch).length > 0,
    forceAvailability,
    injectUnsupported,
    hideCodexPath,
  };
}

/**
 * @param {Record<string, unknown>} baseOptions
 * @param {NodeJS.ProcessEnv} [env]
 */
function applyOwnerScenarioPatch(baseOptions, env = process.env) {
  const { patch } = resolveOwnerScenarioRuntimePatch(env);
  return { ...baseOptions, ...patch };
}

/**
 * 场景 → 子进程环境（不依赖父进程残留变量）。
 * @param {'a'|'b'|'c'|string} scene
 */
function envForOwnerScene(scene) {
  const s = String(scene || 'a').toLowerCase();
  if (s === 'b') {
    return { DIGITALME_CODING_CAPABILITY_FORCE: 'needs_setup' };
  }
  if (s === 'c') {
    return {
      DIGITALME_CODING_CAPABILITY_FORCE: 'needs_setup',
      DIGITALME_INJECT_UNSUPPORTED_DESKTOP: '1',
    };
  }
  return {};
}

/** 从环境中剥离验收专用变量，避免场景 A 被父 shell 污染。 */
function scrubOwnerScenarioEnv(env) {
  const next = { ...env };
  delete next.DIGITALME_CODING_CAPABILITY_FORCE;
  delete next.DIGITALME_INJECT_UNSUPPORTED_DESKTOP;
  delete next.DIGITALME_CODEX_JS_PATH;
  delete next.DIGITALME_EXECUTOR_CLI_KIND;
  delete next.DIGITALME_ATOMCODE_EXE;
  delete next.DIGITALME_SECONDARY_HTTP_BASE_URL;
  delete next.DIGITALME_SECONDARY_HTTP_USERNAME;
  delete next.DIGITALME_SECONDARY_HTTP_PASSWORD;
  delete next.DIGITALME_SECONDARY_HTTP_MODEL;
  delete next.DIGITALME_MCP_ALLOWED_DIR;
  delete next.DIGITALME_MCP_LOOKUP_DIR;
  delete next.DIGITALME_MCP_ALLOWED_TOOLS;
  return next;
}

module.exports = {
  ALLOWED_FORCE,
  resolveOwnerScenarioRuntimePatch,
  applyOwnerScenarioPatch,
  envForOwnerScene,
  scrubOwnerScenarioEnv,
};
