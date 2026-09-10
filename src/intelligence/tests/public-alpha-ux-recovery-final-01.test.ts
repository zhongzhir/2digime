/**
 * DIGITALME-PUBLIC-ALPHA-UX-RECOVERY-FINAL-01
 * 多对话隔离/持久化、并行不阻塞、附件文案、Enter/IME（机械）、Doing regression。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import {
  listConversationSessionsSync,
  createConversationSessionSync,
  openConversationSessionSync,
} from '../../subject-core/conversation-sessions';
import type { TalkChatFn } from '../types';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-ux-rec-${prefix}-`));
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

test('SMOKE A：两会话 history 独立且持久', async () => {
  const root = await tempDir('a');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: scriptedChat([
      async () => ({ text: '回复给 A：苹果' }),
      async () => ({ text: '回复给 B：香蕉' }),
      async () => ({ text: '再回 A：梨' }),
    ]),
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'UX', targetDir: pkgDir });
    const a = listConversationSessionsSync(pkgDir).currentId;
    await bus.invoke('talk', { text: 'A 说苹果' });
    const created = createConversationSessionSync(pkgDir);
    const b = created.id;
    assert.notEqual(a, b);
    await bus.invoke('talk', { text: 'B 说香蕉' });
    openConversationSessionSync(pkgDir, a);
    await bus.invoke('talk', { text: 'A 再说梨' });
    const threadA = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir, a), 'utf8')) as {
      turns: Array<{ role: string; text: string }>;
    };
    const threadB = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir, b), 'utf8')) as {
      turns: Array<{ role: string; text: string }>;
    };
    const textA = threadA.turns.map((t) => t.text).join('\n');
    const textB = threadB.turns.map((t) => t.text).join('\n');
    assert.match(textA, /苹果/);
    assert.match(textA, /梨/);
    assert.equal(/香蕉/.test(textA), false);
    assert.match(textB, /香蕉/);
    assert.equal(/苹果/.test(textB), false);
    const listed = listConversationSessionsSync(pkgDir);
    assert.equal(listed.sessions.length >= 2, true);
    assert.equal(listed.sessions.some((s) => s.id === a), true);
    assert.equal(listed.sessions.some((s) => s.id === b), true);
  } finally {
    await runtime.stop();
  }
});

test('SMOKE C：A 长 Doing 不阻塞 B；回 A 可见结果', async () => {
  const root = await tempDir('c');
  const pkgDir = path.join(root, 'pkg');
  let releaseA!: () => void;
  const holdA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  let aStarted = false;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    externalExecutorCapability: false,
    talkChat: async ({ messages }) => {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const text = String(lastUser?.content || '');
      if (/长任务/.test(text)) {
        aStarted = true;
        await holdA;
        return { text: 'A 长任务完成了。' };
      }
      return { text: 'B 可以正常聊天。' };
    },
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'UX', targetDir: pkgDir });
    const a = listConversationSessionsSync(pkgDir).currentId;
    const pendingA = bus.invoke('talk', { text: '请做长任务' });
    for (let i = 0; i < 50 && !aStarted; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(aStarted, true);
    const b = createConversationSessionSync(pkgDir).id;
    const talkedB = await bus.invoke('talk', { text: 'B 你好' });
    const lastB = [...talkedB.view.turns].reverse().find((t) => t.role === 'assistant');
    assert.match(String(lastB?.text || ''), /B 可以正常聊天/);
    releaseA();
    const talkedA = await pendingA;
    const lastA = [...talkedA.view.turns].reverse().find((t) => t.role === 'assistant');
    assert.match(String(lastA?.text || ''), /长任务完成/);
    openConversationSessionSync(pkgDir, a);
    const refreshed = await bus.invoke('talk', {});
    const copy = refreshed.view.turns.map((t) => t.text).join('\n');
    assert.match(copy, /长任务完成/);
    assert.equal(b !== a, true);
  } finally {
    releaseA();
    await runtime.stop();
  }
});

test('SMOKE D：附件 UI 文案为添加文件/文件夹（HTML）', async () => {
  const html = await fs.readFile(
    path.resolve(__dirname, '../../../electron/renderer/index.html'),
    'utf8',
  );
  assert.match(html, />添加文件</);
  assert.match(html, />添加文件夹</);
  assert.equal(/这次一起看的文件/.test(html), false);
  assert.equal(/文件和文件夹都是这次对话的上下文/.test(html), false);
  assert.match(html, /Enter 发送 · Shift \+ Enter 换行/);
});

test('SMOKE E：file doing regression 磁盘 + final', async () => {
  const root = await tempDir('e');
  const pkgDir = path.join(root, 'pkg');
  const project = path.join(root, 'notes');
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
            arguments: JSON.stringify({ relativePath: 'ok.txt', content: 'done\n' }),
          },
        ],
      }),
      async () => ({ text: '已经写好 ok.txt。' }),
    ]),
  });
  const bus = createCommandBus(runtime);
  try {
    await bus.invoke('subject.createPackage', { displayName: 'E', targetDir: pkgDir });
    const talked = await bus.invoke('talk', { text: '写好文件', contextPaths: [project] });
    assert.equal(await fs.readFile(path.join(project, 'ok.txt'), 'utf8'), 'done\n');
    const last = [...talked.view.turns].reverse().find((t) => t.role === 'assistant');
    assert.match(String(last?.text || ''), /写好|ok\.txt/);
  } finally {
    await runtime.stop();
  }
});

test('Enter/IME：talk.js 含 composing 防护与 Enter 发送', async () => {
  const src = await fs.readFile(
    path.resolve(__dirname, '../../../electron/renderer/talk.js'),
    'utf8',
  );
  assert.match(src, /isComposing/);
  assert.match(src, /keyCode === 229/);
  assert.match(src, /shiftKey/);
  assert.match(src, /bindComposerKeys/);
});
