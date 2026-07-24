"use strict";

const TASK_TYPES = ["chat", "artifact", "review"];
const ROUTING_VERSION = 1;

function providerSecretId(providerId) {
  return `model.provider.${String(providerId)}.apiKey`;
}

function cleanId(value, fallback) {
  const id = String(value || "").trim().replace(/[^a-zA-Z0-9._/-]+/g, "-");
  return id || fallback;
}

function defaultRoutingFromLegacy(raw = {}) {
  const providerId = "default-openai-compatible";
  const modelName = String(raw.model || "gpt-4o-mini").trim() || "gpt-4o-mini";
  const modelId = `${providerId}/${cleanId(modelName, "default")}`;
  const provider = {
    id: providerId,
    name: "默认模型提供方",
    type: "openai-compatible",
    baseUrl: String(raw.baseURL || "https://api.openai.com/v1").trim(),
    enabled: true,
    models: [{ id: modelId, providerId, model: modelName, displayName: modelName, enabled: true }],
  };
  const route = { primary: modelId, fallbacks: [] };
  return { version: ROUTING_VERSION, providers: [provider], routes: { chat: { ...route }, artifact: { ...route }, review: { ...route } } };
}

function normalizeRouting(input, legacy = {}) {
  const base = input && typeof input === "object" ? input : defaultRoutingFromLegacy(legacy);
  const providers = (Array.isArray(base.providers) ? base.providers : []).map((source, index) => {
    const id = cleanId(source.id, `provider-${index + 1}`);
    const models = (Array.isArray(source.models) ? source.models : []).map((model, modelIndex) => ({
      id: String(model.id || `${id}/${cleanId(model.model || model.displayName, `model-${modelIndex + 1}`)}`),
      providerId: id,
      model: String(model.model || "").trim(),
      displayName: String(model.displayName || model.model || "未命名模型").trim(),
      enabled: model.enabled !== false,
    })).filter((model) => model.model);
    return { id, name: String(source.name || id).trim(), type: String(source.type || "openai-compatible"), baseUrl: String(source.baseUrl || source.baseURL || "").trim(), enabled: source.enabled !== false, models };
  }).filter((provider) => provider.models.length);
  const allIds = new Set(providers.flatMap((provider) => provider.models.map((model) => model.id)));
  const defaultId = providers[0]?.models[0]?.id || "";
  const routes = {};
  for (const taskType of TASK_TYPES) {
    const source = base.routes && base.routes[taskType] ? base.routes[taskType] : {};
    const primary = allIds.has(source.primary) ? source.primary : defaultId;
    routes[taskType] = { primary, fallbacks: Array.from(new Set((Array.isArray(source.fallbacks) ? source.fallbacks : []).filter((id) => allIds.has(id) && id !== primary))) };
  }
  return { version: ROUTING_VERSION, providers, routes };
}

function redactModelConfig(routing, secretStore) {
  const normalized = normalizeRouting(routing);
  return {
    version: normalized.version,
    providers: normalized.providers.map((provider) => ({
      ...provider,
      apiKeyConfigured: !!(secretStore && secretStore.has(providerSecretId(provider.id))),
      models: provider.models.map((model) => ({ ...model })),
    })),
    routes: normalized.routes,
  };
}

function resolveModelRoute(routing, taskType, secretStore) {
  const normalized = normalizeRouting(routing);
  const safeTaskType = TASK_TYPES.includes(taskType) ? taskType : "chat";
  const route = normalized.routes[safeTaskType];
  const orderedIds = [route.primary, ...route.fallbacks].filter(Boolean);
  const candidates = orderedIds.map((modelId, index) => {
    const provider = normalized.providers.find((item) => item.models.some((model) => model.id === modelId));
    const model = provider?.models.find((item) => item.id === modelId);
    return provider && model ? { provider, model, apiKey: secretStore?.get(providerSecretId(provider.id)) || "", fallback: index > 0, attempt: index + 1 } : null;
  }).filter(Boolean);
  return { taskType: safeTaskType, candidates, route };
}

function normalizeModelError(error) {
  const message = String(error?.message || error || "");
  const status = Number(error?.statusCode || error?.status || 0);
  let errorCode = "PROVIDER_ERROR";
  if (/not configured|no_api_key|missing api key/i.test(message)) errorCode = "PROVIDER_NOT_CONFIGURED";
  else if (/model.*not configured|no model/i.test(message)) errorCode = "MODEL_NOT_CONFIGURED";
  else if (status === 401 || status === 403 || /unauthori[sz]ed|invalid api key|authentication/i.test(message)) errorCode = "AUTH_FAILED";
  else if (status === 429 || /rate.?limit/i.test(message)) errorCode = "RATE_LIMITED";
  else if (/timeout|timed out|ETIMEDOUT/i.test(message)) errorCode = "TIMEOUT";
  else if (/network|ENOTFOUND|ECONNREFUSED|socket|fetch failed/i.test(message)) errorCode = "NETWORK_ERROR";
  else if (/invalid response|parse|empty response/i.test(message)) errorCode = "INVALID_RESPONSE";
  return { errorCode, message: "当前模型不可用。可以检查模型设置，或切换到备用模型。" };
}

async function invokeModelRoute({ routing, taskType, secretStore, invokeProvider, recordAttempt }) {
  const resolved = resolveModelRoute(routing, taskType, secretStore);
  const attempts = [];
  if (!resolved.candidates.length) {
    return { ok: false, taskType: resolved.taskType, errorCode: "MODEL_NOT_CONFIGURED", friendlyMessage: "当前模型不可用。可以检查模型设置，或切换到备用模型。", attemptedModels: [], settingsAction: "open-model-settings", attempts };
  }
  for (const candidate of resolved.candidates) {
    if (!candidate.provider.enabled || !candidate.model.enabled || (!candidate.apiKey && candidate.provider.type !== "fake")) {
      const errorCode = !candidate.apiKey && candidate.provider.type !== "fake" ? "PROVIDER_NOT_CONFIGURED" : "MODEL_NOT_CONFIGURED";
      const attempt = { provider: candidate.provider.id, model: candidate.model.model, attempt: candidate.attempt, fallback: candidate.fallback, success: false, errorCode };
      attempts.push(attempt); recordAttempt?.(attempt); continue;
    }
    try {
      const value = await invokeProvider(candidate);
      const attempt = { provider: candidate.provider.id, model: candidate.model.model, attempt: candidate.attempt, fallback: candidate.fallback, success: true, errorCode: null };
      attempts.push(attempt); recordAttempt?.(attempt);
      return { ok: true, value, taskType: resolved.taskType, provider: candidate.provider.id, model: candidate.model.model, fallbackUsed: candidate.fallback, attempts };
    } catch (error) {
      const normalized = normalizeModelError(error);
      const attempt = { provider: candidate.provider.id, model: candidate.model.model, attempt: candidate.attempt, fallback: candidate.fallback, success: false, errorCode: normalized.errorCode };
      attempts.push(attempt); recordAttempt?.(attempt);
    }
  }
  return { ok: false, taskType: resolved.taskType, errorCode: attempts.at(-1)?.errorCode || "PROVIDER_ERROR", friendlyMessage: "当前模型不可用。可以检查模型设置，或切换到备用模型。", attemptedModels: attempts.map((item) => `${item.provider}/${item.model}`), settingsAction: "open-model-settings", attempts };
}

module.exports = { TASK_TYPES, ROUTING_VERSION, providerSecretId, defaultRoutingFromLegacy, normalizeRouting, redactModelConfig, resolveModelRoute, normalizeModelError, invokeModelRoute };
