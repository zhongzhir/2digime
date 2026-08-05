/**
 * Independent model client for the research A2A agent.
 * Reads only RESEARCH_AGENT_* / DIGITALME_RESEARCH_AGENT_* credentials.
 * Does not read Digital Me SubjectPackage or SecretStore.
 */
'use strict';

function resolvePeerModelEnv(env = process.env) {
  const apiKey = (
    env.DIGITALME_RESEARCH_AGENT_API_KEY ||
    env.RESEARCH_AGENT_API_KEY ||
    ''
  ).trim();
  const baseUrl = (
    env.DIGITALME_RESEARCH_AGENT_BASE_URL ||
    env.RESEARCH_AGENT_BASE_URL ||
    env.DIGITALME_MODEL_BASE_URL ||
    env.OPENAI_BASE_URL ||
    env.DEEPSEEK_BASE_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  const model = (
    env.DIGITALME_RESEARCH_AGENT_MODEL ||
    env.RESEARCH_AGENT_MODEL ||
    env.DIGITALME_MODEL ||
    env.OPENAI_MODEL ||
    env.DEEPSEEK_MODEL ||
    ''
  ).trim();
  // Acceptance may inject peer key equal to a one-shot env; still never reads DM SecretStore.
  const fallbackKey = !apiKey
    ? (env.DIGITALME_MODEL_API_KEY || env.OPENAI_API_KEY || env.DEEPSEEK_API_KEY || '').trim()
    : '';
  return {
    apiKey: apiKey || fallbackKey,
    baseUrl: baseUrl || 'https://api.deepseek.com',
    model: model || 'deepseek-chat',
    configured: Boolean(apiKey || fallbackKey),
    source: apiKey ? 'research_agent_env' : fallbackKey ? 'process_env_fallback' : 'none',
  };
}

async function chatComplete({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.2,
  maxTokens = 1200,
  signal,
  retries = 1,
  timeoutMs = 55_000,
}) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined =
      signal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([signal, timeout])
        : signal || timeout;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          messages,
        }),
        signal: combined,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`peer model HTTP ${res.status}: ${body.slice(0, 240)}`);
      }
      const json = await res.json();
      const text = String(json?.choices?.[0]?.message?.content || '').trim();
      if (!text) throw new Error('peer model returned empty content');
      return {
        text,
        usage: json?.usage || null,
        model: json?.model || model,
      };
    } catch (err) {
      lastError = err;
      if (attempt >= retries) break;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

module.exports = {
  resolvePeerModelEnv,
  chatComplete,
};
