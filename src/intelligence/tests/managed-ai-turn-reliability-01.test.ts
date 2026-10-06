/**
 * MANAGED-AI-TURN-RELIABILITY-01
 * 执行已成功时，最终模型说明失败不得吞掉 ExecutionRecord；
 * provider timeout/429 必须释放 slot；新 Thread 不被旧 turn 卡死。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import { assistantFromTurnExecutions, TALK_SYNTHESIS_TIMEOUT_NOTICE } from '../service';
import { classifyManagedAiFailure, createManagedAiChatComplete, ManagedAiError } from '../../capability/managed-ai-client';
import { createManagedAiGateway } from '../../relay-service/ai-inference-gateway';
import { createFileAiAllowanceStore } from '../../relay-service/ai-allowance';
import { ModelHttpError } from '../../infrastructure/model-http';
import type { TalkChatFn, TalkExecution } from '../types';

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

test('Talk managed truncation is terminal: no additional model attempt',async()=>{
 let calls=0;
 const chat=createManagedAiChatComplete({gatewayUrl:'https://offline.invalid',installToken:TOKEN_A,fetchImpl:async()=>{
  calls++;return new Response(JSON.stringify({ok:false,status:'PROVIDER_ERROR',error:'truncated',finishReason:'length',text:''}),{status:502});
 }});
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dm-talk-truncated-'));
 const runtime=createDigitalMeRuntime({documentCapability:'fake',registerOpenAiStub:false,talkChat:async input=>{const r=await chat({...input,baseUrl:'https://offline.invalid',model:'managed-ai'});return{text:r.text}}});
 const bus=createCommandBus(runtime);
 try{await bus.invoke('subject.createPackage',{displayName:'离线测试',targetDir:path.join(root,'pkg')});await bus.invoke('talk',{text:'neutral fixture'});assert.equal(calls,1)}finally{await runtime.stop()}
});

function scriptedChat(replies: TalkChatFn[]): TalkChatFn {
  let i = 0;
  return async (input) => {
    const fn = replies[Math.min(i, replies.length - 1)];
    i += 1;
    if (!fn) throw new Error('talk chat script exhausted');
    return fn(input);
  };
}

function exec(partial: Partial<TalkExecution> & Pick<TalkExecution, 'capabilityId' | 'ok' | 'summary'>): TalkExecution {
  return {
    id: partial.id || 'run_x',
    at: '2026-09-20T12:00:00.000Z',
    turnId: 'turn_x',
    instruction: partial.instruction || '',
    ...partial,
  };
}

test('classifyManagedAiFailure 区分 local / concurrency / ceiling / provider', () => {
  assert.equal(classifyManagedAiFailure({ httpStatus: 429, bodyError: 'rate_limited' }), 'LOCAL_RATE_LIMITED');
  assert.equal(classifyManagedAiFailure({ httpStatus: 429, bodyError: 'concurrency' }), 'CONCURRENCY_BUSY');
  assert.equal(classifyManagedAiFailure({ httpStatus: 429, bodyError: 'global_ceiling' }), 'GLOBAL_CEILING');
  assert.equal(classifyManagedAiFailure({ httpStatus: 429, bodyError: 'provider_rate' }), 'PROVIDER_RATE_LIMITED');
  assert.equal(classifyManagedAiFailure({ httpStatus: 503, bodyError: 'timeout' }), 'PROVIDER_TIMEOUT');
  assert.equal(classifyManagedAiFailure({ httpStatus: 502, bodyError: 'provider_5xx' }), 'PROVIDER_5XX');
});

test('execution success + narration timeout → PARTIAL_SUCCESS 且保留文件名', () => {
  const from = assistantFromTurnExecutions(
    [
      exec({
        capabilityId: 'write_file',
        ok: true,
        summary: '已写入 index.html',
        outputPath: 'D:/tmp/index.html',
        producedOutputs: ['D:/tmp/index.html'],
      }),
      exec({
        id: 'run_read',
        capabilityId: 'read_file',
        ok: true,
        summary: '已读取 D:/tmp/index.html',
        outputPath: 'D:/tmp/index.html',
      }),
    ],
    'deadline',
  );
  assert.equal(from.outcome, 'PARTIAL_SUCCESS');
  assert.match(from.text, /操作已完成/);
  assert.match(from.text, /index\.html/);
  assert.match(from.text, /并验证/);
  assert.match(from.text, new RegExp(TALK_SYNTHESIS_TIMEOUT_NOTICE));
});

test('IQS/web search 成功 + 最终模型失败 不得只报服务忙', () => {
  const from = assistantFromTurnExecutions(
    [
      exec({
        capabilityId: 'cap_gemini_web_search',
        ok: true,
        summary: '检索到 4 条公开结果',
      }),
    ],
    'deadline',
  );
  assert.equal(from.outcome, 'PARTIAL_SUCCESS');
  assert.match(from.text, /4 条公开结果/);
  assert.equal(/模型服务当前比较忙/.test(from.text), false);
});

test('write_file 成功后 final narration timeout：文件只写一次，UI 收敛 PARTIAL_SUCCESS', { timeout: 15_000 }, async () => {
  const prev = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = '400';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-turn-rel-write-'));
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'project');
  await fs.mkdir(project, { recursive: true });
  let writes = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => {
        writes += 1;
        return {
          text: '',
          toolCalls: [
            {
              id: 'w1',
              name: 'write_file',
              arguments: JSON.stringify({ relativePath: 'index.html', content: '<title>tujimi coding test</title>' }),
            },
          ],
        };
      },
      async () => new Promise(() => {}),
    ]),
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: '可靠', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '改标题', contextPaths: [project] });
    assert.equal(talked.view.outcome, 'PARTIAL_SUCCESS');
    assert.match(String(talked.view.turns.at(-1)?.text || ''), /已修改 index\.html/);
    assert.equal(writes, 1);
    assert.match(await fs.readFile(path.join(project, 'index.html'), 'utf8'), /tujimi coding test/);
    const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
      executions?: Array<{ ok: boolean; capabilityId: string }>;
    };
    assert.equal((rec.executions || []).filter((e) => e.capabilityId === 'write_file').length, 1);
    assert.equal((rec.executions || []).some((e) => e.ok && e.capabilityId === 'write_file'), true);
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
    else process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = prev;
    await runtime.stop();
  }
});

test('工具已成功后 ManagedAiError 不得覆盖成只报服务忙', { timeout: 15_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-turn-rel-busy-'));
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'project');
  await fs.mkdir(project, { recursive: true });
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'w1',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: 'note.txt', content: 'ok' }),
          },
        ],
      }),
      async () => {
        throw new ManagedAiError('RATE_LIMITED', '模型服务当前比较忙，请稍后再试。', 'rate_limited');
      },
    ]),
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: '忙', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '写文件', contextPaths: [project] });
    const text = String(talked.view.turns.at(-1)?.text || '');
    assert.equal(talked.view.outcome, 'PARTIAL_SUCCESS');
    assert.match(text, /已修改 note\.txt/);
    assert.equal(text === '模型服务当前比较忙，请稍后再试。', false);
    assert.equal(await fs.readFile(path.join(project, 'note.txt'), 'utf8'), 'ok');
  } finally {
    await runtime.stop();
  }
});

test('timeout 后同一 runtime 新对话可立即工作', { timeout: 15_000 }, async () => {
  const prev = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = '80';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-turn-rel-next-'));
  const pkgDir = path.join(root, 'pkg');
  let n = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: async () => {
      n += 1;
      if (n === 1) return new Promise(() => {});
      return { text: '你好，我可以聊天、查找公开信息、帮你改文件。' };
    },
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: '下一轮', targetDir: pkgDir });
    const first = await bus.invoke('talk', { text: '先挂起' });
    assert.equal(first.view.outcome, 'FAILED');
    const second = await bus.invoke('talk', { text: '介绍一下你能帮我做什么' });
    assert.equal(second.view.outcome, 'SUCCESS');
    assert.match(String(second.view.turns.at(-1)?.text || ''), /聊天|文件/);
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
    else process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = prev;
    await runtime.stop();
  }
});

test('provider timeout / 429 释放 inFlight，后续请求可继续', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-gw-slot-'));
  const store = createFileAiAllowanceStore(root);
  let mode: 'timeout' | 'rate' | 'ok' = 'timeout';
  const gateway = createManagedAiGateway({
    store,
    trialTokenLimit: 50_000,
    concurrency: 1,
    timeoutMs: 20,
    maxProviderRetries: 0,
    retryBackoffMs: 0,
    provider: {
      provider: 'deepseek',
      baseUrl: 'http://127.0.0.1',
      apiKey: 'server-only',
      model: 'deepseek-v4-flash',
    },
    complete: async () => {
      if (mode === 'timeout') throw new ModelHttpError('timeout', 'timeout after 20ms');
      if (mode === 'rate') throw new ModelHttpError('rate_limited', 'rate limited (429)', 429);
      return { text: '后话', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    },
  });
  const timed = await gateway.infer({
    body: { messages: [{ role: 'user', content: 'a' }] },
    installToken: TOKEN_A,
  });
  assert.equal(timed.body.status, 'PROVIDER_TIMEOUT');
  mode = 'rate';
  const limited = await gateway.infer({
    body: { messages: [{ role: 'user', content: 'b' }] },
    installToken: TOKEN_A,
  });
  assert.equal(limited.body.status, 'PROVIDER_RATE_LIMITED');
  mode = 'ok';
  const ok = await gateway.infer({
    body: { messages: [{ role: 'user', content: 'c' }] },
    installToken: TOKEN_A,
  });
  assert.equal(ok.body.status, 'AVAILABLE');
  assert.equal(ok.body.text, '后话');
});

test('concurrency cap 拒绝后 slot 仍可被其他 principal 在释放后使用', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-gw-conc-'));
  const store = createFileAiAllowanceStore(root);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gateway = createManagedAiGateway({
    store,
    trialTokenLimit: 50_000,
    concurrency: 1,
    maxProviderRetries: 0,
    retryBackoffMs: 0,
    provider: {
      provider: 'deepseek',
      baseUrl: 'http://127.0.0.1',
      apiKey: 'server-only',
      model: 'deepseek-v4-flash',
    },
    complete: async ({ signal }) => {
      await Promise.race([
        held,
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(new ModelHttpError('aborted', 'aborted')), { once: true });
        }),
      ]);
      return { text: 'held-done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    },
  });
  const first = gateway.infer({
    body: { messages: [{ role: 'user', content: 'hold' }] },
    installToken: TOKEN_A,
  });
  await new Promise((r) => setTimeout(r, 20));
  const busy = await gateway.infer({
    body: { messages: [{ role: 'user', content: 'other' }] },
    installToken: TOKEN_B,
  });
  assert.equal(busy.body.status, 'CONCURRENCY_BUSY');
  release();
  const heldRes = await first;
  assert.equal(heldRes.body.status, 'AVAILABLE');
  const after = await gateway.infer({
    body: { messages: [{ role: 'user', content: 'next' }] },
    installToken: TOKEN_B,
  });
  assert.equal(after.body.status, 'AVAILABLE');
});

test('provider 瞬时 429 有限重试且只计一次 usage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-gw-retry-'));
  const store = createFileAiAllowanceStore(root);
  let calls = 0;
  const gateway = createManagedAiGateway({
    store,
    trialTokenLimit: 50_000,
    maxProviderRetries: 2,
    retryBackoffMs: 0,
    provider: {
      provider: 'deepseek',
      baseUrl: 'http://127.0.0.1',
      apiKey: 'server-only',
      model: 'deepseek-v4-flash',
    },
    complete: async () => {
      calls += 1;
      if (calls < 3) throw new ModelHttpError('rate_limited', 'rate limited (429)', 429);
      return { text: 'ok-after-retry', usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 } };
    },
  });
  const hit = await gateway.infer({
    body: { messages: [{ role: 'user', content: 'retry' }] },
    installToken: TOKEN_A,
  });
  assert.equal(hit.body.status, 'AVAILABLE');
  assert.equal(calls, 3);
  assert.equal(hit.body.usage?.totalTokens, 10);
  const snap = await gateway.allowance({ installToken: TOKEN_A });
  assert.equal(snap.body.ok, true);
  assert.equal((snap.body.remainingPercent || 0) > 0, true);
});

test('重试耗尽仍不重复计费；未到达 provider 的 local 429 不计 token', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-gw-nobill-'));
  const store = createFileAiAllowanceStore(root);
  let calls = 0;
  const gateway = createManagedAiGateway({
    store,
    trialTokenLimit: 50_000,
    burstMax: 1,
    burstWindowMs: 60_000,
    maxProviderRetries: 2,
    retryBackoffMs: 0,
    provider: {
      provider: 'deepseek',
      baseUrl: 'http://127.0.0.1',
      apiKey: 'server-only',
      model: 'deepseek-v4-flash',
    },
    complete: async () => {
      calls += 1;
      throw new ModelHttpError('server_error', 'provider server error (503)', 503);
    },
  });
  const first = await gateway.infer({
    body: { messages: [{ role: 'user', content: 'fail' }] },
    installToken: TOKEN_A,
  });
  assert.equal(first.body.status, 'PROVIDER_5XX');
  assert.equal(calls, 3);
  const second = await gateway.infer({
    body: { messages: [{ role: 'user', content: 'blocked' }] },
    installToken: TOKEN_A,
  });
  assert.equal(second.body.status, 'LOCAL_RATE_LIMITED');
  assert.equal(calls, 3);
  const snap = await gateway.allowance({ installToken: TOKEN_A });
  assert.equal(snap.body.remainingPercent, 100);
});

test('managed client 把 error=rate_limited 映射为 LOCAL_RATE_LIMITED', async () => {
  const complete = createManagedAiChatComplete({
    gatewayUrl: 'http://gateway.example',
    installToken: TOKEN_A,
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: false, status: 'RATE_LIMITED', error: 'rate_limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
  });
  await assert.rejects(
    () => complete({ baseUrl: 'x', model: 'managed-ai', messages: [{ role: 'user', content: 'hi' }] }),
    (err: unknown) => {
      assert.equal(err instanceof ManagedAiError, true);
      assert.equal((err as ManagedAiError).status, 'LOCAL_RATE_LIMITED');
      assert.match(String((err as Error).message), /这一会儿请求比较多/);
      return true;
    },
  );
});
