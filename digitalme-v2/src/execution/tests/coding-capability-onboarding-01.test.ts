/**
 * DIGITALME-V2-CODING-CAPABILITY-ONBOARDING-01
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import {
  buildCodingOnboardingPayload,
  selectPreferredCodingCapability,
  stripInternalTerms,
  type CodingCapabilityStatus,
} from '../../capability/coding-capability';
import { createUnsupportedDesktopCodingAdapter } from '../../capability/adapters/unsupported-desktop-coding';
import { createExternalExecutorCodexAdapter } from '../../capability/adapters/external-executor-codex';
import { CapabilityRegistry } from '../../capability/registry';
import { listCodingCapabilityStatuses } from '../../capability/coding-capability-probe';

function status(partial: Partial<CodingCapabilityStatus> & Pick<CodingCapabilityStatus, 'capabilityId' | 'displayName' | 'availability'>): CodingCapabilityStatus {
  return {
    providerKind: 'local_coding_agent',
    invocationKind: 'cli',
    connectionStatus: partial.availability,
    supportsAutomaticExecution: true,
    supportsProgress: true,
    supportsRevision: true,
    supportsResultCollection: true,
    actionableMessage: '',
    canDo: '修改代码',
    executionModeLabel: '自动执行',
    ...partial,
  };
}

describe('coding-capability-onboarding-01', () => {
  it('未安装任何代码执行能力时返回引导且不创建失败 Job', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-onb-none-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pkg-'));
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: { forceAvailability: 'needs_setup' },
    });
    await rt.createPackage({ displayName: 'onb', targetDir: pkg });
    const result = await rt.submitTask({
      goal: '修改这个项目中的 formatLabel',
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    assert.equal(result.taskId, '');
    assert.ok(result.needsExecutorSetup);
    assert.match(result.needsExecutorSetup!.title || '', /代码执行能力/);
    assert.match(result.needsExecutorSetup!.message, /尚未检测|需要连接/);
    assert.equal(result.needsExecutionConfirm, undefined);
    const listed = await rt.listCapabilities({ codingAction: { type: 'get_pending' } });
    assert.ok(listed.pendingSoftwareTask);
    assert.equal(listed.pendingSoftwareTask!.goal.includes('formatLabel'), true);
  });

  it('Codex ready 时进入权限确认', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-onb-ready-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pkg-'));
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: {
        forceAvailability: 'ready',
        executeHook: async () => ({ exitCode: 0, summary: 'ok' }),
      },
    });
    await rt.createPackage({ displayName: 'ready', targetDir: pkg });
    const result = await rt.submitTask({
      goal: '修改这个项目中的 formatLabel',
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    assert.ok(result.needsExecutionConfirm);
    assert.equal(result.needsExecutionConfirm!.executorDisplayName, '代码执行能力');
    assert.equal(result.taskId, '');
  });

  it('已安装但未登录', async () => {
    const adapter = createExternalExecutorCodexAdapter({ forceAvailability: 'needs_login' });
    const check = await adapter.checkAvailability();
    assert.equal(check.available, false);
    assert.equal(check.reason, 'needs_login');
  });

  it('版本不兼容', async () => {
    const adapter = createExternalExecutorCodexAdapter({ forceAvailability: 'unavailable' });
    const check = await adapter.checkAvailability();
    assert.equal(check.available, false);
    assert.match(String(check.detail), /过旧|更新/);
  });

  it('发现不支持的桌面产品', async () => {
    const adapter = createUnsupportedDesktopCodingAdapter({
      displayName: '某桌面代码工具',
      detected: true,
    });
    const check = await adapter.checkAvailability();
    assert.equal(check.available, false);
    assert.equal(check.reason, 'unsupported');
    assert.match(String(check.detail), /不能.*自动调用/);
    assert.equal(adapter.registration.codingExecution?.supportsAutomaticExecution, false);
    assert.equal(adapter.registration.codingExecution?.invocationKind, 'desktop_handoff');
  });

  it('多个 ready 能力按规则选择默认', () => {
    const a = status({
      capabilityId: 'a',
      displayName: 'A',
      availability: 'ready',
      supportsRevision: false,
      supportsResultCollection: false,
      supportsProgress: false,
    });
    const b = status({
      capabilityId: 'b',
      displayName: 'B',
      availability: 'ready',
      supportsRevision: true,
      supportsResultCollection: true,
      supportsProgress: true,
    });
    const preferred = selectPreferredCodingCapability([a, b]);
    assert.equal(preferred?.capabilityId, 'b');
    const withPref = selectPreferredCodingCapability([a, b], { defaultCapabilityId: 'a' });
    assert.equal(withPref?.capabilityId, 'a');
  });

  it('软件任务无能力时不回退文档生成', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-onb-nodoc-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pkg-'));
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: false,
    });
    await rt.createPackage({ displayName: 'nodoc', targetDir: pkg });
    const result = await rt.submitTask({
      goal: '开发一个俄罗斯方块游戏',
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    assert.ok(result.needsExecutorSetup);
    assert.equal(result.taskId, '');
    assert.equal(result.jobId, '');
  });

  it('目标和材料在稍后连接后仍保留并可恢复', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-onb-keep-'));
    await fs.writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pkg-'));
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: { forceAvailability: 'needs_setup' },
    });
    await rt.createPackage({ displayName: 'keep', targetDir: pkg });
    await rt.submitTask({
      goal: '修改登录页',
      contextRefs: [{ kind: 'folder', path: dir }],
    });
    const listed = await rt.listCapabilities({ codingAction: { type: 'get_pending' } });
    assert.equal(listed.pendingSoftwareTask?.goal, '修改登录页');
    assert.equal(listed.pendingSoftwareTask?.contextRefs[0]?.path, dir);

    // 模拟连接成功后再次提交
    const rt2 = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: {
        forceAvailability: 'ready',
        executeHook: async () => ({ exitCode: 0, summary: 'ok' }),
      },
    });
    await rt2.openPackage({ dir: pkg });
    const pending = await rt2.listCapabilities({ codingAction: { type: 'get_pending' } });
    assert.ok(pending.pendingSoftwareTask);
    const again = await rt2.submitTask({
      goal: pending.pendingSoftwareTask!.goal,
      contextRefs: pending.pendingSoftwareTask!.contextRefs,
    });
    assert.ok(again.needsExecutionConfirm);
    assert.equal(again.needsExecutionConfirm!.workingDirectory, path.resolve(dir));
  });

  it('空目录项目先选目录再选能力', async () => {
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pkg-'));
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: { forceAvailability: 'needs_setup' },
    });
    await rt.createPackage({ displayName: 'order', targetDir: pkg });
    const noFolder = await rt.submitTask({
      goal: '开发一个俄罗斯方块游戏',
      contextRefs: [],
    });
    assert.ok(noFolder.needsProjectFolder);
    assert.equal(noFolder.needsExecutorSetup, undefined);
  });

  it('desktop_handoff 不显示为自动执行；unsupported 不可开始自动执行', async () => {
    const registry = new CapabilityRegistry();
    registry.register(
      createUnsupportedDesktopCodingAdapter({ displayName: '桌面工具', detected: true }),
    );
    const { statuses, preferred } = await listCodingCapabilityStatuses(registry, { probe: true });
    assert.equal(preferred, null);
    assert.equal(statuses[0]?.executionModeLabel.includes('自动执行'), false);
    assert.match(statuses[0]?.executionModeLabel || '', /不能自动|外部/);
  });

  it('引导文案不含内部术语', () => {
    const payload = buildCodingOnboardingPayload([]);
    const blob = JSON.stringify(payload);
    assert.equal(/CLI|Adapter|Registry|executorId/i.test(blob), false);
    assert.equal(stripInternalTerms('请安装 CLI Adapter').includes('CLI'), false);
  });

  it('设置页状态与 Registry 一致（listCapabilities）', async () => {
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pkg-'));
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: { forceAvailability: 'ready', executeHook: async () => ({ exitCode: 0, summary: 'x' }) },
      unsupportedDesktopCodingCapability: { displayName: '桌面工具', detected: true },
    });
    await rt.createPackage({ displayName: 'list', targetDir: pkg });
    const listed = await rt.listCapabilities({ includeAvailability: true });
    assert.ok((listed.codingCapabilities || []).length >= 2);
    const auto = listed.codingCapabilities!.find((c) => c.supportsAutomaticExecution);
    const desk = listed.codingCapabilities!.find((c) => c.invocationKind === 'desktop_handoff');
    assert.equal(auto?.availability, 'ready');
    assert.equal(desk?.availability, 'unsupported');
    assert.equal(listed.executorCapabilityCard?.available, true);
    assert.equal(listed.executorCapabilityCard?.availabilityLabel, '已连接');
  });

  it('默认能力选择可写入 prefs', async () => {
    const pkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-pkg-'));
    const rt = createDigitalMeRuntime({
      documentCapability: 'fake',
      codeAnalysisCapability: 'none',
      externalExecutorCapability: { forceAvailability: 'ready', executeHook: async () => ({ exitCode: 0, summary: 'x' }) },
    });
    await rt.createPackage({ displayName: 'pref', targetDir: pkg });
    const listed = await rt.listCapabilities({ includeAvailability: true });
    const id = listed.preferredCodingCapabilityId || listed.executorCapabilityCard?.capabilityId;
    assert.ok(id);
    await rt.listCapabilities({
      codingAction: { type: 'set_default', capabilityId: id! },
      includeAvailability: true,
    });
    const again = await rt.listCapabilities({ includeAvailability: true });
    assert.equal(again.preferredCodingCapabilityId, id);
  });

  it('UI 结构含引导卡与代码执行能力设置标题', async () => {
    const html = await fs.readFile(
      path.join(__dirname, '../../../electron/renderer/index.html'),
      'utf8',
    );
    assert.match(html, /完成这项任务需要代码执行能力/);
    assert.match(html, /连接代码执行能力|使用已安装的能力/);
    assert.match(html, /安装推荐能力/);
    assert.match(html, /稍后连接/);
    assert.match(html, /代码执行能力/);
    assert.equal(/btn-collab-accept/.test(html), false);
  });
});
