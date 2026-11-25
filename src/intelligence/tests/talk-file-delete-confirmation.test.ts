import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTalkTurn } from '../loop';
import { classifyAuthorizedPaths, deleteAuthorizedFile } from '../mechanical-tools';
import { emptyThread } from '../store';
import type { TalkThread } from '../types';

async function tempDir(label: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-delete-${label}-`));
}

function hash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function deletePreview(thread: TalkThread): {
  confirmationToken: string;
  target: string;
  sha256: string;
} {
  const exec = [...thread.executions].reverse().find((item) => item.capabilityId === 'prepare_delete_file' && item.ok);
  assert.ok(exec?.safeDetail);
  return JSON.parse(exec.safeDetail) as { confirmationToken: string; target: string; sha256: string };
}

async function prepareDeletion(root: string, target: string): Promise<TalkThread> {
  let round = 0;
  const result = await runTalkTurn({
    thread: emptyThread(new Date().toISOString()),
    userText: `删除 ${path.basename(target)}`,
    selfContext: '',
    agents: [],
    workRoot: root,
    contextPaths: [root],
    writeFolders: [root],
    now: new Date().toISOString(),
    chat: async ({ tools, messages }) => {
      if (round++ === 0) {
        assert.equal(tools?.some((tool) => tool.function.name === 'prepare_delete_file'), true);
        assert.equal(tools?.some((tool) => tool.function.name === 'delete_file'), true);
        return {
          text: '',
          toolCalls: [{ id: 'prepare', name: 'prepare_delete_file', arguments: JSON.stringify({ path: target }) }],
        };
      }
      const payload = String(messages.filter((message) => message.role === 'tool').at(-1)?.content || '');
      assert.match(payload, /"confirmationRequired":true/);
      assert.match(payload, new RegExp(path.basename(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return { text: `将删除“${path.basename(target)}”。请确认是否继续。` };
    },
  });
  return result.thread;
}

async function confirmDeletion(root: string, thread: TalkThread, token: string): Promise<TalkThread> {
  let round = 0;
  const result = await runTalkTurn({
    thread,
    userText: '确认删除',
    selfContext: '',
    agents: [],
    workRoot: root,
    contextPaths: [root],
    writeFolders: [root],
    now: new Date().toISOString(),
    chat: async () => round++ === 0
      ? { text: '', toolCalls: [{ id: 'delete', name: 'delete_file', arguments: JSON.stringify({ confirmationToken: token }) }] }
      : { text: '已按确认结果处理。' },
  });
  return result.thread;
}

test('prepare_delete_file 只锁定文件并请求下一轮确认，不立即删除', async () => {
  const root = await tempDir('prepare');
  const target = path.join(root, 'note.txt');
  await fs.writeFile(target, '待删除内容', 'utf8');
  const thread = await prepareDeletion(root, target);
  assert.equal(await fs.readFile(target, 'utf8'), '待删除内容');
  const preview = deletePreview(thread);
  assert.equal(preview.target, target);
  assert.equal(preview.sha256, hash('待删除内容'));
  assert.equal(thread.executions.some((item) => item.capabilityId === 'delete_file'), false);
});

test('紧接下一条用户确认后删除，且受控恢复副本与原文件哈希一致', async () => {
  const root = await tempDir('success');
  const target = path.join(root, 'note.txt');
  await fs.writeFile(target, '需要删除但可恢复', 'utf8');
  const prepared = await prepareDeletion(root, target);
  const preview = deletePreview(prepared);
  const deleted = await confirmDeletion(root, prepared, preview.confirmationToken);
  await assert.rejects(fs.stat(target), (err: NodeJS.ErrnoException) => err.code === 'ENOENT');
  const exec = [...deleted.executions].reverse().find((item) => item.capabilityId === 'delete_file' && item.ok);
  assert.ok(exec?.safeDetail);
  const detail = JSON.parse(exec.safeDetail) as { backupPath: string; backupSha256: string; sha256: string };
  assert.equal(await fs.readFile(detail.backupPath, 'utf8'), '需要删除但可恢复');
  assert.equal(detail.backupSha256, hash('需要删除但可恢复'));
  assert.equal(detail.sha256, detail.backupSha256);
});

test('同一用户轮次即使模型拿到令牌也不能立刻删除', async () => {
  const root = await tempDir('same-turn');
  const target = path.join(root, 'note.txt');
  await fs.writeFile(target, '仍需本人确认', 'utf8');
  let round = 0;
  let token = '';
  const result = await runTalkTurn({
    thread: emptyThread(new Date().toISOString()),
    userText: '删除文件', selfContext: '', agents: [], workRoot: root, contextPaths: [root], writeFolders: [root], now: new Date().toISOString(),
    chat: async ({ messages }) => {
      if (round++ === 0) {
        return { text: '', toolCalls: [{ id: 'prepare', name: 'prepare_delete_file', arguments: JSON.stringify({ path: target }) }] };
      }
      if (round === 2) {
        const payload = JSON.parse(String(messages.filter((message) => message.role === 'tool').at(-1)?.content || '{}')) as { confirmationToken?: string };
        token = String(payload.confirmationToken || '');
        return { text: '', toolCalls: [{ id: 'delete', name: 'delete_file', arguments: JSON.stringify({ confirmationToken: token }) }] };
      }
      return { text: '仍在等待你的下一条确认。' };
    },
  });
  assert.ok(token);
  assert.equal(await fs.readFile(target, 'utf8'), '仍需本人确认');
  assert.equal(result.thread.executions.some((item) => item.capabilityId === 'delete_file' && !item.ok && /紧接上一轮/.test(item.failureReason || '')), true);
});

test('确认后文件内容发生变化时拒绝删除后来内容', async () => {
  const root = await tempDir('changed');
  const target = path.join(root, 'note.txt');
  await fs.writeFile(target, '确认时内容', 'utf8');
  const prepared = await prepareDeletion(root, target);
  const preview = deletePreview(prepared);
  await fs.writeFile(target, '后来新内容', 'utf8');
  const result = await confirmDeletion(root, prepared, preview.confirmationToken);
  assert.equal(await fs.readFile(target, 'utf8'), '后来新内容');
  assert.equal(result.executions.some((item) => item.capabilityId === 'delete_file' && !item.ok && /确认后发生了变化/.test(item.failureReason || '')), true);
});

test('确认后同内容文件被替换时仍拒绝删除', async () => {
  const root = await tempDir('replaced-same-content');
  const target = path.join(root, 'note.txt');
  await fs.writeFile(target, '相同内容', 'utf8');
  const prepared = await prepareDeletion(root, target);
  const preview = deletePreview(prepared);
  const changedTime = new Date(Date.now() + 60_000);
  await fs.writeFile(target, '相同内容', 'utf8');
  await fs.utimes(target, changedTime, changedTime);
  const result = await confirmDeletion(root, prepared, preview.confirmationToken);
  assert.equal(await fs.readFile(target, 'utf8'), '相同内容');
  assert.equal(result.executions.some((item) => item.capabilityId === 'delete_file' && !item.ok && /确认后发生了变化/.test(item.failureReason || '')), true);
});

test('确认令牌跨过一轮普通对话后失效', async () => {
  const root = await tempDir('stale');
  const target = path.join(root, 'note.txt');
  await fs.writeFile(target, '不能隔轮删除', 'utf8');
  const prepared = await prepareDeletion(root, target);
  const preview = deletePreview(prepared);
  const interposed = await runTalkTurn({
    thread: prepared,
    userText: '先等等，我问个别的问题', selfContext: '', agents: [], workRoot: root, contextPaths: [root], writeFolders: [root], now: new Date().toISOString(),
    chat: async () => ({ text: '好的，删除尚未执行。' }),
  });
  const attempted = await confirmDeletion(root, interposed.thread, preview.confirmationToken);
  assert.equal(await fs.readFile(target, 'utf8'), '不能隔轮删除');
  assert.equal(attempted.executions.some((item) => item.capabilityId === 'delete_file' && !item.ok && /无效、已使用或不是紧接上一轮/.test(item.failureReason || '')), true);
});

test('已使用令牌不能重复删除后来创建的同名文件', async () => {
  const root = await tempDir('replay');
  const target = path.join(root, 'note.txt');
  await fs.writeFile(target, '第一版', 'utf8');
  const prepared = await prepareDeletion(root, target);
  const preview = deletePreview(prepared);
  const deleted = await confirmDeletion(root, prepared, preview.confirmationToken);
  await fs.writeFile(target, '后来同名文件', 'utf8');
  const replayed = await confirmDeletion(root, deleted, preview.confirmationToken);
  assert.equal(await fs.readFile(target, 'utf8'), '后来同名文件');
  assert.equal(replayed.executions.filter((item) => item.capabilityId === 'delete_file' && item.ok).length, 1);
});

test('目录、单文件只读授权和多根歧义均不能绕过删除边界', async () => {
  const rootA = await tempDir('root-a');
  const rootB = await tempDir('root-b');
  const targetA = path.join(rootA, 'same.txt');
  const targetB = path.join(rootB, 'same.txt');
  await fs.writeFile(targetA, 'A', 'utf8');
  await fs.writeFile(targetB, 'B', 'utf8');
  let capturedNames: string[] = [];
  await runTalkTurn({
    thread: emptyThread(new Date().toISOString()), userText: '看看文件', selfContext: '', agents: [], workRoot: rootA,
    contextPaths: [targetA], now: new Date().toISOString(),
    chat: async ({ tools }) => {
      capturedNames = (tools || []).map((tool) => tool.function.name);
      return { text: '只读。' };
    },
  });
  assert.equal(capturedNames.includes('prepare_delete_file'), false);
  assert.equal(capturedNames.includes('delete_file'), false);

  let round = 0;
  const ambiguous = await runTalkTurn({
    thread: emptyThread(new Date().toISOString()), userText: '删除 same.txt', selfContext: '', agents: [], workRoot: rootA,
    contextPaths: [rootA, rootB], writeFolders: [rootA, rootB], now: new Date().toISOString(),
    chat: async () => round++ === 0
      ? { text: '', toolCalls: [{ id: 'prepare', name: 'prepare_delete_file', arguments: JSON.stringify({ path: 'same.txt' }) }] }
      : { text: '没有删除。' },
  });
  assert.equal(ambiguous.thread.executions.some((item) => item.capabilityId === 'prepare_delete_file' && !item.ok && /多个已授权目录/.test(item.failureReason || '')), true);
  assert.equal(await fs.readFile(targetA, 'utf8'), 'A');
  assert.equal(await fs.readFile(targetB, 'utf8'), 'B');

  let directoryRound = 0;
  const directory = await runTalkTurn({
    thread: emptyThread(new Date().toISOString()), userText: '删除目录', selfContext: '', agents: [], workRoot: rootA,
    contextPaths: [rootA], writeFolders: [rootA], now: new Date().toISOString(),
    chat: async () => directoryRound++ === 0
      ? { text: '', toolCalls: [{ id: 'prepare', name: 'prepare_delete_file', arguments: JSON.stringify({ path: rootA }) }] }
      : { text: '目录不能删除。' },
  });
  assert.equal(directory.thread.executions.some((item) => item.capabilityId === 'prepare_delete_file' && !item.ok && /普通文件/.test(item.failureReason || '')), true);
});

test('删除准备拒绝通过目录符号链接逃到授权根外', async (t) => {
  const root = await tempDir('symlink-root');
  const outside = await tempDir('symlink-outside');
  const outsideFile = path.join(outside, 'outside.txt');
  const linkedDir = path.join(root, 'linked');
  await fs.writeFile(outsideFile, '不能删除', 'utf8');
  try {
    await fs.symlink(outside, linkedDir, 'junction');
  } catch (err) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes((err as NodeJS.ErrnoException).code || '')) {
      t.skip('当前 Windows 环境不允许创建测试目录链接');
      return;
    }
    throw err;
  }
  try {
    let round = 0;
    const result = await runTalkTurn({
      thread: emptyThread(new Date().toISOString()), userText: '删除链接里的文件', selfContext: '', agents: [], workRoot: root,
      contextPaths: [root], writeFolders: [root], now: new Date().toISOString(),
      chat: async () => round++ === 0
        ? { text: '', toolCalls: [{ id: 'prepare', name: 'prepare_delete_file', arguments: JSON.stringify({ path: path.join(linkedDir, 'outside.txt') }) }] }
        : { text: '没有删除。' },
    });
    assert.equal(result.thread.executions.some((item) => item.capabilityId === 'prepare_delete_file' && !item.ok), true);
    assert.equal(result.thread.executions.some((item) => item.capabilityId === 'prepare_delete_file' && item.ok), false);
    assert.equal(await fs.readFile(outsideFile, 'utf8'), '不能删除');
  } finally {
    await fs.unlink(linkedDir).catch(() => undefined);
  }
});

test('删除动作在取消信号下保留目标文件', async () => {
  const root = await tempDir('cancel');
  const target = path.join(root, 'note.txt');
  await fs.writeFile(target, '取消后保留', 'utf8');
  const controller = new AbortController();
  controller.abort();
  const stat = await fs.stat(target);
  const result = await deleteAuthorizedFile({
    auth: classifyAuthorizedPaths([root]),
    args: { path: target },
    expectedSha256: hash('取消后保留'),
    expectedSize: stat.size,
    expectedMtimeMs: stat.mtimeMs,
    backupRoot: path.join(root, '.deletions'),
    operationId: 'cancelled',
    signal: controller.signal,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /aborted/);
  assert.equal(await fs.readFile(target, 'utf8'), '取消后保留');
});
