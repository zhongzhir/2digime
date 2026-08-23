/**
 * DIGITALME-CAPABILITY-FALLBACK-CLOSURE-01 — 真实闭环证据脚本。
 *
 * 验证"只有通用模型 + 无 key 基础 web"也能完成基本任务闭环：
 * - 真实 Bing 搜索（无需账户，已在本机验证可达）产生真实来源；
 * - 若模型凭证真实可用：跑通真实 deep_research / current_web 闭环（决策→搜索→证据→综合→引用）；
 * - 若模型凭证不可用：诚实记录，不伪造成功。
 *
 * 运行：node scripts/capability-closure-real-evidence.cjs
 * 输出：build/evidence/capability-closure-01/
 */
const fs = require('node:fs');
const path = require('node:path');
const { chatComplete } = require('../dist/infrastructure/model-http');
const {
  runClosureSearch,
  runConversationSearch,
} = require('../dist/capability/conversation-search');
const {
  createBingHtmlSearchConnector,
} = require('../dist/capability/adapters/bing-html-search');

const OUT_DIR = path.join(__dirname, '..', 'build', 'evidence', 'capability-closure-01');

function resolveModelConfig() {
  const apiKey =
    process.env.DIGITALME_MODEL_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    '';
  const baseUrl = (
    process.env.DIGITALME_MODEL_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    process.env.DEEPSEEK_BASE_URL ||
    process.env.DASHSCOPE_BASE_URL ||
    'https://api.deepseek.com/v1'
  ).replace(/\/+$/, '');
  const model =
    process.env.DIGITALME_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.DEEPSEEK_MODEL ||
    'deepseek-v4-flash';
  return { baseUrl, model, apiKey };
}

async function probeModel(cfg) {
  if (!cfg.apiKey) return { usable: false, reason: 'no_api_key' };
  try {
    const result = await chatComplete({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 8,
      timeoutMs: 20000,
    });
    return { usable: result.text.trim().length > 0, reason: 'probe_ok' };
  } catch (err) {
    const msg = String(err && err.message || err);
    return { usable: false, reason: msg.slice(0, 160) };
  }
}

function scrub(v) {
  return JSON.parse(
    JSON.stringify(v, (_k, val) => {
      if (typeof val === 'string' && /sk-[A-Za-z0-9_-]{8,}/.test(val)) return '[redacted]';
      if (typeof val === 'string' && val.length > 4000) return `${val.slice(0, 4000)}…[truncated]`;
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

async function realBingEvidence(bing) {
  const rows = [];
  const queries = [
    '2026 年中国 AI Agent 创业与融资趋势',
    '2026 中国 AI Agent 融资 亿元 创业公司',
    'OpenAI 今天 新闻 2026',
  ];
  for (const q of queries) {
    try {
      const sources = await bing.search(q, { signal: undefined });
      rows.push({
        query: q,
        ok: true,
        sourceCount: sources.length,
        sources: sources.slice(0, 5).map((s) => ({ title: s.title, url: s.url, snippet: (s.snippet || '').slice(0, 120) })),
      });
    } catch (err) {
      rows.push({ query: q, ok: false, error: String(err && err.message || err).slice(0, 160) });
    }
  }
  return rows;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cfg = resolveModelConfig();
  const modelProbe = await probeModel(cfg);
  const bing = createBingHtmlSearchConnector({ timeoutMs: 25000, maxResults: 5 });

  const evidence = {
    task: 'DIGITALME-CAPABILITY-FALLBACK-CLOSURE-01',
    base: '5083675 build/real-capability-benchmark-01',
    branch: 'build/capability-fallback-closure-01',
    at: new Date().toISOString(),
    environment: {
      model: { baseUrl: cfg.baseUrl, model: cfg.model, hasKey: cfg.apiKey.length > 0 },
      modelProbe,
      professionalResearchAgent: { usable: false, note: '未连接专业 Research Agent（验证目标）' },
      baselineWeb: { usable: true, provider: 'no-key bing html' },
    },
  };

  // 1) 真实 baseline web 搜索证据（无 key，已可达）。
  const bingEvidence = await realBingEvidence(bing);
  evidence.baselineWebRounds = bingEvidence;
  await writeEvidence('step-1-baseline-web-real.json', { environment: evidence.environment, rounds: bingEvidence });

  // 2) 真实模型综合（仅当凭证真实可用）。
  if (!modelProbe.usable) {
    evidence.deepResearchClosure = {
      executed: false,
      reason: `模型凭证不可用：${modelProbe.reason}`,
      note: '不伪造真实综合结果；能力选择与降级语义已由离线确定性测试覆盖。',
    };
    evidence.currentNewsClosure = { executed: false, reason: '模型凭证不可用，跳过真实综合' };
    await writeEvidence('step-2-real-closure.json', evidence);
    console.log(JSON.stringify({ ok: true, partial: true, modelUsable: false }, null, 2));
    return;
  }

  const chat = async (messages) => {
    const result = await chatComplete({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages,
      temperature: 0.2,
      maxTokens: 4096,
      timeoutMs: 120000,
    });
    return { text: result.text, finishReason: result.finishReason, truncated: result.truncated };
  };

  try {
    const deep = await runClosureSearch({
      userText: '深入研究 2026 年中国 AI Agent 创业与融资趋势。',
      currentDate: new Date().toISOString().slice(0, 10),
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
      answer: deep.reply.text,
    };
  } catch (err) {
    evidence.deepResearchClosure = { executed: false, error: String(err && err.message || err).slice(0, 200) };
  }

  try {
    const news = await runClosureSearch({
      userText: '今天 OpenAI 有什么重要新闻？',
      currentDate: new Date().toISOString().slice(0, 10),
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

  await writeEvidence('step-2-real-closure.json', evidence);
  console.log(JSON.stringify({ ok: true, modelUsable: true, deepResearchClosure: evidence.deepResearchClosure.executed, currentNewsClosure: evidence.currentNewsClosure.executed }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});