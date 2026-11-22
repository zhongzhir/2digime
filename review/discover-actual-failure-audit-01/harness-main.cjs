/**
 * DIGITALME-DISCOVER-ACTUAL-FAILURE-AUDIT-01 复现 harness（只读审计，不改产品代码）
 *
 * 在 Electron 主进程里按 electron/main.cjs 的 BYOK 分支组装同一套运行时（Owner 的 ai-capability.path=byok），
 * 数据目录是 Owner 数据的隔离副本。对 fetch / https.get 逐次打点，沿同一次请求输出：
 *   原始输入 → 意图 → 实际查询 → 来源返回 → 卡片 → 终态
 *
 * 环境变量：
 *   AUDIT_USER_DATA   隔离 userData（必填）
 *   AUDIT_HOME        隔离 HOME（必填）
 *   AUDIT_SCENARIO    open | seek:<文本>
 *   AUDIT_OUT         输出 json 路径
 *   AUDIT_CAP_MS      整体上限，默认 480000
 * API Key 通过 safeStorage 在进程内解密，不打印、不落盘。
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..', '..');
const USER_DATA = process.env.AUDIT_USER_DATA;
const HOME = process.env.AUDIT_HOME;
const SCENARIO = process.env.AUDIT_SCENARIO || 'open';
const OUT = process.env.AUDIT_OUT || path.join(__dirname, 'trace.json');
const CAP_MS = Number(process.env.AUDIT_CAP_MS || 480000);
if (!USER_DATA || !HOME) throw new Error('AUDIT_USER_DATA / AUDIT_HOME required');

process.env.DIGITALME_V2_HOME = HOME;
process.env.DIGITALME_V2_USER_DATA = USER_DATA;

const { app, safeStorage } = require('electron');
app.setPath('userData', USER_DATA);
app.disableHardwareAcceleration();

const T0 = Date.now();
const trace = [];
const at = () => Date.now() - T0;
function log(kind, data) {
  trace.push(Object.assign({ t: at(), kind }, data));
}
const cut = (s, n = 400) => {
  const x = typeof s === 'string' ? s : JSON.stringify(s);
  return x == null ? '' : x.length > n ? x.slice(0, n) + `…(+${x.length - n})` : x;
};

// ---------- 打点：fetch ----------
const realFetch = globalThis.fetch.bind(globalThis);
let fetchSeq = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url || String(input);
  const id = ++fetchSeq;
  const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
  const isLlm = /deepseek|\/chat\/completions/i.test(url);
  const isRelay = /muhub\.cn/i.test(host);
  let reqSummary = '';
  try {
    if (init && typeof init.body === 'string') {
      const b = JSON.parse(init.body);
      if (isLlm || (isRelay && b.messages)) {
        const msgs = b.messages || [];
        reqSummary = {
          model: b.model,
          responseFormat: b.response_format || b.responseFormat || null,
          maxTokens: b.max_tokens || b.maxTokens || null,
          tools: (b.tools || []).length,
          system: cut(msgs.find((m) => m.role === 'system')?.content || '', 700),
          lastUser: cut(msgs[msgs.length - 1]?.content || '', 2600),
          msgs: msgs.length,
        };
      } else {
        reqSummary = cut(b, 400);
      }
    }
  } catch { /* ignore */ }
  const startedAt = at();
  log('fetch.start', { id, method: (init && init.method) || 'GET', url: cut(url, 220), reqSummary, timeoutSignal: !!(init && init.signal) });
  try {
    const res = await realFetch(input, init);
    let body = '';
    if (isLlm || isRelay || /\.(xml|rss)|feed|rss/i.test(url)) {
      try { body = await res.clone().text(); } catch { /* ignore */ }
    }
    log('fetch.end', {
      id, ms: at() - startedAt, status: res.status, host,
      bytes: body.length,
      body: isLlm || (isRelay && /ai\/inference/.test(url)) ? cut(body, 7000) : isRelay ? cut(body, 900) : '',
    });
    return res;
  } catch (e) {
    log('fetch.error', { id, ms: at() - startedAt, host, name: e && e.name, msg: cut(e && e.message, 200) });
    throw e;
  }
};

// ---------- 打点：https.get ----------
const realGet = https.get;
let getSeq = 0;
https.get = function patchedGet(...args) {
  const opt = args[0] && typeof args[0] === 'object' ? args[0] : {};
  const id = ++getSeq;
  const startedAt = at();
  const label = `${opt.hostname || ''}${opt.path || ''}`;
  log('https.start', { id, target: cut(label, 200) });
  const req = realGet.apply(this, args);
  req.on('response', (res) => {
    log('https.response', { id, ms: at() - startedAt, status: res.statusCode, target: cut(label, 120) });
  });
  req.on('error', (e) => log('https.error', { id, ms: at() - startedAt, target: cut(label, 120), msg: cut(e && e.message, 160) }));
  req.on('timeout', () => log('https.timeout', { id, ms: at() - startedAt, target: cut(label, 120) }));
  return req;
};
void http;

