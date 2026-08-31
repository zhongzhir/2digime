import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendConversationRow, conversationFilePath } from '../conversation-transcript';
import {
  createConversationSessionSync,
  currentConversationFilePathSync,
  listConversationSessionsSync,
  listCurrentSessionTurns,
  openConversationSessionSync,
  touchConversationSessionSync,
} from '../conversation-sessions';

async function tempPkg(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-sessions-${prefix}-`));
}

test('新对话保留原对话，打开历史可继续，重启后仍在', async () => {
  const pkg = await tempPkg('keep');
  const legacy = conversationFilePath(pkg);
  await fs.mkdir(path.dirname(legacy), { recursive: true });
  await appendConversationRow(legacy, {
    id: 'turn_old',
    role: 'user',
    text: '我叫张三',
    at: '2026-01-01T00:00:00.000Z',
  });

  const listed1 = listConversationSessionsSync(pkg);
  assert.equal(listed1.sessions.length, 1);
  assert.match(listed1.sessions[0]!.title, /张三/);
  const firstId = listed1.currentId;
  const oldTurns = await listCurrentSessionTurns(pkg);
  assert.equal(oldTurns.length, 1);
  assert.equal(oldTurns[0]?.text, '我叫张三');

  const created = createConversationSessionSync(pkg);
  assert.notEqual(created.id, firstId);
  const listed2 = listConversationSessionsSync(pkg);
  assert.equal(listed2.currentId, created.id);
  assert.equal(listed2.sessions.length, 2);
  const newTurns = await listCurrentSessionTurns(pkg);
  assert.equal(newTurns.length, 0);

  await appendConversationRow(currentConversationFilePathSync(pkg), {
    id: 'turn_new',
    role: 'user',
    text: '这是第二场对话',
    at: '2026-01-02T00:00:00.000Z',
  });
  touchConversationSessionSync(pkg, { titleFromUserText: '这是第二场对话' });

  openConversationSessionSync(pkg, firstId);
  const restored = await listCurrentSessionTurns(pkg);
  assert.equal(restored.length, 1);
  assert.equal(restored[0]?.text, '我叫张三');

  const listed3 = listConversationSessionsSync(pkg);
  assert.equal(listed3.sessions.length, 2);
  assert.ok(listed3.sessions.some((s) => s.id === firstId));
  assert.ok(listed3.sessions.some((s) => s.id === created.id));
});
