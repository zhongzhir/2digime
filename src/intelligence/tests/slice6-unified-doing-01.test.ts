import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTalkTurn, type SubjectCollabPort } from '../loop';
import type { TalkChatFn, TalkThread } from '../types';

const NOW = '2026-11-23T12:00:00.000Z';

function thread(): TalkThread {
  return {
    schemaVersion: 1,
    threadId: 'slice6-thread',
    updatedAt: NOW,
    turns: [],
    executions: [],
  };
}

function scripted(replies: TalkChatFn[]): TalkChatFn {
  let index = 0;
  return async (input) => {
    const next = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (!next) throw new Error('chat script exhausted');
    return next(input);
  };
}

function collab(consult: SubjectCollabPort['consult']): SubjectCollabPort {
  return {
    cards: [{
      schemaVersion: 1,
      subjectId: 'subject-peer',
      displayName: '风险协作者',
      endpointRef: 'remote:peer-endpoint',
      publicSkills: [{ name: '风险复核', summary: '复核公开材料中的风险边界。' }],
      cooperationScope: '低风险公开材料协作。',
      protocol: '2digime-subject-collab/1',
      reachable: true,
    }],
    consult,
  };
}

test('Slice 6: 同一模型看到本地与外部路径时可直接选择本地真实成果', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-slice6-local-'));
  let consulted = 0;
  const result = await runTalkTurn({
    thread: thread(),
    userText: '整理一份本地备忘并保存。',
    selfContext: '没有额外本人信息。',
    agents: [],
    workRoot: root,
    now: NOW,
    subjectCollab: collab(async () => {
      consulted += 1;
      throw new Error('should not consult');
    }),
    chat: scripted([
      async ({ tools }) => {
        assert.equal(tools?.some((item) => item.function.name === 'write_artifact'), true);
        assert.equal(tools?.some((item) => item.function.name === 'consult_subject'), true);
        return {
          text: '',
          toolCalls: [{
            id: 'local-1',
            name: 'write_artifact',
            arguments: JSON.stringify({ fileName: '本地备忘.md', content: '# 本地备忘\n\n已完成。' }),
          }],
        };
      },
      async ({ messages }) => {
        const tool = String(messages.filter((item) => item.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess\":true/);
        return { text: '备忘已经保存并回读确认。' };
      },
    ]),
  });
  assert.equal(consulted, 0);
  assert.equal(result.outcome, 'SUCCESS');
  assert.deepEqual(result.thread.executions.map((item) => item.capabilityId), ['write_artifact']);
  const saved = result.thread.executions[0]?.outputPath;
  assert.ok(saved);
  assert.equal(await fs.readFile(saved!, 'utf8'), '# 本地备忘\n\n已完成。');
});

test('Slice 6: 对方仅接受但没有成果不算完成，同一模型可回退本地做完', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-slice6-fallback-'));
  const result = await runTalkTurn({
    thread: thread(),
    userText: '形成一份风险备忘；必要时可请外部主体复核。',
    selfContext: '没有额外本人信息。',
    agents: [],
    workRoot: root,
    now: NOW,
    subjectCollab: collab(async () => ({
      ok: false,
      received: true,
      decision: 'accept',
      reply: '我愿意协作。',
      exchangeId: 'ex-no-result',
      disclosed: '公开材料摘要',
      failureReason: '对方接受了请求，但没有返回可用成果。',
    })),
    chat: scripted([
      async () => ({
        text: '',
        toolCalls: [{
          id: 'peer-1',
          name: 'consult_subject',
          arguments: JSON.stringify({
            subjectId: 'subject-peer',
            goal: '复核风险边界',
            hopedContribution: '给出三条风险提示',
            disclosure: '公开材料摘要',
          }),
        }],
      }),
      async ({ messages }) => {
        const tool = String(messages.filter((item) => item.role === 'tool').pop()?.content || '');
        assert.match(tool, /\"actualSuccess\":false/);
        assert.match(tool, /没有返回可用成果/);
        return {
          text: '',
          toolCalls: [{
            id: 'local-2',
            name: 'write_artifact',
            arguments: JSON.stringify({
              fileName: '风险备忘.md',
              content: '# 风险备忘\n\n外部复核未返回成果，本地完成基础风险清单。',
            }),
          }],
        };
      },
      async () => ({ text: '外部复核没有返回成果，我已改用本地能力完成并保存风险备忘。' }),
    ]),
  });
  assert.equal(result.outcome, 'SUCCESS');
  assert.deepEqual(
    result.thread.executions.map((item) => `${item.capabilityId}:${item.ok}`),
    ['consult_subject:false', 'write_artifact:true'],
  );
  assert.match(result.thread.turns.at(-1)?.text || '', /本地能力完成/);
  assert.doesNotMatch(result.thread.turns.at(-1)?.text || '', /A2A|consult_subject/);
});

test('Slice 6: 外部联系超时作为失败事实回到同一模型，不中断 Talk', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-slice6-timeout-'));
  const result = await runTalkTurn({
    thread: thread(),
    userText: '请对方复核这份公开摘要。',
    selfContext: '没有额外本人信息。',
    agents: [],
    workRoot: root,
    now: NOW,
    subjectCollab: collab(async () => {
      throw new Error('upstream timeout after 30000ms');
    }),
    chat: scripted([
      async () => ({
        text: '',
        toolCalls: [{
          id: 'peer-timeout',
          name: 'consult_subject',
          arguments: JSON.stringify({
            subjectId: 'subject-peer',
            goal: '复核公开摘要',
            hopedContribution: '给出风险提示',
            disclosure: '公开摘要',
          }),
        }],
      }),
      async ({ messages }) => {
        const tool = String(messages.filter((item) => item.role === 'tool').pop()?.content || '');
        assert.match(tool, /联系对方超时/);
        return { text: '这次没有收到对方结果。我可以先在本地整理，或稍后重新联系。' };
      },
    ]),
  });
  assert.equal(result.outcome, 'FAILED');
  assert.equal(result.thread.executions.at(-1)?.ok, false);
  assert.match(result.thread.turns.at(-1)?.text || '', /本地整理|稍后重新联系/);
});
