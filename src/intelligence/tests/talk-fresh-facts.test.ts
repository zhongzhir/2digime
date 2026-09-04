/**
 * 实时事实：模型自行判断是否核验；检索单次超时不得吃光整轮；
 * 不测「现在/最近」关键词路由。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { TALK_TIMEOUT_NOTICE } from '../service';
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
    maxCallMs: 80,
    run,
  };
}

test('无工具的可能变化公开事实：验收要求核验后模型可另选检索', async () => {
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
      async () => ({ text: '据我所知目前是训练记忆里的那个人。' }),
      async ({ messages }) => {
        const sys = String(messages[0]?.content || '');
        assert.match(sys, /freshnessRequired/);
        assert.match(sys, /freshEvidenceSeen=false/);
        return {
          text: JSON.stringify({
            deliver: false,
            userReply: '',
            askUser: '',
            openGoal: '',
            revision: '还缺一次对当前公开事实的实时核验',
            freshnessRequired: true,
          }),
        };
      },
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
      async () => ({ text: '根据检索，公开来源一致指向已核验的现任者。' }),
      async () => ({
        text: JSON.stringify({
          deliver: true,
          userReply: '根据检索，公开来源一致指向已核验的现任者。',
          askUser: '',
          openGoal: '',
          revision: '',
          freshnessRequired: true,
        }),
      }),
    ]),
    talkProfessionals: [search],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '核验', targetDir: path.join(root, 'pkg') });
  const talked = await bus.invoke('talk', { text: '谁担任这个国际组织的秘书长？' });
  assert.equal(searches, 1);
  assert.match(talked.view.turns.map((t) => t.text).join('\n'), /已核验的现任者/);
  assert.equal(/据我所知目前是训练记忆/.test(talked.view.turns.map((t) => t.text).join('\n')), false);
  await runtime.stop();
});

test('稳定知识无工具：验收不得要求检索', async () => {
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
      async () => ({ text: '在标准大气压下，水大约在 100 摄氏度沸腾。' }),
      async ({ messages }) => {
        const sys = String(messages[0]?.content || '');
        assert.match(sys, /稳定知识/);
        return {
          text: JSON.stringify({
            deliver: true,
            userReply: '在标准大气压下，水大约在 100 摄氏度沸腾。',
            askUser: '',
            openGoal: '',
            revision: '',
            freshnessRequired: false,
          }),
        };
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

test('检索挂起：单次超时写回失败，整轮不得被杀死', async () => {
  const prev = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = '8000';
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
        assert.match(tool, /没有在预算内返回|timeout after/);
        return { text: '当前无法可靠核验这一点。' };
      },
      async () => ({
        text: JSON.stringify({
          deliver: true,
          userReply: '当前无法可靠核验这一点。',
          freshnessRequired: true,
        }),
      }),
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
    assert.notEqual(talked.view.notice, TALK_TIMEOUT_NOTICE);
    assert.match(talked.view.turns.map((t) => t.text).join('\n'), /无法可靠核验/);
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
    else process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = prev;
    await runtime.stop();
  }
});

test('同类检索失败两次后不再自动注入换检索器', async () => {
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
        assert.equal(/上一轮未产生要求的真实效果，同一轮继续/.test(blob), false);
        return { text: '两次检索都没有可用证据，当前无法确认。' };
      },
      async () => ({
        text: JSON.stringify({
          deliver: true,
          userReply: '两次检索都没有可用证据，当前无法确认。',
          freshnessRequired: true,
        }),
      }),
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
