import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { buildDocxFromMarkdown } from '../../infrastructure/export';
import { talkThreadFilePath } from '../store';
import {
  MAX_SEARCH_RESULTS,
  classifyAuthorizedPaths,
  runSearchFiles,
} from '../mechanical-tools';
import type { TalkChatFn } from '../types';

async function tempDir(label: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-search-${label}-`));
}

function scriptedChat(replies: TalkChatFn[]): TalkChatFn {
  let index = 0;
  return async (input) => {
    const reply = replies[index++];
    if (!reply) throw new Error('talk chat script exhausted');
    return reply(input);
  };
}

test('授权目录搜索同时返回文件名和正文真实匹配，并读取 DOCX 正文', async () => {
  const root = await tempDir('content');
  const nested = path.join(root, 'reports');
  await fs.mkdir(nested);
  await fs.writeFile(path.join(root, 'budget-overview.bin'), Buffer.from([1, 2, 3]));
  await fs.writeFile(path.join(root, 'README'), '十二月完成验收，README 同样可检索。', 'utf8');
  await fs.writeFile(path.join(nested, 'plan.md'), '# 项目计划\n\n关键里程碑是十二月完成验收。', 'utf8');
  await fs.writeFile(
    path.join(nested, 'meeting.docx'),
    buildDocxFromMarkdown('# 会议纪要\n\n十二月完成验收，并形成回读证据。'),
  );
  const auth = classifyAuthorizedPaths([root]);

  const byName = JSON.parse(await runSearchFiles(auth, JSON.stringify({ query: 'budget' }))) as {
    actualSuccess: boolean;
    matches: Array<{ path: string; matchedIn: string }>;
  };
  assert.equal(byName.actualSuccess, true);
  assert.deepEqual(byName.matches.map((item) => [item.path, item.matchedIn]), [['budget-overview.bin', 'name']]);

  const byContent = JSON.parse(await runSearchFiles(auth, JSON.stringify({ query: '十二月完成验收' }))) as {
    actualSuccess: boolean;
    matches: Array<{ path: string; matchedIn: string; snippet?: string }>;
  };
  assert.equal(byContent.actualSuccess, true);
  assert.deepEqual(byContent.matches.map((item) => item.path).sort(), ['README', 'reports/meeting.docx', 'reports/plan.md']);
  assert.equal(byContent.matches.every((item) => item.matchedIn === 'content'), true);
  assert.equal(byContent.matches.every((item) => String(item.snippet).includes('十二月完成验收')), true);
});

test('搜索不跟随符号链接、不进入隐藏目录，并拒绝越界与多根歧义', async () => {
  const base = await tempDir('fence');
  const first = path.join(base, 'first');
  const second = path.join(base, 'second');
  const outside = path.join(base, 'outside');
  await fs.mkdir(first);
  await fs.mkdir(second);
  await fs.mkdir(outside);
  await fs.mkdir(path.join(first, '.hidden'));
  await fs.writeFile(path.join(first, '.hidden', 'secret.txt'), 'needle private', 'utf8');
  await fs.writeFile(path.join(outside, 'outside.txt'), 'needle outside', 'utf8');
  try {
    await fs.symlink(outside, path.join(first, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
  }
  const auth = classifyAuthorizedPaths([first, second]);

  const ambiguous = JSON.parse(await runSearchFiles(auth, JSON.stringify({ query: 'needle' }))) as {
    actualSuccess: boolean;
    failureReason: string;
  };
  assert.equal(ambiguous.actualSuccess, false);
  assert.match(ambiguous.failureReason, /多个|指定/);

  const escaped = JSON.parse(await runSearchFiles(auth, JSON.stringify({ query: 'needle', path: '../outside' }))) as {
    actualSuccess: boolean;
  };
  assert.equal(escaped.actualSuccess, false);

  const safe = JSON.parse(await runSearchFiles(auth, JSON.stringify({ query: 'needle', path: first }))) as {
    actualSuccess: boolean;
    matches: unknown[];
  };
  assert.equal(safe.actualSuccess, true);
  assert.deepEqual(safe.matches, []);
});

test('搜索达到结果上限时明确标记 truncated', async () => {
  const root = await tempDir('limit');
  await Promise.all(Array.from({ length: MAX_SEARCH_RESULTS + 5 }, (_, index) =>
    fs.writeFile(path.join(root, `needle-${String(index).padStart(2, '0')}.txt`), 'x', 'utf8')));
  const result = JSON.parse(await runSearchFiles(
    classifyAuthorizedPaths([root]),
    JSON.stringify({ query: 'needle' }),
  )) as { actualSuccess: boolean; matches: unknown[]; truncated: boolean };
  assert.equal(result.actualSuccess, true);
  assert.equal(result.matches.length, MAX_SEARCH_RESULTS);
  assert.equal(result.truncated, true);
});

test('搜索收到取消信号后停止，不把取消伪装成普通失败', async () => {
  const root = await tempDir('cancel');
  await fs.writeFile(path.join(root, 'notes.txt'), 'needle', 'utf8');
  const controller = new AbortController();
  const reason = new Error('owner cancelled');
  controller.abort(reason);
  await assert.rejects(
    runSearchFiles(classifyAuthorizedPaths([root]), JSON.stringify({ query: 'needle' }), controller.signal),
    reason,
  );
});

test('Talk 仅在授权文件夹时暴露 search_files，并记录真实搜索执行', async () => {
  const base = await tempDir('talk');
  const folder = path.join(base, 'workspace');
  const pkgDir = path.join(base, 'pkg');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'notes.md'), '交付口径：保留真实回读。', 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkProfessionals: [],
    talkChat: scriptedChat([
      async ({ tools }) => {
        assert.equal(tools?.some((item) => item.function.name === 'search_files'), true);
        return {
          text: '',
          toolCalls: [{ id: 'search', name: 'search_files', arguments: JSON.stringify({ query: '真实回读' }) }],
        };
      },
      async ({ messages }) => {
        const payload = String(messages.filter((item) => item.role === 'tool').pop()?.content || '');
        assert.match(payload, /actualSuccess":true/);
        assert.match(payload, /notes\.md/);
        assert.match(payload, /真实回读/);
        return { text: '已在 notes.md 中找到“真实回读”。' };
      },
      async ({ messages, tools }) => {
        assert.deepEqual(tools, []);
        assert.match(String(messages.at(-1)?.content || ''), /search_files \| ok/);
        return { text: '已在 notes.md 中找到“真实回读”。' };
      },
    ]),
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '搜索', targetDir: pkgDir });
  const result = await bus.invoke('talk', { text: '帮我找包含“真实回读”的文件。', contextPaths: [folder] });
  assert.match(String(result.view.turns.at(-1)?.text || ''), /notes\.md/);
  const thread = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as {
    executions: Array<{ capabilityId: string; ok: boolean }>;
  };
  assert.deepEqual(thread.executions.map((item) => `${item.capabilityId}:${item.ok}`), ['search_files:true']);
  await runtime.stop();
});

test('只授权单文件时不暴露目录搜索能力', async () => {
  const base = await tempDir('single');
  const pkgDir = path.join(base, 'pkg');
  const file = path.join(base, 'one.txt');
  await fs.writeFile(file, 'one', 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkProfessionals: [],
    talkChat: async ({ tools }) => {
      assert.equal(tools?.some((item) => item.function.name === 'search_files'), false);
      return { text: '当前只有单文件读取授权。' };
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '单文件', targetDir: pkgDir });
  await bus.invoke('talk', { text: '看看这个文件。', contextPaths: [file] });
  await runtime.stop();
});
