import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { runTalkTurn } from '../../intelligence/loop';
import { emptyThread } from '../../intelligence/store';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createInMemorySubjectNetwork } from '../../subject-collab/network';

test('current Talk can establish an institution-event automation from natural language without protocol jargon', async () => {
  const created: Array<{ title: string; goal: string; eventType: string; sourceSubjectId: string }> = [];
  let calls = 0;
  const result = await runTalkTurn({
    thread: emptyThread('2026-11-27T09:00:00.000Z', 'thread_auto_setup'),
    userText: '以后演示电信发来月度账单时，先等我确认，再帮我整理一份摘要。',
    selfContext: '当前没有需要补充的本人事实。',
    agents: [],
    workRoot: os.tmpdir(),
    now: '2026-11-27T09:00:00.000Z',
    automation: {
      createInstitutionEvent: async (input) => {
        created.push(input);
        return { automationId: 'auto_created', title: input.title };
      },
    },
    chat: async ({ tools }) => {
      calls += 1;
      if (calls === 1) {
        assert.ok((tools || []).some((tool) => tool.function.name === 'configure_automation'));
        return {
          text: '',
          toolCalls: [{
            id: 'call-configure',
            name: 'configure_automation',
            arguments: JSON.stringify({
              title: '电信月度账单摘要',
              goal: '把本次月度账单整理成简短摘要并保存到应用成果区。',
              eventType: 'billing.statement.ready',
              sourceSubjectId: 'subj_demo_telecom',
            }),
          }],
        };
      }
      return { text: '已经设置好。机构发来月度账单后，我会先等你确认，再生成摘要。' };
    },
  });
  assert.equal(created.length, 1);
  assert.equal(created[0]!.sourceSubjectId, 'subj_demo_telecom');
  assert.equal(result.outcome, 'SUCCESS');
  assert.match(result.thread.turns.at(-1)?.text || '', /先等你确认/);
  const execution = result.thread.executions.find((row) => row.capabilityId === 'configure_automation');
  assert.equal(execution?.ok, true);
});

test('runtime only offers natural-language automation setup for an actually connected institution subject', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'digitalme-auto-setup-'));
  const network = createInMemorySubjectNetwork();
  const detach = network.attach({
    subjectId: 'subj_demo_telecom',
    getCard: async () => ({
      schemaVersion: 1,
      subjectId: 'subj_demo_telecom',
      displayName: '演示电信',
      endpointRef: 'memory://demo-telecom',
      publicSkills: [{ name: '账单服务', summary: '可发送月度账单就绪事件。' }],
      cooperationScope: '仅限演示账单服务',
      protocol: '2digime-subject-collab/1',
      reachable: true,
    }),
    handle: async (request) => ({
      exchangeId: request.exchangeId,
      fromSubjectId: 'subj_demo_telecom',
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
            id: 'configure-runtime',
            name: 'configure_automation',
            arguments: JSON.stringify({
              title: '电信月度账单摘要',
              goal: '收到月度账单后生成本机摘要。',
              eventType: 'billing.statement.ready',
              sourceSubjectId: 'subj_demo_telecom',
            }),
          }],
        };
      }
      return { text: '已经设置好；收到演示电信的账单事件后会先等你确认。' };
    },
  });
  try {
    await runtime.createPackage({ displayName: '自动化主人', targetDir: root });
    const result = await runtime.talk({ text: '以后演示电信发来月度账单时，先等我确认，再生成摘要。' });
    assert.equal(result.view.outcome, 'SUCCESS');
    const projection = await runtime.digitalSelf({ action: 'automationList' });
    assert.equal(projection.automations?.length, 1);
    assert.equal(projection.automations?.[0]?.title, '电信月度账单摘要');
    assert.equal(projection.automations?.[0]?.humanInLoop, 'before_execution');
  } finally {
    detach();
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('one human-in-loop automation runs 10 independent events without duplicate execution or fake artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'digitalme-auto-ten-'));
  let modelCalls = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: async ({ tools }) => {
      modelCalls += 1;
      const runNumber = Math.floor((modelCalls - 1) / 2) + 1;
      if (modelCalls % 2 === 1) {
        assert.deepEqual((tools || []).map((tool) => tool.function.name).sort(), ['set_expected_effects', 'write_artifact']);
        return {
          text: '',
          toolCalls: [{
            id: `call-write-${runNumber}`,
            name: 'write_artifact',
            arguments: JSON.stringify({
              fileName: `机构事件摘要-${runNumber}.md`,
              content: `# 机构事件摘要 ${runNumber}\n\n这是第 ${runNumber} 次独立触发的真实成果。`,
            }),
          }],
        };
      }
      return { text: `第 ${runNumber} 次机构事件摘要已经生成。` };
    },
  });
  try {
    await runtime.createPackage({ displayName: '十次运行主人', targetDir: root });
    const created = await runtime.digitalSelf({
      action: 'automationCreate',
      title: '十次机构事件摘要',
      goalTemplate: '把本次机构事件生成一份独立摘要。',
      trigger: { type: 'institution_event', institutionEventType: 'service.notice.ready' },
      allowedCapabilityIds: ['write_artifact'],
      allowedSubjectIds: ['subj_institution'],
      validUntil: '2027-01-01T00:00:00.000Z',
      maxCostCny: 0,
      humanInLoop: 'before_execution',
    });
    const automationId = created.automation!.id;
    const receiptIds: string[] = [];
    const executionIds = new Set<string>();
    const artifactPaths = new Set<string>();
    for (let index = 1; index <= 10; index += 1) {
      const triggered = await runtime.digitalSelf({
        action: 'automationTrigger', automationId,
        eventKey: `event-${index}`, triggerType: 'institution_event',
      });
      receiptIds.push(triggered.receipt!.id);
      const confirmed = await runtime.digitalSelf({
        action: 'automationConfirm', automationId, receiptId: triggered.receipt!.id,
      });
      assert.equal(confirmed.duplicate, false);
      assert.equal(confirmed.receipt!.executionIds!.length, 1);
      assert.equal(confirmed.receipt!.artifactPaths!.length, 1);
      executionIds.add(confirmed.receipt!.executionIds![0]!);
      artifactPaths.add(confirmed.receipt!.artifactPaths![0]!);
      await access(confirmed.receipt!.artifactPaths![0]!);
    }
    assert.equal(receiptIds.length, 10);
    assert.equal(new Set(receiptIds).size, 10);
    assert.equal(executionIds.size, 10);
    assert.equal(artifactPaths.size, 10);
    assert.equal(modelCalls, 20);

    const repeatedTrigger = await runtime.digitalSelf({
      action: 'automationTrigger', automationId,
      eventKey: 'event-10', triggerType: 'institution_event',
    });
    assert.equal(repeatedTrigger.duplicate, true);
    const repeatedConfirm = await runtime.digitalSelf({
      action: 'automationConfirm', automationId, receiptId: repeatedTrigger.receipt!.id,
    });
    assert.equal(repeatedConfirm.duplicate, true);
    assert.equal(modelCalls, 20);
  } finally {
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});
