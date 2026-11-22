import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendConversationRow } from '../conversation-transcript';
import {
  archiveConversationSessionSync,
  conversationSessionFilePath,
  createConversationProjectSync,
  createConversationSessionSync,
  deleteConversationSessionSync,
  listConversationSessionsSync,
  moveConversationSessionSync,
  openConversationSessionSync,
  removeConversationProjectSync,
  renameConversationProjectSync,
  renameConversationSessionSync,
  touchConversationSessionSync,
} from '../conversation-sessions';

async function tempPkg(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-conv-manage-'));
}

async function seed(pkg: string, text: string): Promise<string> {
  const s = createConversationSessionSync(pkg);
  await appendConversationRow(conversationSessionFilePath(pkg, s.id), {
    id: `turn_${s.id}`,
    role: 'user',
    text,
    at: '2026-01-01T00:00:00.000Z',
  });
  touchConversationSessionSync(pkg, { titleFromUserText: text });
  return s.id;
}

test('改名、归档、取回、项目分组都落在索引上，重新读取仍在', async () => {
  const pkg = await tempPkg();
  const a = await seed(pkg, '整理旅行计划');
  const b = await seed(pkg, '写周报');

  renameConversationSessionSync(pkg, a, '  日本旅行  ');
  assert.equal(listConversationSessionsSync(pkg).sessions.find((s) => s.id === a)!.title, '日本旅行');
  assert.throws(() => renameConversationSessionSync(pkg, a, '   '), /不能为空/);

  const project = createConversationProjectSync(pkg, '家庭事务');
  moveConversationSessionSync(pkg, a, project.id);
  archiveConversationSessionSync(pkg, b, true);

  // 模拟重启：只靠磁盘重新读取
  const listed = listConversationSessionsSync(pkg);
  assert.equal(listed.projects.length, 1);
  assert.equal(listed.sessions.find((s) => s.id === a)!.projectId, project.id);
  assert.equal(listed.sessions.find((s) => s.id === b)!.archived, true);

  // 改名后，再说话不会把自定义标题改回首句
  openAndTouch(pkg, a, '又说了一句');
  assert.equal(listConversationSessionsSync(pkg).sessions.find((s) => s.id === a)!.title, '日本旅行');

  // 在归档的对话里继续说话即取回
  openAndTouch(pkg, b, '继续写周报');
  assert.equal(listConversationSessionsSync(pkg).sessions.find((s) => s.id === b)!.archived, undefined);

  moveConversationSessionSync(pkg, a, null);
  assert.equal(listConversationSessionsSync(pkg).sessions.find((s) => s.id === a)!.projectId, undefined);
  renameConversationProjectSync(pkg, project.id, '家务');
  assert.equal(listConversationSessionsSync(pkg).projects[0]!.name, '家务');
});

function openAndTouch(pkg: string, id: string, text: string): void {
  openConversationSessionSync(pkg, id);
  touchConversationSessionSync(pkg, { titleFromUserText: text });
}

test('解散项目不删对话', async () => {
  const pkg = await tempPkg();
  const a = await seed(pkg, '甲');
  const project = createConversationProjectSync(pkg, '项目一');
  moveConversationSessionSync(pkg, a, project.id);
  const { released } = removeConversationProjectSync(pkg, project.id);
  assert.equal(released, 1);
  const listed = listConversationSessionsSync(pkg);
  assert.equal(listed.projects.length, 0);
  assert.ok(listed.sessions.some((s) => s.id === a && !s.projectId));
  await fs.access(conversationSessionFilePath(pkg, a));
});

test('删除必须有明确范围；只删这场对话的记录，不碰产出文件、数字之我和其他对话', async () => {
  const pkg = await tempPkg();
  const keep = await seed(pkg, '保留的对话');
  const doomed = await seed(pkg, '要删的对话');

  const deliverable = path.join(pkg, 'outputs', 'report.md');
  await fs.mkdir(path.dirname(deliverable), { recursive: true });
  await fs.writeFile(deliverable, '成果', 'utf8');
  const digitalSelf = path.join(pkg, 'self', 'profile.json');
  await fs.mkdir(path.dirname(digitalSelf), { recursive: true });
  await fs.writeFile(digitalSelf, '{"name":"张三"}', 'utf8');
  const thread = path.join(pkg, 'intelligence', 'threads', `${doomed}.json`);
  await fs.mkdir(path.dirname(thread), { recursive: true });
  await fs.writeFile(thread, '{}', 'utf8');

  assert.throws(() => deleteConversationSessionSync(pkg, doomed, ''), /确认删除范围/);
  assert.throws(() => deleteConversationSessionSync(pkg, doomed, 'everything'), /确认删除范围/);
  assert.ok(listConversationSessionsSync(pkg).sessions.some((s) => s.id === doomed));

  assert.throws(() => deleteConversationSessionSync(pkg, '../../self/profile', 'conversation_only'), /找不到/);

  const result = deleteConversationSessionSync(pkg, doomed, 'conversation_only');
  assert.equal(result.removedId, doomed);
  assert.notEqual(result.currentId, doomed, '删掉当前对话后回到另一场');
  const listed = listConversationSessionsSync(pkg);
  assert.equal(listed.currentId, result.currentId);
  assert.ok(listed.sessions.some((s) => s.id === result.currentId));
  assert.equal(listed.sessions.some((s) => s.id === doomed), false);
  await assert.rejects(fs.access(conversationSessionFilePath(pkg, doomed)));
  await assert.rejects(fs.access(thread));

  assert.equal(await fs.readFile(deliverable, 'utf8'), '成果');
  assert.equal(await fs.readFile(digitalSelf, 'utf8'), '{"name":"张三"}');
  await fs.access(conversationSessionFilePath(pkg, keep));
});

test('删到没有对话时自动留一场空的新对话', async () => {
  const pkg = await tempPkg();
  const only = listConversationSessionsSync(pkg);
  const id = only.currentId;
  const result = deleteConversationSessionSync(pkg, id, 'conversation_only');
  assert.notEqual(result.currentId, id);
  const listed = listConversationSessionsSync(pkg);
  assert.equal(listed.sessions.length, 1);
  assert.equal(listed.currentId, result.currentId);
});
