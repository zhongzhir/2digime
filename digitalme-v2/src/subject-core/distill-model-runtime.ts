/**
 * 产品蒸馏模型入口 — 复用做事路径的 openaiCompatible + SecretAccessor。
 * 不单独读环境变量、不建第二客户端。
 */
import { chatComplete } from '../infrastructure/model-http';
import { providerCredentialKey } from '../infrastructure/secret-store';
import type { SecretAccessor } from '../capability/adapter';
import type { OpenAiCompatibleAdapterConfig } from '../capability/adapters/openai-compatible';
import type { ChatCompleteFn } from './structured-distill';

export interface SubjectDistillModelRuntime {
  enabled: boolean;
  chatComplete: ChatCompleteFn;
  model: { baseUrl: string; model: string; providerId: string };
}

export function createSubjectDistillModelRuntime(input: {
  documentCapability?: 'none' | 'fake' | 'openai-compatible' | 'both';
  openaiCompatible?: OpenAiCompatibleAdapterConfig;
  secrets?: SecretAccessor;
}): SubjectDistillModelRuntime | null {
  const mode = input.documentCapability ?? 'fake';
  if (mode !== 'openai-compatible' && mode !== 'both') return null;
  if (!input.openaiCompatible || !input.secrets) return null;

  const cfg = input.openaiCompatible;
  const providerId = cfg.providerId ?? 'openai-compatible';
  const secretKey = providerCredentialKey(providerId);
  const secrets = input.secrets;

  const chat: ChatCompleteFn = async (options) => {
    const apiKey = await secrets.get(secretKey);
    if (!apiKey) {
      throw new Error('model credential is not configured');
    }
    return chatComplete({
      ...options,
      baseUrl: cfg.baseUrl,
      apiKey,
      model: cfg.model,
      ...(cfg.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs ?? cfg.timeoutMs } : {}),
    });
  };

  return {
    enabled: true,
    chatComplete: chat,
    model: {
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      providerId,
    },
  };
}