function cardRow(card) {
  let host = '';
  try { host = new URL(card.url || '').host; } catch { /* ignore */ }
  return {
    id: String(card.itemId || '').slice(0, 11),
    type: card.contentType || '',
    title: cut(card.title || '', 40),
    url: cut(card.url || '', 160),
    host,
    pub: String(card.publishedAt || '').slice(0, 10),
    media: !!card.mediaUrl,
    embed: !!card.embedUrl,
    thumb: !!card.thumbnailUrl,
    consumption: card.consumption || '',
    fidelity: card.objectFidelity || '',
    excerpt: !!card.excerpt,
    access: card.accessState || '',
    cond: card.conditionStatus || '',
    condNote: cut(card.conditionNote || '', 80),
    kind: card.objectKind || '',
    channel: card.channelUse || '',
    duration: card.durationSeconds || '',
    entrance: cut(card.entrancePurpose || '', 40),
    reason: cut(card.reason || '', 120),
  };
}
function viewRow(v) {
  if (!v) return null;
  return {
    feedMode: v.feedMode, reasonCode: v.reasonCode, replenishing: v.replenishing,
    notice: cut(v.notice || '', 160), headline: v.headline, lead: cut(v.lead || '', 120),
    searchQuery: v.searchQuery, gen: v.searchGenerationId, networking: v.networking,
    cards: (v.cards || []).map(cardRow),
    related: (v.relatedCards || []).length,
    unjudged: (v.unjudgedCards || []).length,
    access: (v.accessCards || []).length,
    unjudgedTitles: (v.unjudgedCards || []).slice(0, 5).map((c) => cut(c.title, 40)),
    relatedRows: (v.relatedCards || []).map(cardRow),
    adjustment: v.adjustment
      ? {
          summary: cut(v.adjustment.summary || '', 160),
          scope: v.adjustment.scope || '',
          scopeNote: cut(v.adjustment.scopeNote || '', 120),
          question: cut(v.adjustment.question || '', 120),
        }
      : null,
    relatedTitle: v.relatedTitle || '',
    supplyTrace: (v.supplyTrace || []).map((row) => ({ event: row.event, ms: row.ms, count: row.count })),
    searchUsage: v.searchUsage || null,
    seekTrace: v.seekTrace
      ? {
          raw: v.seekTrace.rawCandidates, primary: v.seekTrace.primaryContent, about: v.seekTrace.aboutContent,
          unrelated: v.seekTrace.unrelated, selected: v.seekTrace.selected, hits: v.seekTrace.rawSearchHits,
          duplicates: v.seekTrace.duplicates, judgePages: v.seekTrace.judgePages, notSent: v.seekTrace.notSentToJudge,
          rateLimited: !!v.seekTrace.searchRateLimited,
          items: (v.seekTrace.items || []).map((r) => ({
            id: String(r.contentId || '').slice(0, 14), type: r.contentType || '', origin: r.origin,
            fid: r.fidelity || 'UNJUDGED', typeOk: r.typeMatched, sel: r.selected, vis: r.visible,
            title: cut(r.title || '', 50),
          })),
        }
      : null,
  };
}

