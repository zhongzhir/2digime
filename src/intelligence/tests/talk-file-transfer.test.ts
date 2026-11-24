import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { talkThreadFilePath } from '../store';
import {
  classifyAuthorizedPaths,
  copyAuthorizedFile,
  moveAuthorizedFile,
} from '../mechanical-tools';
import type { TalkChatFn } from '../types';

async function tempDir(label: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-transfer-${label}-`));
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function scriptedChat(replies: TalkChatFn[]): TalkChatFn {
  let index = 0;
  return async (input) => {
    const reply = replies[index++];
    if (!reply) throw new Error('talk chat script exhausted');
    return reply(input);
  };
}

test('授权根内复制、移动与重命名均真实回读 SHA-256，且不覆盖已有目标', async () => {
  const root = await tempDir('mechanical');
  const source = path.join(root, 'source.txt');
  const copied = path.join(root, 'copied.txt');
  const renamed = path.join(root, 'renamed.txt');
  const content = 'owner authorized content\n';
  await fs.writeFile(source, content, 'utf8');
  const auth = classifyAuthorizedPaths([root]);

  const copy = await copyAuthorizedFile(auth, { sourcePath: 'source.txt', destinationPath: 'copied.txt' });
  assert.equal(copy.ok, true);
  assert.equal(copy.sha256, hash(content));
  assert.equal(await fs.readFile(source, 'utf8'), content);
  assert.equal(await fs.readFile(copied, 'utf8'), content);

  const move = await moveAuthorizedFile(auth, { sourcePath: 'copied.txt', destinationPath: 'renamed.txt' });
  assert.equal(move.ok, true);
  assert.equal(move.sha256, hash(content));
  await assert.rejects(fs.stat(copied), { code: 'ENOENT' });
  assert.equal(await fs.readFile(renamed, 'utf8'), content);

  const refused = await copyAuthorizedFile(auth, { sourcePath: 'source.txt', destinationPath: 'renamed.txt' });
  assert.equal(refused.ok, false);
  assert.match(String(refused.failureReason), /已存在|覆盖/);
  assert.equal(await fs.readFile(renamed, 'utf8'), content);
});

test('文件转移拒绝越出授权根和符号链接逃逸', async () => {
  const base = await tempDir('fence');
  const root = path.join(base, 'allowed');
  const outside = path.join(base, 'outside');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(root, 'inside.txt'), 'inside', 'utf8');
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8');
  const auth = classifyAuthorizedPaths([root]);

  const escaped = await copyAuthorizedFile(auth, { sourcePath: '../outside/secret.txt', destinationPath: 'leak.txt' });
  assert.equal(escaped.ok, false);
  assert.equal(await fs.readFile(path.join(outside, 'secret.txt'), 'utf8'), 'secret');

  const link = path.join(root, 'linked');
  try {
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
    throw err;
  }
  const linked = await copyAuthorizedFile(auth, { sourcePath: 'linked/secret.txt', destinationPath: 'leak.txt' });
  assert.equal(linked.ok, false);
  assert.match(String(linked.failureReason), /符号链接|授权目录/);
  await assert.rejects(fs.stat(path.join(root, 'leak.txt')), { code: 'ENOENT' });
});

test('多个授权根时必须明确选择根，且不能跨根转移', async () => {
  const base = await tempDir('roots');
  const first = path.join(base, 'first');
  const second = path.join(base, 'second');
  await fs.mkdir(first);
  await fs.mkdir(second);
  await fs.writeFile(path.join(first, 'source.txt'), 'first', 'utf8');
  const auth = classifyAuthorizedPaths([first, second]);

  const ambiguous = await copyAuthorizedFile(auth, { sourcePath: 'source.txt', destinationPath: 'copy.txt' });
  assert.equal(ambiguous.ok, false);
  assert.match(String(ambiguous.failureReason), /多个|root/);

  const crossRoot = await moveAuthorizedFile(auth, {
    sourcePath: path.join(first, 'source.txt'),
    destinationPath: path.join(second, 'moved.txt'),
    root: first,
  });
  assert.equal(crossRoot.ok, false);
  assert.match(String(crossRoot.failureReason), /超出授权目录/);
  assert.equal(await fs.readFile(path.join(first, 'source.txt'), 'utf8'), 'first');
  await assert.rejects(fs.stat(path.join(second, 'moved.txt')), { code: 'ENOENT' });
});

test('Talk 仅在授权文件夹时暴露并执行 copy_file / move_file', async () => {
  const base = await tempDir('talk');
  const folder = path.join(base, 'workspace');
  const pkgDir = path.join(base, 'pkg');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'source.txt'), 'same bytes', 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkProfessionals: [],
    talkChat: scriptedChat([
      async ({ tools }) => {
        const names = (tools || []).map((item) => item.function.name);
        assert.equal(names.includes('copy_file'), true);
        assert.equal(names.includes('move_file'), true);
        return { text: '', toolCalls: [{ id: 'copy', name: 'copy_file', arguments: JSON.stringify({ sourcePath: 'source.txt', destinationPath: 'copy.txt' }) }] };
      },
      async ({ messages }) => {
        assert.match(String(messages.filter((item) => item.role === 'tool').pop()?.content || ''), /actualSuccess":true/);
        return { text: '', toolCalls: [{ id: 'move', name: 'move_file', arguments: JSON.stringify({ sourcePath: 'copy.txt', destinationPath: 'renamed.txt' }) }] };
      },
      async ({ messages }) => {
        assert.match(String(messages.filter((item) => item.role === 'tool').pop()?.content || ''), /actualSuccess":true/);
        return { text: '已经复制后重命名，并完成哈希核对。' };
      },
    ]),
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '转移', targetDir: pkgDir });
  await bus.invoke('talk', { text: '复制 source.txt，再把副本重命名为 renamed.txt。', contextPaths: [folder] });
  assert.equal(await fs.readFile(path.join(folder, 'source.txt'), 'utf8'), 'same bytes');
  assert.equal(await fs.readFile(path.join(folder, 'renamed.txt'), 'utf8'), 'same bytes');
  await assert.rejects(fs.stat(path.join(folder, 'copy.txt')), { code: 'ENOENT' });
  const thread = JSON.parse(await fs.readFile(talkThreadFilePath(pkgDir), 'utf8')) as { executions: Array<{ capabilityId: string; ok: boolean; outputPath?: string }> };
  assert.deepEqual(thread.executions.map((item) => `${item.capabilityId}:${item.ok}`), ['copy_file:true', 'move_file:true']);
  assert.equal(thread.executions[1]?.outputPath, path.join(folder, 'renamed.txt'));
  await runtime.stop();
});

test('只授权单文件时不暴露目录级复制与移动能力', async () => {
  const base = await tempDir('single');
  const pkgDir = path.join(base, 'pkg');
  const file = path.join(base, 'one.txt');
  await fs.writeFile(file, 'one', 'utf8');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    talkProfessionals: [],
    talkChat: async ({ tools }) => {
      const names = (tools || []).map((item) => item.function.name);
      assert.equal(names.includes('copy_file'), false);
      assert.equal(names.includes('move_file'), false);
      return { text: '当前只有这个文件的读取授权。' };
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '单文件', targetDir: pkgDir });
  await bus.invoke('talk', { text: '看看这个文件。', contextPaths: [file] });
  await runtime.stop();
});
