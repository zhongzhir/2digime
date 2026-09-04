/**
 * Talk 整轮 deadline：模型/网络挂起时不得无限「正在处理」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { TALK_TIMEOUT_NOTICE } from '../service';

test('Talk 整轮超时：挂起的模型调用必须在期限内变成可理解失败', { timeout: 15_000 }, async () => {
  const prev = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = '80';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-talk-deadline-'));
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: async () => new Promise(() => {}),
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', {
      displayName: '超时',
      targetDir: path.join(root, 'pkg'),
    });
    const started = Date.now();
    const talked = await bus.invoke('talk', { text: '你好' });
    const elapsed = Date.now() - started;
    assert.equal(elapsed < 4000, true, `timeout too slow: ${elapsed}ms`);
    const copy = talked.view.turns.map((t) => t.text).join('\n');
    assert.match(copy, /请求超时/);
    assert.equal(talked.view.notice, TALK_TIMEOUT_NOTICE);
    const last = talked.view.turns[talked.view.turns.length - 1];
    assert.equal(last?.role, 'assistant');
    assert.match(String(last?.text || ''), /超时/);
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
    else process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = prev;
    await runtime.stop();
  }
});

test('Talk 整轮超时：挂起的工具执行必须在期限内变成可理解失败', { timeout: 15_000 }, async () => {
  const prev = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = '80';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-talk-tool-deadline-'));
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: async () => ({
      text: '',
      toolCalls: [
        {
          id: 'call_hang',
          name: 'delegate',
          arguments: JSON.stringify({ instruction: 'hang forever' }),
        },
      ],
    }),
    talkProfessionals: [
      {
        id: 'cap_hang',
        label: '挂起能力',
        description: '永不返回',
        async run() {
          await new Promise(() => {});
          return { ok: false, summary: 'never', producedOutputs: [] };
        },
      },
    ],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', {
      displayName: '工具超时',
      targetDir: path.join(root, 'pkg'),
    });
    const started = Date.now();
    const talked = await bus.invoke('talk', { text: '请执行外部能力' });
    const elapsed = Date.now() - started;
    assert.equal(elapsed < 4000, true, `tool timeout too slow: ${elapsed}ms`);
    const copy = talked.view.turns.map((t) => t.text).join('\n');
    assert.equal(/请求超时，模型在限定时间内没有返回/.test(copy) || /还没有做成|没有在预算内|时间预算不足/.test(copy), true);
    const last = talked.view.turns[talked.view.turns.length - 1];
    assert.equal(last?.role, 'assistant');
    assert.equal(String(last?.text || '').length > 0, true);
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
    else process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = prev;
    await runtime.stop();
  }
});
