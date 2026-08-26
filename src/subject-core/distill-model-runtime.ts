/**
 * 主体理解（蒸馏）模型入口。
 *
 * 这是已有能力需求 subject understanding / distillation，不是第二套模型注册表。
 * 解析顺序：
 * 1. 专门的 distill capability（测试/升级注入）
 * 2. 已有 generic model access（与做事/对话同一 openaiCompatible + secrets）
 * 3. 完全没有模型 → 返回 null，调用方只走确定性路径
 *
 * 不单独读环境变量、不建第二客户端、不要求用户理解 distill/memory/embedding。
 */
import { chatComplete } from '../infrastructure/model-http';
import { providerCredentialKey } from '../infrastructure/secret-store';
import type { SecretAccessor } from '../capability/adapter';
import type { OpenAiCompatibleAdapterConfig } from '../capability/adapters/openai-compatible';
import type { ChatCompleteFn } from './structured-distill';

export type SubjectUnderstandingSource = 'specialist' | 'generic' | 'none';

export interface SubjectDistillModelRuntime {
  enabled: boolean;
  chatComplete: ChatCompleteFn;
  model: { baseUrl: string; model: string; providerId: string };
  /** 审计用：专门能力 or 主模型复用。不上用户面。 */
  source?: SubjectUnderstandingSource;
}

export interface SubjectUnderstandingAccess {
  runtime: SubjectDistillModelRuntime | null;
  source: SubjectUnderstandingSource;
}

function runtimeFromOpenAiCompatible(input: {
  openaiCompatible: OpenAiCompatibleAdapterConfig;
  secrets: SecretAccessor;
  source: 'specialist' | 'generic';
}): SubjectDistillModelRuntime {
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
    source: input.source,
  };
}

/**
 * 历史入口：只要 generic model access 可用就启用。
 * 不再把 documentCapability 模式当成「必须另配一台 distill 模型」的门闩。
 */
export function createSubjectDistillModelRuntime(input: {
  documentCapability?: 'none' | 'fake' | 'openai-compatible' | 'both';
  openaiCompatible?: OpenAiCompatibleAdapterConfig;
  secrets?: SecretAccessor;
}): SubjectDistillModelRuntime | null {
  return resolveSubjectUnderstandingRuntime(input).runtime;
}

/**
 * 统一解析主体理解所用模型。
 * 专门 distill 可用 → 用它；否则复用已有 generic model；都没有 → none。
 */
export function resolveSubjectUnderstandingRuntime(input: {
  specialist?: SubjectDistillModelRuntime | null;
  documentCapability?: 'none' | 'fake' | 'openai-compatible' | 'both';
  openaiCompatible?: OpenAiCompatibleAdapterConfig;
  secrets?: SecretAccessor;
}): SubjectUnderstandingAccess {
  if (input.specialist?.enabled) {
    const runtime: SubjectDistillModelRuntime = {
      ...input.specialist,
      source: 'specialist',
    };
    return { runtime, source: 'specialist' };
  }
  if (input.openaiCompatible && input.secrets) {
    const runtime = runtimeFromOpenAiCompatible({
      openaiCompatible: input.openaiCompatible,
      secrets: input.secrets,
      source: 'generic',
    });
    return { runtime, source: 'generic' };
  }
  return { runtime: null, source: 'none' };
}
