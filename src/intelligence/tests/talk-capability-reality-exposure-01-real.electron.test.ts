/**
 * 能力现实暴露：正式 Talk 四场景。打开：DIGITALME_V2_CAPABILITY_REALITY=1
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

const ENABLED = process.env.DIGITALME_V2_CAPABILITY_REALITY === '1';
const EVIDENCE = path.join(REPO_ROOT, 'scripts', '_capability-reality-exposure-01');
const TALK_TRACE = path.join(EVIDENCE, 'raw-talk');

type Turn = { role?: string; text?: string };
type Trace = { tools?: string[]; messages?: Array<{ role?: string; content?: string }>; text?: string };

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

async function latestTrace(): Promise<Trace> {
  const names = (await fs.readdir(TALK_TRACE)).filter((n) => n.endsWith('.json')).sort();
  const last = names[names.length - 1];
  if (!last) return {};
  return JSON.parse(await fs.readFile(path.join(TALK_TRACE, last), 'utf8')) as Trace;
}

function systemOf(trace: Trace): string {
  return String(trace.messages?.find((m) => m.role === 'system')?.content || '');
}

(ENABLED ? test : test.skip)(
  'A-D 正式 Talk：能力现实可见，授权后才可调用',
  { timeout: 1_200_000 },
  async () => {
    assert.equal(hasTestModelCredential(), true, '需要开发模型凭证');
    await fs.mkdir(TALK_TRACE, { recursive: true });
    for (const name of await fs.readdir(TALK_TRACE)) {
      if (name.endsWith('.json')) await fs.unlink(path.join(TALK_TRACE, name));
    }
    const importFile = path.join(os.tmpdir(), `dm-reality-cred-${Date.now()}.json`);
    const modelCred = JSON.parse(await fs.readFile(DEV_MODEL_CREDENTIAL_FILE, 'utf8')) as Record<string, string>;
    await fs.writeFile(importFile, JSON.stringify(modelCred, null, 2), 'utf8');
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-reality-repo-'));
    await fs.writeFile(path.join(repo, 'README.md'), 'hello\n', 'utf8');

    const harness = await launchDigitalMeElectron({
      realProduct: true,
      extraEnv: {
        DIGITALME_V2_DIGITAL_SELF_STUB: '0',
        DIGITALME_V2_TALK_STUB: '0',
        DIGITALME_V2_UX_ACCEPTANCE: '0',
        DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
        DIGITALME_V2_CREDENTIAL_IMPORT: importFile,
        DIGITALME_V2_TALK_TRACE_DIR: TALK_TRACE,
        DIGITALME_V2_TALK_TURN_DEADLINE_MS: '600000',
        DIGITALME_V2_TALK_UI_DEADLINE_MS: '620000',
        GEMINI_API_KEY: '',
        GEMINI_SEARCH_MODEL: '',
        GEMINI_MODEL: '',
      },
    });
    const report: Record<string, unknown> = {};
    try {
      await enterProductShell(harness.page);
      const pkgDir = (await harness.page.evaluate(`(async () => {
        return window.digitalMe.getDefaultSubjectDir();
      })()`)) as { dir: string };

      await sendTalk(harness.page, '帮我修改这个项目并跑测试。', 420_000);
      const aTrace = await latestTrace();
      const aSys = systemOf(aTrace);
      const aReply = [...(await talkView(harness.page)).turns].reverse().find((t) => t.role === 'assistant')?.text || '';
      report.A = { sysHasCode: /代码执行：/.test(aSys), tools: aTrace.tools, replyPreview: aReply.slice(0, 400) };
      assert.match(aSys, /代码执行：已安装，但本轮尚未授权工作目录|代码执行：当前尚未连接或配置/);
      assert.equal((aTrace.tools || []).includes('delegate'), false);
      assert.equal(/cap_external_executor_codex/.test(aSys), false);
      assert.equal(/我没有代码能力/.test(aReply), false);

      const beforeB = (await fs.readdir(TALK_TRACE)).filter((n) => n.endsWith('.json')).length;
      await sendTalk(harness.page, '就改这个。', 480_000, { contextPaths: [repo] });
      const namesB = (await fs.readdir(TALK_TRACE)).filter((n) => n.endsWith('.json')).sort();
      const bTrace = JSON.parse(
        await fs.readFile(path.join(TALK_TRACE, namesB[Math.max(beforeB, namesB.length - 1)] || namesB[namesB.length - 1]!), 'utf8'),
      ) as Trace;
      const bSys = systemOf(bTrace);
      const thread = JSON.parse(
        await fs.readFile(path.join(pkgDir.dir, 'intelligence', 'thread.json'), 'utf8'),
      ) as { executions?: Array<{ capabilityId?: string; ok?: boolean }> };
      const bExec = (thread.executions || []).filter((e) => e.capabilityId === 'cap_external_executor_codex');
      let noteExists = false;
      try {
        noteExists = (await fs.stat(path.join(repo, 'note.txt'))).isFile();
      } catch {
        /* 模型可能还没写文件 */
      }
      report.B = { tools: bTrace.tools, delegated: bExec.length, noteExists };
      if (/代码执行：已连接/.test(bSys)) {
        assert.equal((bTrace.tools || []).includes('delegate'), true);
      }

      await sendTalk(harness.page, '帮我操作正在打开的 PowerPoint 调一下这几页。', 420_000);
      const cTrace = await latestTrace();
      const cSys = systemOf(cTrace);
      const cReply = [...(await talkView(harness.page)).turns].reverse().find((t) => t.role === 'assistant')?.text || '';
      report.C = { desktopLine: /桌面应用操作：/.test(cSys), replyPreview: cReply.slice(0, 400) };
      assert.match(cSys, /桌面应用操作：当前没有已连接的可执行能力/);
      assert.equal(/不能操作电脑|桌面控制不允许|此类任务不支持/.test(cSys), false);

      await sendTalk(harness.page, '今天有什么重要新闻？', 420_000);
      const dTrace = await latestTrace();
      const dSys = systemOf(dTrace);
      const dReply = [...(await talkView(harness.page)).turns].reverse().find((t) => t.role === 'assistant')?.text || '';
      report.D = { searchLine: /联网搜索：/.test(dSys), replyPreview: dReply.slice(0, 500) };
      assert.match(dSys, /联网搜索：当前尚未连接或配置/);
      assert.equal(/cap_gemini_web_search|cap_baseline_web_search/.test(dSys), false);
    } finally {
      await fs.writeFile(path.join(EVIDENCE, 'results.json'), JSON.stringify(report, null, 2), 'utf8');
      await harness.close();
    }
  },
);
