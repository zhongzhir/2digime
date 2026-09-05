/**
 * CONTEXT-HYGIENE-MINIMAL-FIX 短真实 smoke。默认 skip。
 * 打开：DIGITALME_V2_CONTEXT_HYGIENE_SMOKE=1
 * 无测试 credential 时跳过，禁止退回正式 AppData。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Page } from 'playwright';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
  REPO_ROOT,
  hasTestModelCredential,
  officialAppUserDataPath,
} from '../../runtime/tests/electron-harness';
import { liveUnderstandings } from '../../subject-core/digital-self/view';
import type { DigitalSelf } from '../../subject-core/digital-self/types';

const ENABLED = process.env.DIGITALME_V2_CONTEXT_HYGIENE_SMOKE === '1';
const EVIDENCE = path.join(REPO_ROOT, 'scripts', '_context-hygiene-smoke');
const TALK_TRACE = path.join(EVIDENCE, 'raw-talk');

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

async function sendTalk(page: Page, text: string, waitMs = 400_000): Promise<void> {
  const before = (
    (await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`)) as { view?: { turns?: unknown[] } }
  ).view?.turns?.length || 0;
  await page.evaluate(`(async (payload) => {
    if (!window.TalkPage || typeof window.TalkPage.handleSend !== 'function') {
      throw new Error('TalkPage.handleSend missing');
    }
    await window.TalkPage.handleSend(payload);
  })(${JSON.stringify(text)})`);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const n =
      (
        (await page.evaluate(`(async () => {
      return window.digitalMe.invoke('talk', {});
    })()`)) as { view?: { turns?: unknown[] } }
      ).view?.turns?.length || 0;
    if (n > before) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`talk 未在时限内增加回合：${text}`);
}

function lastAssistant(turns: Array<{ role?: string; text?: string }>): string {
  return [...turns].reverse().find((t) => t.role === 'assistant')?.text || '';
}

async function readSelf(pkgDir: string): Promise<DigitalSelf | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(pkgDir, 'digital-self', 'self.json'), 'utf8')) as DigitalSelf;
  } catch {
    return null;
  }
}

test(
  '上下文卫生 smoke：发散 / 长期偏好 / 一次性任务不沉淀 / userData 隔离',
  {
    skip: !ENABLED
      ? 'set DIGITALME_V2_CONTEXT_HYGIENE_SMOKE=1'
      : hasTestModelCredential()
        ? false
        : 'no test model credential; will not use official AppData',
    timeout: 900_000,
  },
  async () => {
    await fs.mkdir(TALK_TRACE, { recursive: true });
    const official = path.resolve(officialAppUserDataPath());
    const harness = await launchDigitalMeElectron({
      realProduct: true,
      extraEnv: {
        DIGITALME_V2_DIGITAL_SELF_STUB: '0',
        DIGITALME_V2_TALK_STUB: '0',
        DIGITALME_V2_UX_ACCEPTANCE: '0',
        DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
        DIGITALME_V2_TALK_TRACE_DIR: TALK_TRACE,
      },
    });
    const report: Record<string, unknown> = {};
    try {
      await enterProductShell(harness.page);
      const status = (await harness.page.evaluate(`(async () => {
        return window.digitalMe.getModelStatus();
      })()`)) as { modelReady?: boolean };
      assert.equal(!!status.modelReady, true, '真实模型未接通');
      const loc = (await harness.page.evaluate(`(async () => {
        return window.digitalMe.getDefaultSubjectDir();
      })()`)) as { dir: string };
      const pkgDir = loc.dir;
      assert.equal(path.resolve(harness.userData) === official, false);
      assert.equal(pkgDir.startsWith(official + path.sep) || path.resolve(pkgDir) === official, false);
      report.D = {
        harnessUserData: harness.userData,
        pkgDir,
        officialAppUserData: official,
        isolated: true,
      };

      await sendTalk(harness.page, '我想做一个有趣的小项目，你先给我几个不同方向。');
      const viewA = (await harness.page.evaluate(`(async () => {
        return window.digitalMe.invoke('talk', {});
      })()`)) as { view?: { turns?: Array<{ role: string; text: string }> } };
      const replyA = lastAssistant(viewA.view?.turns || []);
      report.A = { text: replyA.slice(0, 500) };
      const locked =
        /都能做成一个网页小文件/.test(replyA) && /里面会藏着什么数学/.test(replyA);
      assert.equal(locked, false, '开放方向不应被锁死成数学网页');
      const selfA = await readSelf(pkgDir);
      const currentA = selfA ? liveUnderstandings(selfA).filter((i) => i.status === 'current') : [];
      assert.equal(
        currentA.some((i) => /数学网页小游戏|具体项目方向是做一个数学小游戏/.test(i.text)),
        false,
      );

      await sendTalk(
        harness.page,
        '我不会写代码。以后不要让我理解 IT 技术问题，用大白话和我沟通技术问题。',
      );
      const selfB = await readSelf(pkgDir);
      const currentB = selfB ? liveUnderstandings(selfB).filter((i) => i.status === 'current') : [];
      report.B = currentB.map((i) => i.text);
      assert.ok(
        currentB.some((i) => /大白话|不要.*IT|不会写代码/.test(i.text)),
        '长期偏好应能沉淀',
      );

      await sendTalk(harness.page, '给我做一个双击就能玩的数学小游戏。');
      const viewC = (await harness.page.evaluate(`(async () => {
        return window.digitalMe.invoke('talk', {});
      })()`)) as { view?: { turns?: Array<{ role: string; text: string; result?: { path?: string } }> } };
      const replyC = lastAssistant(viewC.view?.turns || []);
      const wrote =
        (viewC.view?.turns || []).some((t) => t.result?.path && /html/i.test(t.result.path)) ||
        /html|网页|双击/i.test(replyC);
      report.C = { text: replyC.slice(0, 400), wrote };
      assert.equal(wrote, true, '数学小游戏仍应能完成');
      const selfC = await readSelf(pkgDir);
      const currentC = selfC ? liveUnderstandings(selfC).filter((i) => i.status === 'current') : [];
      report.Ccurrent = currentC.map((i) => i.text);
      assert.equal(
        currentC.some((i) => /当前想要.*数学|具体项目方向是做一个数学小游戏/.test(i.text)),
        false,
        '本次小游戏目标不得成为长期 current',
      );

      await fs.mkdir(EVIDENCE, { recursive: true });
      await fs.writeFile(path.join(EVIDENCE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    } finally {
      await harness.close();
    }
  },
);
