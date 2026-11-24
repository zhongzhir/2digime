import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { Document, Packer, Paragraph } from 'docx';
import { runTalkTurn } from '../loop';
import { emptyThread } from '../store';

test('Talk 只在存在已授权 DOCX 时向模型提供原格式修改工具', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '2digime-talk-revise-tool-'));
  const source = path.join(root, 'source.docx');
  await fs.writeFile(source, await Packer.toBuffer(new Document({
    sections: [{ children: [new Paragraph('原文')] }],
  })));
  let offered: string[] = [];
  await runTalkTurn({
    thread: emptyThread(new Date().toISOString()),
    userText: '请把这份 Word 的原文改成新文，另存一版。',
    selfContext: '没有与本任务相关的本人长期信息。',
    agents: [],
    workRoot: root,
    contextPaths: [source],
    now: new Date().toISOString(),
    chat: async ({ tools }) => {
      offered = (tools || []).map((item) => item.function.name);
      return { text: '已识别到可用的原格式修改能力。' };
    },
  });
  assert.ok(offered.includes('revise_docx'));
  assert.ok(offered.includes('read_file'));
});

test('Talk 没有 DOCX 授权时不暴露原格式修改工具', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '2digime-talk-no-revise-tool-'));
  let offered: string[] = [];
  await runTalkTurn({
    thread: emptyThread(new Date().toISOString()),
    userText: '你能修改 Word 吗？',
    selfContext: '没有与本任务相关的本人长期信息。',
    agents: [],
    workRoot: root,
    contextPaths: [],
    now: new Date().toISOString(),
    chat: async ({ tools }) => {
      offered = (tools || []).map((item) => item.function.name);
      return { text: '可以说明当前能力边界。' };
    },
  });
  assert.equal(offered.includes('revise_docx'), false);
});
