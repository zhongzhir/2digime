/**
 * DIGITALME-CAPABILITY-FALLBACK-CLOSURE-01 — 真实闭环 e2e（DeepSeek-only 深度研究 / 当前信息）。
 *
 * 目标环境：只连接一个普通通用模型（DeepSeek）+ 已有无 key 基础 web 搜索（Bing），
 * 不要求 Gemini / 专业 Research Agent / 新账户。
 *
 * 本套件遵循仓库真实能力测试惯例：无可用模型凭证时**诚实 skip**，不伪造成功。
 * 模型可用性用一次最小真实调用探测（401/网络失败视为不可用）。
 * 真实搜索证据另见 scripts/capability-closure-real-evidence.cjs。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEnvSecretAccessor,
  resolveModelEnvAsync,
  type RuntimeModelCredential,
} from '../../infrastructure/env-secrets';
import { chatComplete } from '../../infrastructure/model-http';
import { providerCredentialKey } from '../../infrastructure/secret-store';
import { createBingHtmlSearchConnector } from '../adapters/bing-html-search';
import {
  runClosureSearch,
  type ConversationChat,
} from '../conversation-search';
import { classifySearchClosure } from '../capability-closure';

let runtimeCred: RuntimeModelCredential | null = null;
let modelEnv: Awaited<ReturnType<typeof resolveModelEnvAsync>> = {
  configured: false,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-flash',
  providerId: 'openai-compatible',
  source: 'default',
  runtime: null,
};
let modelUsable = false;

async function probeModelUsable(): Promise<boolean> {
  const baseUrl = modelEnv.baseUrl;
  const model = modelEnv.model;
  const secrets = createEnvSecretAccessor(process.env, modelEnv.providerId, runtimeCred);
  const apiKey = await secrets.get(providerCredentialKey(modelEnv.providerId));
  if (!apiKey) return false;
  try {
    const result = await chatComplete({
      baseUrl,
      apiKey,
      model,
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 8,
      timeoutMs: 20_000,
    });
    return result.text.trim().length > 0;
  } catch {
    return false;
  }
}

test('bootstrap: 解析模型配置并真实探测可用性（无效凭证 → 诚实 skip，不伪造）', async () => {
  const resolved = await resolveModelEnvAsync(process.cwd(), process.env);
  runtimeCred = resolved.runtime;
  modelEnv = {
    configured: resolved.configured,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    providerId: resolved.providerId,
    source: resolved.source,
    runtime: runtimeCred,
  };
  modelUsable = await probeModelUsable();
  assert.equal(typeof modelUsable, 'boolean');
});

test('CASE 1/3 real：DeepSeek-only 深度研究 + 当前信息（baseline web + 通用模型）', async (t) => {
  if (!modelUsable) {
    t.skip('本环境模型凭证不可用（401/网络失败），诚实跳过真实综合；搜索证据见真实脚本');
    return;
  }
  const bing = createBingHtmlSearchConnector({ timeoutMs: 25_000, maxResults: 5 });
  const chat: ConversationChat = async (messages) => {
    const apiKey = await createEnvSecretAccessor(
      process.env,
      modelEnv.providerId,
      runtimeCred,
    ).get(providerCredentialKey(modelEnv.providerId));
    assert.ok(apiKey, 'credential required');
    const result = await chatComplete({
      baseUrl: modelEnv.baseUrl,
      apiKey,
      model: modelEnv.model,
      messages,
      temperature: 0.2,
      maxTokens: 4096,
      timeoutMs: 120_000,
    });
    const out: { text: string; finishReason?: string; truncated?: boolean } = { text: result.text };
    if (result.finishReason) out.finishReason = result.finishReason;
    if (result.truncated) out.truncated = result.truncated;
    return out;
  };

  const deep = await runClosureSearch({
    userText: '深入研究 2026 年中国 AI Agent 创业与融资趋势。',
    currentDate: new Date().toISOString().slice(0, 10),
    chat,
    connector: bing,
    professionalSearchUsable: false,
    baselineSearchUsable: true,
    modelUsable: true,
  });
  assert.equal(deep.resolution.level, 'baseline');
  assert.equal(deep.reply.mode, 'deep_research');
  assert.equal(deep.reply.usedExternal, true, '真实来源必须参与');
  assert.ok(deep.reply.evidence.rounds.length >= 1);
  const valid = deep.reply.evidence.citationReport?.validCount ?? 0;
  assert.ok(deep.reply.text.length > 0);

  const news = await runClosureSearch({
    userText: '今天 OpenAI 有什么重要新闻？',
    currentDate: new Date().toISOString().slice(0, 10),
    chat,
    connector: bing,
    professionalSearchUsable: false,
    baselineSearchUsable: true,
    modelUsable: true,
  });
  assert.equal(news.resolution.level, 'baseline');
  assert.equal(news.reply.usedExternal, true);
});

test('CASE 1/2 分类：专业能力出现时自然升级（不绑定品牌）', () => {
  const deepOnly = classifySearchClosure({
    need: { mode: 'deep_research', queries: [] },
    professionalSearchUsable: false,
    baselineSearchUsable: true,
    modelUsable: true,
  });
  assert.equal(deepOnly.level, 'baseline');
  const upgraded = classifySearchClosure({
    need: { mode: 'deep_research', queries: [] },
    professionalSearchUsable: true,
    baselineSearchUsable: true,
    modelUsable: true,
  });
  assert.equal(upgraded.level, 'optimal');
});