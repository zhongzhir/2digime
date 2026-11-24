import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTalkTurn } from '../loop';
import { emptyThread } from '../store';
import {
  classifyAuthorizedPaths,
  editAuthorizedTextFile,
  rollbackAuthorizedTextFile,
} from '../mechanical-tools';

async function tempDir(label: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dm-text-edit-${label}-`));
}

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

test('Talk 只在授权文件夹中暴露 edit/rollback，先读后精确修改并保存可核对备份', async () => {
  const root = await tempDir('talk-success');
  const target = path.join(root, 'note.txt');
  const original = '第一行\n旧称呼出现一次\n最后一行\n';
  await fs.writeFile(target, original, 'utf8');
  let round = 0;
  const first = await runTalkTurn({
    thread: emptyThread(new Date().toISOString()),
    userText: '把旧称呼改成新称呼',
    selfContext: '',
    agents: [],
    workRoot: root,
    contextPaths: [root],
    writeFolders: [root],
    now: new Date().toISOString(),
    chat: async ({ tools, messages }) => {
      assert.equal(tools?.some((tool) => tool.function.name === 'edit_file'), true);
      assert.equal(tools?.some((tool) => tool.function.name === 'rollback_file'), true);
      if (round++ === 0) {
        return {
          text: '',
          toolCalls: [
            { id: 'read', name: 'read_file', arguments: JSON.stringify({ path: target }) },
            {
              id: 'edit',
              name: 'edit_file',
              arguments: JSON.stringify({
                path: target,
                replacements: [{ from: '旧称呼', to: '新称呼', expectedCount: 1 }],
              }),
            },
          ],
        };
      }
      const editResult = String(messages.filter((message) => message.role === 'tool').at(-1)?.content || '');
      assert.match(editResult, /"rollbackAvailable":true/);
      assert.match(editResult, /"before":"旧称呼"/);
      return { text: '已修改并核对。' };
    },
  });

  assert.equal(await fs.readFile(target, 'utf8'), original.replace('旧称呼', '新称呼'));
  const edit = first.thread.executions.find((exec) => exec.capabilityId === 'edit_file' && exec.ok);
  assert.ok(edit?.safeDetail);
  const detail = JSON.parse(edit.safeDetail) as { backupPath: string; beforeSha256: string; afterSha256: string };
  assert.equal(await fs.readFile(detail.backupPath, 'utf8'), original);
  assert.equal(detail.beforeSha256, sha256(original));
  assert.equal(detail.afterSha256, sha256(original.replace('旧称呼', '新称呼')));
});

test('edit_file 没有本轮 read_file 时拒绝且不改盘', async () => {
  const root = await tempDir('read-required');
  const target = path.join(root, 'note.txt');
  await fs.writeFile(target, '原文', 'utf8');
  let round = 0;
  const result = await runTalkTurn({
    thread: emptyThread(new Date().toISOString()),
    userText: '修改它',
    selfContext: '',
    agents: [],
    workRoot: root,
    writeFolders: [root],
    now: new Date().toISOString(),
    chat: async () => round++ === 0
      ? { text: '', toolCalls: [{ id: 'edit', name: 'edit_file', arguments: JSON.stringify({ path: target, replacements: [{ from: '原文', to: '新文', expectedCount: 1 }] }) }] }
      : { text: '没有修改。' },
  });
  assert.equal(await fs.readFile(target, 'utf8'), '原文');
  assert.equal(result.thread.executions.some((exec) => exec.capabilityId === 'edit_file' && !exec.ok && /先用 read_file/.test(exec.failureReason || '')), true);
});

test('整批替换按同一原文预检，拒绝次数不符和重叠，不产生备份', async () => {
  const root = await tempDir('preflight');
  const target = path.join(root, 'note.txt');
  await fs.writeFile(target, '甲乙甲', 'utf8');
  const result = await editAuthorizedTextFile({
    auth: classifyAuthorizedPaths([root]),
    args: { path: target, replacements: [{ from: '甲', to: '乙', expectedCount: 1 }] },
    expectedCurrentSha256: sha256('甲乙甲'),
    backupRoot: path.join(root, '.backups'),
    operationId: 'count-mismatch',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /实际出现 2 次/);
  assert.equal(await fs.readFile(target, 'utf8'), '甲乙甲');
  await assert.rejects(fs.stat(path.join(root, '.backups', 'count-mismatch')));

  await fs.writeFile(target, '甲乙', 'utf8');
  const overlapping = await editAuthorizedTextFile({
    auth: classifyAuthorizedPaths([root]),
    args: {
      path: target,
      replacements: [
        { from: '甲乙', to: '第一项', expectedCount: 1 },
        { from: '乙', to: '第二项', expectedCount: 1 },
      ],
    },
    expectedCurrentSha256: sha256('甲乙'),
    backupRoot: path.join(root, '.backups'),
    operationId: 'overlap',
  });
  assert.equal(overlapping.ok, false);
  assert.match(overlapping.reason || '', /互相重叠/);
  assert.equal(await fs.readFile(target, 'utf8'), '甲乙');
  await assert.rejects(fs.stat(path.join(root, '.backups', 'overlap')));
});

test('文本编辑拒绝无效 UTF-8 和授权根内符号链接', async (t) => {
  const root = await tempDir('encoding-symlink');
  const binary = path.join(root, 'binary.txt');
  await fs.writeFile(binary, Buffer.from([0xff, 0xfe, 0x00, 0x61]));
  const invalid = await editAuthorizedTextFile({
    auth: classifyAuthorizedPaths([root]),
    args: { path: binary, replacements: [{ from: 'a', to: 'b', expectedCount: 1 }] },
    expectedCurrentSha256: sha256(await fs.readFile(binary)),
    backupRoot: path.join(root, '.backups'),
    operationId: 'invalid-utf8',
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.reason || '', /UTF-8|二进制/);

  const outside = await tempDir('outside');
  const outsideFile = path.join(outside, 'outside.txt');
  const linked = path.join(root, 'linked.txt');
  await fs.writeFile(outsideFile, '不能修改', 'utf8');
  try {
    await fs.symlink(outsideFile, linked, 'file');
  } catch (err) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes((err as NodeJS.ErrnoException).code || '')) {
      t.skip('当前 Windows 环境不允许创建测试符号链接');
      return;
    }
    throw err;
  }
  const escaped = await editAuthorizedTextFile({
    auth: classifyAuthorizedPaths([root]),
    args: { path: linked, replacements: [{ from: '不能', to: '错误', expectedCount: 1 }] },
    expectedCurrentSha256: sha256('不能修改'),
    backupRoot: path.join(root, '.backups'),
    operationId: 'symlink',
  });
  assert.equal(escaped.ok, false);
  assert.match(escaped.reason || '', /符号链接/);
  assert.equal(await fs.readFile(outsideFile, 'utf8'), '不能修改');
});

test('文件在读取后变化时拒绝覆盖后来内容', async () => {
  const root = await tempDir('stale-read');
  const target = path.join(root, 'note.txt');
  await fs.writeFile(target, '读取时版本', 'utf8');
  const expected = sha256('读取时版本');
  await fs.writeFile(target, '后来版本', 'utf8');
  const result = await editAuthorizedTextFile({
    auth: classifyAuthorizedPaths([root]),
    args: { path: target, replacements: [{ from: '读取时', to: '已经', expectedCount: 1 }] },
    expectedCurrentSha256: expected,
    backupRoot: path.join(root, '.backups'),
    operationId: 'stale',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /读取后已发生变化/);
  assert.equal(await fs.readFile(target, 'utf8'), '后来版本');
});

test('rollback_file 仅在目标仍等于编辑后 SHA 时恢复，并拒绝重复回滚', async () => {
  const root = await tempDir('rollback');
  const target = path.join(root, 'note.txt');
  await fs.writeFile(target, '原始文字', 'utf8');
  let editRound = 0;
  const edited = await runTalkTurn({
    thread: emptyThread(new Date().toISOString()),
    userText: '修改文字', selfContext: '', agents: [], workRoot: root, contextPaths: [root], writeFolders: [root], now: new Date().toISOString(),
    chat: async () => editRound++ === 0
      ? { text: '', toolCalls: [
          { id: 'r', name: 'read_file', arguments: JSON.stringify({ path: target }) },
          { id: 'e', name: 'edit_file', arguments: JSON.stringify({ path: target, replacements: [{ from: '原始', to: '修改后', expectedCount: 1 }] }) },
        ] }
      : { text: '完成。' },
  });
  let rollbackRound = 0;
  const rolled = await runTalkTurn({
    thread: edited.thread,
    userText: '撤销刚才修改', selfContext: '', agents: [], workRoot: root, writeFolders: [root], now: new Date().toISOString(),
    chat: async () => rollbackRound++ === 0
      ? { text: '', toolCalls: [{ id: 'rb', name: 'rollback_file', arguments: JSON.stringify({ path: target }) }] }
      : { text: '已撤销。' },
  });
  assert.equal(await fs.readFile(target, 'utf8'), '原始文字');
  assert.equal(rolled.thread.executions.some((exec) => exec.capabilityId === 'rollback_file' && exec.ok), true);

  let repeatRound = 0;
  const repeated = await runTalkTurn({
    thread: rolled.thread,
    userText: '再撤销一次', selfContext: '', agents: [], workRoot: root, writeFolders: [root], now: new Date().toISOString(),
    chat: async () => repeatRound++ === 0
      ? { text: '', toolCalls: [{ id: 'rb2', name: 'rollback_file', arguments: JSON.stringify({ path: target }) }] }
      : { text: '没有可撤销修改。' },
  });
  assert.equal(repeated.thread.executions.some((exec) => exec.capabilityId === 'rollback_file' && !exec.ok && /没有找到/.test(exec.failureReason || '')), true);
  assert.equal(await fs.readFile(target, 'utf8'), '原始文字');
});

test('回滚在文件被后来修改时拒绝，不覆盖后来内容', async () => {
  const root = await tempDir('rollback-stale');
  const target = path.join(root, 'note.txt');
  const backupRoot = path.join(root, '.backups');
  await fs.writeFile(target, '原文', 'utf8');
  const edited = await editAuthorizedTextFile({
    auth: classifyAuthorizedPaths([root]),
    args: { path: target, replacements: [{ from: '原文', to: '编辑版', expectedCount: 1 }] },
    expectedCurrentSha256: sha256('原文'),
    backupRoot,
    operationId: 'edit',
  });
  assert.equal(edited.ok, true);
  await fs.writeFile(target, '用户后来又改了', 'utf8');
  const rolled = await rollbackAuthorizedTextFile({
    auth: classifyAuthorizedPaths([root]),
    path: target,
    expectedCurrentSha256: edited.afterSha256 || '',
    backupPath: edited.backupPath || '',
    expectedBackupSha256: edited.backupSha256 || '',
    backupRoot,
    operationId: 'rollback',
  });
  assert.equal(rolled.ok, false);
  assert.match(rolled.reason || '', /又发生了变化/);
  assert.equal(await fs.readFile(target, 'utf8'), '用户后来又改了');
});

test('write_file 不再覆盖已存在文件', async () => {
  const root = await tempDir('write-existing');
  const target = path.join(root, 'note.txt');
  await fs.writeFile(target, '保留内容', 'utf8');
  let round = 0;
  const result = await runTalkTurn({
    thread: emptyThread(new Date().toISOString()),
    userText: '直接覆盖', selfContext: '', agents: [], workRoot: root, writeFolders: [root], now: new Date().toISOString(),
    chat: async () => round++ === 0
      ? { text: '', toolCalls: [{ id: 'w', name: 'write_file', arguments: JSON.stringify({ relativePath: 'note.txt', content: '不应写入' }) }] }
      : { text: '没有覆盖。' },
  });
  assert.equal(await fs.readFile(target, 'utf8'), '保留内容');
  assert.equal(result.thread.executions.some((exec) => exec.capabilityId === 'write_file' && !exec.ok && /只创建新文件/.test(exec.failureReason || '')), true);
});
