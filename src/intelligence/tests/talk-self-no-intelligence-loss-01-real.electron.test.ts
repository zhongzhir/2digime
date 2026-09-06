/**
 * Digital Self 不丢失 intelligence。打开：DIGITALME_V2_SELF_NO_LOSS=1
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from 'playwright';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
  REPO_ROOT,
  hasTestModelCredential,
  DEV_MODEL_CREDENTIAL_FILE,
} from '../../runtime/tests/electron-harness';
import { digitalSelfFilePath } from '../../subject-core/digital-self/store';
import { buildFixtureResumeDocx, FIXTURE_NAME } from '../../infrastructure/tests/feedback-loop-02-fixtures';

const ENABLED = process.env.DIGITALME_V2_SELF_NO_LOSS === '1';
const EVIDENCE = path.join(REPO_ROOT, 'scripts', '_self-no-intelligence-loss-01');

type Turn = { role?: string; text?: string };

async function enterProductShell(page: Page): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const shell = await page.locator('#view-shell').isVisible().catch(() => false);
    const input = await page.locator('#chat-input').isVisible().catch(() => false);
    if (shell && input) return;
    for (const id of ['btn-welcome-skip-model', 'btn-welcome-skip-model-2', 'btn-create-skip']) {
      const btn = page.locator(`#${id}`);
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true }).catch(() => undefined);
        await page.waitForTimeout(600);
      }
    }
    await page.waitForTimeout(400);
  }
  await skipWelcomeAndEnterShell(page);
}

async function pkgDirOf(page: Page): Promise<string> {
  const loc = (await page.evaluate(`(async () => {
    return window.digitalMe.getDefaultSubjectDir();
  })()`)) as { dir: string };
  return loc.dir;
}

async function talkView(page: Page): Promise<{ turns: Turn[] }> {
  const talked = (await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`)) as { view?: { turns?: Turn[] } };
  return { turns: talked.view?.turns || [] };
}

async function sendTalk(page: Page, text: string, waitMs = 240_000): Promise<void> {
  const before = (await talkView(page)).turns.length;
  await page.evaluate(`(async (payload) => {
    if (!window.TalkPage || typeof window.TalkPage.handleSend !== 'function') {
      throw new Error('TalkPage.handleSend missing');
    }
    await window.TalkPage.handleSend(payload);
  })(${JSON.stringify(text)})`);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if ((await talkView(page)).turns.length > before) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`talk 未在时限内增加回合：${text}`);
}

function lastAssistant(turns: Turn[]): string {
  return [...turns].reverse().find((t) => t.role === 'assistant')?.text || '';
}

(ENABLED ? test : test.skip)(
  'A-D 简历/确认/普通 candidate/无关任务',
  { timeout: 900_000 },
  async () => {
    assert.equal(hasTestModelCredential(), true, '需要开发模型凭证');
    await fs.mkdir(EVIDENCE, { recursive: true });
    const resumePath = path.join(EVIDENCE, 'fixture-resume.docx');
    await fs.writeFile(resumePath, buildFixtureResumeDocx());
    const boundaryPath = path.join(EVIDENCE, 'boundary.md');
    await fs.writeFile(boundaryPath, '高风险工程合作我不参与。\n', 'utf8');
    const importFile = path.join(os.tmpdir(), `dm-self-nolos-cred-${Date.now()}.json`);
    const modelCred = JSON.parse(await fs.readFile(DEV_MODEL_CREDENTIAL_FILE, 'utf8')) as Record<string, string>;
    await fs.writeFile(importFile, JSON.stringify(modelCred, null, 2), 'utf8');

    const harness = await launchDigitalMeElectron({
      realProduct: true,
      extraEnv: {
        DIGITALME_V2_DIGITAL_SELF_STUB: '0',
        DIGITALME_V2_TALK_STUB: '0',
        DIGITALME_V2_UX_ACCEPTANCE: '0',
        DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
        DIGITALME_V2_CREDENTIAL_IMPORT: importFile,
        DIGITALME_V2_TALK_TURN_DEADLINE_MS: '600000',
        DIGITALME_V2_TALK_UI_DEADLINE_MS: '620000',
      },
    });
    const report: Record<string, unknown> = {};
    try {
      await enterProductShell(harness.page);
      const pkgDir = await pkgDirOf(harness.page);

      await harness.page.evaluate(`(async (filePath) => {
        return window.digitalMe.invoke('digitalSelf', { action: 'import', filePath });
      })(${JSON.stringify(resumePath)})`);
      const afterImport = JSON.parse(await fs.readFile(digitalSelfFilePath(pkgDir), 'utf8')) as {
        understandings?: Array<{ text: string; status: string }>;
      };
      const nameRow = (afterImport.understandings || []).find((item) => item.text.includes(FIXTURE_NAME));
      report.importName = nameRow;
      assert.ok(nameRow, 'import 应写下姓名理解');
      assert.notEqual(nameRow?.status, 'current');

      await sendTalk(harness.page, '你知道我的名字吗？');
      const aReply = lastAssistant((await talkView(harness.page)).turns);
      report.A = aReply.slice(0, 500);
      assert.match(aReply, new RegExp(FIXTURE_NAME));
      assert.equal(/完全不知道|没有你名字的记录/.test(aReply), false);

      await sendTalk(harness.page, '对，我叫张元林，你可以叫我元林。');
      await sendTalk(harness.page, '我叫什么？');
      const bReply = lastAssistant((await talkView(harness.page)).turns);
      report.B = bReply.slice(0, 500);
      assert.match(bReply, /张元林|元林/);

      await harness.page.evaluate(`(async (filePath) => {
        return window.digitalMe.invoke('digitalSelf', { action: 'import', filePath });
      })(${JSON.stringify(boundaryPath)})`);
      await sendTalk(harness.page, '如果有人找我做高风险工程合作，我该怎么看？');
      const cReply = lastAssistant((await talkView(harness.page)).turns);
      report.C = cReply.slice(0, 500);
      assert.match(cReply, /工程|合作|风险/);

      await sendTalk(harness.page, '1+1 等于几？');
      const dReply = lastAssistant((await talkView(harness.page)).turns);
      report.D = dReply.slice(0, 500);
      assert.match(dReply, /2|二/);
      await fs.writeFile(path.join(EVIDENCE, 'results.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } finally {
      await harness.close();
    }
  },
);
