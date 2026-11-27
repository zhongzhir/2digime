import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { AutomationService } from '../automation-service';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { readThread } from '../../intelligence/store';
import { createInMemorySubjectNetwork } from '../../subject-collab/network';

test('stored automatic authorization is fail-closed to zero-cost local artifact writes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'digitalme-auto-policy-'));
  try {
    const service = await AutomationService.open(root);
    const base = {
      subjectId: 'subj_owner',
      title: '低风险自动摘要',
      goalTemplate: '生成本机摘要。',
      trigger: { type: 'institution_event' as const, institutionEventType: 'notice.ready' },
      allowedSubjectIds: ['subj_institution'],
      validUntil: '2027-01-01T00:00:00.000Z',
      humanInLoop: 'none' as const,
      risk: 'low' as const,
    };
    await assert.rejects(
      service.create({ ...base, allowedCapabilityIds: ['web_search'], maxCostCny: 0 }),
      /只允许写入本机应用成果区/,
    );
    await assert.rejects(
      service.create({ ...base, allowedCapabilityIds: ['write_artifact'], maxCostCny: 1 }),
      /只允许零费用低风险动作/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an explicit ordinary-language request can establish the constrained automatic mode', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'digitalme-auto-natural-'));
  const network = createInMemorySubjectNetwork();
  const detach = network.attach({
    subjectId: 'subj_demo_bank',
    getCard: async () => ({
      schemaVersion: 1,
      subjectId: 'subj_demo_bank',
      displayName: '演示银行',
      endpointRef: 'memory://demo-bank',
      publicSkills: [{ name: '通知服务', summary: '可发送低风险通知事件。' }],
      cooperationScope: '仅限演示通知',
      protocol: '2digime-subject-collab/1',
      reachable: true,
    }),
    handle: async (request) => ({
      exchangeId: request.exchangeId,
      fromSubjectId: 'subj_demo_bank',
      toSubjectId: request.fromSubjectId,
      at: request.at,
      decision: 'decline',
      reply: '本测试不处理协作请求。',
    }),
  });
  let calls = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    subjectNetwork: network,
    talkChat: async ({ tools }) => {
      calls += 1;
      if (calls === 1) {
        assert.ok((tools || []).some((tool) => tool.function.name === 'configure_automation'));
        return {
          text: '',
          toolCalls: [{
            id: 'configure-auto',
            name: 'configure_automation',
            arguments: JSON.stringify({
              title: '银行通知本机摘要',
              goal: '把新通知整理成本机摘要。',
              eventType: 'notice.ready',
              sourceSubjectId: 'subj_demo_bank',
              runAutomatically: true,
            }),
          }],
        };
      }
      return { text: '已经设置好；以后只生成零费用本机成果，无需每次确认。' };
    },
  });
  try {
    await runtime.createPackage({ displayName: '自然语言自动主人', targetDir: root });
    await runtime.talk({ text: '演示银行发来新通知时自动整理成本机摘要，无需每次确认。' });
    const listed = await runtime.digitalSelf({ action: 'automationList' });
    assert.equal(listed.automations?.length, 1);
    assert.equal(listed.automations?.[0]?.humanInLoop, 'none');
    assert.deepEqual(listed.automations?.[0]?.allowedCapabilityIds, ['write_artifact']);
    assert.equal(listed.automations?.[0]?.maxCostCny, 0);
  } finally {
    detach();
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('one preauthorized low-risk automation runs 10 events with true automation origin and no duplicates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'digitalme-auto-low-risk-ten-'));
  let modelCalls = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: async ({ messages, tools }) => {
      modelCalls += 1;
      const runNumber = Math.floor((modelCalls - 1) / 2) + 1;
      const system = String(messages[0]?.content || '');
      const current = String(messages.filter((message) => message.role === 'user').at(-1)?.content || '');
      assert.match(system, /预先保存的低风险授权/);
      assert.match(current, /自动化触发，不是主人发言/);
      assert.equal(current.includes('我确认运行'), false);
      if (modelCalls % 2 === 1) {
        assert.deepEqual((tools || []).map((tool) => tool.function.name).sort(), ['set_expected_effects', 'write_artifact']);
        return {
          text: '',
          toolCalls: [{
            id: `auto-write-${runNumber}`,
            name: 'write_artifact',
            arguments: JSON.stringify({
              fileName: `低风险自动摘要-${runNumber}.md`,
              content: `# 低风险自动摘要 ${runNumber}\n\n这是第 ${runNumber} 次预授权自动运行的真实成果。`,
            }),
          }],
        };
      }
      return { text: `第 ${runNumber} 次低风险自动摘要已经生成。` };
    },
  });
  try {
    await runtime.createPackage({ displayName: '低风险自动化主人', targetDir: root });
    const created = await runtime.digitalSelf({
      action: 'automationCreate',
      title: '低风险自动摘要',
      goalTemplate: '把本次机构通知生成一份本机摘要。',
      trigger: { type: 'institution_event', institutionEventType: 'notice.ready' },
      allowedCapabilityIds: ['write_artifact'],
      allowedSubjectIds: ['subj_institution'],
      validUntil: '2027-01-01T00:00:00.000Z',
      maxCostCny: 0,
      humanInLoop: 'none',
    });
    const automationId = created.automation!.id;
    const receiptIds = new Set<string>();
    const executionIds = new Set<string>();
    const artifactPaths = new Set<string>();
    for (let index = 1; index <= 10; index += 1) {
      const result = await runtime.digitalSelf({
        action: 'automationTrigger',
        automationId,
        eventKey: `automatic-event-${index}`,
        triggerType: 'institution_event',
      });
      assert.equal(result.duplicate, false);
      assert.equal(result.receipt?.confirmedAt, undefined);
      assert.equal(result.receipt?.executionAuthority, 'stored_low_risk_authorization');
      assert.ok(result.receipt?.executionClaimedAt);
      assert.equal(result.receipt?.executionIds?.length, 1);
      assert.equal(result.receipt?.artifactPaths?.length, 1);
      receiptIds.add(result.receipt!.id);
      executionIds.add(result.receipt!.executionIds![0]!);
      artifactPaths.add(result.receipt!.artifactPaths![0]!);
      await access(result.receipt!.artifactPaths![0]!);
    }
    assert.equal(receiptIds.size, 10);
    assert.equal(executionIds.size, 10);
    assert.equal(artifactPaths.size, 10);
    assert.equal(modelCalls, 20);

    const thread = await readThread(root, new Date().toISOString());
    const automatedTurns = thread.turns.filter((turn) => turn.origin === 'automation');
    assert.equal(automatedTurns.length, 10);
    assert.ok(automatedTurns.every((turn) => turn.role === 'user' && !turn.text.includes('我确认运行')));

    const repeated = await runtime.digitalSelf({
      action: 'automationTrigger',
      automationId,
      eventKey: 'automatic-event-10',
      triggerType: 'institution_event',
    });
    assert.equal(repeated.duplicate, true);
    assert.equal(modelCalls, 20);
  } finally {
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('automatic run without a real artifact is recorded as failed and never replayed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'digitalme-auto-no-fake-'));
  let modelCalls = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: async () => {
      modelCalls += 1;
      return { text: '我没有生成文件。' };
    },
  });
  try {
    await runtime.createPackage({ displayName: '自动失败主人', targetDir: root });
    const created = await runtime.digitalSelf({
      action: 'automationCreate',
      title: '必须有成果',
      goalTemplate: '生成一份本机成果。',
      trigger: { type: 'institution_event', institutionEventType: 'notice.ready' },
      allowedCapabilityIds: ['write_artifact'],
      allowedSubjectIds: ['subj_institution'],
      validUntil: '2027-01-01T00:00:00.000Z',
      maxCostCny: 0,
      humanInLoop: 'none',
    });
    await assert.rejects(
      runtime.digitalSelf({
        action: 'automationTrigger', automationId: created.automation!.id,
        eventKey: 'no-artifact', triggerType: 'institution_event',
      }),
      /没有产生可核验的应用成果/,
    );
    const listed = await runtime.digitalSelf({ action: 'automationList' });
    assert.match(listed.automations?.[0]?.receipts?.[0]?.failureReason || '', /没有产生可核验的应用成果/);
    const repeated = await runtime.digitalSelf({
      action: 'automationTrigger', automationId: created.automation!.id,
      eventKey: 'no-artifact', triggerType: 'institution_event',
    });
    assert.equal(repeated.duplicate, true);
    assert.equal(modelCalls, 1);
  } finally {
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});
