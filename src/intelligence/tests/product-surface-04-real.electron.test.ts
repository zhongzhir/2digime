/**
 * 04 真实产品表面闸门：A–E 都走「与 2digime」正式入口。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
  REPO_ROOT,
} from '../../runtime/tests/electron-harness';
import type { Page } from 'playwright';

const EVIDENCE = path.join(REPO_ROOT, 'scripts', '_product-surface-04-real');

async function talkTurnCount(page: Page): Promise<number> {
  const result = (await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`)) as { view?: { turns?: unknown[] } };
  return result.view?.turns?.length || 0;
}

async function sendTalk(page: Page, text: string, waitMs = 800_000): Promise<void> {
  const before = await talkTurnCount(page);
  await page.evaluate(`(async (payload) => {
    if (!window.TalkPage || typeof window.TalkPage.handleSend !== 'function') {
      throw new Error('TalkPage.handleSend missing');
    }
    await window.TalkPage.handleSend(payload);
  })(${JSON.stringify(text)})`);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if ((await talkTurnCount(page)) > before) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`talk 未在时限内增加回合：${text}`);
}

async function enterProductShell(page: Page): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const shell = await page.locator('#view-shell').isVisible().catch(() => false);
    const input = await page.locator('#chat-input').isVisible().catch(() => false);
    if (shell && input) return;
    for (const id of ['btn-welcome-skip-model', 'btn-welcome-skip-model-2', 'btn-create-skip']) {
      const btn = page.locator(`#${id}`);
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true });
        await page.waitForTimeout(600);
      }
    }
    await page.waitForTimeout(400);
  }
  await skipWelcomeAndEnterShell(page);
}

function lastAssistant(view: unknown): string {
  const turns =
    (view as { view?: { turns?: Array<{ role: string; text: string; result?: { title?: string } }> } })?.view
      ?.turns ||
    (view as { turns?: Array<{ role: string; text: string; result?: { title?: string } }> })?.turns ||
    [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]?.role === 'assistant') return String(turns[i]?.text || '');
  }
  return '';
}

function lastAssistantTurn(view: unknown): { text: string; resultTitle?: string } {
  const turns =
    (view as { view?: { turns?: Array<{ role: string; text: string; result?: { title?: string } }> } })?.view
      ?.turns ||
    (view as { turns?: Array<{ role: string; text: string; result?: { title?: string } }> })?.turns ||
    [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]?.role === 'assistant') {
      const title = turns[i]?.result?.title;
      return title ? { text: String(turns[i]?.text || ''), resultTitle: title } : { text: String(turns[i]?.text || '') };
    }
  }
  return { text: '' };
}

async function dump(page: Page, tag: string): Promise<{ view: unknown; thread: unknown; uiText: string }> {
  const uiText = await page.locator('#panel-chat').innerText();
  const view = await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`);
  const loc = (await page.evaluate(`(async () => {
    return window.digitalMe.getDefaultSubjectDir();
  })()`)) as { dir: string };
  let thread: unknown = { missing: true };
  try {
    thread = JSON.parse(await fs.readFile(path.join(loc.dir, 'intelligence', 'thread.json'), 'utf8'));
  } catch {
    /* missing */
  }
  await page.screenshot({ path: path.join(EVIDENCE, `${tag}.png`), fullPage: true });
  await fs.writeFile(
    path.join(EVIDENCE, `${tag}.json`),
    `${JSON.stringify({ tag, uiText, view, thread }, null, 2)}\n`,
    'utf8',
  );
  return { view, thread, uiText };
}

function leak(copy: string): boolean {
  return /Job ID|taskId|cap_external|adapter|execution stage|semantic review|正在调用 cap_/i.test(copy);
}

async function workStateFingerprint(pkgDir: string): Promise<string> {
  const names = ['tasks', 'jobs', 'snapshots', 'artifacts', 'work', 'content'];
  const parts: string[] = [];
  for (const name of names) {
    const dir = path.join(pkgDir, 'runtime', name);
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    parts.push(`${name}:${[...files].sort().join(',')}`);
  }
  return parts.join('|');
}

