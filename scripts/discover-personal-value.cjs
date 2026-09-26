'use strict';
// DISCOVER-2.0-PERSONAL-VALUE-08 experiment harness.
// Same public candidate pool, isolated test Subjects (never the Owner's Digital Self), real model.
const fs = require('node:fs/promises');
const { acquirePublicFeeds } = require('../dist/subject-comm/news-supply');
const { selectSupply } = require('../dist/subject-comm/news-selection');
const { formatSelfContext } = require('../dist/intelligence/self-context');
const { chatComplete } = require('../dist/infrastructure/model-http');
const { readRuntimeModelCredential } = require('../dist/infrastructure/env-secrets');

const POOL_LIMIT = 200;
const NOW = '2026-01-01T00:00:00.000Z';
const understanding = (id, text) => ({ id, text, facet: 'preferences', status: 'current', confirmed: true,
  provenance: { origin: 'user_statement', actor: 'owner', statedAt: NOW }, updatedAt: NOW });
const selfOf = (texts) => formatSelfContext(texts.map((t, i) => understanding('u' + i, t)));

const SUBJECTS = {
  A: { label: 'AI/创业/投资/前沿科技', self: selfOf(['我长期关注 AI、创业、一级市场和前沿科技。', '我是一名科技领域投资人。', '我更关心技术趋势、新公司和商业模式。']) },
  B: { label: '文化/阅读/影视/创作', self: selfOf(['我长期关注文化、阅读、影视和内容创作。', '我是一名内容创作者。', '我更关心书籍、纪录片和创作方法。']) },
  C: { label: '消费/旅行/娱乐/健康', self: selfOf(['我长期关注消费生活、旅行、娱乐和健康生活。', '我注重自己的生活方式和身心平衡。', '我更关心好吃的、好玩的、值得去的地方。']) },
  GENERIC: { label: '无数字之我（generic）', self: '' },
};

const summary = (cards) => cards.slice(0, 8).map((c, i) => ({
  rank: i + 1, title: c.title.slice(0, 60), type: c.contentType || 'article',
  publisher: c.publisherDisplayName || '', reason: (c.reason || '').slice(0, 50),
}));