async function main() {
  await app.whenReady();
  const { resolveModelConfig } = require(path.join(ROOT, 'electron', 'bootstrap-secrets.cjs'));
  const { loadBrand } = require(path.join(ROOT, 'electron', 'brand.cjs'));
  const brand = loadBrand();
  const { createDigitalMeRuntime } = require(path.join(ROOT, 'dist', 'runtime', 'digitalme-runtime'));
  const { readOrCreateInstallCapabilityToken } = require(path.join(ROOT, 'dist', 'capability', 'install-capability-token'));
  const { readWebDiscoveryPreference } = require(path.join(ROOT, 'dist', 'capability', 'web-discovery-preference'));
  const { readOrMigrateAiCapabilityPreference } = require(path.join(ROOT, 'dist', 'capability', 'ai-capability-preference'));
  const { ensureDefaultPackageAttached } = require(path.join(ROOT, 'electron', 'default-package.cjs'));

  const model = await resolveModelConfig({ safeStorage, userDataPath: USER_DATA, isPackaged: true, allowDevRuntimeFile: false });
  const webPref = await readWebDiscoveryPreference(USER_DATA);
  const installToken = await readOrCreateInstallCapabilityToken(USER_DATA);
  const aiPref = await readOrMigrateAiCapabilityPreference(USER_DATA, { hasByokKey: model.ok === true });
  const gateway = String(brand.webDiscoveryGatewayUrl || '').trim();
  log('boot', {
    modelOk: model.ok === true,
    modelMeta: model.modelMeta || null,
    aiPath: aiPref.path,
    webDiscovery: webPref,
    gatewayHost: (() => { try { return new URL(gateway).host; } catch { return gateway; } })(),
    hasInstallToken: !!installToken,
    sha: (() => { try { return require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(); } catch { return ''; } })(),
  });
  if (aiPref.path !== 'byok') throw new Error('expected byok path for Owner scene, got ' + aiPref.path);
  if (model.documentCapability !== 'openai-compatible') throw new Error('model not usable: ' + JSON.stringify(model.status || {}));

  const options = {
    documentCapability: 'openai-compatible',
    openaiCompatible: model.openaiCompatible,
    secrets: model.secrets,
    registerOpenAiStub: false,
    codeAnalysisCapability: 'openai-compatible',
    webDiscoveryEnabled: webPref.enabled !== false,
    webDiscoveryPath: webPref.path === 'byok' ? 'byok' : 'managed',
    ...(gateway ? { webDiscoveryGatewayUrl: gateway } : {}),
    ...(installToken ? { webDiscoveryInstallToken: installToken } : {}),
    requestFolderAccess: async () => false,
  };
  const runtime = createDigitalMeRuntime(options);
  runtime.eventBus.subscribe((ev) => log('event', { type: ev && (ev.type || ev.name), data: cut(ev, 240) }));
  const attached = await ensureDefaultPackageAttached({ runtime, userDataPath: USER_DATA });
  log('attach', { ok: attached.ok, reason: attached.reason || '' });

  let gen = 'sg_audit_' + Date.now().toString(36);
  const call = async (label, payload) => {
    const s = at();
    log('content.call', { label, payload: cut(payload, 300) });
    try {
      const r = await runtime.content(payload);
      log('content.return', { label, ms: at() - s, view: viewRow(r && r.view) });
      return r;
    } catch (e) {
      log('content.throw', { label, ms: at() - s, name: e && e.name, msg: cut(e && e.message, 300) });
      throw e;
    }
  };

  // 复刻渲染层 followReplenish(最多两次 replenish)
  const follow = async (view) => {
    let guard = 0; let cur = view;
    while (guard < 2 && cur && cur.replenishing) {
      guard += 1;
      const r = await call(`replenish#${guard}`, { action: 'replenish', searchGenerationId: gen });
      cur = r && r.view;
    }
    return cur;
  };

  const cap = setTimeout(() => {
    log('cap', { ms: CAP_MS, note: '整体上限触发，调用仍未返回' });
    finish(2);
  }, CAP_MS);

  async function finish(code) {
    clearTimeout(cap);
    try { await runtime.stop(); } catch { /* ignore */ }
    fs.writeFileSync(OUT, JSON.stringify({ scenario: SCENARIO, totalMs: at(), trace }, null, 1));
    app.exit(code);
  }

  try {
    if (SCENARIO === 'open') {
      const first = await call('discover', { action: 'discover', searchGenerationId: gen });
      const last = await follow(first && first.view);
      log('final', { view: viewRow(last) });
    } else if (SCENARIO.startsWith('open-then-seek:')) {
      // 复刻真实界面顺序：打开发现页（discover → replenish#1 → replenish#2 在途），约 18 秒后用户提交搜索
      const text = SCENARIO.slice('open-then-seek:'.length);
      const openGen = gen;
      const first = await call('discover', { action: 'discover', searchGenerationId: openGen });
      void (async () => {
        let cur = first && first.view; let g = 0;
        while (g < 2 && cur && cur.replenishing) {
          g += 1;
          const r = await call(`open-follow-replenish#${g}`, { action: 'replenish', searchGenerationId: openGen });
          cur = r && r.view;
        }
      })();
      await new Promise((r) => setTimeout(r, Number(process.env.AUDIT_WAIT_BEFORE_SEEK_MS || 18000)));
      log('input', { raw: text });
      gen = 'sg_audit_seek_' + Date.now().toString(36);
      const sfirst = await call('seek', { action: 'seek', text, searchGenerationId: gen });
      const last = await follow(sfirst && sfirst.view);
      log('final', { view: viewRow(last) });
      // 终态探测：再向运行时问两次当前状态，看 replenishing 是否仍为 true
      for (let i = 1; i <= 2; i += 1) {
        await new Promise((r) => setTimeout(r, 5000));
        const probe = await call(`probe-state#${i}`, { action: 'replenish', searchGenerationId: gen });
        log('probe', { replenishing: probe && probe.view && probe.view.replenishing });
      }
    } else if (SCENARIO.startsWith('talk:')) {
      const text = SCENARIO.slice(5);
      log('input', { raw: text });
      const s = at();
      const r = await runtime.talk({ text });
      const turns = (r && r.view && r.view.turns) || [];
      log('talk.return', { ms: at() - s, notice: cut(r && r.view && r.view.notice, 200), last: turns.slice(-2).map((t) => ({ role: t.role, text: cut(t.text, 1500) })) });
    } else if (SCENARIO === 'quality-05' || SCENARIO === 'delivery-04') {
      gen = 'sg_audit_d4_' + Date.now().toString(36);
      const adj = await call('adjust-course', {
        action: 'adjust',
        text: '最近看剧有点多了，帮我找几门适合我的AI投资与产品落地课程，每天大约一小时。',
        searchGenerationId: gen,
      });
      log('adjust-first-paint', { view: viewRow(adj && adj.view) });
      const afterAdj = await follow(adj && adj.view);
      log('after-course-adjust', { view: viewRow(afterAdj) });
      const unused = [
        ['seek-gannan', '带孩子去甘南若尔盖住哪里'],
        ['seek-minguo', '找几本完结的民国探案'],
        ['seek-coop', '想找能联机的合作解谜'],
        ['seek-manju', '周末想看点轻松的国创奇幻漫剧'],
      ];
      for (const [label, text] of unused) {
        gen = 'sg_audit_d4_' + Date.now().toString(36);
        const first = await call(label, { action: 'seek', text, searchGenerationId: gen });
        const last = await follow(first && first.view);
        log('after-' + label, { view: viewRow(last) });
      }
      gen = 'sg_audit_d4rev_' + Date.now().toString(36);
      const rev = await call('revoke', { action: 'adjustRevoke', searchGenerationId: gen });
      log('revoke-first-paint', { view: viewRow(rev && rev.view) });
      log('after-revoke', { view: viewRow(await follow(rev && rev.view)) });
    } else if (SCENARIO === 'adjust-03-course') {
      gen = 'sg_audit_course_' + Date.now().toString(36);
      const first = await call('adjust-course', {
        action: 'adjust',
        text: '最近看剧有点多了，帮我找几门适合我的AI投资与产品落地课程，每天大约一小时。',
        searchGenerationId: gen,
      });
      const last = await follow(first && first.view);
      log('after-course-adjust', { view: viewRow(last) });
    } else if (SCENARIO === 'adjust-03') {
      const openFirst = await call('discover', { action: 'discover', searchGenerationId: gen });
      const before = await follow(openFirst && openFirst.view);
      log('before-adjust', { view: viewRow(before) });
      gen = 'sg_audit_adj_' + Date.now().toString(36);
      const adjFirst = await call('adjust', {
        action: 'adjust',
        text: '最近看剧有点多了，帮我看看有哪些适合我的课程。',
        searchGenerationId: gen,
      });
      const afterAdj = await follow(adjFirst && adjFirst.view);
      log('after-adjust', { view: viewRow(afterAdj) });
      gen = 'sg_audit_game_' + Date.now().toString(36);
      const gameFirst = await call('seek-game', {
        action: 'seek',
        text: '适合周末一个人玩的回合制策略',
        searchGenerationId: gen,
      });
      const afterGame = await follow(gameFirst && gameFirst.view);
      log('after-game-seek', { view: viewRow(afterGame) });
      gen = 'sg_audit_rev_' + Date.now().toString(36);
      const revFirst = await call('revoke', { action: 'adjustRevoke', searchGenerationId: gen });
      const afterRev = await follow(revFirst && revFirst.view);
      log('after-revoke', { view: viewRow(afterRev) });
    } else if (SCENARIO.startsWith('adjust:')) {
      const text = SCENARIO.slice(7);
      log('input', { raw: text });
      gen = 'sg_audit_adj_' + Date.now().toString(36);
      const first = await call('adjust', { action: 'adjust', text, searchGenerationId: gen });
      log('adjust-first-paint', { view: viewRow(first && first.view) });
      const last = await follow(first && first.view);
      log('final', { view: viewRow(last) });
    } else if (SCENARIO.startsWith('seek:')) {
      const text = SCENARIO.slice(5);
      log('input', { raw: text });
      gen = 'sg_audit_' + Date.now().toString(36);
      const first = await call('seek', { action: 'seek', text, searchGenerationId: gen });
      const last = await follow(first && first.view);
      log('final', { view: viewRow(last) });
    } else {
      throw new Error('unknown scenario ' + SCENARIO);
    }
    await finish(0);
  } catch (e) {
    log('fatal', { name: e && e.name, msg: cut(e && e.message, 300), stack: cut(e && e.stack, 600) });
    await finish(1);
  }
}

main().catch((e) => {
  try { fs.writeFileSync(OUT, JSON.stringify({ scenario: SCENARIO, boot_error: String(e && e.stack || e), trace }, null, 1)); } catch { /* ignore */ }
  app.exit(3);
});
