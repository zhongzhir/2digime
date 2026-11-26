import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractFile } from '../../infrastructure/extract';
import { runTalkTurn } from '../loop';
import { emptyThread } from '../store';
import type { TalkThread } from '../types';
import type { ChatMessage, ChatToolDefinition } from '../../infrastructure/model-http';

type ToolRound = (input: { messages: ChatMessage[]; tools?: ChatToolDefinition[] }) => {
  text: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
};

function call(id: string, name: string, args: Record<string, unknown>): ReturnType<ToolRound> {
  return { text: '', toolCalls: [{ id, name, arguments: JSON.stringify(args) }] };
}

function latestExec(thread: TalkThread, capabilityId: string) {
  return [...thread.executions].reverse().find((item) => item.capabilityId === capabilityId);
}

test('Slice 2B：授权文件工作区固定 20 项退出门', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-file-gate-'));
  const workRoot = path.join(base, 'package');
  const root = path.join(base, 'workspace');
  const secondRoot = path.join(base, 'workspace-b');
  const outside = path.join(base, 'outside');
  await Promise.all([
    fs.mkdir(workRoot, { recursive: true }),
    fs.mkdir(root, { recursive: true }),
    fs.mkdir(secondRoot, { recursive: true }),
    fs.mkdir(outside, { recursive: true }),
  ]);
  await fs.writeFile(path.join(root, 'notes.md'), '# 项目\n\n真实回读是验收依据。\n', 'utf8');
  await fs.writeFile(path.join(root, 'multi.txt'), '甲乙丙', 'utf8');
  await fs.writeFile(path.join(root, 'delete-me.txt'), '删除前必须可恢复', 'utf8');
  await fs.writeFile(path.join(outside, 'secret.txt'), '未授权内容', 'utf8');
  await fs.writeFile(path.join(secondRoot, 'other.txt'), '第二授权根', 'utf8');

  let thread = emptyThread(new Date().toISOString());
  let seq = 0;
  const turn = async (text: string, rounds: ToolRound[], roots = [root]): Promise<TalkThread> => {
    let index = 0;
    const result = await runTalkTurn({
      thread,
      userText: text,
      selfContext: '',
      agents: [],
      workRoot,
      contextPaths: roots,
      writeFolders: roots,
      now: new Date(Date.now() + seq++ * 1000).toISOString(),
      chat: async (input) => rounds[index++]?.(input) || { text: '已按真实工具结果处理。' },
    });
    thread = result.thread;
    return thread;
  };

  await t.test('01 列出授权目录并看到真实条目', async () => {
    await turn('列出这个工作区。', [() => call('list', 'list_directory', { path: root })]);
    const exec = latestExec(thread, 'list_directory');
    assert.equal(exec?.ok, true);
    assert.match(exec?.summary || '', /列出 \d+ 项/);
  });

  await t.test('02 读取授权目录内文本', async () => {
    await turn('读取 notes.md。', [() => call('read', 'read_file', { path: 'notes.md' })]);
    const exec = latestExec(thread, 'read_file');
    assert.equal(exec?.ok, true);
    assert.match(exec?.summary || '', /notes\.md/);
  });

  await t.test('03 按文件名搜索', async () => {
    await turn('查找文件名含 notes 的文件。', [() => call('search-name', 'search_files', { query: 'notes' })]);
    assert.equal(latestExec(thread, 'search_files')?.ok, true);
  });

  await t.test('04 按正文搜索', async () => {
    await turn('查找正文里的真实回读。', [() => call('search-body', 'search_files', { query: '真实回读' })]);
    assert.equal(latestExec(thread, 'search_files')?.ok, true);
  });

  await t.test('05 创建 Markdown 并从磁盘回读', async () => {
    await turn('创建 created.md。', [() => call('write-md', 'write_file', { relativePath: 'created.md', content: '# 新文件\n\n已落盘。\n' })]);
    assert.equal(await fs.readFile(path.join(root, 'created.md'), 'utf8'), '# 新文件\n\n已落盘。\n');
  });

  await t.test('06 创建 HTML 并从磁盘回读', async () => {
    const html = '<!doctype html><meta charset="utf-8"><title>验收</title><main>真实文件</main>';
    await turn('创建 created.html。', [() => call('write-html', 'write_file', { relativePath: 'created.html', content: html })]);
    assert.equal(await fs.readFile(path.join(root, 'created.html'), 'utf8'), html);
  });

  for (const [number, format, name] of [
    ['07', 'docx', 'report.docx'],
    ['08', 'pptx', 'briefing.pptx'],
    ['09', 'pdf', 'memo.pdf'],
  ] as const) {
    await t.test(`${number} 导出 ${format.toUpperCase()} 并真实抽取回读`, async () => {
      await turn(`导出 ${name}。`, [() => call(`export-${format}`, 'export_file', {
        format,
        relativePath: name,
        content: `# ${format.toUpperCase()} 验收\n\n授权文件工作区真实回读。`,
      })]);
      const extracted = await extractFile(path.join(root, name));
      assert.equal(extracted.status, 'ok');
      assert.match(extracted.text || '', /授权文件工作区真实回读/);
    });
  }

  await t.test('10 先读后精确编辑单处文字', async () => {
    await turn('把 created.md 的“已落盘”改为“已核验”。', [
      () => call('read-edit-one', 'read_file', { path: 'created.md' }),
      () => call('edit-one', 'edit_file', { path: 'created.md', replacements: [{ from: '已落盘', to: '已核验', expectedCount: 1 }] }),
    ]);
    assert.match(await fs.readFile(path.join(root, 'created.md'), 'utf8'), /已核验/);
  });

  await t.test('11 同一原文上精确编辑多处文字', async () => {
    await turn('把 multi.txt 的甲和丙分别替换。', [
      () => call('read-edit-many', 'read_file', { path: 'multi.txt' }),
      () => call('edit-many', 'edit_file', {
        path: 'multi.txt',
        replacements: [
          { from: '甲', to: '一', expectedCount: 1 },
          { from: '丙', to: '三', expectedCount: 1 },
        ],
      }),
    ]);
    assert.equal(await fs.readFile(path.join(root, 'multi.txt'), 'utf8'), '一乙三');
  });

  await t.test('12 撤销最近一次精确编辑', async () => {
    await turn('撤销 multi.txt 的最近修改。', [() => call('rollback', 'rollback_file', { path: 'multi.txt' })]);
    assert.equal(await fs.readFile(path.join(root, 'multi.txt'), 'utf8'), '甲乙丙');
  });

  await t.test('13 复制文件并核对两端内容', async () => {
    await turn('复制 created.md。', [() => call('copy', 'copy_file', { sourcePath: 'created.md', destinationPath: 'created-copy.md' })]);
    assert.equal(await fs.readFile(path.join(root, 'created-copy.md'), 'utf8'), await fs.readFile(path.join(root, 'created.md'), 'utf8'));
  });

  await t.test('14 移动并重命名文件', async () => {
    await turn('把副本重命名。', [() => call('move', 'move_file', { sourcePath: 'created-copy.md', destinationPath: 'renamed.md' })]);
    await assert.rejects(fs.stat(path.join(root, 'created-copy.md')), { code: 'ENOENT' });
    assert.match(await fs.readFile(path.join(root, 'renamed.md'), 'utf8'), /已核验/);
  });

  await t.test('15 删除准备只锁定目标而不修改', async () => {
    await turn('删除 delete-me.txt。', [() => call('prepare-delete', 'prepare_delete_file', { path: 'delete-me.txt' })]);
    assert.equal(await fs.readFile(path.join(root, 'delete-me.txt'), 'utf8'), '删除前必须可恢复');
    assert.equal(latestExec(thread, 'prepare_delete_file')?.ok, true);
  });

  await t.test('16 下一轮确认后删除并保留恢复副本', async () => {
    await turn('确认删除这个文件。', [({ messages }) => {
      const system = String(messages.find((message) => message.role === 'system')?.content || '');
      const token = /一次性 confirmationToken：([^\s]+)/.exec(system)?.[1];
      assert.ok(token);
      return call('delete', 'delete_file', { confirmationToken: token });
    }]);
    await assert.rejects(fs.stat(path.join(root, 'delete-me.txt')), { code: 'ENOENT' });
    const exec = latestExec(thread, 'delete_file');
    assert.equal(exec?.ok, true);
    const detail = JSON.parse(exec?.safeDetail || '{}') as { backupPath?: string };
    assert.equal(await fs.readFile(detail.backupPath || '', 'utf8'), '删除前必须可恢复');
  });

  await t.test('17 读取相邻未授权文件被拒绝', async () => {
    await turn('读取外部 secret.txt。', [() => call('read-outside', 'read_file', { path: path.join(outside, 'secret.txt') })]);
    assert.equal(latestExec(thread, 'read_file')?.ok, false);
  });

  await t.test('18 写入相邻未授权目录被拒绝', async () => {
    const target = path.join(outside, 'blocked.txt');
    await turn('写入外部目录。', [() => call('write-outside', 'write_file', { relativePath: target, content: '不得写入' })]);
    assert.equal(latestExec(thread, 'write_file')?.ok, false);
    await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  });

  await t.test('19 移动到授权根外被拒绝且源文件保留', async () => {
    await turn('把 renamed.md 移到外部目录。', [() => call('move-outside', 'move_file', { sourcePath: 'renamed.md', destinationPath: path.join(outside, 'renamed.md') })]);
    assert.equal(latestExec(thread, 'move_file')?.ok, false);
    assert.match(await fs.readFile(path.join(root, 'renamed.md'), 'utf8'), /已核验/);
  });

  await t.test('20 多授权根未明确选择时拒绝操作', async () => {
    await turn('在授权目录里搜索文件。', [() => call('search-ambiguous', 'search_files', { query: '真实' })], [root, secondRoot]);
    assert.equal(latestExec(thread, 'search_files')?.ok, false);
    assert.match(latestExec(thread, 'search_files')?.failureReason || '', /多个已授权(目录|文件夹)/);
  });
});
