import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { readThread } from '../../intelligence/store';

test('confirmed institution event runs once through current Talk execution and artifact facts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'digitalme-auto-talk-'));
  let modelCalls = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: async ({ tools }) => {
      modelCalls += 1;
      if (modelCalls === 1) {
        assert.deepEqual(
          (tools || []).map((tool) => tool.function.name).sort(),
          ['set_expected_effects', 'write_artifact'],
        );
        return {
          text: '',
          toolCalls: [{
            id: 'call-write',
            name: 'write_artifact',
            arguments: JSON.stringify({ fileName: '机构事件摘要.md', content: '# 机构事件摘要\n\n已按主人确认生成。' }),
          }],
        };
      }
      return { text: '已生成机构事件摘要，并保存到应用成果区。' };
    },
  });
  try {
    await runtime.createPackage({ displayName: '自动化主人', targetDir: root });
    const created = await runtime.digitalSelf({
      action: 'automationCreate',
      title: '机构事件摘要',
      goalTemplate: '把机构事件整理成简短摘要。',
      trigger: { type: 'institution_event', institutionEventType: 'service.notice.ready' },
      allowedCapabilityIds: ['write_artifact'],
      allowedSubjectIds: ['subj_institution'],
      validUntil: '2027-01-01T00:00:00.000Z',
      maxCostCny: 0,
      humanInLoop: 'before_execution',
    });
    assert.ok(created.automation);
    const triggered = await runtime.digitalSelf({
      action: 'automationTrigger',
      automationId: created.automation!.id,
      eventKey: 'notice-001',
      triggerType: 'institution_event',
    });
    assert.ok(triggered.receipt);
    const confirmed = await runtime.digitalSelf({
      action: 'automationConfirm',
      automationId: created.automation!.id,
      receiptId: triggered.receipt!.id,
    });
    assert.equal(confirmed.duplicate, false);
    assert.equal(confirmed.receipt!.executionIds!.length, 1);
    assert.equal(confirmed.receipt!.artifactPaths!.length, 1);
    const artifactPath = confirmed.receipt!.artifactPaths![0]!;
    await access(artifactPath);
    assert.match(await readFile(artifactPath, 'utf8'), /机构事件摘要/);
    const thread = await readThread(root, new Date().toISOString(), confirmed.receipt!.threadId);
    assert.equal(thread.executions.filter((row) => row.capabilityId === 'write_artifact' && row.ok).length, 1);

    const again = await runtime.digitalSelf({
      action: 'automationConfirm',
      automationId: created.automation!.id,
      receiptId: triggered.receipt!.id,
    });
    assert.equal(again.duplicate, true);
    assert.equal(modelCalls, 2);
  } finally {
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('automation Talk refuses a tool outside the stored capability scope', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'digitalme-auto-scope-'));
  let modelCalls = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: async () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          text: '',
          toolCalls: [{ id: 'call-web', name: 'web_search', arguments: '{"query":"secret"}' }],
        };
      }
      return { text: '这项自动化没有联网权限，因此没有执行搜索。' };
    },
  });
  try {
    await runtime.createPackage({ displayName: '范围主人', targetDir: root });
    const created = await runtime.digitalSelf({
      action: 'automationCreate',
      title: '仅生成本地摘要',
      goalTemplate: '生成本地摘要。',
      trigger: { type: 'institution_event', institutionEventType: 'local.summary.ready' },
      allowedCapabilityIds: ['write_artifact'],
      validUntil: '2027-01-01T00:00:00.000Z',
      maxCostCny: 0,
      humanInLoop: 'before_execution',
    });
    const triggered = await runtime.digitalSelf({
      action: 'automationTrigger', automationId: created.automation!.id,
      eventKey: 'local-001', triggerType: 'institution_event',
    });
    const confirmed = await runtime.digitalSelf({
      action: 'automationConfirm', automationId: created.automation!.id,
      receiptId: triggered.receipt!.id,
    });
    assert.equal(confirmed.receipt!.artifactPaths!.length, 0);
    const thread = await readThread(root, new Date().toISOString(), confirmed.receipt!.threadId);
    const denied = thread.executions.find((row) => row.capabilityId === 'web_search');
    assert.equal(denied?.ok, false);
    assert.match(denied?.failureReason || '', /没有获得/);
  } finally {
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});
