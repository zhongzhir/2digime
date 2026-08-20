import type {
  CapabilityAdapter,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
} from '../adapter';
import type { CapabilityRegistration } from '../registration';
import { asLocalCapabilityAdapter } from '../local-adapter-lifecycle';
import { chatComplete, ModelHttpError } from '../../infrastructure/model-http';
import { providerCredentialKey } from '../../infrastructure/secret-store';
import { assembleDocumentPrompt } from './prompt-assemble';

/**
 * model.openai-compatible Adapter(P1.4)。
 * - 只经 CapabilityAdapter 契约与 model-http 通信;
 * - 经 SecretAccessor 取密钥,不直接读 SecretStore 文件;
 * - 不写 Task/Job/Artifact Store;
 * - 领域对象不出现 provider 专有字段(baseUrl/model 仅 Adapter 配置)。
 */
export const OPENAI_COMPATIBLE_CAPABILITY_ID = 'cap_model_openai_compatible';

export interface OpenAiCompatibleAdapterConfig {
  /** SecretAccessor 查找用的 providerId(默认 openai-compatible)。 */
  providerId?: string;
  /** OpenAI-compatible API 根,如 https://api.deepseek.com/v1 */
  baseUrl: string;
  /** 模型标识,如 deepseek-v4-flash */
  model: string;
  displayName?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** 覆盖默认 availability。 */
  availability?: CapabilityRegistration['availability'];
}

export function buildOpenAiCompatibleRegistration(
  config: OpenAiCompatibleAdapterConfig,
): CapabilityRegistration {
  return {
    id: OPENAI_COMPATIBLE_CAPABILITY_ID,
    kind: 'model',
    displayName: config.displayName ?? '通用对话模型',
    description: 'OpenAI 兼容接口的文档生成能力',
    inputContract: {
      acceptsGoal: true,
      acceptsSnapshot: true,
      acceptsSubjectContext: true,
    },
    outputArtifactTypes: ['document'],
    permissions: ['network', 'secret_access'],
    cost: { estimate: '按用量计费' },
    latencyEstimate: '数秒到数十秒',
    location: 'remote',
    availability: config.availability ?? 'available',
    adapter: {
      type: 'openai-compatible-model',
      adapterId: 'openai-compatible-chat',
    },
  };
}

export function createOpenAiCompatibleAdapter(
  config: OpenAiCompatibleAdapterConfig,
): CapabilityAdapter {
  const providerId = config.providerId ?? 'openai-compatible';
  const secretKey = providerCredentialKey(providerId);
  const registration = buildOpenAiCompatibleRegistration(config);

  return asLocalCapabilityAdapter({
    registration,
    async execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput> {
      if (input.artifactType !== 'document') {
        throw Object.assign(new Error(`unsupported artifact type: ${input.artifactType}`), {
          stage: 'capability' as const,
          actionable: '当前模型能力仅支持文档成果',
        });
      }

      ctx.reportProgress('正在读取凭证');
      const apiKey = await ctx.secrets.get(secretKey);
      if (!apiKey) {
        throw Object.assign(new Error('model credential is not configured'), {
          stage: 'capability' as const,
          actionable: '请先配置模型接口凭证后再试',
        });
      }

      ctx.reportProgress('正在组织材料');
      const readText =
        ctx.readExtractedText ??
        (async () => {
          throw new Error('extracted text resolver is not available');
        });
      const assembled = await assembleDocumentPrompt(input, readText);

      if (ctx.signal.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }

      ctx.reportProgress('正在调用模型');
      let result;
      try {
        result = await chatComplete({
          baseUrl: config.baseUrl,
          apiKey,
          model: config.model,
          messages: assembled.messages,
          ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
          ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
          ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
          signal: ctx.signal,
        });
      } catch (error) {
        throw mapModelError(error);
      }

      const text = result.text.trim();
      if (text.length === 0) {
        throw Object.assign(new Error('model returned empty content'), {
          stage: 'model' as const,
          actionable: '请重试;若持续为空请更换模型或简化目标',
        });
      }

      ctx.reportProgress('正在整理成果');
      const title = extractTitle(text, input.goal);
      const output: CapabilityOutput = {
        artifact: {
          type: 'document',
          title,
          payload: { kind: 'text', format: 'markdown', text },
        },
        materialUse: {
          usedPaths: assembled.sources,
          includedCount: assembled.materialCount,
          truncatedCount: assembled.truncatedCount,
          fullReadCount: assembled.fullReadCount,
          skippedWarningCount: assembled.skippedWarningCount,
          items: assembled.items.map((it) => ({
            path: it.sourcePath,
            completeness: it.completeness,
            sourceChars: it.sourceChars,
            usedChars: it.usedChars,
          })),
        },
      };
      if (result.usage?.totalTokens !== undefined) {
        output.costActual = { tokens: result.usage.totalTokens };
      }
      return output;
    },
  });
}

/** 保留给无凭证场景的占位注册(availability=needs_setup)。 */
export function createOpenAiCompatibleAdapterStub(): CapabilityAdapter {
  return createOpenAiCompatibleAdapter({
    baseUrl: 'https://example.invalid/v1',
    model: 'unset',
    availability: 'needs_setup',
  });
}

function extractTitle(markdown: string, goal: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  if (heading?.[1]) return heading[1].trim().slice(0, 80);
  return goal.trim().slice(0, 80) || '文档';
}

function mapModelError(error: unknown): Error {
  if (error instanceof ModelHttpError) {
    const stage = error.kind === 'unauthorized' || error.kind === 'bad_request' ? 'capability' : 'model';
    const actionable = actionableFor(error.kind);
    // 消息已由 model-http 截断;再做一次安全 scrub。
    const message = scrubSecrets(error.message);
    return Object.assign(new Error(message), {
      stage: stage as 'capability' | 'model',
      actionable,
      kind: error.kind,
      status: error.status,
    });
  }
  if (error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message))) {
    return error;
  }
  return Object.assign(new Error(scrubSecrets((error as Error).message || 'model call failed')), {
    stage: 'model' as const,
    actionable: '请稍后重试',
  });
}

function actionableFor(kind: ModelHttpError['kind']): string {
  switch (kind) {
    case 'unauthorized':
      return '请检查模型凭证是否有效';
    case 'rate_limited':
      return '请求过于频繁,请稍后再试';
    case 'timeout':
      return '模型响应超时,请重试或简化材料';
    case 'aborted':
      return '任务已取消';
    case 'server_error':
      return '模型服务暂时不可用,请稍后重试';
    case 'bad_response':
      return '模型返回无法解析,请重试';
    case 'network':
      return '网络连接失败,请检查网络后重试';
    default:
      return '请检查请求后重试';
  }
}

function scrubSecrets(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"'&\s]+/gi, 'api_key=[redacted]')
    .slice(0, 400);
}
