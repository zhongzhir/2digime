/**
 * 5 个真实短场景。打开：DIGITALME_V2_EXISTING_CAPABILITY_EXPOSURE=1
 * 走正式 Talk 入口（TalkPage.handleSend + contextPaths）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, promises as fs } from 'node:fs';
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
import { extractFile } from '../../infrastructure/extract';
import { digitalSelfFilePath } from '../../subject-core/digital-self/store';
import { buildFixtureResumeDocx, FIXTURE_NAME } from '../../infrastructure/tests/feedback-loop-02-fixtures';

const ENABLED = process.env.DIGITALME_V2_EXISTING_CAPABILITY_EXPOSURE === '1';
const AUTOBIZ = process.env.DIGITALME_V2_AUTOBIZ_DIR || 'E:\\AutoBiz';
const DOCX_NAME = 'global_digital_asset_monetization_full_13_paths.docx';
const EVIDENCE = path.join(REPO_ROOT, 'scripts', '_existing-capability-exposure-01');

type ExecRec = { capabilityId?: string; ok?: boolean; failureReason?: string };
type Turn = { role?: string; text?: string; result?: { title?: string; path?: string } };

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

async function sendTalk(
  page: Page,
  text: string,
  waitMs: number,
  extra?: { contextPaths?: string[] },
): Promise<void> {
  const before = (await talkView(page)).turns.length;
  const payload = extra?.contextPaths?.length ? { text, contextPaths: extra.contextPaths } : text;
  await page.evaluate(`(async (payload) => {
    if (!window.TalkPage || typeof window.TalkPage.handleSend !== 'function') {
      throw new Error('TalkPage.handleSend missing');
    }
    await window.TalkPage.handleSend(
      typeof payload === 'string' ? payload : payload.text,
      typeof payload === 'string' ? undefined : payload,
    );
  })(${JSON.stringify(payload)})`);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if ((await talkView(page)).turns.length > before) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`talk 未在时限内增加回合：${text}`);
}

function readThread(pkgDir: string): { executions: ExecRec[]; turns: Turn[] } {
  try {
    const parsed = JSON.parse(
      require('node:fs').readFileSync(path.join(pkgDir, 'intelligence', 'thread.json'), 'utf8'),
    ) as { executions?: ExecRec[]; turns?: Turn[] };
    return { executions: parsed.executions || [], turns: parsed.turns || [] };
  } catch {
    return { executions: [], turns: [] };
  }
}

function lastAssistant(turns: Turn[]): string {
  return [...turns].reverse().find((t) => t.role === 'assistant')?.text || '';
}

function isPkZip(buf: Buffer): boolean {
  return buf.length > 2 && buf[0] === 0x50 && buf[1] === 0x4b;
}

(ENABLED ? test : test.skip)(
  'A-E 正式 Talk：授权文件夹/docx、真实 Office 导出、简历姓名分层',
  { timeout: 1_200_000 },
  async () => {
    assert.equal(hasTestModelCredential(), true, '需要开发模型凭证');
    assert.equal(existsSync(AUTOBIZ), true, `需要真实目录 ${AUTOBIZ}`);
    const docxPath = path.join(AUTOBIZ, DOCX_NAME);
    assert.equal(existsSync(docxPath), true, `需要 ${docxPath}`);

    await fs.mkdir(EVIDENCE, { recursive: true });
    const importFile = path.join(os.tmpdir(), `dm-expose-cred-${Date.now()}.json`);
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

      await sendTalk(
        harness.page,
        '你看下这个文件夹的内容，就我正在做的这件事来说，有什么改进建议？',
        420_000,
        { contextPaths: [AUTOBIZ] },
      );
      const afterA = readThread(pkgDir);
      const aList = afterA.executions.filter((e) => e.capabilityId === 'list_directory' && e.ok);
      const aRead = afterA.executions.filter((e) => e.capabilityId === 'read_file' && e.ok);
      const aReply = lastAssistant(afterA.turns);
      report.A = {
        listOk: aList.length,
        readOk: aRead.length,
        replyChars: aReply.length,
        replyPreview: aReply.slice(0, 400),
      };
      assert.ok(aList.length > 0, 'A 应真实 list_directory');
      assert.ok(aRead.length > 0, 'A 应真实 read_file');
      assert.ok(aReply.length > 40, 'A 应给出建议');
      assert.equal(/我没有读取本地|无法访问本地文件夹/.test(aReply), false);

      const bBefore = afterA.executions.length;
      await sendTalk(harness.page, '这是其中一份文件，看看有什么意见建议。', 420_000, {
        contextPaths: [docxPath],
      });
      const afterB = readThread(pkgDir);
      const bRead = afterB.executions
        .slice(bBefore)
        .filter((e) => e.capabilityId === 'read_file' && e.ok);
      const bReply = lastAssistant(afterB.turns);
      report.B = { readOk: bRead.length, replyPreview: bReply.slice(0, 400) };
      assert.ok(bRead.length > 0, 'B 应 read_file 该 docx');
      assert.equal(/我没有读取本地 docx|没有读取本地/.test(bReply), false);
      assert.ok(bReply.length > 40);

      const cBefore = afterB.executions.length;
      await sendTalk(
        harness.page,
        '把刚才的大纲做成 Word。大纲如下：\n# 数字资产变现\n\n- 先把真实文件闭环做出来\n- 再谈规模化路径',
        300_000,
      );
      const afterC = readThread(pkgDir);
      const cExport = afterC.executions
        .slice(cBefore)
        .filter((e) => e.capabilityId === 'export_file' && e.ok);
      const cTurn = [...afterC.turns].reverse().find((t) => t.role === 'assistant');
      const cPath = cTurn?.result?.path || '';
      report.C = { exportOk: cExport.length, path: cPath };
      assert.ok(cExport.length > 0, 'C 应调用 export_file');
      assert.match(cPath, /\.docx$/i);
      const cBytes = await fs.readFile(cPath);
      assert.equal(isPkZip(cBytes), true);
      const cText = await extractFile(cPath);
      assert.match(String(cText.text || ''), /数字资产变现|真实文件/);

      const dBefore = afterC.executions.length;
      await sendTalk(harness.page, '再做成开会提案用的 PPT。', 300_000);
      const afterD = readThread(pkgDir);
      const dExport = afterD.executions
        .slice(dBefore)
        .filter((e) => e.capabilityId === 'export_file' && e.ok);
      const dTurn = [...afterD.turns].reverse().find((t) => t.role === 'assistant');
      const dPath = dTurn?.result?.path || '';
      report.D = { exportOk: dExport.length, path: dPath };
      assert.ok(dExport.length > 0, 'D 应调用 export_file');
      assert.match(dPath, /\.pptx$/i);
      const dBytes = await fs.readFile(dPath);
      assert.equal(isPkZip(dBytes), true);

      const resumePath = process.env.DIGITALME_V2_RESUME_PATH || path.join(EVIDENCE, 'fixture-resume.docx');
      if (!process.env.DIGITALME_V2_RESUME_PATH) {
        await fs.writeFile(resumePath, buildFixtureResumeDocx());
      }
      const extracted = await extractFile(resumePath);
      await harness.page.evaluate(`(async (filePath) => {
        return window.digitalMe.invoke('digitalSelf', { action: 'import', filePath });
      })(${JSON.stringify(resumePath)})`);
      const selfRaw = JSON.parse(await fs.readFile(digitalSelfFilePath(pkgDir), 'utf8')) as {
        understandings?: Array<{ text: string; status: string }>;
      };
      const nameHits = (selfRaw.understandings || []).filter(
        (item) => /姓名|名字|叫/.test(item.text) || item.text.includes(FIXTURE_NAME),
      );
      const talkCtxItems = nameHits.filter((item) => item.status === 'current');
      await sendTalk(harness.page, '你知道我的名字吗？', 180_000);
      const eReply = lastAssistant(readThread(pkgDir).turns);
      report.E = {
        extractHasName: /张元林|姓名/.test(String(extracted.text || '')),
        extractFirstLine: String(extracted.text || '').split(/\n/).find((l) => l.trim()) || '',
        understandings: nameHits.map((item) => ({ text: item.text, status: item.status })),
        currentNameInSelf: talkCtxItems.map((item) => item.text),
        reply: eReply.slice(0, 400),
        resumePath,
        usedFixture: !process.env.DIGITALME_V2_RESUME_PATH,
      };
      await fs.writeFile(path.join(EVIDENCE, 'results.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } finally {
      await harness.close();
    }
  },
);
