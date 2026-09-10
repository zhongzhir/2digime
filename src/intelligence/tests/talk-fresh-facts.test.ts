/**
 * 实时事实：模型自行判断是否核验；检索单次超时不得吃光整轮。
 * 不测关键词路由，不测 JSON reviewer。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import type { ProfessionalAgent, TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-fresh-${prefix}-`));
}

function scriptedChat(replies: TalkChatFn[]): TalkChatFn {
  let i = 0;
  return async (input) => {
    const fn = replies[Math.min(i, replies.length - 1)];
    i += 1;
    if (!fn) throw new Error('talk chat script exhausted');
    return fn(input);
  };
}

function searchCap(id: string, run: ProfessionalAgent['run']): ProfessionalAgent {
  return {
    id,
    label: id,
    description: '检索公开网页',
    returnsEvidence: true,
    run,
  };
}

test('模型自行决定检索：同一 messages 综合证据', async () => {
  const root = await tempDir('live');
  let searches = 0;
  const search = searchCap('cap_web', async ({ instruction }) => {
    searches += 1;
    return {
      ok: true,
      evidenceOnly: true,
      summary: `证据：${instruction} → 公开来源称现任为核验结果`,
      producedOutputs: [],
    };
  });
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async ({ tools }) => {
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), true);
        return {
          text: '',
          toolCalls: [
            {
              id: 's1',
              name: 'delegate',
              arguments: JSON.stringify({ instruction: '核验当前公开任职', capabilityId: 'cap_web' }),
            },
          ],
        };
      },
      async ({ messages }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":true/);
        assert.equal(/freshnessRequired/.test(JSON.stringify(messages)), false);
        return { text: '根据检索，公开来源一致指向已核验的现任者。' };
      },
    ]),
    talkProfessionals: [search],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '核验', targetDir: path.join(root, 'pkg') });
  const talked = await bus.invoke('talk', { text: '谁担任这个国际组织的秘书长？' });
  assert.equal(searches, 1);
  assert.match(talked.view.turns.map((t) => t.text).join('\n'), /已核验的现任者/);
  await runtime.stop();
});

test('稳定知识无工具：直接回答，不检索', async () => {
  const root = await tempDir('stable');
  let searches = 0;
  const search = searchCap('cap_web', async () => {
    searches += 1;
    return { ok: true, evidenceOnly: true, summary: '不该被调用', producedOutputs: [] };
  });
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async ({ messages }) => {
        const sys = String(messages[0]?.content || '');
        assert.match(sys, /你是用户的兔机米/);
        assert.equal(/freshnessRequired/.test(sys), false);
        return { text: '在标准大气压下，水大约在 100 摄氏度沸腾。' };
      },
    ]),
    talkProfessionals: [search],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '稳定', targetDir: path.join(root, 'pkg') });
  const talked = await bus.invoke('talk', { text: '水在标准大气压下大约多少度沸腾？' });
  assert.equal(searches, 0);
  assert.match(talked.view.turns.map((t) => t.text).join('\n'), /100/);
  await runtime.stop();
});

test('检索挂起：使用 Talk 剩余 deadline，不再另套更短工具预算', async () => {
  const prev = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = '400';
  const root = await tempDir('hang');
  const search = searchCap('cap_hang_search', async () => new Promise(() => {}));
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'h1',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: '检索', capabilityId: 'cap_hang_search' }),
          },
        ],
      }),
      async ({ messages }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":false/);
        return { text: '当前无法可靠核验这一点。' };
      },
    ]),
    talkProfessionals: [search],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: '挂起检索', targetDir: path.join(root, 'pkg') });
    const started = Date.now();
    const talked = await bus.invoke('talk', { text: '核验一条会变化的公开事实' });
    const elapsed = Date.now() - started;
    assert.equal(elapsed < 4000, true, `call timeout too slow: ${elapsed}ms`);
    const copy = talked.view.turns.map((t) => t.text).join('\n');
    assert.equal(/已到时限|没有在预算内返回|无法可靠核验|请求超时/.test(copy), true);
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
    else process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = prev;
    await runtime.stop();
  }
});

test('模型自行连续检索两次后停止；runtime 不注入换检索器', async () => {
  const root = await tempDir('twice');
  let runs = 0;
  const a = searchCap('cap_search_a', async () => {
    runs += 1;
    return { ok: false, evidenceOnly: true, failureReason: 'a failed', summary: 'a failed', producedOutputs: [] };
  });
  const b = searchCap('cap_search_b', async () => {
    runs += 1;
    return { ok: false, evidenceOnly: true, failureReason: 'b failed', summary: 'b failed', producedOutputs: [] };
  });
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'a1',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: '检索', capabilityId: 'cap_search_a' }),
          },
        ],
      }),
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'b1',
            name: 'delegate',
            arguments: JSON.stringify({ instruction: '检索', capabilityId: 'cap_search_b' }),
          },
        ],
      }),
      async ({ messages }) => {
        const blob = JSON.stringify(messages);
        assert.equal(/刚才这次执行未产生|上一轮未产生要求的真实效果/.test(blob), false);
        return { text: '两次检索都没有可用证据，当前无法确认。' };
      },
    ]),
    talkProfessionals: [a, b],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '两次', targetDir: path.join(root, 'pkg') });
  const talked = await bus.invoke('talk', { text: '核验一条公开现状' });
  assert.equal(runs, 2);
  assert.match(talked.view.turns.map((t) => t.text).join('\n'), /无法确认/);
  await runtime.stop();
});
