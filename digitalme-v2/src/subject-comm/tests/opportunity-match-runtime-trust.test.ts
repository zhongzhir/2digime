/**
 * OPPORTUNITY-MATCH-RUNTIME-TRUST-02
 * 近真实运行路径：sendSignal → inbox → processInbox → completeSemanticJson(distill) → opportunity
 * 禁止只 mock matchSignalLocally 的最终返回。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { OpportunityStore } from '../inbox-store';
import {
  getLastOpportunityMatchDiagnostics,
  matchSignalLocally,
} from '../opportunity-match';
import type { SignalPayload } from '../signal';
import { SUBJECT_PACKAGE_LAYOUT } from '../../subject-core/subject-package';

const OWNER_INTENT =
  '我正在推进 Aivestor 和 Digital Me 的 Agent 能力升级，希望寻找关注金融投资、AI Agent、产品研发和联合参赛的合作伙伴，一起探索产品升级与赛事合作机会。';

const B_BRIEF =
  '拥有成熟金融应用场景（如 Aivestor），具备 Agent 与 Digital Me 相关能力基础，可联合参赛。';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-opp-trust-${prefix}-`));
}

test('近真实路径：inbox → processInbox → distill completeSemanticJson 建机会', async () => {
  const root = await tempDir('inbox');
  const dirB = path.join(root, 'b');

  const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busB = createCommandBus(runtimeB);
  await runtimeB.createPackage({
    displayName: 'MacB',
    targetDir: dirB,
    initialSelfDescription: B_BRIEF,
  });

  let distillCalls = 0;
  let sawIntro = false;
  let sawIntent = false;
  let usedJsonFormat = false;

  // 模拟 Electron bootstrap 注入的同一 distill 链（非 match 层 options.chatComplete）
  runtimeB.subject.setDistillModelRuntime({
    enabled: true,
    model: {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      providerId: 'openai-compatible',
    },
    chatComplete: async (options) => {
      distillCalls += 1;
      const blob = options.messages.map((m) => m.content).join('\n');
      if (/Aivestor/.test(blob)) sawIntro = true;
      if (/联合参赛|Agent 能力升级/.test(blob)) sawIntent = true;
      if (options.responseFormat?.type === 'json_object') usedJsonFormat = true;
      return {
        text: JSON.stringify({ verdict: 'potential_match', matchKind: 'complementary' }),
      };
    },
  });

  const { buildEnvelope } = await import('../local-subject-transport');
  const { InboxStore } = await import('../inbox-store');
  const pkg = runtimeB.subject.requireActive();
  const self = {
    subjectId: pkg.id,
    displayName: pkg.identity.displayName,
    endpointRef: `subject:${pkg.id}`,
  };
  const envelope = buildEnvelope({
    from: { subjectId: 'subj_a', displayName: 'PCA', endpointRef: 'subject:subj_a' },
    to: self,
    kind: 'signal',
    payload: {
      intent: OWNER_INTENT,
      seeking: [OWNER_INTENT],
      offering: ['相关能力与经验'],
      disclosureLevel: 'minimal',
    },
    correlationId: 'opportunity_trust_01',
  });
  // 直接写入 B inbox，避免同机 sendSignal 用 sibling runtime（无 distill）抢先 ACK
  await (await InboxStore.open(dirB)).putIfAbsent(envelope);

  // 注册假对端目录，便于 potential_match 后回包不炸
  const dirA = path.join(root, 'a');
  const runtimeA = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtimeA.createPackage({
    displayName: 'PCA',
    targetDir: dirA,
    initialSelfDescription: 'Agent',
  });
  const { LocalPackageTransport } = await import('../../collaboration/transport');
  await new LocalPackageTransport(runtimeB).registerEndpoint(
    { subjectId: 'subj_a', displayName: 'PCA', endpointRef: 'subject:subj_a' },
    dirA,
  );

  await busB.invoke('subject.communicate', { action: 'processInbox' });

  assert.equal(distillCalls, 1, '必须经 distill chatComplete / completeSemanticJson');
  assert.equal(sawIntro, true, '模型提示必须含 B 个人简介');
  assert.equal(sawIntent, true, '模型提示必须含完整 intent');
  assert.equal(usedJsonFormat, true);

  const diag = getLastOpportunityMatchDiagnostics();
  assert.ok(diag);
  assert.equal(diag!.distillEnabled, true);
  assert.equal(diag!.modelCalled, true);
  assert.equal(diag!.usedFallback, false);
  assert.equal(diag!.finalVerdict, 'potential_match');
  assert.ok(diag!.identityDescriptionChars >= 8);

  const listed = await busB.invoke('subject.communicate', { action: 'listOpportunities' });
  assert.ok((listed.items || []).length >= 1);

  await runtimeA.stop();
  await runtimeB.stop();
});

test('distill 不可用时：无「合作」套话的简介仍可靠实质重合 fallback', async () => {
  const root = await tempDir('fallback');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: 'MacB',
    targetDir: path.join(root, 'b'),
    // 故意不含「希望/寻找/合作」套话，复现旧 heuristic 假阴
    initialSelfDescription:
      '拥有成熟金融应用场景（如 Aivestor），具备 Agent 与 Digital Me 技术基础，可联合参赛。',
  });
  runtime.subject.setDistillModelRuntime(null);

  const match = await matchSignalLocally(runtime, {
    intent: OWNER_INTENT,
    seeking: [OWNER_INTENT],
    offering: ['相关能力与经验'],
    disclosureLevel: 'minimal',
  });
  const diag = getLastOpportunityMatchDiagnostics();
  assert.equal(diag?.distillEnabled, false);
  assert.equal(diag?.modelCalled, false);
  assert.equal(diag?.usedFallback, true);
  assert.equal(match.verdict, 'potential_match');
  await runtime.stop();
});

test('response_format 失败时 completeSemanticJson 会降级重试', async () => {
  const root = await tempDir('retry');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: 'MacB',
    targetDir: path.join(root, 'b'),
    initialSelfDescription: B_BRIEF,
  });
  let calls = 0;
  runtime.subject.setDistillModelRuntime({
    enabled: true,
    model: { baseUrl: 'http://127.0.0.1', model: 'm', providerId: 'openai-compatible' },
    chatComplete: async (options) => {
      calls += 1;
      if (options.responseFormat) {
        throw new Error('request rejected (400): response_format unsupported');
      }
      return {
        text: JSON.stringify({ verdict: 'potential_match', matchKind: 'shared_goal' }),
      };
    },
  });
  const match = await matchSignalLocally(runtime, {
    intent: OWNER_INTENT,
    seeking: ['x'],
    offering: ['相关能力与经验'],
    disclosureLevel: 'minimal',
  });
  assert.equal(calls, 2);
  assert.equal(match.verdict, 'potential_match');
  assert.equal(runtime.subject.getLastSemanticJsonError(), null);
  await runtime.stop();
});

test('legacy 空 description 时 matcher 仍从 materials/self_ 取简介并建机会', async () => {
  const root = await tempDir('legacy');
  const dirA = path.join(root, 'a');
  const dirB = path.join(root, 'b');

  const setupB = createDigitalMeRuntime({ documentCapability: 'fake' });
  await setupB.createPackage({
    displayName: '旧包',
    targetDir: dirB,
    initialSelfDescription: B_BRIEF,
  });
  await setupB.stop();

  const manifestPath = path.join(dirB, SUBJECT_PACKAGE_LAYOUT.manifest);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
    identity: { displayName: string; description?: string };
  };
  delete manifest.identity.description;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const runtimeA = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busA = createCommandBus(runtimeA);
  await runtimeA.createPackage({
    displayName: 'PCA',
    targetDir: dirA,
    initialSelfDescription: 'Agent 能力',
  });

  const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busB = createCommandBus(runtimeB);
  await runtimeB.openPackage({ dir: dirB });
  // 清掉内存简介，迫使 matcher 读 materials（openPackage 可能已回填磁盘）
  const pkg = runtimeB.subject.requireActive();
  pkg.identity = { displayName: pkg.identity.displayName };

  runtimeB.subject.setDistillModelRuntime({
    enabled: true,
    model: { baseUrl: 'http://127.0.0.1', model: 'm', providerId: 'openai-compatible' },
    chatComplete: async (options) => {
      assert.match(options.messages.map((m) => m.content).join('\n'), /Aivestor/);
      return { text: JSON.stringify({ verdict: 'potential_match', matchKind: 'complementary' }) };
    },
  });

  await busA.invoke('subject.communicate', {
    action: 'sendSignal',
    peerPackageDir: dirB,
    signal: {
      intent: OWNER_INTENT,
      seeking: [OWNER_INTENT],
      offering: ['相关能力与经验'],
      disclosureLevel: 'minimal',
    },
  });
  await busB.invoke('subject.communicate', { action: 'processInbox' });
  const cards = await (await OpportunityStore.open(dirB)).list();
  assert.equal(cards.length, 1);

  await runtimeA.stop();
  await runtimeB.stop();
});
