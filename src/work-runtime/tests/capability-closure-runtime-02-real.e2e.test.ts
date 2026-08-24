/**
 * DIGITALME-CAPABILITY-CLOSURE-RUNTIME-02 — 最低能力环境真实闭环 e2e。
 *
 * single generic model（不要求品牌叫 DeepSeek）+ 无 key 基础 web（Bing）+ URL read：
 * - 真实深度研究：决策 → 搜索 → 读证据 → 综合 → 来源 → 结果（不要求 Gemini/专业 Research Agent/新账户）；
 * - 真实当前新闻：有来源的当前答案；
 * - 真实 Document Do：经真实做事主链 submitTask 产出文件。
 *
 * 真实模型凭证不可用时诚实 skip，不伪造 success。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../job-runner';
import {
  createEnvSecretAccessor,
  resolveModelEnvAsync,
  type RuntimeModelCredential,
} from '../../infrastructure/env-secrets';
import { chatComplete } from '../../infrastructure/model-http';
import { providerCredentialKey } from '../../infrastructure/secret-store';
import { createBingHtmlSearchConnector } from '../../capability/adapters/bing-html-search';
import { runClosureSearch, type ConversationChat } from '../../capability/conversation-search';

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
  const secrets = createEnvSecretAccessor(process.env, modelEnv.providerId, runtimeCred);
  const apiKey = await secrets.get(providerCredentialKey(modelEnv.providerId));
  if (!apiKey) return false;
  try {
    const result = await chatComplete({
      baseUrl: modelEnv.baseUrl,
      apiKey,
      model: modelEnv.model,
      messages: [{ role: 'user', content: '请只回复：OK' }],
      maxTokens: 128,
      timeoutMs: 30_000,
    });
    return result.text.trim().length > 0;
  } catch {
    return false;
  }
}

test('bootstrap: 解析产品模型配置并真实探测可用性（不可用则诚实 skip）', async () => {
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

function realChat(): ConversationChat {
  return async (messages, opts) => {
    const apiKey = await createEnvSecretAccessor(
      process.env,
      modelEnv.providerId,
      runtimeCred,
    ).get(providerCredentialKey(modelEnv.providerId));
    assert.ok(apiKey, 'credential required');
    const result = await chatComplete({
      baseUrl: modelEnv.baseUrl,
      apiKey: apiKey!,
      model: modelEnv.model,
      messages,
      temperature: opts?.temperature ?? 0.2,
      maxTokens: opts?.maxTokens ?? 4096,
      timeoutMs: 120_000,
      ...(opts?.responseFormat ? { responseFormat: { type: opts.responseFormat } } : {}),
    });
    const out: { text: string; finishReason?: string; truncated?: boolean } = { text: result.text };
    if (result.finishReason) out.finishReason = result.finishReason;
    if (result.truncated) out.truncated = result.truncated;
    return out;
  };
}

test('CASE R1（section 四）：single generic model 深度研究真实闭环', async (t) => {
  if (!modelUsable) {
    t.skip('本环境真实模型凭证不可用，诚实跳过真实深度研究；工程接线已由离线测试覆盖');
    return;
  }
  const bing = createBingHtmlSearchConnector({ timeoutMs: 25_000, maxResults: 5 });
  const result = await runClosureSearch({
    userText: '深入研究 2026 年中国 AI Agent 创业与融资趋势。',
    currentDate: new Date().toISOString().slice(0, 10),
    chat: realChat(),
    connector: bing,
    professionalSearchUsable: false,
    baselineSearchUsable: true,
    modelUsable: true,
  });
  const reply = result.reply;
  assert.equal(result.resolution.level, 'baseline');
  assert.equal(reply.mode, 'deep_research');
  assert.equal(reply.usedExternal, true, '必须真实取到外部来源');
  assert.ok(reply.evidence.rounds.length >= 1, '至少一轮真实搜索');
  const sources = reply.evidence.rounds.reduce((n, r) => n + r.sources.length, 0);
  assert.ok(sources >= 1, '来源必须存在');
  assert.ok(reply.text.length > 20, '综合必须产出正文');
  // 用户面不出现「请配置 Gemini/Claude/Perplexity」类要求
  assert.ok(!/配置\s*(Gemini|Claude|Perplexity)/i.test(reply.text));
  // 不得假装专业 Research Agent 存在
  assert.ok(!/专业研究\s*(Agent|代理)|专业 Research/i.test(reply.text));
});

test('CASE R2（section 五）：当前新闻真实闭环（有来源的当前答案）', async (t) => {
  if (!modelUsable) {
    t.skip('本环境真实模型凭证不可用，诚实跳过真实当前新闻');
    return;
  }
  const bing = createBingHtmlSearchConnector({ timeoutMs: 25_000, maxResults: 5 });
  const result = await runClosureSearch({
    userText: '今天 OpenAI 有什么重要新闻？',
    currentDate: new Date().toISOString().slice(0, 10),
    chat: realChat(),
    connector: bing,
    professionalSearchUsable: false,
    baselineSearchUsable: true,
    modelUsable: true,
  });
  assert.equal(result.resolution.level, 'baseline');
  assert.equal(result.reply.usedExternal, true);
  assert.ok(result.reply.text.length > 20);
});

test('CASE R3（section 七 Document）：single generic model 经真实 Do 主链产出文件', async (t) => {
  if (!modelUsable) {
    t.skip('本环境真实模型凭证不可用，诚实跳过真实文档 Do');
    return;
  }
  const runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      baseUrl: modelEnv.baseUrl,
      model: modelEnv.model,
      providerId: modelEnv.providerId,
      displayName: '真实通用模型',
      timeoutMs: 120_000,
    },
    secrets: createEnvSecretAccessor(process.env, modelEnv.providerId, runtimeCred),
    registerOpenAiStub: false,
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-closure-real-doc-'));
  await runtime.createPackage({ displayName: '闭包验证', targetDir: path.join(root, 'pkg') });
  const submitted = await runtime.submitTask({
    goal: '写一份 150 字左右关于本地优先数字主体概念的介绍。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  assert.equal(submitted.capabilityClosure?.level, 'baseline', '文档 Do 应暴露 BASELINE 闭包视图');
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 180_000);
  assert.equal(job.status, 'succeeded');
  assert.ok(job.artifactId, '必须产出真实成果文件');
  const content = (await runtime.getContent({ artifactId: job.artifactId as string })) as {
    text?: string;
  };
  assert.ok((content.text?.length ?? 0) > 20, '成果必须包含正文');
  await runtime.stop();
});