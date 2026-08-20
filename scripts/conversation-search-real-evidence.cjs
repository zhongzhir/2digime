/**
 * DIGITALME-CONVERSATION-SEARCH-RESEARCH-01 — 真实 Web 搜索证据脚本。
 * 使用已连接的真实模型凭据 + 真实 Bing HTML 搜索，跑通：
 *   决策(web_search/deep_research/no_search) → 真实搜索 → 综合成文(引用)。
 *
 * 运行：node scripts/conversation-search-real-evidence.cjs
 * 需要 DIGITALME_V2_ALLOW_DEV_CREDENTIAL=1 且存在 dev runtime credential，
 * 或环境变量 DIGITALME_CONVERSATION_SEARCH_BASE_URL / _MODEL / _API_KEY。
 * 输出证据 JSON 到 scripts/_conversation-search-real-evidence-evidence/。
 */
const fs = require('node:fs');
const path = require('node:path');
const { chatComplete } = require('../dist/infrastructure/model-http');
const {
  runConversationSearch,
} = require('../dist/capability/conversation-search');
const { createBingHtmlSearchConnector } = require('../dist/capability/adapters/bing-html-search');

const OUT_DIR = path.join(__dirname, '_conversation-search-real-evidence-evidence');

function resolveCredential() {
  const fromEnv = {
    baseUrl: process.env.DIGITALME_CONVERSATION_SEARCH_BASE_URL,
    model: process.env.DIGITALME_CONVERSATION_SEARCH_MODEL,
    apiKey: process.env.DIGITALME_CONVERSATION_SEARCH_API_KEY,
  };
  if (fromEnv.baseUrl && fromEnv.model && fromEnv.apiKey) return fromEnv;
  const devCredential = path.join(
    __dirname,
    '..',
    'digitalme-v2',
    'scripts',
    '_mvp-p14-real-capability-evidence',
    '.runtime-model-credential.json',
  );
  if (fs.existsSync(devCredential)) {
    const j = JSON.parse(fs.readFileSync(devCredential, 'utf8'));
    if (j.baseUrl && j.model && j.apiKey) {
      return { baseUrl: j.baseUrl, model: j.model, apiKey: j.apiKey };
    }
  }
  return null;
}

const SCENARIOS = [
  {
    id: 'scenario-1-no-search',
    label: '水结冰（应 no_search，不触发搜索）',
    userText: '水在0摄氏度会结冰吗？',
  },
  {
    id: 'scenario-2-web-search',
    label: 'OpenAI 最近新闻（应 web_search + 引用）',
    userText: '最近 OpenAI 有什么重要新闻？',
  },
  {
    id: 'scenario-6-owner-context',
    label: '结合赛事目标找比赛（web_search + owner context）',
    userText: '最近有什么适合我项目参加的 AI 创新类比赛？',
  },
  {
    id: 'scenario-5-deep-research',
    label: '深度研究（deep_research 最小闭环：>=2 轮搜索）',
    userText: '深入研究一下 2026 年中国 AI Agent 创业与融资的趋势',
  },
  {
    id: 'scenario-8-network-down',
    label: '网络不可用（应诚实失败回退）',
    userText: '现在最新的人工智能大会是什么时候？',
    forceNetworkDown: true,
  },
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const credential = resolveCredential();
  if (!credential) {
    console.log(JSON.stringify({ ok: false, error: 'no credential available' }, null, 2));
    process.exitCode = 2;
    return;
  }

  const chat = async (messages, opts) => {
    const result = await chatComplete({
      baseUrl: credential.baseUrl,
      apiKey: credential.apiKey,
      model: credential.model,
      messages,
      temperature: opts && typeof opts.temperature === 'number' ? opts.temperature : 0.4,
      maxTokens: opts && Number.isFinite(opts.maxTokens) && opts.maxTokens > 0 ? opts.maxTokens : 1600,
      timeoutMs: 120_000,
      ...(opts && opts.responseFormat ? { responseFormat: { type: opts.responseFormat } } : {}),
    });
    return result;
  };

  const realConnector = createBingHtmlSearchConnector();
  const downConnector = {
    id: 'down',
    async search() {
      throw new Error('搜索网络失败：模拟断网');
    },
  };

  const records = [];
  for (const scenario of SCENARIOS) {
    const start = Date.now();
    const connector = scenario.forceNetworkDown ? downConnector : realConnector;
    try {
      const reply = await runConversationSearch({
        userText: scenario.userText,
        subjectFacts: [
          '用户正在准备 2digime 参加 AI 创新大赛',
          '数字之我的定位是数字主体与 AI Native',
        ],
        currentDate: new Date().toISOString().slice(0, 10),
        chat,
        connector,
      });
      records.push({
        id: scenario.id,
        label: scenario.label,
        mode: reply.mode,
        usedExternal: reply.usedExternal,
        text: reply.text.slice(0, 1200),
        rounds: reply.evidence.rounds.map((r) => ({
          query: r.query,
          sources: r.sources.map((s) => ({ title: s.title, url: s.url })),
        })),
        iterations: reply.evidence.iterations,
        ms: Date.now() - start,
      });
      console.log(`✔ ${scenario.id} ${scenario.label} -> ${reply.mode}`);
    } catch (err) {
      records.push({
        id: scenario.id,
        label: scenario.label,
        mode: 'error',
        error: String(err && err.message ? err.message : err),
        ms: Date.now() - start,
      });
      console.log(`✖ ${scenario.id} ${scenario.label} -> ${String(err.message || err).slice(0, 200)}`);
    }
  }

  const evidence = {
    ok: true,
    generatedAt: new Date().toISOString(),
    credentialSource: 'dev-runtime-credential-or-env',
    scenarios: records,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'conversation-search-real-evidence.json'),
    JSON.stringify(evidence, null, 2),
    'utf8',
  );
  console.log('\nEvidence written to', path.join(OUT_DIR, 'conversation-search-real-evidence.json'));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});