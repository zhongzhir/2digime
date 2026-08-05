'use strict';
/**
 * 外部专业能力（研究分析）连接配置 — App Shell only。
 * - 非密：userData/remote-capability-config.json
 * - 密：若将来需要，走既有 secrets.v2.json（本轮参考 Agent 无需凭证）
 * - 不新建 Connection Store
 * - 环境变量仅作开发覆盖，不是产品注册前提
 */
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_NAME = 'remote-capability-config.json';
const CAPABILITY_KEY = 'researchAnalysis';
const DISPLAY_NAME = '研究分析能力';

function configPath(userDataPath) {
  return path.join(userDataPath, CONFIG_NAME);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isLoopbackHostname(host) {
  const h = String(host || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/**
 * 规范化服务地址；本机回环统一为 127.0.0.1，避免 localhost / ::1 与 Card 广告主机不一致。
 */
function normalizeBaseUrl(raw) {
  const trimmed = String(raw || '')
    .trim()
    .replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    if (isLoopbackHostname(u.hostname)) {
      u.hostname = '127.0.0.1';
    }
    const pathPart = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host}${pathPart}`;
  } catch {
    return trimmed;
  }
}

function readRemoteCapabilityConfig(userDataPath) {
  const parsed = readJsonSafe(configPath(userDataPath));
  const entry = (parsed && parsed[CAPABILITY_KEY]) || null;
  if (!entry) {
    return { enabled: false, baseUrl: '', updatedAt: null };
  }
  return {
    enabled: entry.enabled === true,
    baseUrl: normalizeBaseUrl(entry.baseUrl),
    updatedAt: entry.updatedAt || null,
  };
}

function writeRemoteCapabilityConfig(userDataPath, input) {
  fs.mkdirSync(userDataPath, { recursive: true });
  const next = {
    [CAPABILITY_KEY]: {
      enabled: input.enabled === true,
      baseUrl: normalizeBaseUrl(input.baseUrl),
      updatedAt: new Date().toISOString(),
    },
  };
  fs.writeFileSync(configPath(userDataPath), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return readRemoteCapabilityConfig(userDataPath);
}

function disableRemoteCapabilityConfig(userDataPath) {
  const current = readRemoteCapabilityConfig(userDataPath);
  return writeRemoteCapabilityConfig(userDataPath, {
    enabled: false,
    baseUrl: current.baseUrl || '',
  });
}

/**
 * 解析最终用于注册的 baseUrl。
 * 优先：已保存且启用的配置；
 * 其次：产品已明确停用（配置文件存在且 enabled=false）则不注册；
 * 再次：开发环境变量覆盖（仅在尚无产品停用记录时）。
 */
function resolveResearchBaseUrl(userDataPath, env = process.env) {
  const saved = readRemoteCapabilityConfig(userDataPath);
  if (saved.enabled && saved.baseUrl) {
    return {
      baseUrl: saved.baseUrl,
      source: 'saved_config',
      enabled: true,
    };
  }
  const cfgFile = configPath(userDataPath);
  const productDisabled =
    fs.existsSync(cfgFile) && saved.enabled === false && !!saved.updatedAt;
  if (productDisabled) {
    return {
      baseUrl: saved.baseUrl || '',
      source: 'disabled',
      enabled: false,
    };
  }
  const envUrl = normalizeBaseUrl(env.DIGITALME_V2_A2A_RESEARCH_BASE_URL || '');
  if (envUrl) {
    return {
      baseUrl: envUrl,
      source: 'env_override',
      enabled: true,
    };
  }
  return {
    baseUrl: saved.baseUrl || '',
    source: 'none',
    enabled: false,
  };
}

const CONNECT_FAIL_USER =
  '无法连接研究分析能力，请确认服务正在运行并检查地址。';

function userFacingConnectError(err) {
  const msg = err instanceof Error ? err.message : String(err || '');
  if (/https|non-loopback|loopback-http requires/i.test(msg)) {
    return '该服务地址不符合安全要求。本地可用 http://127.0.0.1，公网须使用 https。';
  }
  if (/invalid url|endpointId|baseUrl|expectedAgentCardUrl/i.test(msg)) {
    return '服务地址无效，请检查后重试。';
  }
  if (/redirect/i.test(msg)) {
    return '服务重定向不被允许，请使用最终可访问的地址。';
  }
  if (
    /agent.?card|skill|fingerprint|mismatch|name|ECONNREFUSED|ENOTFOUND|network|fetch failed|timed? ?out|unable to connect/i.test(
      msg,
    )
  ) {
    return CONNECT_FAIL_USER;
  }
  return CONNECT_FAIL_USER;
}

/**
 * 保存前校验：统一 A2A 连接探测合同（Card + Skill + 无副作用协议探测）。
 * 失败抛出用户可读 Error（message 已映射）；cause.diagnostic 供主进程脱敏日志。
 */
async function validateResearchEndpoint(baseUrl, appRoot) {
  const url = normalizeBaseUrl(baseUrl);
  if (!url) {
    throw Object.assign(new Error('请填写服务地址'), {
      userMessage: '请填写服务地址',
    });
  }
  const distRoot = path.join(appRoot, 'dist', 'capability');
  const { probeA2AConnection, scrubConnectionDiagnostic, connectionProbeUserMessage } = require(
    path.join(distRoot, 'a2a-connection-probe.js'),
  );
  let probe;
  try {
    probe = await probeA2AConnection({ baseUrl: url });
  } catch (err) {
    throw Object.assign(new Error(userFacingConnectError(err)), {
      userMessage: userFacingConnectError(err),
      cause: err,
      diagnostic: { stage: 'protocol_probe', reasons: [String(err && err.message || err)] },
    });
  }
  if (!probe || !probe.ok) {
    const message = connectionProbeUserMessage(probe) || userFacingConnectError(new Error((probe.diagnostic.reasons || []).join('; ')));
    throw Object.assign(new Error(message), {
      userMessage: message,
      diagnostic: scrubConnectionDiagnostic(probe.diagnostic),
      probe,
    });
  }
  return {
    policy: probe.policy,
    validation: probe.validation,
    card: probe.card,
    probe,
  };
}

function publicRemoteCapabilityStatus(input) {
  const saved = input.saved || { enabled: false, baseUrl: '' };
  const resolved = input.resolved || { enabled: false, baseUrl: '', source: 'none' };
  const connectionState = input.connectionState || 'disconnected';
  // connectionState: disconnected | checking | connected | unreachable
  const labelMap = {
    disconnected: '未连接',
    checking: '正在检查',
    connected: '已连接',
    unreachable: '无法连接',
  };
  return {
    displayName: DISPLAY_NAME,
    enabled: saved.enabled === true,
    baseUrl: saved.baseUrl || '',
    resolvedBaseUrl: resolved.enabled ? resolved.baseUrl : '',
    source: resolved.source || 'none',
    registered: !!input.registered,
    connectionState,
    statusLabel: labelMap[connectionState] || '未连接',
    requiresCredential: false,
    updatedAt: saved.updatedAt || null,
  };
}

module.exports = {
  CONFIG_NAME,
  CAPABILITY_KEY,
  DISPLAY_NAME,
  configPath,
  readRemoteCapabilityConfig,
  writeRemoteCapabilityConfig,
  disableRemoteCapabilityConfig,
  resolveResearchBaseUrl,
  validateResearchEndpoint,
  userFacingConnectError,
  publicRemoteCapabilityStatus,
  normalizeBaseUrl,
};
