import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from 'playwright';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} from '../../runtime/tests/electron-harness';

type TalkTurn = { role?: string; text?: string };
type TalkView = { view?: { turns?: TalkTurn[] } };

async function turns(page: Page): Promise<TalkTurn[]> {
  const result = (await page.evaluate(`(async () => window.digitalMe.invoke('talk', {}))()`)) as TalkView;
  return result.view?.turns || [];
}

async function send(page: Page, text: string, workspace: string): Promise<string> {
  const before = (await turns(page)).length;
  await page.evaluate(`(async (payload) => {
    await window.TalkPage.handleSend(payload.text, { contextPaths: [payload.workspace] });
  })(${JSON.stringify({ text, workspace })})`);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const current = await turns(page);
    if (current.length >= before + 2 && current.at(-1)?.role === 'assistant') {
      assert.equal(current.at(-2)?.role, 'user');
      assert.equal(current.at(-2)?.text?.startsWith(text), true);
      return current.at(-1)?.text || '';
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`Talk 未完成：${text}`);
}

test('Electron Slice 2B：同一 Talk 完成搜索、编辑、复制、重命名和确认删除', { timeout: 180_000 }, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-file-electron-'));
  const workspace = path.join(base, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'note.txt'), '修改前：正式 Electron 文件主链。', 'utf8');
  await fs.writeFile(path.join(workspace, 'delete-me.txt'), '删除前必须保存恢复副本。', 'utf8');

  const harness = await launchDigitalMeElectron({
    extraEnv: {
      DIGITALME_V2_DIGITAL_SELF_STUB: '1',
      DIGITALME_V2_TALK_STUB: '1',
    },
  });
  const pageErrors: string[] = [];
  harness.page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await skipWelcomeAndEnterShell(harness.page);
    await send(harness.page, '文件工作区验收：搜索包含“修改前”的文件。', workspace);
    assert.match(await harness.page.locator('#chat-turns').innerText(), /搜索|找到|完成/);

    await send(harness.page, '文件工作区验收：编辑 note.txt，把“修改前”改成“修改后”。', workspace);
    assert.equal(await fs.readFile(path.join(workspace, 'note.txt'), 'utf8'), '修改后：正式 Electron 文件主链。');
    const editCard = harness.page.locator('.talk-result-card').last();
    await editCard.waitFor({ state: 'visible', timeout: 15_000 });
    assert.match(await editCard.innerText(), /note\.txt/);
    assert.equal((await editCard.locator('.talk-result-open').innerText()).trim(), '打开');

    await send(harness.page, '文件工作区验收：复制 note.txt。', workspace);
    assert.equal(await fs.readFile(path.join(workspace, 'note-copy.txt'), 'utf8'), '修改后：正式 Electron 文件主链。');

    await send(harness.page, '文件工作区验收：重命名复制文件。', workspace);
    await assert.rejects(fs.stat(path.join(workspace, 'note-copy.txt')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(workspace, 'note-renamed.txt'), 'utf8'), '修改后：正式 Electron 文件主链。');

    const prepareReply = await send(harness.page, '文件工作区验收：删除 delete-me.txt。', workspace);
    assert.equal(await fs.readFile(path.join(workspace, 'delete-me.txt'), 'utf8'), '删除前必须保存恢复副本。');
    assert.match(await harness.page.locator('#chat-turns').innerText(), /delete-me\.txt/);
    assert.match(prepareReply, /等待|确认|尚未删除/);

    const deleteReply = await send(harness.page, '文件工作区验收：确认删除 delete-me.txt。', workspace);
    await assert.rejects(fs.stat(path.join(workspace, 'delete-me.txt')), { code: 'ENOENT' });
    assert.match(deleteReply, /已删除|恢复副本|完成/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await harness.close();
    await fs.rm(base, { recursive: true, force: true });
  }
});
