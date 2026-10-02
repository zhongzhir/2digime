/**
 * ZERO-START-CODING-EXECUTION-01
 * expected effects vs observed effects；read/list ok 不能冒充修改成功。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import { expectedFromExecutions, hasObservedMutation, isMutationEffectName } from '../talk-effects';
import { assistantFromTurnExecutions, TALK_SYNTHESIS_TIMEOUT_NOTICE } from '../service';
import type { TalkChatFn, TalkExecution, TalkThread } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-effect-${prefix}-`));
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

async function readThread(pkgDir: string): Promise<TalkThread> {
  return JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as TalkThread;
}

const OLD_HTML = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>极简单的计算器</title></head>
<body><h1>calc</h1></body></html>
`;

const NEW_HTML = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>Tujimi Coding Test</title></head>
<body><h1>calc</h1></body></html>
`;

const RESET_HTML = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>Tujimi Coding Test</title></head>
<body>
  <input id="out" value="1" />
  <button type="button" id="reset">reset</button>
  <script src="app.js"></script>
</body></html>
`;

const RESET_JS = `document.getElementById('reset').onclick=function(){document.getElementById('out').value='0';};`;

test('expected / observed helpers：mutation 名称与 target 匹配', () => {
  assert.equal(isMutationEffectName('content_modified'), true);
  assert.equal(isMutationEffectName('observation'), false);
  const execs: TalkExecution[] = [
    {
      id: 'e1',
      at: 't',
      turnId: 'u',
      capabilityId: 'write_file',
      instruction: 'index.html',
      ok: true,
      summary: 'wrote',
      outputPath: 'D:/tmp/index.html',
      observedEffect: { kind: 'content_modified', target: 'D:/tmp/index.html', mutated: true },
    },
  ];
  assert.equal(hasObservedMutation(execs, 'index.html'), true);
});

test('create task → write evidence required', async () => {
  const root = await tempDir('create');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'proj');
  await fs.mkdir(project, { recursive: true });
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'e1',
            name: 'set_expected_effects',
            arguments: JSON.stringify({
              effects: [{ target: 'effect-test.txt', effect: 'file_created', expectedState: 'effect-pass' }],
            }),
          },
        ],
      }),
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'w1',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: 'effect-test.txt', content: 'effect-pass' }),
          },
        ],
      }),
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'r1',
            name: 'read_file',
            arguments: JSON.stringify({ path: 'effect-test.txt' }),
          },
        ],
      }),
      async () => ({ text: '已经写好 effect-test.txt。' }),
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '创建', targetDir: pkgDir });
  const talked = await bus.invoke('talk', {
    text: '在授权目录创建 effect-test.txt，内容写 effect-pass。',
    contextPaths: [project],
  });
  assert.equal(talked.view.outcome, 'SUCCESS');
  assert.equal(await fs.readFile(path.join(project, 'effect-test.txt'), 'utf8'), 'effect-pass');
  const thread = await readThread(pkgDir);
  const expected = expectedFromExecutions(thread.executions || []);
  assert.equal(expected.some((row) => row.effect === 'file_created'), true);
  assert.equal(hasObservedMutation(thread.executions || [], 'effect-test.txt'), true);
  await runtime.stop();
});

test('read-only task → no mutation required', async () => {
  const root = await tempDir('ro');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'proj');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'index.html'), OLD_HTML, 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'e1',
            name: 'set_expected_effects',
            arguments: JSON.stringify({ effects: [{ target: 'index.html', effect: 'observation' }] }),
          },
        ],
      }),
      async () => ({
        text: '',
        toolCalls: [{ id: 'r1', name: 'read_file', arguments: JSON.stringify({ path: 'index.html' }) }],
      }),
      async () => ({ text: '标题还是极简单的计算器。' }),
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '只读', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '看看 index.html 内容', contextPaths: [project] });
  assert.equal(talked.view.outcome, 'SUCCESS');
  assert.equal(await fs.readFile(path.join(project, 'index.html'), 'utf8'), OLD_HTML);
  const thread = await readThread(pkgDir);
  assert.equal(hasObservedMutation(thread.executions || []), false);
  await runtime.stop();
});

test('只读之后模型收工时，不强迫继续改文件', async () => {
  const root = await tempDir('neg');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'proj');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'index.html'), OLD_HTML, 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'e1',
            name: 'set_expected_effects',
            arguments: JSON.stringify({
              effects: [
                { target: 'index.html', effect: 'content_modified', expectedState: 'Tujimi Coding Test' },
              ],
            }),
          },
        ],
      }),
      async () => ({
        text: '',
        toolCalls: [
          { id: 'l1', name: 'list_directory', arguments: JSON.stringify({ path: '' }) },
          { id: 'r1', name: 'read_file', arguments: JSON.stringify({ path: 'index.html' }) },
        ],
      }),
      async (input) => {
        const blob = JSON.stringify(input.messages || []);
        if (blob.includes('工具执行记录')) return { text: '没有写文件，标题没有改。' };
        return { text: '操作已完成。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '负例', targetDir: pkgDir });
  const talked = await bus.invoke('talk', {
    text: '把 index.html 标题改成 Tujimi Coding Test，并检查修改成功。',
    contextPaths: [project],
  });
  assert.equal(talked.view.outcome, 'SUCCESS');
  assert.equal(String(talked.view.turns.at(-1)?.text || ''), '没有写文件，标题没有改。');
  assert.equal(talked.view.turns.at(-1)?.result, undefined);
  assert.equal(await fs.readFile(path.join(project, 'index.html'), 'utf8'), OLD_HTML);
  const thread = await readThread(pkgDir);
  assert.equal(
    (thread.executions || []).some((row) => row.ok && row.capabilityId === 'write_file'),
    false,
  );
  await runtime.stop();
});

test('modify task → mutation + verify on disk', async () => {
  const root = await tempDir('mod');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'TujimiCodingTest');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'index.html'), OLD_HTML, 'utf8');
  const before = (await fs.stat(path.join(project, 'index.html'))).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 30));
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'e1',
            name: 'set_expected_effects',
            arguments: JSON.stringify({
              effects: [
                { target: 'index.html', effect: 'content_modified', expectedState: 'Tujimi Coding Test' },
              ],
            }),
          },
        ],
      }),
      async () => ({
        text: '',
        toolCalls: [{ id: 'r1', name: 'read_file', arguments: JSON.stringify({ path: 'index.html' }) }],
      }),
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'w1',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: 'index.html', content: NEW_HTML }),
          },
        ],
      }),
      async () => ({
        text: '',
        toolCalls: [{ id: 'r2', name: 'read_file', arguments: JSON.stringify({ path: 'index.html' }) }],
      }),
      async () => ({ text: '标题已经改成 Tujimi Coding Test。' }),
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '改标题', targetDir: pkgDir });
  const talked = await bus.invoke('talk', {
    text: '把 TujimiCodingTest 里的 index.html 标题改成 Tujimi Coding Test，并检查修改成功。',
    contextPaths: [project],
  });
  assert.equal(talked.view.outcome, 'SUCCESS');
  const body = await fs.readFile(path.join(project, 'index.html'), 'utf8');
  assert.match(body, /<title>Tujimi Coding Test<\/title>/);
  const after = (await fs.stat(path.join(project, 'index.html'))).mtimeMs;
  assert.equal(after > before, true);
  const thread = await readThread(pkgDir);
  assert.equal(hasObservedMutation(thread.executions || [], 'index.html'), true);
  await runtime.stop();
});

test('验收句子和文件不一致时，不强迫再写一次', async () => {
  const root = await tempDir('repair');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'proj');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'index.html'), OLD_HTML, 'utf8');
  let writes = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'e1',
            name: 'set_expected_effects',
            arguments: JSON.stringify({
              effects: [
                { target: 'index.html', effect: 'content_modified', expectedState: 'Tujimi Coding Test' },
              ],
            }),
          },
        ],
      }),
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'w1',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: 'index.html', content: OLD_HTML }),
          },
        ],
      }),
      async () => {
        writes += 1;
        return {
          text: '',
          toolCalls: [{ id: 'r1', name: 'read_file', arguments: JSON.stringify({ path: 'index.html' }) }],
        };
      },
      async () => ({ text: '改好了' }),
      async (input) => {
        const blob = JSON.stringify(input.messages || []);
        if (blob.includes('工具执行记录')) {
          return { text: '写过一次，但标题仍是旧的，没有改成 Tujimi Coding Test。' };
        }
        return {
          text: '',
          toolCalls: [
            {
              id: 'w2',
              name: 'write_file',
              arguments: JSON.stringify({ relativePath: 'index.html', content: NEW_HTML }),
            },
          ],
        };
      },
      async () => ({
        text: '',
        toolCalls: [{ id: 'r2', name: 'read_file', arguments: JSON.stringify({ path: 'index.html' }) }],
      }),
      async () => ({ text: '这次标题对了。' }),
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '修正', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '改标题并检查', contextPaths: [project] });
  assert.equal(talked.view.outcome, 'SUCCESS');
  assert.equal(await fs.readFile(path.join(project, 'index.html'), 'utf8'), OLD_HTML);
  assert.equal(String(talked.view.turns.at(-1)?.text || ''), '改好了');
  const thread = await readThread(pkgDir);
  assert.equal((thread.executions || []).filter((row) => row.capabilityId === 'write_file' && row.ok).length, 1);
  await runtime.stop();
});

test('mutation success + narration timeout → PARTIAL_SUCCESS without duplicate write', async () => {
  const prev = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = '400';
  const root = await tempDir('partial');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'proj');
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
              arguments: JSON.stringify({ relativePath: 'note.txt', content: 'ok' }),
            },
          ],
        };
      },
      async () => new Promise(() => {}),
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: '超时', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '写 note.txt', contextPaths: [project] });
    assert.equal(talked.view.outcome, 'PARTIAL_SUCCESS');
    assert.equal(writes, 1);
    assert.equal(await fs.readFile(path.join(project, 'note.txt'), 'utf8'), 'ok');
    assert.match(String(talked.view.turns.at(-1)?.text || ''), new RegExp(TALK_SYNTHESIS_TIMEOUT_NOTICE));
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
    else process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS = prev;
    await runtime.stop();
  }
});

test('timeout fallback 在没有 mutation 时不得说操作已完成', () => {
  const from = assistantFromTurnExecutions(
    [
      {
        id: 'r1',
        at: 't',
        turnId: 'u',
        capabilityId: 'read_file',
        instruction: 'index.html',
        ok: true,
        summary: '已读取 index.html',
        observedEffect: { kind: 'file_read', target: 'index.html', mutated: false },
      },
      {
        id: 'l1',
        at: 't',
        turnId: 'u',
        capabilityId: 'list_directory',
        instruction: '',
        ok: true,
        summary: '列出 1 项',
        observedEffect: { kind: 'directory_listed', mutated: false },
      },
    ],
    'deadline',
  );
  assert.equal(/操作已完成/.test(from.text), false);
  assert.equal(/相关修改已经写入/.test(from.text), false);
  assert.match(from.text, new RegExp(TALK_SYNTHESIS_TIMEOUT_NOTICE));
});

test('persisted folder grant reused; denial respected', async () => {
  const home = await tempDir('grant-home');
  const pkgDir = path.join(await tempDir('grant-pkg'), 'pkg');
  await fs.mkdir(path.join(home, 'Desktop'), { recursive: true });
  const asked: string[] = [];
  const prev = process.env.DIGITALME_V2_HOME;
  process.env.DIGITALME_V2_HOME = home;
  try {
    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      requestFolderAccess: async ({ path: folder }) => {
        asked.push(folder);
        return true;
      },
      talkChat: scriptedChat([
        async () => ({
          text: '',
          toolCalls: [
            {
              id: 'a1',
              name: 'request_folder_access',
              arguments: JSON.stringify({ path: 'desktop/TujimiCodingTest' }),
            },
          ],
        }),
        async () => ({
          text: '',
          toolCalls: [
            {
              id: 'w1',
              name: 'write_file',
              arguments: JSON.stringify({ relativePath: 'a.txt', content: 'one' }),
            },
          ],
        }),
        async () => ({ text: '已写 a.txt' }),
        async ({ tools }) => {
          assert.equal(tools?.some((t) => t.function.name === 'write_file'), true);
          return {
            text: '',
            toolCalls: [
              {
                id: 'w2',
                name: 'write_file',
                arguments: JSON.stringify({ relativePath: 'b.txt', content: 'two' }),
              },
            ],
          };
        },
        async () => ({ text: '已写 b.txt' }),
      ]),
      talkProfessionals: [],
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '授权', targetDir: pkgDir });
    await bus.invoke('talk', { text: '在 TujimiCodingTest 写 a.txt' });
    assert.equal(asked.length, 1);
    await bus.invoke('talk', { text: '再写 b.txt' });
    assert.equal(asked.length, 1);
    assert.equal(await fs.readFile(path.join(home, 'Desktop', 'TujimiCodingTest', 'b.txt'), 'utf8'), 'two');
    await runtime.stop();
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_HOME;
    else process.env.DIGITALME_V2_HOME = prev;
  }
});

test('folder access denial is recorded and does not write', async () => {
  const home = await tempDir('deny-home');
  const pkgDir = path.join(await tempDir('deny-pkg'), 'pkg');
  await fs.mkdir(path.join(home, 'Desktop'), { recursive: true });
  const prev = process.env.DIGITALME_V2_HOME;
  process.env.DIGITALME_V2_HOME = home;
  try {
    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      requestFolderAccess: async () => false,
      talkChat: scriptedChat([
        async () => ({
          text: '',
          toolCalls: [
            {
              id: 'e1',
              name: 'set_expected_effects',
              arguments: JSON.stringify({
                effects: [{ target: 'x.txt', effect: 'file_created', expectedState: 'x' }],
              }),
            },
          ],
        }),
        async () => ({
          text: '',
          toolCalls: [
            {
              id: 'a1',
              name: 'request_folder_access',
              arguments: JSON.stringify({ path: 'desktop/TujimiCodingTest' }),
            },
          ],
        }),
        async () => ({ text: '主人没有允许访问该文件夹。' }),
      ]),
      talkProfessionals: [],
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '拒绝', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '在 TujimiCodingTest 写 x.txt' });
    assert.notEqual(talked.view.outcome, 'SUCCESS');
    await assert.rejects(fs.access(path.join(home, 'Desktop', 'TujimiCodingTest', 'x.txt')));
    await runtime.stop();
  } finally {
    if (prev === undefined) delete process.env.DIGITALME_V2_HOME;
    else process.env.DIGITALME_V2_HOME = prev;
  }
});

test('complex html/js edit uses filesystem capability, not forced coding agent', async () => {
  const root = await tempDir('reset');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'proj');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'index.html'), NEW_HTML, 'utf8');
  await fs.writeFile(path.join(project, 'app.js'), 'console.log(1);', 'utf8');
  let delegated = false;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async ({ tools }) => {
        assert.equal(tools?.some((t) => t.function.name === 'write_file'), true);
        return {
          text: '',
          toolCalls: [
            {
              id: 'e1',
              name: 'set_expected_effects',
              arguments: JSON.stringify({
                effects: [
                  { target: 'index.html', effect: 'content_modified', expectedState: 'id="reset"' },
                  { target: 'app.js', effect: 'content_modified', expectedState: 'onclick' },
                ],
              }),
            },
          ],
        };
      },
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'w1',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: 'index.html', content: RESET_HTML }),
          },
          {
            id: 'w2',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: 'app.js', content: RESET_JS }),
          },
        ],
      }),
      async () => ({
        text: '',
        toolCalls: [
          { id: 'r1', name: 'read_file', arguments: JSON.stringify({ path: 'index.html' }) },
          { id: 'r2', name: 'read_file', arguments: JSON.stringify({ path: 'app.js' }) },
        ],
      }),
      async () => ({ text: '已经加上 reset 按钮，并和 app.js 对上。' }),
    ]),
    talkProfessionals: [
      {
        id: 'coding',
        label: 'coding',
        description: '专业代码执行',
        async run() {
          delegated = true;
          return { ok: false, summary: 'unused' };
        },
      },
    ],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: 'reset', targetDir: pkgDir });
  const talked = await bus.invoke('talk', {
    text: '给现有页面增加一个 reset 按钮，并同步修改 HTML/JS，完成后检查引用和逻辑一致。',
    contextPaths: [project],
  });
  assert.equal(talked.view.outcome, 'SUCCESS');
  assert.equal(delegated, false);
  assert.match(await fs.readFile(path.join(project, 'index.html'), 'utf8'), /id="reset"/);
  assert.match(await fs.readFile(path.join(project, 'app.js'), 'utf8'), /getElementById\('reset'\)/);
  await runtime.stop();
});

test('工具协议文本不会当成给主人的答复', async () => {
  const root = await tempDir('proto');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'proj');
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
            arguments: JSON.stringify({ relativePath: 'note.txt', content: '窗口验收成功' }),
          },
        ],
      }),
      async (input) => {
        const blob = JSON.stringify(input.messages || []);
        if (blob.includes('不是给主人的话')) return { text: '已经写好，内容是窗口验收成功。' };
        return { text: '<｜｜DSML｜｜invoke name="read_file"></｜｜DSML｜｜>' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '协议', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '写 note.txt', contextPaths: [project] });
  assert.equal(await fs.readFile(path.join(project, 'note.txt'), 'utf8'), '窗口验收成功');
  assert.equal(String(talked.view.turns.at(-1)?.text || ''), '已经写好，内容是窗口验收成功。');
  assert.equal(String(talked.view.turns.at(-1)?.text || '').includes('DSML'), false);
  await runtime.stop();
});

test('只在对话里回答时，不因为没有写文件而失败', async () => {
  const root = await tempDir('chat');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'proj');
  await fs.mkdir(project, { recursive: true });
  let calls = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => {
        calls += 1;
        return { text: '可以，按你的语气写就行。这次先不落文件。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '对话', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '先告诉我你会不会按我的语气写，先别建文件。', contextPaths: [project] });
  assert.equal(calls, 1);
  assert.equal(talked.view.outcome, 'SUCCESS');
  assert.equal(talked.view.turns.at(-1)?.result, undefined);
  await assert.rejects(fs.stat(path.join(project, 'note.txt')));
  await runtime.stop();
});

test('没有写文件时，声称改完也不会带上结果卡', async () => {
  const root = await tempDir('claim');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'proj');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'index.html'), OLD_HTML, 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([async () => ({ text: '修改已经完成。' })]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '声称', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '改一下标题', contextPaths: [project] });
  assert.equal(await fs.readFile(path.join(project, 'index.html'), 'utf8'), OLD_HTML);
  assert.equal(talked.view.turns.at(-1)?.result, undefined);
  assert.equal((await readThread(pkgDir)).executions?.length || 0, 0);
  await runtime.stop();
});

test('写入失败后仍可在授权内完成', async () => {
  const root = await tempDir('retry');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'proj');
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
            arguments: JSON.stringify({ relativePath: '../outside.txt', content: 'nope' }),
          },
        ],
      }),
      async () => ({ text: '没有继续。' }),
      async (input) => {
        const blob = JSON.stringify(input.messages || []);
        if (blob.includes('还可以继续完成')) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'w2',
                name: 'write_file',
                arguments: JSON.stringify({ relativePath: 'note.txt', content: '补上了' }),
              },
            ],
          };
        }
        return { text: '没有继续。' };
      },
      async () => ({ text: '已经写到授权目录里的 note.txt。' }),
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '重试', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '写 note.txt', contextPaths: [project] });
  assert.equal(await fs.readFile(path.join(project, 'note.txt'), 'utf8'), '补上了');
  assert.equal(talked.view.outcome, 'SUCCESS');
  await assert.rejects(fs.stat(path.join(root, 'outside.txt')));
  await runtime.stop();
});

test('一部分写成功、另一部分失败时说明两边', async () => {
  const root = await tempDir('mix');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'proj');
  await fs.mkdir(project, { recursive: true });
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkChat: scriptedChat([
      async () => ({
        text: '',
        toolCalls: [
          {
            id: 'ok',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: 'ok.txt', content: '成了' }),
          },
          {
            id: 'bad',
            name: 'write_file',
            arguments: JSON.stringify({ relativePath: '../nope.txt', content: '不成' }),
          },
        ],
      }),
      async (input) => {
        const blob = JSON.stringify(input.messages || []);
        if (blob.includes('执行已经结束')) return { text: 'ok.txt 已写上。越出授权的 nope.txt 没有写。' };
        return { text: '先这样。' };
      },
    ]),
    talkProfessionals: [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '部分', targetDir: pkgDir });
  const talked = await bus.invoke('talk', { text: '写两个文件', contextPaths: [project] });
  assert.equal(talked.view.outcome, 'PARTIAL_SUCCESS');
  assert.equal(await fs.readFile(path.join(project, 'ok.txt'), 'utf8'), '成了');
  assert.match(String(talked.view.turns.at(-1)?.text || ''), /ok\.txt/);
  assert.match(String(talked.view.turns.at(-1)?.text || ''), /nope\.txt/);
  await runtime.stop();
});
