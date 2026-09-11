/**
 * Institution Adapter (Slice C) — thin client glue.
 * Exchange institution session → write existing SecretStore / model-config.
 * Does not alter Talk / Digital Self semantics.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MODE_FILE = 'institution-mode.json';

function modePath(userDataPath) {
  return path.join(userDataPath, MODE_FILE);
}

function readMode(userDataPath) {
  const file = modePath(userDataPath);
  if (!fs.existsSync(file)) {
    return { enabled: false };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      enabled: Boolean(parsed.enabled),
      backendBaseUrl: String(parsed.backendBaseUrl || '').replace(/\/+$/, ''),
      institutionUserId: String(parsed.institutionUserId || ''),
      organizationId: String(parsed.organizationId || ''),
      organizationName: String(parsed.organizationName || ''),
      assertion: String(parsed.assertion || 'mock'),
      model: String(parsed.model || ''),
      gatewayBaseUrl: String(parsed.gatewayBaseUrl || '').replace(/\/+$/, ''),
      updatedAt: parsed.updatedAt || null,
    };
  } catch {
    return { enabled: false };
  }
}

function writeMode(userDataPath, mode) {
  fs.mkdirSync(userDataPath, { recursive: true });
  const next = {
    enabled: Boolean(mode.enabled),
    backendBaseUrl: String(mode.backendBaseUrl || '').replace(/\/+$/, ''),
    institutionUserId: String(mode.institutionUserId || ''),
    organizationId: String(mode.organizationId || ''),
    organizationName: String(mode.organizationName || ''),
    assertion: String(mode.assertion || 'mock'),
    model: String(mode.model || ''),
    gatewayBaseUrl: String(mode.gatewayBaseUrl || '').replace(/\/+$/, ''),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(modePath(userDataPath), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

function clearMode(userDataPath) {
  const file = modePath(userDataPath);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return { enabled: false };
}

async function httpJson(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 2000) };
  }
  return { ok: res.ok, status: res.status, json, text };
}

function mapInstitutionError(errLike) {
  const raw = String((errLike && errLike.message) || errLike || '');
  if (/budget|max_budget|额度|quota|spend.*exceed/i.test(raw) || /429/.test(raw)) {
    return '你的 AI 使用额度已用完。';
  }
  if (/session|assertion|unauthorized|401/i.test(raw)) {
    return '机构登录已失效，请重新连接机构服务。';
  }
  if (/entitlement|user_not_found|404/i.test(raw)) {
    return '当前账号没有可用的 AI 权益。';
  }
  if (/ECONN|ENOTFOUND|fetch failed|503|backend|unavailable/i.test(raw)) {
    return '暂时连不上机构 AI 服务，请稍后再试。';
  }
  return null;
}

/**
 * @param {{ backendBaseUrl: string }} opts
 */
function createInstitutionAdapter(opts) {
  const backendBaseUrl = String((opts && opts.backendBaseUrl) || '').replace(/\/+$/, '');
  if (!backendBaseUrl) throw new Error('backendBaseUrl required');

  return {
    backendBaseUrl,

    async exchange({ institutionUserId, assertion = 'mock' }) {
      const id = String(institutionUserId || '').trim();
      if (!id) throw new Error('institutionUserId required');
      const r = await httpJson('POST', `${backendBaseUrl}/v0/session/exchange`, {
        institutionUserId: id,
        assertion: String(assertion || 'mock'),
      });
      if (!r.ok) {
        const mapped = mapInstitutionError({ message: JSON.stringify(r.json || r.text) });
        const err = new Error(mapped || `机构会话兑换失败（${r.status}）`);
        err.status = r.status;
        err.detail = r.json;
        throw err;
      }
      const gatewayBaseUrl = String(r.json.gatewayBaseUrl || '').replace(/\/+$/, '');
      const model = String(r.json.model || '').trim();
      const credential = r.json.credential || {};
      const value = String(credential.value || '').trim();
      if (!gatewayBaseUrl || !model || !value) {
        throw new Error('机构会话响应不完整');
      }
      if (r.json.providerMasterKey) {
        throw new Error('拒绝接受机构下发的 provider master key');
      }
      return {
        institutionUserId: r.json.institutionUserId || id,
        organizationId: r.json.organizationId || null,
        gatewayBaseUrl,
        model,
        credential: {
          type: String(credential.type || 'litellm_virtual_key'),
          value,
        },
        entitlement: r.json.entitlement || null,
        organizationName: null,
      };
    },

    /**
     * Apply exchanged session into existing credential ops (SecretStore + model-config).
     * @param {*} saveCredential from bootstrap-secrets createCredentialOps
     * @param {*} session from exchange()
     */
    async applyToCredentialStore(saveCredential, session, modeMeta = {}) {
      if (typeof saveCredential !== 'function') {
        throw new Error('saveCredential required');
      }
      await saveCredential({
        apiKey: session.credential.value,
        baseUrl: session.gatewayBaseUrl,
        model: session.model,
        providerId: 'openai-compatible',
        providerPreset: 'openai-compatible',
      });
      return {
        ok: true,
        gatewayHost: (() => {
          try {
            return new URL(session.gatewayBaseUrl).host;
          } catch {
            return '';
          }
        })(),
        model: session.model,
        institutionUserId: session.institutionUserId,
        organizationId: session.organizationId,
        ...modeMeta,
      };
    },
  };
}

module.exports = {
  MODE_FILE,
  modePath,
  readMode,
  writeMode,
  clearMode,
  createInstitutionAdapter,
  mapInstitutionError,
  httpJson,
};
