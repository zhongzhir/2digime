/**
 * DIGITALME-CAPABILITY-FALLBACK-CLOSURE-01
 * 验证能力选择 / 降级语义（OPTIMAL / BASELINE / LIMITED / UNAVAILABLE）与 10 个真实验证场景。
 *
 * 离线确定性测试：capability 视图与 search connector 全部 fake，不访问网络。
 * 真实模型 / 真实搜索的 e2e 在 capability-closure-real.e2e.test.ts（无有效凭证时诚实 skip）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveCapability,
  resolveFromRegistry,
  classifySearchClosure,
  buildCapabilityNotice,
  domainFromSearchNeed,
  domainFromWorkIntent,
  capabilityViewFromRegistration,
  type AvailableCapability,
  type TaskCapabilityNeed,
} from '../capability-closure';
import {
  runClosureSearch,
  runConversationSearch,
  type ConversationChat,
} from '../conversation-search';
import type { SearchConnector } from '../search-connector';
import { EXTERNAL_SOURCE_CLASS, type SearchSource } from '../search-contract';
import type { CapabilityRegistration } from '../registration';
import type { WorkIntent } from '../../work-runtime/work-intent';

const FORBIDDEN_TECH_TERMS = [
  /gemini/i,
  /deepseek/i,
  /gpt-?\s?\d/i,
  /qwen/i,
  /claude/i,
  /openai/i,
  /quota/i,
  /adapter/i,
  /\bmcp\b/i,
  /provider/i,
  /api[_-]?key/i,
];

function assertNoTechLeak(text: string | undefined, label: string): void {
  if (!text) return;
  for (const re of FORBIDDEN_TECH_TERMS) {
    assert.ok(!re.test(text), `${label} 不得泄露技术细节：${text}（命中 ${re}）`);
  }
}

function modelCap(id = 'model_any', available = true): AvailableCapability {
  return {
    capabilityId: id,
    kindLabel: '通用模型',
    tier: 'model',
    domains: ['deep_research', 'current_web', 'coding', 'document', 'stable_knowledge'],
    usable: available,
    automatic: true,
  };
}

function baselineWeb(id = 'baseline_web'): AvailableCapability {
  return {
    capabilityId: id,
    kindLabel: '基础搜索能力',
    tier: 'baseline',
    domains: ['deep_research', 'current_web'],
    usable: true,
    automatic: true,
    qualityGap: true,
  };
}

function professionalSearch(id = 'prof_search'): AvailableCapability {
  return {
    capabilityId: id,
    kindLabel: '专业能力',
    tier: 'professional',
    domains: ['deep_research', 'current_web'],
    usable: true,
    automatic: true,
  };
}

function professionalCoding(id = 'coding_cli'): AvailableCapability {
  return {
    capabilityId: id,
    kindLabel: '专业能力',
    tier: 'professional',
    domains: ['coding'],
    usable: true,
    automatic: true,
  };
}

function baselineCoding(id = 'coding_model_api'): AvailableCapability {
  return {
    capabilityId: id,
    kindLabel: '基础代码能力',
    tier: 'baseline',
    domains: ['coding'],
    usable: true,
    automatic: true,
    qualityGap: true,
  };
}

function need(domain: TaskCapabilityNeed['domain']): TaskCapabilityNeed {
  return { domain };
}

function registration(partial: {
  id: string;
  type: CapabilityRegistration['adapter']['type'];
  availability?: CapabilityRegistration['availability'];
}): CapabilityRegistration {
  return {
    id: partial.id,
    kind: 'model',
    displayName: partial.id,
    description: '',
    inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
    outputArtifactTypes: [],
    permissions: [],
    cost: { estimate: '' },
    latencyEstimate: '',
    location: 'remote',
    availability: partial.availability ?? 'available',
    adapter: { type: partial.type, adapterId: `${partial.type}-test` },
  };
}

function workIntent(over: Partial<WorkIntent>): WorkIntent {
  return {
    intentKind: 'general',
    expectedOutputFamily: 'document',
    materialKinds: [],
    highConfidence: false,
    ...over,
  };
}

const fakeSources: SearchSource[] = [
  { title: 'AI Agent 产业报告', url: 'https://research.example.com/agent', sourceClass: EXTERNAL_SOURCE_CLASS },
  { title: '融资快讯', url: 'https://funding.example.com/news', sourceClass: EXTERNAL_SOURCE_CLASS },
];

function fakeSearchConnector(opts?: { fail?: boolean; failKind?: string; empty?: boolean }): SearchConnector {
  return {
    id: 'fake',
    async search(_q) {
      if (opts?.empty) return [];
      if (opts?.fail) {
        throw Object.assign(new Error('primary provider down'), { kind: opts.failKind ?? 'network' });
      }
      return fakeSources;
    },
    async read() {
      return null;
    },
  };
}

function fakeChat(): ConversationChat {
  return async (messages) => {
    const sys = messages.find((m) => m.role === 'system')?.content || '';
    const last = messages[messages.length - 1]?.content || '';
    if (/联网获取最新信息失败|没能获取到最新网络信息/.test(sys)) {
      return { text: '现在没能获取到最新网络信息，我可以先根据已有知识回答。' };
    }
    if (/用户消息：/.test(last)) {
      return { text: '{"mode":"deep_research","queries":["2026 中国 AI Agent 趋势"]}' };
    }
    return {
      text: '综合答案 [1][2]\n\n来源：[1] AI Agent 产业报告 https://research.example.com/agent\n[2] 融资快讯 https://funding.example.com/news',
    };
  };
}

describe('capability-closure-01', () => {
  describe('域派生（复用既有意图，不建第二套）', () => {
    it('WorkIntent → 域', () => {
      assert.equal(domainFromWorkIntent(workIntent({ intentKind: 'modify_code' })), 'coding');
      assert.equal(domainFromWorkIntent(workIntent({ intentKind: 'analyze_code' })), 'coding');
      assert.equal(domainFromWorkIntent(workIntent({ intentKind: 'create_document' })), 'document');
      assert.equal(domainFromWorkIntent(workIntent({ intentKind: 'external_research' })), 'deep_research');
      assert.equal(domainFromWorkIntent(workIntent({ intentKind: 'general' })), 'stable_knowledge');
    });
    it('SearchNeed → 域', () => {
      assert.equal(domainFromSearchNeed({ mode: 'deep_research', queries: [] }), 'deep_research');
      assert.equal(domainFromSearchNeed({ mode: 'web_search', queries: [] }), 'current_web');
      assert.equal(domainFromSearchNeed({ mode: 'no_search', queries: [] }), 'stable_knowledge');
    });
    it('注册表条目 → 运行态能力视图（按合同归类，不看品牌）', () => {
      const model = capabilityViewFromRegistration(registration({ id: 'm', type: 'openai-compatible-model' }));
      assert.equal(model?.tier, 'model');
      const cli = capabilityViewFromRegistration(registration({ id: 'c', type: 'external-executor-cli' }));
      assert.equal(cli?.tier, 'professional');
      const api = capabilityViewFromRegistration(registration({ id: 'a', type: 'external-executor-model-api' }));
      assert.equal(api?.tier, 'baseline');
      const remote = capabilityViewFromRegistration(registration({ id: 'r', type: 'remote-subject' }));
      assert.equal(remote?.tier, 'professional');
      assert.deepEqual(remote?.domains, ['deep_research', 'current_web']);
      const mcp = capabilityViewFromRegistration(registration({ id: 't', type: 'mcp-stdio' }));
      assert.equal(mcp, null);
      const unavailable = capabilityViewFromRegistration(
        registration({ id: 'u', type: 'openai-compatible-model', availability: 'needs_setup' }),
      );
      assert.equal(unavailable?.usable, false);
    });
  });

  describe('CASE 1：Deep Research — 只有通用模型 + baseline web → BASELINE 闭环', () => {
    it('不要求新账户，默认继续执行', () => {
      const res = resolveCapability(need('deep_research'), [modelCap(), baselineWeb()]);
      assert.equal(res.level, 'baseline');
      assert.equal(res.plan.kindLabel, '基础搜索能力');
      assert.equal(res.userNotice, undefined); // BASELINE 默认静默
      assert.deepEqual(res.userChoices, []);
      assert.equal(res.need.domain, 'deep_research');
    });
  });

  describe('CASE 2：Deep Research — 专业能力可用 → 自动选更强', () => {
    it('OPTIMAL，静默执行', () => {
      const res = resolveCapability(need('deep_research'), [modelCap(), baselineWeb(), professionalSearch()]);
      assert.equal(res.level, 'optimal');
      assert.equal(res.plan.kindLabel, '专业能力');
      assert.equal(res.userNotice, undefined);
    });
  });

  describe('CASE 3：当前信息 — 通用模型 + baseline web → 有来源的当前答案', () => {
    it('BASELINE，直接执行', () => {
      const res = resolveCapability(need('current_web'), [modelCap(), baselineWeb()]);
      assert.equal(res.level, 'baseline');
      assert.equal(res.userNotice, undefined);
    });
    it('只有搜索能力没有综合模型 → LIMITED（无法成文）', () => {
      const res = resolveCapability(need('current_web'), [baselineWeb()]);
      assert.equal(res.level, 'limited');
    });
  });

  describe('CASE 4：当前信息 — 无联网能力 → 不幻觉当前事实（LIMITED）', () => {
    it('诚实受限，不得假装实时', () => {
      const res = resolveCapability(need('current_web'), [modelCap()]);
      assert.equal(res.level, 'limited');
      assert.ok(res.userNotice && /无法可靠确认最新信息/.test(res.userNotice));
      assert.ok(!/今天/.test(res.userNotice || ''), '不得用训练知识假装“今天”');
      assert.deepEqual(res.userChoices, ['continue_current', 'defer']);
      assertNoTechLeak(res.userNotice, 'CASE4');
    });
    it('无模型也无网络 → UNAVAILABLE', () => {
      const res = resolveCapability(need('current_web'), []);
      assert.equal(res.level, 'unavailable');
      assert.ok(res.userNotice && /没有可靠可用/.test(res.userNotice));
    });
  });

  describe('CASE 5：稳定知识 — 只有通用模型 → 直接回答，不错误要求 Search', () => {
    it('BASELINE 直接回答，不产生搜索要求', () => {
      const res = resolveCapability(need('stable_knowledge'), [modelCap()]);
      assert.equal(res.level, 'baseline');
      assert.equal(res.plan.kindLabel, '通用模型');
      assert.equal(res.userNotice, undefined);
    });
  });

  describe('CASE 6：文档生成 — 只有通用模型 → 完成文件闭环', () => {
    it('BASELINE，不因无专业文档 Agent 阻塞', () => {
      const res = resolveCapability(need('document'), [modelCap()]);
      assert.equal(res.level, 'baseline');
      assert.equal(res.userNotice, undefined);
    });
    it('无模型 → UNAVAILABLE', () => {
      const res = resolveCapability(need('document'), []);
      assert.equal(res.level, 'unavailable');
    });
  });

  describe('CASE 7：Coding — 专业 Coding Agent 可用 → 专业 Agent', () => {
    it('OPTIMAL', () => {
      const res = resolveCapability(need('coding'), [modelCap(), professionalCoding()]);
      assert.equal(res.level, 'optimal');
      assert.equal(res.plan.kindLabel, '专业能力');
    });
  });

  describe('CASE 8：Coding — 专业 Agent 不可用 → 基础安全 fallback 或诚实 LIMITED', () => {
    it('模型兜底运输（model-api）→ BASELINE 小型任务', () => {
      const res = resolveCapability(need('coding'), [modelCap(), baselineCoding()]);
      assert.equal(res.level, 'baseline');
      assert.equal(res.plan.kindLabel, '基础代码能力');
    });
    it('只有通用模型无代码运输 → LIMITED，不假装已执行', () => {
      const res = resolveCapability(need('coding'), [modelCap()]);
      assert.equal(res.level, 'limited');
      assert.ok(res.userNotice && /不会假装已在项目里执行/.test(res.userNotice));
      assert.deepEqual(res.userChoices, ['continue_current', 'use_stronger', 'defer']);
      assertNoTechLeak(res.userNotice, 'CASE8');
    });
    it('什么都没有 → UNAVAILABLE，给选择', () => {
      const res = resolveCapability(need('coding'), []);
      assert.equal(res.level, 'unavailable');
      assert.deepEqual(res.userChoices, ['continue_current', 'use_stronger', 'defer']);
    });
  });

  describe('CASE 9：能力运行中失败（专业 Search quota/503）→ 自动 baseline fallback 继续完成', () => {
    it('主 provider 失败不杀死任务，不把 HTTP 错误抛给用户', async () => {
      const failing = fakeSearchConnector({ fail: true, failKind: 'quota' });
      const fallback = fakeSearchConnector();
      const reply = await runConversationSearch({
        userText: '深入研究 2026 年中国 AI Agent 创业与融资趋势',
        currentDate: '2026-08-20',
        chat: fakeChat(),
        connector: failing,
        fallbackConnector: fallback,
        providerId: 'primary',
      });
      assert.equal(reply.usedExternal, true);
      assert.equal(reply.evidence.providerDegraded, true);
      assertNoTechLeak(reply.text, 'CASE9 text');
      assert.ok(!/503|429|quota/i.test(reply.text), '用户面不出现 HTTP/quota 细节');
    });
    it('主 provider 返回 empty → 视为本次能力不可用，fallback 完成', async () => {
      const empty = fakeSearchConnector({ empty: true });
      const fallback = fakeSearchConnector();
      const reply = await runConversationSearch({
        userText: '深入研究 2026 年中国 AI Agent 创业与融资趋势',
        currentDate: '2026-08-26',
        chat: fakeChat(),
        connector: empty,
        fallbackConnector: fallback,
        providerId: 'primary',
      });
      assert.equal(reply.usedExternal, true);
      assert.equal(reply.evidence.providerDegraded, true);
      assertNoTechLeak(reply.text, 'CASE9 empty');
    });
  });

  describe('CASE 10：所有关键能力均不可用 → honest unavailable + 用户选择', () => {
    it('不给假完成状态', () => {
      for (const domain of ['deep_research', 'current_web', 'coding', 'document', 'stable_knowledge'] as const) {
        const res = resolveCapability(need(domain), []);
        assert.equal(res.level, 'unavailable');
        assert.ok(res.userNotice && /你可以选择/.test(res.userNotice));
        assert.deepEqual(res.userChoices, ['continue_current', 'use_stronger', 'defer']);
        assertNoTechLeak(res.userNotice, 'CASE10');
      }
    });
  });

  describe('CASE 12：能力恢复与升级 — 任务语义不变，执行网络变化', () => {
    it('同一 need 第二次出现更强能力 → 自然升级', () => {
      const needDeep = need('deep_research');
      const before = resolveCapability(needDeep, [modelCap(), baselineWeb()]);
      assert.equal(before.level, 'baseline');
      const after = resolveCapability(needDeep, [modelCap(), baselineWeb(), professionalSearch()]);
      assert.equal(after.level, 'optimal');
      // 不需要用户重做：仅按当前可用能力重新解析。
    });
    it('Coding 从 BASELINE 升到 OPTIMAL', () => {
      const needCode = need('coding');
      assert.equal(resolveCapability(needCode, [modelCap(), baselineCoding()]).level, 'baseline');
      assert.equal(
        resolveCapability(needCode, [modelCap(), baselineCoding(), professionalCoding()]).level,
        'optimal',
      );
    });
  });

  describe('CASE 13：不绑定 Owner 当前配置（无品牌路由）', () => {
    it('任意通用模型（Qwen / Claude / 本地模型语义）同样闭环', () => {
      const anyModel = modelCap('cap_model_any_provider');
      const res = resolveCapability(need('stable_knowledge'), [anyModel]);
      assert.equal(res.level, 'baseline');
      assert.equal(res.plan.capabilityId, 'cap_model_any_provider');
    });
    it('用户面文案不含任何品牌/协议/状态字眼', () => {
      const res = resolveCapability(need('deep_research'), [modelCap()]);
      assert.equal(res.level, 'limited');
      assertNoTechLeak(res.userNotice, '品牌无关');
    });
  });

  describe('classifySearchClosure（Search/Research 闭包分类）', () => {
    it('DeepSeek-only（baseline web + 模型）深度研究 → BASELINE', () => {
      const res = classifySearchClosure({
        need: { mode: 'deep_research', queries: [] },
        professionalSearchUsable: false,
        baselineSearchUsable: true,
        modelUsable: true,
      });
      assert.equal(res.level, 'baseline');
    });
    it('专业研究能力可用 → OPTIMAL', () => {
      const res = classifySearchClosure({
        need: { mode: 'deep_research', queries: [] },
        professionalSearchUsable: true,
        baselineSearchUsable: true,
        modelUsable: true,
      });
      assert.equal(res.level, 'optimal');
    });
    it('当前信息、无联网 → LIMITED（不幻觉今天）', () => {
      const res = classifySearchClosure({
        need: { mode: 'web_search', queries: [] },
        professionalSearchUsable: false,
        baselineSearchUsable: false,
        modelUsable: true,
      });
      assert.equal(res.level, 'limited');
      assert.ok(res.userNotice && /无法可靠确认最新信息/.test(res.userNotice));
    });
    it('稳定知识问题不错误要求 Search', () => {
      const res = classifySearchClosure({
        need: { mode: 'no_search', queries: [] },
        professionalSearchUsable: false,
        baselineSearchUsable: false,
        modelUsable: true,
      });
      assert.equal(res.level, 'baseline');
    });
  });

  describe('runClosureSearch（执行前分类 + 诚实闭环）', () => {
    it('无联网能力时不发起注定失败的搜索，返回诚实 LIMITED 回复', async () => {
      const { resolution, reply } = await runClosureSearch({
        userText: '今天 OpenAI 有什么重要新闻？',
        currentDate: '2026-08-20',
        chat: fakeChat(),
        connector: fakeSearchConnector({ fail: true, failKind: 'network' }),
        baselineSearchUsable: false,
        professionalSearchUsable: false,
        modelUsable: true,
      });
      assert.equal(resolution.level, 'limited');
      assert.equal(reply.usedExternal, false);
      assert.ok(/没|无法|已有知识/.test(reply.text), '诚实说明无法获取最新网络信息');
      assertNoTechLeak(reply.text, 'runClosureSearch honest');
    });
    it('baseline web 可用时正常完成（BASELINE 闭环）', async () => {
      const { resolution, reply } = await runClosureSearch({
        userText: '深入研究 2026 年中国 AI Agent 创业与融资趋势',
        currentDate: '2026-08-20',
        chat: fakeChat(),
        connector: fakeSearchConnector(),
        baselineSearchUsable: true,
        professionalSearchUsable: false,
        modelUsable: true,
      });
      assert.equal(resolution.level, 'baseline');
      assert.equal(reply.usedExternal, true);
    });
  });

  describe('resolveFromRegistry（复用 CapabilityRegistry 条目）', () => {
    it('注册了专用代码执行器 → Coding OPTIMAL', () => {
      const res = resolveFromRegistry(need('coding'), [
        registration({ id: 'm', type: 'openai-compatible-model' }),
        registration({ id: 'c', type: 'external-executor-cli' }),
      ]);
      assert.equal(res.level, 'optimal');
    });
    it('只注册了模型 → 文档 BASELINE、Coding LIMITED', () => {
      const regs = [registration({ id: 'm', type: 'openai-compatible-model' })];
      assert.equal(resolveFromRegistry(need('document'), regs).level, 'baseline');
      assert.equal(resolveFromRegistry(need('coding'), regs).level, 'limited');
      assert.equal(resolveFromRegistry(need('stable_knowledge'), regs).level, 'baseline');
    });
    it('只注册了模型兜底代码运输 → Coding BASELINE', () => {
      const res = resolveFromRegistry(need('coding'), [
        registration({ id: 'm', type: 'openai-compatible-model' }),
        registration({ id: 'a', type: 'external-executor-model-api' }),
      ]);
      assert.equal(res.level, 'baseline');
    });
  });

  describe('用户面文案（buildCapabilityNotice）', () => {
    it('OPTIMAL / BASELINE 无文案（默认静默）', () => {
      assert.equal(buildCapabilityNotice('optimal', need('deep_research')), undefined);
      assert.equal(buildCapabilityNotice('baseline', need('current_web')), undefined);
    });
    it('LIMITED 不阻塞，提供“继续执行”默认', () => {
      for (const domain of ['deep_research', 'current_web', 'coding', 'document'] as const) {
        const notice = buildCapabilityNotice('limited', need(domain));
        assert.ok(notice && notice.length > 0);
        assertNoTechLeak(notice, `limited ${domain}`);
      }
    });
    it('UNAVAILABLE 诚实 + 三选择', () => {
      const notice = buildCapabilityNotice('unavailable', need('coding'));
      assert.ok(notice && /你可以选择/.test(notice));
      assertNoTechLeak(notice, 'unavailable');
    });
  });
});