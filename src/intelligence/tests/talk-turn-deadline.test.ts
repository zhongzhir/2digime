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
import { TALK_SYNTHESIS_TIMEOUT_NOTICE, TALK_TIMEOUT_NOTICE } from '../service';
import { talkThreadFilePath } from '../store';

import type { TalkChatFn } from '../types';

function scriptedChat(replies: TalkChatFn[]): TalkChatFn {
  let i = 0;
  return async (input) => {
    const fn = replies[Math.min(i, replies.length - 1)];
    i += 1;
    if (!fn) throw new Error('talk chat script exhausted');
    return fn(input);
  };
}

test('Talk 整轮超时：挂起的模型调用必须在期限内变成可理解失败', { timeout: 15_000 }, async () => {
  const prev = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = '80';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-talk-deadline-'));
  let seenTimeout: number | undefined;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: async ({ timeoutMs }) => {
      seenTimeout = timeoutMs;
      return new Promise(() => {});
    },
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
    assert.equal(typeof seenTimeout, 'number');
    assert.equal(Number(seenTimeout) > 0 && Number(seenTimeout) <= 80, true);
    assert.equal(seenTimeout === 120_000, false);
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
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'call_hang',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: 'hang forever' }),
          },
        ],
      }),
      async ({ messages }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":false/);
        return { text: '外部能力没有在预算内返回，这件事还没有做成。' };
      },
    ]),
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

test('Talk 整轮超时：已有工具失败必须保留，不得只剩泛化请求超时', { timeout: 15_000 }, async () => {
  const prev = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = '400';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-talk-keep-fail-'));
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'call_write',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: '../escape.txt', content: 'nope' }),
          },
        ],
      }),
      async () => new Promise(() => {}),
    ]),
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', {
      displayName: '保留失败',
      targetDir: pkgDir,
    });
    const talked = await bus.invoke('talk', { text: '写一个文件' });
    const copy = talked.view.turns.map((t) => t.text).join('\n');
    assert.equal(copy.includes(TALK_TIMEOUT_NOTICE), false);
    assert.match(copy, /超出授权|路径|授权/);
    assert.match(String(talked.view.notice || ''), /超出授权|路径|授权/);
    const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
      executions?: Array<{ ok: boolean; capabilityId: string }>;
    };
    const execs = rec.executions || [];
    assert.equal(execs.length > 0, true);
    assert.equal(
      execs.some((item) => item.ok === false && item.capabilityId === 'write_file'),
      true,
    );
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
    else process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = prev;
    await runtime.stop();
  }
});

test('Talk 整轮超时：已有工具成功必须保留，并说明最终回复生成超时', { timeout: 15_000 }, async () => {
  const prev = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = '400';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-talk-keep-ok-'));
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'call_write',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: 'done.txt', content: 'ok' }),
          },
        ],
      }),
      async () => new Promise(() => {}),
    ]),
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', {
      displayName: '保留成功',
      targetDir: pkgDir,
    });
    const project = path.join(root, 'project');
    await fs.mkdir(project, { recursive: true });
    const talked = await bus.invoke('talk', { text: '写一个文件', contextPaths: [project] });
    const last = talked.view.turns[talked.view.turns.length - 1];
    assert.equal(last?.text, TALK_SYNTHESIS_TIMEOUT_NOTICE);
    assert.equal(talked.view.notice, TALK_SYNTHESIS_TIMEOUT_NOTICE);
    const abs = path.join(project, 'done.txt');
    assert.equal(await fs.readFile(abs, 'utf8'), 'ok');
    const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
      executions?: Array<{ ok: boolean; capabilityId: string }>;
    };
    const execs = rec.executions || [];
    assert.equal(
      execs.some((item) => item.ok === true && item.capabilityId === 'write_file'),
      true,
    );
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
    else process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = prev;
    await runtime.stop();
  }
});
