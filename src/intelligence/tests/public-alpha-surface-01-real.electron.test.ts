/**
 * Public Alpha 产品面：三条真实 UI Trial（A 聊天 / B 做事 / C 纠正）。
 * 正式 Electron + 真模型；证据写入 gitignored 目录。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
  REPO_ROOT,
  hasTestModelCredential,
} from '../../runtime/tests/electron-harness';
import type { Page } from 'playwright';

const EVIDENCE = path.join(REPO_ROOT, 'build', 'evidence', 'public-alpha-surface-01');

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

function leak(copy: string): boolean {
  return /Job|taskId|cap_|adapter|execution stage|semantic review|正在调用|OpenCode|runtime provider|IPC protocol/i.test(
    copy,
  );
}

test('Public Alpha 真实 UI Trial A/B/C', { timeout: 2_400_000 }, async (t) => {
  if (!hasTestModelCredential()) {
    t.skip('缺少本机模型凭证，跳过真实 UI Trial');
    return;
  }
  await fs.mkdir(EVIDENCE, { recursive: true });
  const proj = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-alpha-trial-proj-'));
  await fs.writeFile(
    path.join(proj, 'package.json'),
    JSON.stringify({ name: 'alpha-trial-proj', version: '1.0.0', private: true }, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(proj, 'index.js'),
    "function greet() { return 'hello'; }\nconsole.log(greet());\n",
    'utf8',
  );

  const harness = await launchDigitalMeElectron({
    realProduct: true,
    extraEnv: {
      DIGITALME_V2_DIGITAL_SELF_STUB: '0',
      DIGITALME_V2_TALK_STUB: '0',
      DIGITALME_V2_UX_ACCEPTANCE: '0',
      DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
      DIGITALME_EXECUTOR_CLI_KIND: 'codex',
    },
  });
  const report: Record<string, unknown> = {};
  try {
    await skipWelcomeAndEnterShell(harness.page);
    const status = await harness.page.evaluate(`(async () => {
      return window.digitalMe.getModelStatus();
    })()`);
    assert.equal(!!(status as { modelReady?: boolean }).modelReady, true, '真实模型未接通');

    assert.equal((await harness.page.locator('#nav-chat').innerText()).trim(), '与兔机米');
    assert.equal(await harness.page.locator('#nav-subject').isVisible(), true);
    assert.equal(await harness.page.locator('#nav-settings').isVisible(), true);
    assert.equal(await harness.page.locator('#nav-work').isVisible().catch(() => false), false);
    assert.equal(await harness.page.locator('#nav-collab').isVisible().catch(() => false), false);
    assert.equal(await harness.page.locator('.empty-emblem').count(), 0);
    assert.match(await harness.page.locator('.composer-hint').innerText(), /上下文/);
    const attachFileLabel = await harness.page.locator('#btn-talk-attach-file').textContent();
    assert.match(String(attachFileLabel || ''), /这次一起看/);

    await harness.page.locator('#nav-settings').click();
    await harness.page.locator('#view-settings').waitFor({ state: 'visible', timeout: 15_000 });
    const settingsCopy = await harness.page.locator('#view-settings').innerText();
    assert.equal(/OpenCode|Codex|MCP|Relay URL|capability registry/i.test(settingsCopy), false);
    await harness.page.locator('#btn-settings-back').click();
    await harness.page.locator('#nav-chat').click();

    await sendTalk(harness.page, '我最近主要在关注 2digime 的公开试用。');
    await sendTalk(harness.page, '你知道我最近主要在关注什么吗？');
    const trialA = await harness.page.locator('#chat-turns').innerText();
    await harness.page.screenshot({ path: path.join(EVIDENCE, 'trial-a.png'), fullPage: true });
    report.A = { copy: trialA.slice(0, 2000) };
    assert.match(trialA, /关注|试用|2digime|公开/);
    assert.equal(leak(trialA), false);
    assert.equal(await harness.page.locator('#panel-work').isVisible().catch(() => false), false);

    await harness.page.evaluate(`(async (dir) => {
      if (!window.TalkPage || typeof window.TalkPage.addContextPaths !== 'function') {
        throw new Error('TalkPage.addContextPaths missing');
      }
      window.TalkPage.addContextPaths([dir]);
    })(${JSON.stringify(proj)})`);
    await harness.page.locator('.talk-attach-chip').waitFor({ state: 'visible', timeout: 10_000 });
    await sendTalk(harness.page, '帮我给这个程序增加一个小功能并检查是否可用。');
    const trialB = await harness.page.locator('#chat-turns').innerText();
    await harness.page.screenshot({ path: path.join(EVIDENCE, 'trial-b.png'), fullPage: true });
    const resultCards = await harness.page.locator('.talk-result-card').count();
    report.B = { copy: trialB.slice(0, 2500), resultCards };
    assert.equal(leak(trialB), false);
    assert.equal(/Codex|OpenCode|executor|runtime|provider/i.test(trialB), false);
    assert.equal(resultCards > 0, true, '做事结果应直接留在 Talk');
    assert.match(await harness.page.locator('.talk-result-card').last().innerText(), /打开/);
    assert.match(await harness.page.locator('.talk-result-card').last().innerText(), /这次完成的结果/);
    const opened = await harness.page.evaluate(`(async () => {
      const btn = document.querySelector('.talk-result-open');
      return !!(btn && btn.textContent && btn.textContent.trim() === '打开');
    })()`);
    assert.equal(opened, true);

    await sendTalk(harness.page, '纠正一下：我喜欢在清晨写代码，请把这当成我对工作节奏的明确认识。');
    await harness.page.locator('#nav-subject').click();
    await harness.page.locator('#digital-self-page').waitFor({ state: 'visible', timeout: 20_000 });
    await harness.page.locator('#digital-self-page .ds-text', { hasText: /清晨|写代码/ }).waitFor({
      state: 'visible',
      timeout: 45_000,
    });
    const dsCopy = await harness.page.locator('#digital-self-page').innerText();
    await harness.page.screenshot({ path: path.join(EVIDENCE, 'trial-c.png'), fullPage: true });
    report.C = { copy: dsCopy.slice(0, 2000) };
    assert.match(dsCopy, /清晨|写代码/);
    assert.match(dsCopy, /你亲口说的|来自资料|兔机米的推断|已确认|尚未确认|需要你确认/);
    assert.match(dsCopy, /纠正/);
    assert.equal(dsCopy.includes('growth cockpit') || dsCopy.includes('已经了解'), false);
    assert.equal(/Candidate ID|provenance|pipeline|confidence/i.test(dsCopy), false);
    assert.equal(await harness.page.locator('#growth-block').isVisible().catch(() => false), false);
    assert.equal(await harness.page.locator('#nav-collab').isVisible().catch(() => false), false);

    await fs.writeFile(path.join(EVIDENCE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } finally {
    await Promise.race([
      harness.close(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 8000);
      }),
    ]);
  }
});
