/**
 * DIGITALME-CONVERSATION-SEARCH-RESEARCH-01
 * 覆盖 frozen semantics：决策（模型+显式特征）、web_search pipeline、deep_research 最小闭环、
 * 引用与冲突表达、owner context 相关性参与、external 不污染本人事实、诚实失败。
 *
 * 本套件为离线确定性测试：connector 与 chat 全部注入 fake，不访问网络。
 * 真实 Bing 验证在 scripts/ 独立证据脚本中执行。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decideSearchNeed,
  runConversationSearch,
  runWebSearch,
  runDeepResearch,
  hasExternalSources,
  type ConversationChat,
} from '../conversation-search';
import type { SearchConnector } from '../search-connector';
import type { SearchSource, SearchNeed } from '../search-contract';
import { createBingHtmlSearchConnector, parseBingSearchResults, decodeBingRedirectUrl } from '../adapters/bing-html-search';
import {
  EXTERNAL_SOURCE_CLASS,
  isExternalSource,
} from '../search-contract';

const SOURCE_POOL = [
  { title: 'OpenAI 发布最新模型', url: 'https://openai.com/news', host: 'openai.com' },
  { title: 'AI 行业周报', url: 'https://techcrunch.com/ai-week', host: 'techcrunch.com' },
  { title: 'OpenAI 官方公告', url: 'https://openai.com/blog', host: 'openai.com' },
  { title: '维基百科 - OpenAI', url: 'https://en.wikipedia.org/wiki/OpenAI', host: 'en.wikipedia.org' },
  { title: 'AI 创新大赛报名', url: 'https://competition.example.com/ai-2026', host: 'competition.example.com' },
  { title: 'AI Agent 产业报告', url: 'https://research.example.com/ai-agent', host: 'research.example.com' },
  { title: '创业公司融资快讯', url: 'https://funding.example.com/news', host: 'funding.example.com' },
  { title: '政策支持 AI 产业', url: 'https://gov.example.com/ai-policy', host: 'gov.example.com' },
];

function fakeConnector(options?: { fail?: boolean }): SearchConnector {
  let cursor = 0;
  const seen = new Set<string>();
  return {
    id: 'fake',
    async search(_query) {
      if (options?.fail) throw new Error('搜索网络失败：fake network down');
      const sources: SearchSource[] = [];
      while (sources.length < 4 && cursor < SOURCE_POOL.length) {
        const s = SOURCE_POOL[cursor]!;
        cursor += 1;
        if (seen.has(s.host)) continue;
        seen.add(s.host);
        sources.push({ title: s.title, url: s.url, sourceClass: EXTERNAL_SOURCE_CLASS });
      }
      return sources;
    },
  };
}

function fakeChat(behavior: 'web' | 'research' | 'no-search' | 'unparseable' | 'throw'): ConversationChat {
  const log: string[] = [];
  const chat = async (messages: Array<{ role: string; content: string }>): Promise<{ text: string }> => {
    log.push(messages.map((m) => m.role).join(','));
    const last = messages[messages.length - 1]?.content || '';
    if (behavior === 'throw') throw new Error('model down');
    if (behavior === 'no-search') return { text: '{"mode":"no_search","queries":[]}' };
    if (behavior === 'unparseable') return { text: 'sorry, no json' };
    if (behavior === 'research') {
      if (/follow_up_queries/.test(last)) {
        return {
          text: '{"follow_up_queries":["补充：行业融资数据 2026","补充：政策支持 AI Agent"],"unresolved_questions":["具体融资规模尚不明确"]}',
        };
      }
      if (/用户消息：/.test(last)) {
        return { text: '{"mode":"deep_research","queries":["2026 中国 AI Agent 趋势","2026 中国 AI Agent 融资"]}' };
      }
      return { text: '综合答案（deep）[1][2]' };
    }
    // web 决策：system 提示含「搜索决策器」，用户句形如「用户消息：…」
    if (/用户消息：/.test(last)) {
      return { text: '{"mode":"web_search","queries":["OpenAI 最新新闻 2026"]}' };
    }
    return { text: '综合答案（web）[1][2]\n\n来源：[1] OpenAI 官方 https://openai.com/news' };
  };
  return chat;
}

function baseOptions(chat: ConversationChat, connector: SearchConnector) {
  return {
    userText: '最近 OpenAI 有什么重要新闻？',
    subjectFacts: ['用户正在准备一个 AI 创新大赛参赛作品', '数字之我的定位是数字主体与 AI Native'],
    currentDate: '2026-08-20',
    chat,
    connector,
  };
}

describe('conversation-search-01', () => {
  it('A: 决策 — 明确「不要搜索」硬覆盖为 no_search', async () => {
    const d = await decideSearchNeed({
      ...baseOptions(fakeChat('web'), fakeConnector()),
      userText: '不要搜索，就按你的知识回答就行',
    });
    assert.equal(d.mode, 'no_search');
    assert.deepEqual(d.queries, []);
  });

  it('B: 决策 — 明确「深入研究」→ deep_research（显式任务特征）', async () => {
    const d = await decideSearchNeed({
      ...baseOptions(fakeChat('web'), fakeConnector()),
      userText: '请帮我深入研究一下 2026 年中国 AI Agent 的融资趋势',
    });
    assert.equal(d.mode, 'deep_research');
  });

  it('C: 决策 — 模型判断 web_search（普通新闻问题）', async () => {
    const d = await decideSearchNeed(baseOptions(fakeChat('web'), fakeConnector()));
    assert.equal(d.mode, 'web_search');
    assert.ok(Array.isArray(d.queries) && d.queries.length > 0);
  });

  it('D: 决策 — 模型返回不可解析 JSON → 诚实回退 no_search', async () => {
    const d = await decideSearchNeed(baseOptions(fakeChat('unparseable'), fakeConnector()));
    assert.equal(d.mode, 'no_search');
  });

  it('E: 决策 — 模型调用失败 → 回退 no_search，不阻断对话', async () => {
    const d = await decideSearchNeed(baseOptions(fakeChat('throw'), fakeConnector()));
    assert.equal(d.mode, 'no_search');
  });

  it('F: web_search — 执行真实连接器、去重、综合带引用', async () => {
    const reply = await runConversationSearch(baseOptions(fakeChat('web'), fakeConnector()));
    assert.equal(reply.mode, 'web_search');
    assert.ok(reply.usedExternal);
    assert.ok(reply.text.includes('[1]'));
    const totalSources = reply.evidence.rounds.reduce((n, r) => n + r.sources.length, 0);
    assert.ok(totalSources >= 3, `expected >=3 sources, got ${totalSources}`);
    // 主机去重：openai.com 只出现一次
    const hosts = reply.evidence.rounds.flatMap((r) => r.sources.map((s) => new URL(s.url).hostname));
    assert.equal(hosts.filter((h) => h === 'openai.com').length, 1);
    // 全部标记 external
    assert.ok(reply.evidence.rounds.every((r) => r.sources.every((s) => isExternalSource(s))));
  });

  it('G: web_search — 综合提示包含 owner context（相关性参与）', async () => {
    let lastPayload = '';
    const chat: ConversationChat = async (messages) => {
      const last = messages[messages.length - 1]?.content || '';
      if (/用户消息：/.test(last)) return { text: '{"mode":"web_search","queries":["OpenAI 最新新闻"]}' };
      lastPayload = JSON.stringify(messages);
      return { text: '综合答案（web）[1][2]' };
    };
    const reply = await runConversationSearch(baseOptions(chat, fakeConnector()));
    assert.ok(reply.text.length > 0);
    assert.ok(lastPayload.includes('AI 创新大赛'), 'owner context 应注入综合提示');
  });

  it('H: web_search — 明确快速搜索 hint 直接 web_search', async () => {
    const d = await decideSearchNeed({
      ...baseOptions(fakeChat('web'), fakeConnector()),
      userText: '帮我查一下最近的 AI 新闻',
    });
    assert.equal(d.mode, 'web_search');
  });

  it('I: deep_research — 最小闭环：>=2 次搜索轮、来源集、未决问题', async () => {
    const reply = await runDeepResearch(
      baseOptions(fakeChat('research'), fakeConnector()),
      { mode: 'deep_research', queries: ['2026 中国 AI Agent 趋势'] } as SearchNeed,
    );
    assert.equal(reply.mode, 'deep_research');
    assert.ok(reply.usedExternal);
    // 至少两轮不同搜索（首轮 + 补充轮）
    assert.ok(reply.evidence.rounds.length >= 2, `rounds=${reply.evidence.rounds.length}`);
    assert.ok(reply.evidence.iterations && reply.evidence.iterations >= 2);
    // 未决问题被记录且进入综合（诚实标注）
    assert.ok(reply.evidence.research?.unresolvedQuestions?.length);
    assert.ok(reply.text.length > 0);
  });

  it('J: deep_research — 通过主入口触发并保留来源集', async () => {
    const reply = await runConversationSearch({
      ...baseOptions(fakeChat('research'), fakeConnector()),
      userText: '深入研究一下 2026 年中国 AI Agent 的融资趋势',
    });
    assert.equal(reply.mode, 'deep_research');
    assert.ok(hasExternalSources(reply.evidence));
  });

  it('K: 诚实失败 — 搜索连接失败 → 诚实自然语言回复（不假装实时、不抛到用户面）', async () => {
    const chat: ConversationChat = async (messages) => {
      const last = messages[messages.length - 1]?.content || '';
      if (/用户消息：/.test(last)) return { text: '{"mode":"web_search","queries":["x"]}' };
      // 失败回退综合：系统提示要求诚实说明无法获取最新信息
      return { text: '现在没能获取到最新网络信息，我先根据已有知识回答。[已有知识回答]' };
    };
    const reply = await runConversationSearch(baseOptions(chat, fakeConnector({ fail: true })));
    assert.equal(reply.mode, 'web_search');
    assert.equal(reply.usedExternal, false);
    assert.ok(reply.text.includes('最新网络信息'), '应诚实说明无法获取最新信息');
    assert.ok(reply.evidence.rounds.length === 0);
  });

  it('L: external 不污染 — 综合输出不把搜索结果写成本人事实', async () => {
    const chat: ConversationChat = async (messages) => {
      const last = messages[messages.length - 1]?.content || '';
      if (/用户消息：/.test(last)) return { text: '{"mode":"web_search","queries":["OpenAI 最新新闻"]}' };
      // 断言：综合提示中搜索结果以 [n] 来源形式出现，且系统提示要求不混淆
      assert.ok(/网络搜索结果/.test(last));
      return { text: '综合答案（web）[1][2]' };
    };
    const reply = await runConversationSearch(baseOptions(chat, fakeConnector()));
    assert.equal(reply.mode, 'web_search');
    assert.ok(reply.text.length > 0);
    // 产物全部 external，不写入 owner 事实存储（本模块无 Store 写入入口）
    assert.ok(reply.evidence.rounds.every((r) => r.sources.every((s) => s.sourceClass === EXTERNAL_SOURCE_CLASS)));
  });
});

describe('bing-html-search-connector-01', () => {
  it('M: decodeBingRedirectUrl 解码真实 URL', () => {
    assert.equal(decodeBingRedirectUrl('a1aHR0cHM6Ly9vcGVuYWkuY29tLw'), 'https://openai.com/');
    assert.equal(decodeBingRedirectUrl('a1aHR0cHM6Ly93d3cubGlua2VkaW4uY29tL2NvbXBhbnkvb3BlbmFp'), 'https://www.linkedin.com/company/openai');
    assert.equal(decodeBingRedirectUrl(''), '');
    assert.equal(decodeBingRedirectUrl('xyz'), '');
  });

  it('N: parseBingSearchResults 解析 HTML 提取标题与 URL', () => {
    const html = `
<html><body>
<li class="b_algo" data-id="1"><h2 class=""><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=x&amp;u=a1aHR0cHM6Ly9vcGVuYWkuY29tLw&amp;ntb=1" h="ID=SERP,5125.2"><strong>OpenAI</strong> | Research</a></h2></li>
<li class="b_algo" data-id="2"><h2 class=""><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=y&amp;u=a1aHR0cHM6Ly93d3cudGVjaGNydW5jaC5jb20v&amp;ntb=1" h="ID=SERP,5141.2">TechCrunch - AI</a></h2></li>
</body></html>`;
    const results = parseBingSearchResults(html);
    assert.equal(results.length, 2);
    assert.equal(results[0]?.url, 'https://openai.com/');
    assert.equal(results[0]?.title, 'OpenAI | Research');
    assert.equal(results[1]?.url, 'https://www.techcrunch.com/');
  });

  it('O: createBingHtmlSearchConnector 可用真实 fetchImpl 注入', async () => {
    const connector = createBingHtmlSearchConnector({
      fetchImpl: (async () => {
        return new Response('<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?&u=a1aHR0cHM6Ly9vcGVuYWkuY29tLw&ntb=1">OpenAI</a></h2></li>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }) as unknown as typeof fetch,
    });
    const sources = await connector.search('openai');
    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.url, 'https://openai.com/');
    assert.equal(sources[0]?.sourceClass, EXTERNAL_SOURCE_CLASS);
  });

  it('P: 连接器对 202 挑战返回 blocked 错误', async () => {
    const connector = createBingHtmlSearchConnector({
      fetchImpl: (async () => new Response('challenge', { status: 202 })) as unknown as typeof fetch,
    });
    await assert.rejects(() => connector.search('x'), (err: unknown) => {
      const e = err as { kind?: string };
      return e.kind === 'blocked';
    });
  });
});