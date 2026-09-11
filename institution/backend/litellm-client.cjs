/**
 * Thin LiteLLM management / OpenAI-compatible client.
 * Master key stays server-side only.
 */
'use strict';

function createLitellmClient({ baseUrl, masterKey }) {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  if (!root) throw new Error('LITELLM_BASE_URL required');
  if (!masterKey) throw new Error('LITELLM_MASTER_KEY required');

  async function request(method, urlPath, { key, body } = {}) {
    const res = await fetch(`${root}${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${key || masterKey}`,
        'Content-Type': 'application/json',
      },
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

  return {
    baseUrl: root,
    async health() {
      const a = await request('GET', '/health/liveliness');
      if (a.ok) return a;
      return request('GET', '/health');
    },
    async generateKey({ userId, maxBudget, models, alias, metadata }) {
      const r = await request('POST', '/key/generate', {
        body: {
          user_id: userId,
          max_budget: maxBudget,
          models,
          key_alias: alias,
          metadata: metadata || {},
        },
      });
      if (!r.ok) {
        const err = new Error(`LiteLLM key/generate failed (${r.status})`);
        err.detail = r.json;
        throw err;
      }
      const key = r.json && (r.json.key || r.json.token);
      if (!key) {
        const err = new Error('LiteLLM key/generate missing key');
        err.detail = r.json;
        throw err;
      }
      return { key, info: r.json };
    },
    async keyInfo(virtualKey) {
      let r = await request('GET', `/key/info?key=${encodeURIComponent(virtualKey)}`);
      if (!r.ok) {
        r = await request('POST', '/key/info', { body: { key: virtualKey } });
      }
      return r;
    },
    async chatCompletions(virtualKey, body) {
      return request('POST', '/v1/chat/completions', { key: virtualKey, body });
    },
  };
}

module.exports = { createLitellmClient };
