/**
 * DIGITALME-SUPER-ASSISTANT-L1-01
 * 最小验证：MODEL DIRECT / 授权文件 / specialist delegate / 通用 capability /
 * multi-capability continuation / final result 交付 / acquisition 不锁 Coding。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import { TALK_SYNTHESIS_TIMEOUT_NOTICE } from '../service';
import {
  acquireCapability,
  readyAcquire,
  type AcquireCandidate,
} from '../../capability/acquire-capability';
import type { TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-sa-l1-${prefix}-`));
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

test('SMOKE A — General direct：普通写作/分析，模型直接答，无 capability', async () => {
  const root = await tempDir('a');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async ({ tools }) => {
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), false);
        return { text: '这是一段可直接交付的分析结论：先定目标，再列约束，最后给三步行动。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'A', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '帮我分析一下怎么安排本周工作。' });
    const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
    assert.match(String(last?.text || ''), /分析|行动|目标/);
    const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
      executions?: unknown[];
    };
    assert.equal((rec.executions || []).length, 0);
  } finally {
    await runtime.stop();
  }
});

test('SMOKE B — Direct file doing：授权文件 read/write → 用户最终结果', async () => {
  const root = await tempDir('b');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'notes');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'messy.txt'), 'b\na\nc\n', 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'r1',
            name: 'read_file',
            arguments: JSON.stringify({ path: 'messy.txt' }),
          },
        ],
      }),
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'w1',
            name: 'write_file',
            arguments: JSON.stringify({
              relativePath: 'messy.txt',
              content: 'a\nb\nc\n',
            }),
          },
        ],
      }),
      async () => ({ text: '已经按字母顺序整理并写回 messy.txt。' }),
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'B', targetDir: pkgDir });
    const talked = await bus.invoke('talk', {
      text: '把这个文件整理并直接修改好。',
      contextPaths: [project],
    });
    const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
    assert.match(String(last?.text || ''), /整理|messy/);
    assert.equal(await fs.readFile(path.join(project, 'messy.txt'), 'utf8'), 'a\nb\nc\n');
    assert.equal(Boolean(last?.result?.path), true);
  } finally {
    await runtime.stop();
  }
});

test('SMOKE C — Specialist：模型自主 delegate；直接完成也算通过', async () => {
  const root = await tempDir('c');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'math');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'add.js'), 'module.exports = { add(a,b){ return a - b; } };\n', 'utf8');
  await fs.writeFile(
    path.join(project, 'add.test.js'),
    "const { add } = require('./add');\nif (add(2,3) !== 5) throw new Error('fail');\n",
    'utf8',
  );
  let delegated = false;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async ({ tools }) => {
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), true);
        return {
          text: '',
          toolCalls: [
            {
              id: 'd1',
              name: 'delegate',
              arguments: JSON.stringify({
                capabilityId: 'test-specialist-cap',
                instruction: 'fix add.js so tests pass',
              }),
            },
          ],
        };
      },
      async ({ messages }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":true/);
        return { text: '已修好加法实现，测试应可通过。' };
      },
    ]),
    talkProfessionals: [
      {
        id: 'test-specialist-cap',
        label: '测试专用专业能力',
        description: '跨文件理解并修改代码的测试替身。',
        async run() {
          delegated = true;
          const target = path.join(project, 'add.js');
          await fs.writeFile(target, 'module.exports = { add(a,b){ return a + b; } };\n', 'utf8');
          return {
            ok: true,
            summary: 'fixed add.js',
            producedOutputs: [target],
            outputPath: target,
          };
        },
      },
    ],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'C', targetDir: pkgDir });
    const talked = await bus.invoke('talk', {
      text: '这个小项目测试失败了，请修好。',
      contextPaths: [project],
    });
    assert.equal(delegated, true);
    const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
    assert.match(String(last?.text || ''), /修好|测试/);
    assert.match(await fs.readFile(path.join(project, 'add.js'), 'utf8'), /a \+ b/);
  } finally {
    await runtime.stop();
  }
});

test('SMOKE D — Generic capability fixture：Talk 核心无需 special case', async () => {
  const root = await tempDir('d');
  const pkgDir = path.join(root, 'pkg');
  const artifact = path.join(root, 'external-artifact.ref');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async ({ tools, messages }) => {
        assert.equal(tools?.some((t) => t.function.name === 'delegate'), true);
        const sys = String(messages[0]?.content || '');
        assert.match(sys, /test-generic-capability/);
        assert.equal(/VideoAgent|ImageAgent|DigitalHumanAgent/.test(sys), false);
        return {
          text: '',
          toolCalls: [
            {
              id: 'g1',
              name: 'delegate',
              arguments: JSON.stringify({
                capabilityId: 'test-generic-capability',
                instruction: 'produce external artifact',
              }),
            },
          ],
        };
      },
      async ({ messages }) => {
        const tool = String(messages.filter((m) => m.role === 'tool').pop()?.content || '');
        assert.match(tool, /actualSuccess":true/);
        assert.match(tool, /external-artifact\.ref/);
        return { text: `已拿到外部产物：${artifact}` };
      },
    ]),
    talkProfessionals: [
      {
        id: 'test-generic-capability',
        label: '测试通用能力',
        description: '生成一种当前模型自身不能直接产生的外部产物。',
        async run() {
          await fs.writeFile(artifact, 'generic-artifact-v1\n', 'utf8');
          return {
            ok: true,
            summary: `artifact:${artifact}`,
            producedOutputs: [artifact],
            outputPath: artifact,
          };
        },
      },
    ],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'D', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '请生成那个我自己做不了的外部产物。' });
    const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
    assert.match(String(last?.text || ''), /外部产物|artifact/);
    assert.equal(await fs.readFile(artifact, 'utf8'), 'generic-artifact-v1\n');
  } finally {
    await runtime.stop();
  }
});

test('MULTI_CAPABILITY_CONTINUATION：同一 turn 连续 tool → capability → final', async () => {
  const root = await tempDir('multi');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'work');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'note.txt'), 'raw', 'utf8');
  const order: string[] = [];
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async () => {
        order.push('read');
        return {
          text: '',
          toolCalls: [
            { id: 't1', name: 'read_file', arguments: JSON.stringify({ path: 'note.txt' }) },
          ],
        };
      },
      async () => {
        order.push('write');
        return {
          text: '',
          toolCalls: [
            {
              id: 't2',
              name: 'write_file',
              arguments: JSON.stringify({ relativePath: 'note.txt', content: 'prepared\n' }),
            },
          ],
        };
      },
      async () => {
        order.push('cap');
        return {
          text: '',
          toolCalls: [
            {
              id: 't3',
              name: 'delegate',
              arguments: JSON.stringify({
                capabilityId: 'test-generic-capability',
                instruction: 'stamp',
              }),
            },
          ],
        };
      },
      async () => {
        order.push('final');
        return { text: '已连续完成读取、写入与外部能力调用。' };
      },
    ]),
    talkProfessionals: [
      {
        id: 'test-generic-capability',
        label: '测试通用能力',
        description: '生成一种当前模型自身不能直接产生的外部产物。',
        async run() {
          const out = path.join(project, 'stamp.ref');
          await fs.writeFile(out, 'stamped\n', 'utf8');
          return { ok: true, summary: 'stamped', producedOutputs: [out], outputPath: out };
        },
      },
    ],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'M', targetDir: pkgDir });
    const talked = await bus.invoke('talk', {
      text: '先读再写，再调用外部能力，最后给我结果。',
      contextPaths: [project],
    });
    assert.deepEqual(order, ['read', 'write', 'cap', 'final']);
    const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
    assert.match(String(last?.text || ''), /连续完成/);
    assert.equal(await fs.readFile(path.join(project, 'note.txt'), 'utf8'), 'prepared\n');
    assert.equal(await fs.readFile(path.join(project, 'stamp.ref'), 'utf8'), 'stamped\n');
  } finally {
    await runtime.stop();
  }
});

test('FINAL_RESULT_DELIVERED：合成运输层超时后仍落 Thread 并返回用户可见结果', async () => {
  const prev = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = '800';
  const root = await tempDir('deliver');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'out');
  await fs.mkdir(project, { recursive: true });
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'w1',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: 'done.txt', content: 'ready' }),
          },
        ],
      }),
      async () => {
        const err = new Error('timeout after 12ms');
        err.name = 'ModelHttpError';
        (err as { kind?: string }).kind = 'timeout';
        throw err;
      },
    ]),
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'Deliver', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '写好文件', contextPaths: [project] });
    const last = talked.view.turns[talked.view.turns.length - 1];
    assert.equal(last?.role, 'assistant');
    assert.equal(last?.text, TALK_SYNTHESIS_TIMEOUT_NOTICE);
    assert.equal(talked.view.notice, TALK_SYNTHESIS_TIMEOUT_NOTICE);
    assert.equal(await fs.readFile(path.join(project, 'done.txt'), 'utf8'), 'ready');
    const rec = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
      executions?: Array<{ ok: boolean; capabilityId: string }>;
      turns?: Array<{ role: string; text: string }>;
    };
    assert.equal(
      (rec.executions || []).some((e) => e.ok && e.capabilityId === 'write_file'),
      true,
    );
    assert.equal(
      (rec.turns || []).some((t) => t.role === 'assistant' && t.text === TALK_SYNTHESIS_TIMEOUT_NOTICE),
      true,
    );
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
    else process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = prev;
    await runtime.stop();
  }
});

test('ACQUISITION_ABSTRACTION：非 Coding candidate 可复用 acquireCapability', async () => {
  const root = await tempDir('acq');
  const runtimePath = path.join(root, 'tool-runtime');
  await fs.mkdir(runtimePath, { recursive: true });
  const candidates: AcquireCandidate[] = [
    {
      id: 'test-non-coding-runtime',
      async acquire() {
        return readyAcquire({
          candidateId: 'test-non-coding-runtime',
          runtimePath,
          version: '0.0.1',
          source: 'test-fixture',
        });
      },
    },
  ];
  const result = await acquireCapability(candidates, { runtimeRoot: root });
  assert.equal(result.status, 'ready');
  assert.equal(result.ok, true);
  assert.equal(result.candidateId === 'test-non-coding-runtime', true);
  assert.equal(/opencode/i.test(result.candidateId || ''), false);
  assert.equal(result.source, 'test-fixture');
});
