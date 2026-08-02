/**
 * 环境变量 / 应用运行时凭证适配器(P1.4 测试/本机开发)。
 * 不落盘、不日志;仅实现 SecretAccessor.get。
 *
 * 识别键:
 * - model.provider.openai-compatible.apiKey
 * - model.provider.<providerId>.apiKey
 *
 * 密钥来源优先级:
 * 1. DIGITALME_MODEL_API_KEY
 * 2. 应用 SecretStore 导出的运行时文件(见 load-app-model-credential.cjs)
 * 3. OPENAI_API_KEY / DEEPSEEK_API_KEY / DASHSCOPE_API_KEY
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { SecretAccessor } from '../capability/adapter';
import { providerCredentialKey } from './secret-store';

export const DEFAULT_MODEL_RUNTIME_FILE = path.join(
  'scripts',
  '_mvp-p14-real-capability-evidence',
  '.runtime-model-credential.json',
);

export interface RuntimeModelCredential {
  providerId: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  source?: string;
}

export async function readRuntimeModelCredential(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeModelCredential | null> {
  const filePath = env.DIGITALME_MODEL_RUNTIME_FILE
    ? path.resolve(env.DIGITALME_MODEL_RUNTIME_FILE)
    : path.resolve(cwd, DEFAULT_MODEL_RUNTIME_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RuntimeModelCredential>;
    const apiKey = String(parsed.apiKey || '').trim();
    const baseUrl = String(parsed.baseUrl || '').trim().replace(/\/+$/, '');
    const model = String(parsed.model || '').trim();
    if (!apiKey || !baseUrl || !model) return null;
    return {
      providerId: String(parsed.providerId || 'openai-compatible').trim() || 'openai-compatible',
      baseUrl,
      model,
      apiKey,
      ...(parsed.source ? { source: parsed.source } : {}),
    };
  } catch {
    return null;
  }
}

function envApiKey(env: NodeJS.ProcessEnv): string {
  return (
    env.DIGITALME_MODEL_API_KEY ||
    env.OPENAI_API_KEY ||
    env.DEEPSEEK_API_KEY ||
    env.DASHSCOPE_API_KEY ||
    ''
  ).trim();
}

export function createEnvSecretAccessor(
  env: NodeJS.ProcessEnv = process.env,
  providerId = 'openai-compatible',
  runtime?: RuntimeModelCredential | null,
): SecretAccessor {
  const expected = providerCredentialKey(providerId);
  return {
    async get(key: string): Promise<string | null> {
      if (key !== expected) return null;
      // 显式 DIGITALME_MODEL_API_KEY 优先;否则优先应用运行时文件,避免错误 OPENAI_* 配对。
      const explicit = (env.DIGITALME_MODEL_API_KEY || '').trim();
      if (explicit) return explicit;
      if (runtime?.apiKey) return runtime.apiKey;
      const fileCred = await readRuntimeModelCredential(process.cwd(), env);
      if (fileCred?.apiKey) return fileCred.apiKey;
      const fromEnv = (
        env.OPENAI_API_KEY ||
        env.DEEPSEEK_API_KEY ||
        env.DASHSCOPE_API_KEY ||
        ''
      ).trim();
      return fromEnv.length > 0 ? fromEnv : null;
    },
  };
}

export interface ResolvedModelEnv {
  configured: boolean;
  baseUrl: string;
  model: string;
  providerId: string;
  source: 'env' | 'app_runtime_file' | 'default';
}

/** 解析本机模型接入配置(不含密钥值)。同步版仅看 env;异步版可合并应用运行时文件。 */
export function resolveModelEnv(env: NodeJS.ProcessEnv = process.env): ResolvedModelEnv {
  const baseUrl = (
    env.DIGITALME_MODEL_BASE_URL ||
    env.OPENAI_BASE_URL ||
    env.DEEPSEEK_BASE_URL ||
    env.DASHSCOPE_BASE_URL ||
    'https://api.deepseek.com/v1'
  ).replace(/\/+$/, '');
  const model =
    env.DIGITALME_MODEL ||
    env.OPENAI_MODEL ||
    env.DEEPSEEK_MODEL ||
    'deepseek-v4-flash';
  const providerId = env.DIGITALME_MODEL_PROVIDER_ID || 'openai-compatible';
  const hasKey = Boolean(envApiKey(env));
  return {
    configured: hasKey,
    baseUrl,
    model,
    providerId,
    source: hasKey ? 'env' : 'default',
  };
}

/** 优先应用运行时文件(与正式应用 SecretStore 对齐),再回退 env。 */
export async function resolveModelEnvAsync(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedModelEnv & { runtime: RuntimeModelCredential | null }> {
  const runtime = await readRuntimeModelCredential(cwd, env);
  if (runtime) {
    return {
      configured: true,
      baseUrl: runtime.baseUrl,
      model: runtime.model,
      providerId: runtime.providerId,
      source: 'app_runtime_file',
      runtime,
    };
  }
  const sync = resolveModelEnv(env);
  return { ...sync, runtime: null };
}