async function assertLegacyWorkInactive(page: Page): Promise<void> {
  const status = (await page.evaluate(`(async () => {
    return window.digitalMe.getModelStatus();
  })()`)) as { legacyWorkRuntimeAttached?: boolean };
  assert.equal(!!status.legacyWorkRuntimeAttached, false, '正式路径不应初始化旧 Work Runtime');
}

test('04 真实入口：导航 + A–E 同一交流', { timeout: 2_400_000 }, async () => {
  await fs.mkdir(EVIDENCE, { recursive: true });
  const talkTrace = path.join(EVIDENCE, 'raw-talk');
  await fs.mkdir(talkTrace, { recursive: true });
  const harness = await launchDigitalMeElectron({
    realProduct: true,
    extraEnv: {
      DIGITALME_V2_DIGITAL_SELF_STUB: '0',
      DIGITALME_V2_TALK_STUB: '0',
      DIGITALME_V2_UX_ACCEPTANCE: '0',
      DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
      DIGITALME_V2_TALK_TRACE_DIR: talkTrace,
      DIGITALME_EXECUTOR_CLI_KIND: 'codex',
    },
  });
  const results: Record<string, unknown> = {
    talkJudgmentUnchanged: true,
    noWorkRuntimeOnTalkPath: true,
    openGoalObserved: null as string | null,
  };
  try {
    await enterProductShell(harness.page);
    const status = await harness.page.evaluate(`(async () => {
      return window.digitalMe.getModelStatus();
    })()`);
    assert.equal(!!(status as { modelReady?: boolean }).modelReady, true, '真实模型未接通');
    await assertLegacyWorkInactive(harness.page);

    const locStart = (await harness.page.evaluate(`(async () => {
      return window.digitalMe.getDefaultSubjectDir();
    })()`)) as { dir: string };
    const workBefore = await workStateFingerprint(locStart.dir);

    assert.equal((await harness.page.locator('#nav-chat').innerText()).trim(), '与兔机米');
    assert.equal((await harness.page.locator('#nav-discover').innerText()).trim(), '发现');
    assert.equal(await harness.page.locator('#nav-subject').isVisible(), true);
    assert.equal(await harness.page.locator('#nav-settings').isVisible(), true);
    assert.equal(await harness.page.locator('#nav-work').isVisible().catch(() => false), false);
    assert.equal(await harness.page.locator('#nav-collab').isVisible().catch(() => false), false);
    assert.equal(await harness.page.locator('#panel-chat').isVisible(), true);
    assert.equal(await harness.page.locator('#panel-work').isVisible().catch(() => false), false);

    await harness.page.locator('#nav-subject').click();
    await harness.page.locator('#panel-subject').waitFor({ state: 'visible', timeout: 20_000 });
    await harness.page.locator('#digital-self-page').waitFor({ state: 'visible', timeout: 15_000 });
    await harness.page.locator('#ds-headline').waitFor({ state: 'visible', timeout: 15_000 });
    await harness.page.locator('#nav-settings').click();
    await harness.page.locator('#view-settings').waitFor({ state: 'visible', timeout: 15_000 });
    await harness.page.locator('#btn-settings-back').click();
    await harness.page.locator('#view-shell').waitFor({ state: 'visible', timeout: 15_000 });
    await harness.page.locator('#nav-chat').click();
    await harness.page.locator('#panel-chat').waitFor({ state: 'visible', timeout: 15_000 });
    await assertLegacyWorkInactive(harness.page);

    await sendTalk(harness.page, '你现在了解我什么？');
    const a = await dump(harness.page, 'A-chat');
    const aReply = lastAssistant(a.view);
    results.A = { reply: aReply };
    assert.equal(aReply.trim().length > 0, true);
    assert.equal(leak(a.uiText), false);
    assert.equal(await harness.page.locator('#panel-work').isVisible().catch(() => false), false);

    await sendTalk(
      harness.page,
      '帮我把这段话改得更简洁。今天开会讨论了很多内容，最后决定下周再确认方案细节。',
    );
    const b = await dump(harness.page, 'B-rewrite');
    const bTurn = lastAssistantTurn(b.view);
    results.B = bTurn;
    assert.equal(bTurn.text.trim().length > 0, true);
    assert.equal(Boolean(bTurn.resultTitle), false, 'B 不应强制外部执行出文件卡');
    assert.equal(leak(b.uiText), false);

    const loc0 = (await harness.page.evaluate(`(async () => {
      return window.digitalMe.getDefaultSubjectDir();
    })()`)) as { dir: string };
    const runsDir = path.join(loc0.dir, 'intelligence', 'runs');
    const runsBefore = await fs.readdir(runsDir).catch(() => [] as string[]);
    await sendTalk(harness.page, '请在这个工作区创建 README.md，写一段简短项目说明。');
    const c = await dump(harness.page, 'C-readme');
    const cTurn = lastAssistantTurn(c.view);
    const runsAfter = await fs.readdir(runsDir).catch(() => [] as string[]);
    const newRuns = runsAfter.filter((id) => !runsBefore.includes(id));
    let createdReadme = false;
    for (const execId of newRuns) {
      const names = await fs.readdir(path.join(runsDir, execId)).catch(() => [] as string[]);
      if (names.some((name) => name.toLowerCase() === 'readme.md')) createdReadme = true;
    }
    results.C = { ...cTurn, createdReadme, card: await harness.page.locator('.talk-result-card').count() };
    assert.equal(createdReadme || Boolean(cTurn.resultTitle), true, 'C：应产生 README 或结果卡');
    if (await harness.page.locator('.talk-result-card').count()) {
      assert.match(await harness.page.locator('.talk-result-card').first().innerText(), /README|打开/);
    }
    assert.equal(leak(c.uiText), false);
    assert.equal(await harness.page.locator('#panel-work').isVisible().catch(() => false), false);

    await sendTalk(harness.page, '帮我写一份明天上午三件最重要事情的简短备忘。');
    const d1 = await dump(harness.page, 'D-ask');
    const dAsk = lastAssistant(d1.view);
    const openGoal = (d1.thread as { openGoal?: string }).openGoal || null;
    results.openGoalObserved = openGoal;
    results.D1 = { reply: dAsk, openGoal };
    assert.equal(dAsk.trim().length > 0, true);
    await sendTalk(harness.page, '三件是：写周报、回复李明、整理闸门记录。');
    const d2 = await dump(harness.page, 'D-continue');
    const dDone = lastAssistant(d2.view);
    results.D2 = { reply: dDone };
    assert.equal(dDone.trim().length > 0, true);
    assert.equal(leak(d2.uiText), false);

    await sendTalk(harness.page, '把这封邮件直接发给李明。');
    const e = await dump(harness.page, 'E-no-email');
    const eReply = lastAssistant(e.view);
    results.E = { reply: eReply };
    assert.equal(eReply.trim().length > 0, true);
    assert.equal(/已经发出|已发送成功|邮件已送达/.test(eReply), false, 'E：不得假发送');
    assert.equal(leak(e.uiText), false);
    assert.equal(await harness.page.locator('#panel-work').isVisible().catch(() => false), false);
    await assertLegacyWorkInactive(harness.page);
    const workAfter = await workStateFingerprint(locStart.dir);
    assert.equal(workAfter, workBefore, '正式路径不得新写旧 Task/Job/work state');
    results.legacyWorkRuntimeAttached = false;
    results.workStateUnchanged = true;

    await fs.writeFile(path.join(EVIDENCE, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  } finally {
    await Promise.race([
      harness.close(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 8000);
      }),
    ]);
  }
});
