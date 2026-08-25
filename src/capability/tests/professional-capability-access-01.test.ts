/**
 * DIGITALME-PROFESSIONAL-CAPABILITY-ACCESS-01 — 专业能力可达性验证。
 *
 * 验证：
 *  - CASE 1/2: Coding 能力自动发现（已安装 CLI → available）；未安装 → 不假执行，走 needs_setup。
 *  - CASE 3: 已有支持 Search 的合法凭据 → 自动发现 search capability。
 *  - CASE 4: 专业 Research capability 存在 → deep_research 自动升级 OPTIMAL。
 *  - CASE 5: 能力后来出现 → 原任务可继续（closure 重新评估，不重建任务语义）。
 *  - CASE 6: 探测失败 → 不暴露技术错误，fallback 仍可运行。
 *
 * 0 新增 Store / 0 新 registry / 0 新 Agent。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { discoverSearchCapabilities, probeSearchAvailability, BASELINE_SEARCH_CAPABILITY_ID, PROFESSIONAL_SEARCH_CAPABILITY_ID } from '../search-capability-discovery';
import { resolveCapability, availableFromRegistrations, closureLevelForAdapterType, closureViewFromSelection } from '../capability-closure';
import { CapabilityRegistry } from '../registry';
import { createExternalExecutorCodexAdapter } from '../adapters/external-executor-codex';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-pca-${prefix}-`));
}

test('CASE 1/2: Coding 能力自动发现 — 已安装 → available；未安装 → needs_setup（不假执行）', async () => {
  const root = await tempDir('codex');
  const runtime = createDigitalMeRuntime({ documentCapability: 'none', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '编码发现', targetDir: path.join(root, 'pkg') });
  try {
    // AtomCode/Codex 探测：capability.list 暴露 availability。
    const caps = await runtime.listCapabilities({});
    const codex = (caps.capabilities || []).find((c) => c.adapter.adapterId === 'external-executor-codex-cli' || c.id === 'cap_external_executor_codex');
    assert.ok(codex, 'codex adapter 自动注册');
    // 断言它至少是一个可探测的执行器（available 或 needs_setup，而非无条件 available 假装可用）。
    assert.ok(
      codex.availability === 'available' || codex.availability === 'needs_setup',
      `codex availability=${codex.availability}`,
    );
    // 未安装时不得假执行：modify_code 在无执行器/无确认规划时抛 plan-confirm 引导或返回 blocked 卡，而非伪造成功。
    let blocked = false;
    try {
      const sub = await runtime.submitTask({
        goal: '把 index.js 的 n 改成 2',
        contextRefs: [{ kind: 'folder', path: root }],
        requestedArtifactType: 'code-change',
        intentKind: 'modify_code',
      });
      blocked = !!(sub.needsExecutorSetup || sub.needsExecutionConfirm || sub.needsProjectFolder);
    } catch (err) {
      blocked = true;
      assert.match(String(err && (err as { message?: string }).message || ''), /plan confirmation required/, '无执行器/无规划时不假执行，走引导');
    }
    assert.ok(blocked, '无执行器时不假执行（返回引导/错误而非伪造成功）');
  } finally {
    await runtime.stop();
  }
});

test('CASE 3: 已有支持 Search 的合法凭据 → 自动发现 search capability', () => {
  // 有 GEMINI key：professional search 注册。
  const withKey = discoverSearchCapabilities({ GEMINI_API_KEY: 'sk-test', GEMINI_SEARCH_MODEL: 'gemini-3.6-flash' });
  const ids = withKey.map((a) => a.registration.id);
  assert.ok(ids.includes(BASELINE_SEARCH_CAPABILITY_ID), 'baseline search 始终注册');
  assert.ok(ids.includes(PROFESSIONAL_SEARCH_CAPABILITY_ID), '有凭据时 professional search 注册');
  assert.equal(withKey.find((a) => a.registration.id === PROFESSIONAL_SEARCH_CAPABILITY_ID)!.registration.availability, 'available');

  // 无 key：只有 baseline。
  const noKey = discoverSearchCapabilities({ GEMINI_API_KEY: '' });
  const noKeyIds = noKey.map((a) => a.registration.id);
  assert.ok(noKeyIds.includes(BASELINE_SEARCH_CAPABILITY_ID));
  assert.ok(!noKeyIds.includes(PROFESSIONAL_SEARCH_CAPABILITY_ID), '无凭据时不注册 professional search');
});

test('CASE 3b: 探测分级 available / needs_simple_setup / unavailable', async () => {
  const regs = discoverSearchCapabilities({ GEMINI_API_KEY: 'sk-test' }).map((a) => a.registration);
  const baseline = regs.find((r) => r.id === BASELINE_SEARCH_CAPABILITY_ID)!;
  const prof = regs.find((r) => r.id === PROFESSIONAL_SEARCH_CAPABILITY_ID)!;
  assert.equal(await probeSearchAvailability(baseline, { GEMINI_API_KEY: '' }), 'available');
  assert.equal(await probeSearchAvailability(prof, { GEMINI_API_KEY: '' }), 'needs_simple_setup');
  assert.equal(await probeSearchAvailability(prof, { GEMINI_API_KEY: 'sk-x' }), 'available');
});

test('CASE 4: 专业 Research capability 存在 → deep_research 自动升级 OPTIMAL', () => {
  const withKey = discoverSearchCapabilities({ GEMINI_API_KEY: 'sk-test' }).map((a) => a.registration);
  const avail = availableFromRegistrations(withKey);
  const prof = avail.find((v) => v.capabilityId === PROFESSIONAL_SEARCH_CAPABILITY_ID);
  assert.ok(prof && prof.tier === 'professional', 'search 专业能力归类为 professional');
  const r = resolveCapability({ domain: 'deep_research' }, avail);
  assert.equal(r.level, 'optimal');
  assert.equal(r.plan.capabilityId, PROFESSIONAL_SEARCH_CAPABILITY_ID);

  // 无凭据：deep_research 为 limited（baseline search），不伪装专业。
  const noKey = discoverSearchCapabilities({ GEMINI_API_KEY: '' }).map((a) => a.registration);
  const availNoKey = availableFromRegistrations(noKey);
  const rNoKey = resolveCapability({ domain: 'deep_research' }, availNoKey);
  assert.equal(rNoKey.level, 'limited');
  assert.ok((rNoKey.userChoices || []).includes('use_stronger'), '给出增强选择');
});

test('CASE 5: 能力后来出现 → 同一 need 自动升级（不重建任务语义）', () => {
  // 纯函数：同一 need，注册表变化后重新评估 → 从 limited 升到 optimal。
  const noKey = discoverSearchCapabilities({ GEMINI_API_KEY: '' }).map((a) => a.registration);
  const withKey = discoverSearchCapabilities({ GEMINI_API_KEY: 'sk-test' }).map((a) => a.registration);
  const before = resolveCapability({ domain: 'deep_research' }, availableFromRegistrations(noKey));
  const after = resolveCapability({ domain: 'deep_research' }, availableFromRegistrations(withKey));
  assert.equal(before.level, 'limited');
  assert.equal(after.level, 'optimal');
  // 任务本身不重建：同 need（goal/上下文不变），仅能力执行路径变化。
  assert.equal(after.plan.capabilityId, PROFESSIONAL_SEARCH_CAPABILITY_ID);
});

test('CASE 6: 探测失败 → 不暴露技术错误，fallback 仍可运行', async () => {
  const root = await tempDir('fallback');
  // 无模型 + 无 search 凭据：research 任务走 limited（baseline search）而非崩溃。
  const runtime = createDigitalMeRuntime({ documentCapability: 'none', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '回退验证', targetDir: path.join(root, 'pkg') });
  try {
    const need = { domain: 'deep_research' as const };
    const regs = discoverSearchCapabilities({ GEMINI_API_KEY: '' }).map((a) => a.registration);
    const view = closureViewFromSelection({ need, availableRegistrations: regs });
    assert.ok(view.level === 'limited' || view.level === 'unavailable', '探测不足时给出 limited/unavailable，不抛技术错误');
    assert.ok(!/HTTP|quota|adapter|stack|ECONN/i.test(JSON.stringify(view)), '闭包视图不含技术错误');
  } finally {
    await runtime.stop();
  }
});

test('closureLevelForAdapterType: search 专业能力经 selectedCapabilityId 报 optimal', () => {
  assert.equal(closureLevelForAdapterType('local-tool'), 'baseline');
  const view = closureViewFromSelection({
    need: { domain: 'deep_research' },
    selectedAdapterType: 'local-tool',
    selectedCapabilityId: PROFESSIONAL_SEARCH_CAPABILITY_ID,
    availableRegistrations: [],
  });
  assert.equal(view.level, 'optimal');
  const baselineView = closureViewFromSelection({
    need: { domain: 'deep_research' },
    selectedAdapterType: 'local-tool',
    selectedCapabilityId: BASELINE_SEARCH_CAPABILITY_ID,
    availableRegistrations: [],
  });
  assert.equal(baselineView.level, 'baseline');
});

test('registry: research 意图优先选 search 能力', async () => {
  const registry = new CapabilityRegistry();
  // 先注册通用模型，再注册 search —— 证明 research 意图不被 document 抢占。
  const { createOpenAiCompatibleAdapter } = await import('../adapters/openai-compatible');
  registry.register(createOpenAiCompatibleAdapter({ baseUrl: 'x', model: 'm', providerId: 'openai-compatible', availability: 'available' }));
  for (const a of discoverSearchCapabilities({ GEMINI_API_KEY: 'sk-test' })) {
    registry.register(a);
  }
  const sel = registry.selectForNeed({
    intentKind: 'external_research',
    expectedOutputFamily: 'document',
    materialKinds: [],
  });
  assert.ok(sel.adapter, 'research 意图选中能力');
  assert.match(sel.adapter!.registration.id, /search/, `选中 search 能力: ${sel.adapter!.registration.id}`);
  // Coding 意图仍走 coding agent（不被 search 抢占）。
  const codex = createExternalExecutorCodexAdapter({ forceAvailability: 'ready' });
  (codex.registration as { availability: string }).availability = 'available';
  registry.register(codex);
  const codingSel = registry.selectForNeed({
    intentKind: 'modify_code',
    expectedOutputFamily: 'code-change',
    materialKinds: ['folder'],
  });
  assert.ok(codingSel.adapter, 'coding 意图选中 coding 能力');
  assert.match(codingSel.adapter!.registration.id, /codex|executor/, `选中 coding 能力: ${codingSel.adapter!.registration.id}`);
});