(async () => {
  const cred = await readRuntimeModelCredential(process.cwd());
  if (!cred || !new URL(cred.baseUrl).host.endsWith('deepseek.com')) throw new Error('DeepSeek credential required');
  const model = { baseUrl: cred.baseUrl, model: cred.model, apiKey: cred.apiKey };
  const pool = await acquirePublicFeeds();
  const cards = pool.slice(0, POOL_LIMIT);
  console.log('pool', pool.length, 'using', cards.length);

  const run = async (query, selfContext, preferences = '') =>
    selectSupply({ cards, query, selfContext, preferences, chatComplete: chatComplete, model, resolve: true });

  const evidence = { at: new Date().toISOString(), poolSize: pool.length, usedPool: cards.length, subjects: {}, controlled: [], intentConflict: [], feedback: [], ab: [] };

  // 1. Controlled: same query + same pool, three isolated Subjects + generic.
  const sharedQuery = '最近有什么值得我看的？';
  for (const key of ['A', 'B', 'C', 'GENERIC']) {
    const t = Date.now();
    const chosen = await run(sharedQuery, SUBJECTS[key].self);
    evidence.controlled.push({ subject: key, label: SUBJECTS[key].label, query: sharedQuery, ms: Date.now() - t, cards: summary(chosen) });
    console.log('CONTROLLED', key, chosen.length, 'cards', Date.now() - t, 'ms');
  }

  // 2. Intent conflict: Subject A is an AI/investor, but the current request overrides.
  for (const q of ['今天不要给我科技内容，想看点轻松的。', '我最近需要研究出版业 AI 应用。']) {
    const t = Date.now();
    const chosen = await run(q, SUBJECTS.A.self);
    evidence.intentConflict.push({ subject: 'A', query: q, ms: Date.now() - t, cards: summary(chosen) });
    console.log('INTENT', q.slice(0, 18), chosen.length, 'cards');
  }

  // 3. News scenario across subjects.
  for (const key of ['A', 'B', 'C']) {
    const chosen = await run('今天有什么值得我关注的新闻？', SUBJECTS[key].self);
    evidence.feedback.push({ kind: 'news', subject: key, query: '今天有什么值得我关注的新闻？', cards: summary(chosen) });
  }

  // 4. Explicit feedback loop: baseline -> reduce -> boost on Subject A.
  const fbQuery = '最近有什么值得我看的？';
  const base = await run(fbQuery, SUBJECTS.A.self);
  const reduced = await run(fbQuery, SUBJECTS.A.self, `- [reduce] 少推类似「${(base[0] || {}).title || ''}」的内容`);
  const boosted = await run(fbQuery, SUBJECTS.A.self, `- [boost] 更想看到类似「${(evidence.controlled[1].cards[0] || {}).title || ''}」的内容`);
  evidence.feedback.push({ kind: 'baseline', cards: summary(base) });
  evidence.feedback.push({ kind: 'after-reduce', cards: summary(reduced) });
  evidence.feedback.push({ kind: 'after-boost', cards: summary(boosted) });
  console.log('FEEDBACK baseline/reduce/boost', base.length, reduced.length, boosted.length);

  // 5. A/B: generic vs personalized (Subject A) across >= 10 real queries + model comparison.
  const abQueries = [
    sharedQuery, '今天有什么值得我关注的新闻？', '最近有什么值得看的 AI / 科技深度内容？',
    '最近有什么值得听的商业 / 科技 / 投资播客？', '最近一级市场有什么值得关注的内容？',
    '有什么值得看的长文？', '最近文化 / 阅读方面有什么内容？', '有什么适合通勤听的音频？',
    '最近有什么重要视频？', '有什么轻松一点、不费脑的内容？',
  ];
  const verdicts = { BETTER: 0, SAME: 0, WORSE: 0 };
  for (const q of abQueries) {
    const generic = await run(q, SUBJECTS.GENERIC.self);
    const personal = await run(q, SUBJECTS.A.self);
    const compare = await chatComplete({ ...model, temperature: 0, thinking: 'disabled', maxTokens: 400, timeoutMs: 30000,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: '比较两组来自相同公共候选池的发现结果，输出 JSON {"verdict":"BETTER|SAME|WORSE","reason":"最多40字"}。以“对这位具体用户是否更有用”为标准，不看出结果数量。' },
        { role: 'user', content: JSON.stringify({ userProfile: SUBJECTS.A.label, userSelf: SUBJECTS.A.self, query: q,
          generic: summary(generic).map((c) => c.title), personalized: summary(personal).map((c) => c.title) }) },
      ] });
    let verdict = 'SAME'; let reason = '';
    try {
      const parsed = JSON.parse(compare.text.slice(compare.text.indexOf('{'), compare.text.lastIndexOf('}') + 1));
      if (['BETTER', 'SAME', 'WORSE'].includes(parsed.verdict)) verdict = parsed.verdict;
      reason = String(parsed.reason || '').slice(0, 80);
    } catch { /* keep SAME */ }
    verdicts[verdict] += 1;
    evidence.ab.push({ query: q, verdict, reason, generic: summary(generic).map((c) => c.title), personalized: summary(personal).map((c) => c.title) });
    console.log('AB', verdict, q.slice(0, 16), '|', reason);
  }
  evidence.verdicts = verdicts;
  await fs.mkdir('docs/audits/evidence/personal-value-08', { recursive: true });
  await fs.writeFile('docs/audits/evidence/personal-value-08/experiment.json', JSON.stringify(evidence, null, 2));
  console.log('VERDICTS', JSON.stringify(verdicts));
})().catch((e) => { console.error(e.name, String(e.message).slice(0, 300)); process.exitCode = 1; });
