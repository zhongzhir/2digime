/**
 * Phase 1 Digital Self：真实 Electron 页面验收，不是只测内部对象。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} from '../../runtime/tests/electron-harness';
import type { Page } from 'playwright';

const STUB_ENV = { DIGITALME_V2_DIGITAL_SELF_STUB: '1' };
const EVIDENCE = path.join(os.tmpdir(), 'dm-ds-refoundation-02-evidence');

async function openDigitalSelf(page: Page): Promise<void> {
  await page.locator('#nav-subject').waitFor({ state: 'visible', timeout: 20_000 });
  for (let i = 0; i < 8; i += 1) {
    await page.locator('#nav-subject').dispatchEvent('click');
    const visible = await page.locator('#panel-subject').isVisible().catch(() => false);
    if (visible) break;
    await page.waitForTimeout(300);
  }
  await page.locator('#panel-subject').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#digital-self-page').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#ds-headline').waitFor({ state: 'visible', timeout: 10_000 });
}

async function tell(page: Page, text: string): Promise<void> {
  await page.locator('#btn-ds-tell').click();
  await page.locator('#ds-tell-form').waitFor({ state: 'visible' });
  await page.locator('#ds-tell-input').fill(text);
  await page.locator('#btn-ds-tell-submit').click();
  await page.locator('#ds-tell-form').waitFor({ state: 'hidden', timeout: 20_000 });
}

async function visibleTexts(page: Page): Promise<string[]> {
  return page.locator('#digital-self-page .ds-text').allTextContents();
}

async function waitForUnderstanding(page: Page, text: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const loc = page.locator('#digital-self-page .ds-text', { hasText: text });
    if (await loc.isVisible().catch(() => false)) return;
    await openDigitalSelf(page);
    await page.waitForTimeout(250);
  }
  await page.locator('#digital-self-page .ds-text', { hasText: text }).waitFor({
    state: 'visible',
    timeout: 1_000,
  });
}

async function pageCopy(page: Page): Promise<string> {
  return page.locator('#digital-self-page').innerText();
}

async function saveEvidence(name: string, page: Page, extra?: unknown): Promise<void> {
  await fs.mkdir(EVIDENCE, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE, `${name}.png`),
    fullPage: true,
  });
  const dump = {
    headline: await page.locator('#ds-headline').innerText(),
    notice: await page.locator('#ds-notice').innerText(),
    groups: await page.evaluate(`(() => {
      return Array.from(document.querySelectorAll('#ds-groups .ds-group')).map((section) => ({
        title: (section.querySelector('h2') && section.querySelector('h2').textContent) || '',
        items: Array.from(section.querySelectorAll('.ds-text')).map((el) => el.textContent || ''),
      }));
    })()`),
    extra: extra ?? null,
  };
  await fs.writeFile(path.join(EVIDENCE, `${name}.json`), `${JSON.stringify(dump, null, 2)}\n`, 'utf8');
}

test('Electron：数字之我最小闭环 10 项真实验收', { timeout: 240_000 }, async () => {
  await fs.mkdir(EVIDENCE, { recursive: true });
  const mixed = path.join(EVIDENCE, 'mixed-import.md');
  const conflict = path.join(EVIDENCE, 'conflict-lisi.md');
  await fs.writeFile(
    mixed,
    [
      '我喜欢早起处理事情。',
      '',
      '# 量子物理导论',
      '波函数坍缩是量子力学的基础概念。薛定谔方程描述了非相对论量子系统的演化。',
      '氢原子能级与泡利不相容原理属于教材内容，与本人无关。本节还有很长的无关推导。',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(conflict, '我叫李四。这是一份夹杂无关备注的资料。\n', 'utf8');

  const first = await launchDigitalMeElectron({ extraEnv: STUB_ENV });
  try {
    await skipWelcomeAndEnterShell(first.page);
    await openDigitalSelf(first.page);
    const headline = await first.page.locator('#ds-headline').innerText();
    assert.equal(headline.includes('2digime 现在怎样理解我'), true);
    assert.equal(await first.page.locator('#growth-block').isVisible(), false);

    await tell(first.page, '我叫张三');
    await waitForUnderstanding(first.page, '张三');
    let copy = await pageCopy(first.page);
    assert.match(copy, /张三/);
    assert.equal(copy.includes('Candidate'), false);
    assert.equal(copy.includes('provenance'), false);
    assert.equal(copy.includes('pipeline'), false);
    await saveEvidence('01-name-zhangsan', first.page);

    await tell(first.page, '我现在主要在做 A 项目');
    await waitForUnderstanding(first.page, 'A 项目');
    copy = await pageCopy(first.page);
    assert.match(copy, /A 项目/);
    await saveEvidence('02-project-a', first.page);

    await first.page.locator('#ds-import-file').setInputFiles(mixed);
    await waitForUnderstanding(first.page, '早起');
    copy = await pageCopy(first.page);
    assert.equal(copy.includes('薛定谔'), false);
    assert.equal(copy.includes('波函数'), false);
    assert.equal(copy.includes('氢原子'), false);
    const morning = first.page.locator('#digital-self-page .ds-item', { hasText: '早起' });
    const morningSource = await morning.locator('.ds-source p').textContent();
    assert.match(String(morningSource || ''), /尚未确认|需要你确认/);
    await saveEvidence('03-import-mixed', first.page);

    await tell(first.page, '刚才那个不对，应该是 B');
    await waitForUnderstanding(first.page, 'B 项目');
    const afterCorrect = await visibleTexts(first.page);
    assert.ok(afterCorrect.some((text) => text.includes('B 项目')));
    assert.equal(afterCorrect.some((text) => text.includes('A 项目')), false);
    await saveEvidence('05-correct-to-b', first.page);

    await tell(first.page, '我叫张三');
    const names = (await visibleTexts(first.page)).filter((text) => text.includes('张三'));
    assert.equal(names.length, 1);

    await first.page.locator('#ds-import-file').setInputFiles(conflict);
    await waitForUnderstanding(first.page, '李四');
    const afterConflict = await visibleTexts(first.page);
    assert.ok(afterConflict.some((text) => text.includes('张三')));
    const lisiGroup = await first.page.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.ds-item'));
      const lisi = items.find((el) => (el.textContent || '').includes('李四'));
      const group = lisi && lisi.closest('.ds-group');
      const h2 = group && group.querySelector('h2');
      return (h2 && h2.textContent) || '';
    })()`);
    assert.equal(lisiGroup, '正在了解');
    const zhangGroup = await first.page.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.ds-item'));
      const zhang = items.find((el) => (el.textContent || '').includes('张三'));
      const group = zhang && zhang.closest('.ds-group');
      const h2 = group && group.querySelector('h2');
      return (h2 && h2.textContent) || '';
    })()`);
    assert.equal(zhangGroup, '关于我');
    await saveEvidence('08-conflict-lisi', first.page);

    await first.page.locator('#digital-self-page .ds-item', { hasText: '早起' }).locator('button[data-act="delete"]').click();
    await first.page.waitForFunction(`(() => {
      const texts = Array.from(document.querySelectorAll('#digital-self-page .ds-text')).map((el) => el.textContent || '');
      return !texts.some((text) => text.includes('早起'));
    })()`);
    await saveEvidence('06-deleted-morning', first.page);

    const userData = first.userData;
    await first.close();

    const second = await launchDigitalMeElectron({ extraEnv: STUB_ENV, userData });
    try {
      await skipWelcomeAndEnterShell(second.page);
      await second.page.waitForTimeout(800);
      await openDigitalSelf(second.page);
      await waitForUnderstanding(second.page, '张三');
      const restarted = await visibleTexts(second.page);
      assert.ok(restarted.some((text) => text.includes('张三')));
      assert.ok(restarted.some((text) => text.includes('B 项目')));
      assert.equal(restarted.some((text) => text.includes('A 项目')), false);
      assert.equal(restarted.some((text) => text.includes('早起')), false);
      assert.ok(restarted.some((text) => text.includes('李四')));
      assert.equal(restarted.filter((text) => text.includes('张三')).length, 1);
      const selfJson = path.join(userData, 'subjects', 'default', 'digital-self', 'self.json');
      const raw = await fs.readFile(selfJson, 'utf8');
      const parsed = JSON.parse(raw) as { understandings?: unknown[] };
      assert.ok(Array.isArray(parsed.understandings));
      await saveEvidence('09-restart', second.page, { authorityFile: selfJson });
      await fs.writeFile(
        path.join(EVIDENCE, 'results.json'),
        `${JSON.stringify(
          {
            checks: {
              name: true,
              projectContext: true,
              mixedImportNotAllMe: true,
              inferenceNotConfirmed: true,
              correctionUsesB: true,
              deletePersists: true,
              noDuplicateName: true,
              conflictNotSilent: true,
              restartConsistent: true,
              singleAuthorityFile: true,
            },
            texts: restarted,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    } finally {
      await second.close();
    }
  } catch (err) {
    try {
      await first.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
});
