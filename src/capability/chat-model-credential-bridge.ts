/**
 * 把 2digime 已有聊天模型连接临时映射给成熟 Coding Agent。
 * 不写第二套 SecretStore，不把密钥写入 evidence / 仓库。
 */
import type { SecretAccessor } from './adapter';
import { providerCredentialKey } from '../infrastructure/secret-store';

export interface ChatModelConnection {
  providerId?: string;
  baseUrl?: string;
  model?: string;
}

export interface BridgedProviderEnv {
  env: Record<string, string>;
  modelRef: string;
  host: string;
  nativeDeepSeek: boolean;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '';
  }
}

export async function mapChatModelToProviderEnv(input: {
  secrets?: SecretAccessor;
  connection?: ChatModelConnection;
}): Promise<BridgedProviderEnv | null> {
  const providerId = String(input.connection?.providerId || 'openai-compatible').trim() || 'openai-compatible';
  const baseUrl = String(input.connection?.baseUrl || '').replace(/\/+$/, '');
  const model = String(input.connection?.model || '').trim();
  const apiKey = input.secrets ? await input.secrets.get(providerCredentialKey(providerId)) : null;
  if (!apiKey || !baseUrl || !model) return null;
  const host = hostOf(baseUrl);
  const nativeDeepSeek = /deepseek\.com$/i.test(host) || /(^|\.)deepseek\./i.test(host);
  const env: Record<string, string> = nativeDeepSeek
    ? { DEEPSEEK_API_KEY: apiKey }
    : { OPENAI_API_KEY: apiKey };
  return {
    env,
    modelRef: nativeDeepSeek ? `deepseek/${model}` : `openai-compatible/${model}`,
    host,
    nativeDeepSeek,
  };
}
