/**
 * DIGITALME-CAPABILITY-SEMANTICS-02 — Web Search 与 Deep Research 能力语义。
 *
 * 冻结语义：
 *  - CURRENT_WEB_SEARCH：能搜索当前互联网并返回来源。
 *  - BASELINE_RESEARCH：web search + model 组合完成基础多来源研究。
 *  - PROFESSIONAL_DEEP_RESEARCH：明确声明并真实具备（自主规划/多轮获取/gap/综合/可引用报告）的专业 Research Agent。
 * 不得按 provider 品牌推断等级。
 *
 * CASE A: gemini grounded search + model → current_web OPTIMAL；deep_research BASELINE（不虚报）。
 * CASE B: 注入明确 professional deep-research contract → deep_research OPTIMAL（自动升级）。
 * CASE C: 无 Search specialist 但 baseline web + model → deep_research BASELINE，不阻塞。
 * CASE D: 所有外部研究能力不可用 → LIMITED / UNAVAILABLE，不虚报。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCapability, availableFromRegistrations, closureViewFromSelection, capabilityViewFromRegistration } from '../capability-closure';
import { discoverSearchCapabilities, BASELINE_SEARCH_CAPABILITY_ID, PROFESSIONAL_SEARCH_CAPABILITY_ID } from '../search-capability-discovery';
import type { CapabilityRegistration } from '../registration';

function modelReg(): CapabilityRegistration {
  return {
    id: 'cap_model',
    kind: 'model',
    displayName: '通用模型',
    description: '',
    inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
    outputArtifactTypes: ['document'],
    permissions: [],
    cost: { estimate: '' },
    latencyEstimate: '',
    location: 'remote',
    availability: 'available',
    adapter: { type: 'openai-compatible-model', adapterId: 'openai-compatible-chat' },
  };
}

function professionalDeepResearchReg(): CapabilityRegistration {
  return {
    id: 'cap_professional_deep_research',
    kind: 'agent',
    displayName: '专业深度研究',
    description: '自主研究规划、多轮信息获取、gap follow-up、多来源综合核验、可引用报告。',
    inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
    outputArtifactTypes: ['document'],
    permissions: ['network'],
    cost: { estimate: '' },
    latencyEstimate: '',
    location: 'remote',
    availability: 'available',
    adapter: { type: 'remote-subject', adapterId: 'professional-deep-research' },
  };
}

test('CASE A: Gemini Grounded Search + model — current_web OPTIMAL；deep_research BASELINE（不虚报）', () => {
  const search = discoverSearchCapabilities({ GEMINI_API_KEY: 'sk-test' }).map((a) => a.registration);
  const avail = availableFromRegistrations([...search, modelReg()]);

  const cw = resolveCapability({ domain: 'current_web' }, avail);
  assert.equal(cw.level, 'optimal', 'current_web + 专业搜索 → OPTIMAL');
  assert.equal(cw.plan.capabilityId, PROFESSIONAL_SEARCH_CAPABILITY_ID);

  const dr = resolveCapability({ domain: 'deep_research' }, avail);
  assert.equal(dr.level, 'baseline', 'deep_research + web search + model → BASELINE，不是 OPTIMAL-professional');
  assert.ok(!/professional/i.test(String(dr.plan.kindLabel || '')), 'baseline research 不标为专业');
});

test('CASE B: 真正 professional deep-research contract 出现 → deep_research OPTIMAL（自动升级）', () => {
  const search = discoverSearchCapabilities({ GEMINI_API_KEY: 'sk-test' }).map((a) => a.registration);
  const before = resolveCapability({ domain: 'deep_research' }, availableFromRegistrations([...search, modelReg()]));
  assert.equal(before.level, 'baseline');

  const after = resolveCapability(
    { domain: 'deep_research' },
    availableFromRegistrations([...search, modelReg(), professionalDeepResearchReg()]),
  );
  assert.equal(after.level, 'optimal', '明确 professional deep research 出现后自动升级');
  assert.equal(after.plan.capabilityId, 'cap_professional_deep_research');
});

test('CASE C: 无 Search specialist 但 baseline web + model → deep_research BASELINE，不阻塞', () => {
  const baseline = discoverSearchCapabilities({ GEMINI_API_KEY: '' }).map((a) => a.registration);
  assert.ok(baseline.some((r) => r.id === BASELINE_SEARCH_CAPABILITY_ID));
  assert.ok(!baseline.some((r) => r.id === PROFESSIONAL_SEARCH_CAPABILITY_ID), '无凭据时无专业搜索');

  const dr = resolveCapability({ domain: 'deep_research' }, availableFromRegistrations([...baseline, modelReg()]));
  assert.equal(dr.level, 'baseline', 'baseline web + model → BASELINE research，仍完成');
});

test('CASE D: 所有外部研究能力不可用 → LIMITED / UNAVAILABLE，不虚报', () => {
  // 只有 model，无任何 search → deep_research limited。
  const drModelOnly = resolveCapability({ domain: 'deep_research' }, availableFromRegistrations([modelReg()]));
  assert.equal(drModelOnly.level, 'limited');

  // 完全无可执行能力 → unavailable。
  const drNone = resolveCapability({ domain: 'deep_research' }, availableFromRegistrations([]));
  assert.equal(drNone.level, 'unavailable');
});

test('capabilityViewFromRegistration: search 能力不再服务 deep_research 域', () => {
  const search = discoverSearchCapabilities({ GEMINI_API_KEY: 'sk-test' });
  for (const a of search) {
    const view = capabilityViewFromRegistration(a.registration);
    assert.ok(view, 'search 能力应有视图');
    assert.ok(!view!.domains.includes('deep_research'), `${a.registration.id} 不得服务 deep_research`);
    assert.ok(view!.domains.includes('current_web'), `${a.registration.id} 服务 current_web`);
  }
});

test('closureViewFromSelection: deep_research 选中 search 时仍报 BASELINE', () => {
  const search = discoverSearchCapabilities({ GEMINI_API_KEY: 'sk-test' }).map((a) => a.registration);
  const view = closureViewFromSelection({
    need: { domain: 'deep_research' },
    selectedAdapterType: 'local-tool',
    selectedCapabilityId: PROFESSIONAL_SEARCH_CAPABILITY_ID,
    availableRegistrations: [...search, modelReg()],
  });
  assert.equal(view.level, 'baseline', 'deep_research 执行走 search 但等级如实为 BASELINE');

  // current_web 选中专业搜索 → OPTIMAL。
  const cwView = closureViewFromSelection({
    need: { domain: 'current_web' },
    selectedAdapterType: 'local-tool',
    selectedCapabilityId: PROFESSIONAL_SEARCH_CAPABILITY_ID,
    availableRegistrations: search,
  });
  assert.equal(cwView.level, 'optimal');
});