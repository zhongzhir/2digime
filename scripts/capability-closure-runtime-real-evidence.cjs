/**
 * DIGITALME-CAPABILITY-CLOSURE-RUNTIME-02 — 真实最低能力环境闭环证据脚本。
 *
 * 环境：single generic model（DeepSeek openai-compatible）+ 无 key 基础 web（Bing）+ URL read。
 * 关闭：Gemini Deep Research / 专业 Research Agent / 付费 Research provider。
 *
 * 运行：node scripts/capability-closure-runtime-real-evidence.cjs
 * 模型凭证来源优先级：DIGITALME_MODEL_RUNTIME_FILE > 应用 SecretStore 运行时文件 > env。
 * 输出：build/evidence/capability-closure-runtime-02/
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { promises: fsp } = require('node:fs');
const {
  createEnvSecretAccessor,
  resolveModelEnvAsync,
} = require('../dist/infrastructure/env-secrets');
const { chatComplete } = require('../dist/infrastructure/model-http');
const { providerCredentialKey } = require('../dist/infrastructure/secret-store');
const {
  runClosureSearch,
  runConversationSearch,
} = require('../dist/capability/conversation-search');
const {
  createBingHtmlSearchConnector,
} = require('../dist/capability/adapters/bing-html-search');
const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');

const OUT_DIR = path.join(__dirname, '..', 'build', 'evidence', 'capability-closure-runtime-02');

function scrub(v) {
  return JSON.parse(
    JSON.stringify(v, (_k, val) => {
      if (typeof val === 'string' && /sk-[A-Za-z0-9_-]{8,}/.test(val)) return '[redacted]';
      if (typeof val === 'string' && val.length > 6000) return `${val.slice(0, 6000)}…[truncated]`;
      return val;
    }),
  );
}

async function writeEvidence(name, payload) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, `${JSON.stringify(scrub(payload), null, 2)}\n`, 'utf8');
  console.log(`written ${file}`);
}

async function probeModel(env) {
  const secrets = createEnvSecretAccessor(process.env, env.providerId, env.runtime);
  const apiKey = await secrets.get(providerCredentialKey(env.providerId));
  if (!apiKey) return { usable: false, reason: 'no_api_key' };
  try {
    const r = await chatComplete({
      baseUrl: env.baseUrl,
      apiKey,
      model: env.model,
      messages: [{ role: 'user', content: '请只回复：OK' }],
      maxTokens: 128,
      timeoutMs: 30000,
    });
    return { usable: r.text.trim().length > 0, reason: 'probe_ok' };
  } catch (err) {
    return { usable: false, reason: String((err && err.kind) || (err && err.message) || err).slice(0, 160) };
  }
}

function buildChat(env) {
  return async (messages, opts) => {
    const apiKey = await createEnvSecretAccessor(process.env, env.providerId, env.runtime).get(
      providerCredentialKey(env.providerId),
    );
    const r = await chatComplete({
      baseUrl: env.baseUrl,
      apiKey,
      model: env.model,
      messages,
      temperature: (opts && opts.temperature) || 0.2,
      maxTokens: (opts && opts.maxTokens) || 4096,
      timeoutMs: 120000,
      ...(opts && opts.responseFormat ? { responseFormat: { type: opts.responseFormat } } : {}),
    });
    const out = { text: r.text };
    if (r.finishReason) out.finishReason = r.finishReason;
    if (r.truncated) out.truncated = r.truncated;
    return out;
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const env = await resolveModelEnvAsync(process.cwd(), process.env);
  const probe = await probeModel(env);
  const evidence = {
    task: 'DIGITALME-CAPABILITY-CLOSURE-RUNTIME-02',
    base: '8ac15ef build/capability-fallback-closure-01',
    branch: 'build/capability-closure-runtime-02',
    at: new Date().toISOString(),
    environment: {
      singleGenericModel: {
        baseUrl: env.baseUrl,
        model: env.model,
        providerId: env.providerId,
        source: env.source,
        usable: probe.usable,
        reason: probe.reason,
      },
      professionalResearchAgent: { usable: false, note: '未连接（验证目标：不要求）' },
      baselineWeb: { usable: true, provider: 'no-key bing html' },
      geminiDeepResearch: { enabled: false },
    },
  };

  if (!probe.usable) {
    evidence.deepResearchClosure = { executed: false, reason: `真实模型凭证不可用：${probe.reason}` };
    evidence.currentNewsClosure = { executed: false, reason: '真实模型凭证不可用' };
    evidence.documentDoClosure = { executed: false, reason: '真实模型凭证不可用' };
    await writeEvidence('real-closure.json', evidence);
    console.log(JSON.stringify({ ok: true, partial: true, singleGenericModelUsable: false }, null, 2));
    return;
  }

  const bing = createBingHtmlSearchConnector({ timeoutMs: 25000, maxResults: 5 });
  const chat = buildChat(env);
  const today = new Date().toISOString().slice(0, 10);

  // 1) 深度研究真实闭环（不要求 Gemini / 专业 Research Agent / 新账户）
  try {
    const deep = await runClosureSearch({
      userText: '深入研究 2026 年中国 AI Agent 创业与融资趋势。',
      currentDate: today,
      chat,
      connector: bing,
      professionalSearchUsable: false,
      baselineSearchUsable: true,
      modelUsable: true,
    });
    evidence.deepResearchClosure = {
      executed: true,
      level: deep.resolution.level,
      mode: deep.reply.mode,
      usedExternal: deep.reply.usedExternal,
      iterations: deep.reply.evidence.iterations,
      roundCount: deep.reply.evidence.rounds.length,
      sourceCount: deep.reply.evidence.rounds.reduce((n, r) => n + r.sources.length, 0),
      citationReport: deep.reply.evidence.citationReport,
      sources: deep.reply.evidence.rounds.flatMap((r) => r.sources.slice(0, 5)).map((s) => ({ title: s.title, url: s.url })),
      answer: deep.reply.text,
    };
  } catch (err) {
    evidence.deepResearchClosure = { executed: false, error: String(err && err.message || err).slice(0, 200) };
  }

  // 2) 当前新闻真实闭环
  try {
    const news = await runClosureSearch({
      userText: '今天 OpenAI 有什么重要新闻？',
      currentDate: today,
      chat,
      connector: bing,
      professionalSearchUsable: false,
      baselineSearchUsable: true,
      modelUsable: true,
    });
    evidence.currentNewsClosure = {
      executed: true,
      level: news.resolution.level,
      mode: news.reply.mode,
      usedExternal: news.reply.usedExternal,
      sourceCount: news.reply.evidence.rounds.reduce((n, r) => n + r.sources.length, 0),
      answer: news.reply.text,
    };
  } catch (err) {
    evidence.currentNewsClosure = { executed: false, error: String(err && err.message || err).slice(0, 200) };
  }

  // 3) 真实 Document Do（经真实做事主链 submitTask 产出文件）
  try {
    const runtime = createDigitalMeRuntime({
      documentCapability: 'openai-compatible',
      openaiCompatible: {
        baseUrl: env.baseUrl,
        model: env.model,
        providerId: env.providerId,
        displayName: '真实通用模型',
        timeoutMs: 120000,
      },
      secrets: createEnvSecretAccessor(process.env, env.providerId, env.runtime),
      registerOpenAiStub: false,
    });
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-closure-evidence-'));
    await runtime.createPackage({ displayName: '闭包证据', targetDir: path.join(root, 'pkg') });
    const submitted = await runtime.submitTask({
      goal: '写一份 150 字左右关于本地优先数字主体概念的介绍。',
      contextRefs: [],
      requestedArtifactType: 'document',
    });
    const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 180000);
    let artifactChars = 0;
    if (job.artifactId) {
      const content = (await runtime.getContent({ artifactId: job.artifactId })) || {};
      artifactChars = (content.text || '').length;
    }
    evidence.documentDoClosure = {
      executed: true,
      closureLevel: submitted.capabilityClosure && submitted.capabilityClosure.level,
      jobStatus: job.status,
      artifactChars,
      artifactId: job.artifactId,
    };
    await runtime.stop();
  } catch (err) {
    evidence.documentDoClosure = { executed: false, error: String(err && err.message || err).slice(0, 200) };
  }

  // 4) provider failure → baseline fallback（可控模拟：主搜索 quota 失败 → 基础搜索继续）
  try {
    const failing = {
      id: 'failing-professional',
      async search() {
        throw Object.assign(new Error('primary quota exhausted'), { kind: 'quota' });
      },
      async read() {
        return null;
      },
    };
    const p = await runConversationSearch({
      userText: '最近开源大模型有哪些新发布？',
      currentDate: today,
      chat,
      connector: failing,
      fallbackConnector: bing,
      providerId: 'professional-search',
    });
    evidence.providerFailureFallback = {
      executed: true,
      usedExternal: p.usedExternal,
      providerDegraded: p.evidence.providerDegraded,
      userTextHasTechError: /503|429|quota|provider|adapter/i.test(p.text),
      answer: p.text,
    };
  } catch (err) {
    evidence.providerFailureFallback = { executed: false, error: String(err && err.message || err).slice(0, 200) };
  }

  await writeEvidence('real-closure.json', evidence);
  console.log(
    JSON.stringify(
      {
        ok: true,
        singleGenericModelUsable: true,
        deepResearch: evidence.deepResearchClosure.executed,
        currentNews: evidence.currentNewsClosure.executed,
        documentDo: evidence.documentDoClosure.executed,
        providerFailureFallback: evidence.providerFailureFallback.executed,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});