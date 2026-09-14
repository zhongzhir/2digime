/**
 * PUBLIC-ALPHA-UX-CLOSURE-01：一级发现、数字之我概览、设置双列。
 * 正式 Electron 产品面；不改 Digital Self / content 语义。
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
import { ingestSource } from '../../subject-comm/content-ingest';
import { FileNetworkItemStore } from '../../relay-service/network-item-store';
import { listContentPreferences } from '../../subject-comm/content-preferences';

const STUB_ENV = {
  DIGITALME_V2_DIGITAL_SELF_STUB: '1',
  DIGITALME_V2_TALK_STUB: '1',
};

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Publisher</title>
    <item>
      <title>Fusion progress this week</title>
      <link>https://example.org/fusion</link>
      <description>A lab published new confinement results.</description>
    </item>
  </channel>
</rss>`;

test('Electron：Public Alpha UX closure 导航 / 发现 / 数字之我 / 设置', { timeout: 240_000 }, async () => {
  const harness = await launchDigitalMeElectron({ extraEnv: STUB_ENV });
  try {
    await skipWelcomeAndEnterShell(harness.page);
    const navText = await harness.page.locator('.main-nav').innerText();
    assert.match(navText, /与兔机米/);
    assert.match(navText, /发现/);
    assert.match(navText, /数字之我/);
    assert.match(navText, /设置/);
    assert.equal(await harness.page.locator('#nav-discover').isVisible(), true);
    assert.equal(await harness.page.locator('#panel-chat #content-discover').count(), 0);

    await harness.page.locator('#nav-discover').click();
    await harness.page.locator('#panel-discover').waitFor({ state: 'visible', timeout: 15_000 });
    const discoverCopy = await harness.page.locator('#panel-discover').innerText();
    assert.match(discoverCopy, /想找什么内容/);
    assert.match(discoverCopy, /还没有为你挑出的新内容|兔机米会从公开内容/);
    assert.equal(discoverCopy.includes('还没有新内容') && !discoverCopy.includes('还没有为你挑出'), false);
    assert.equal(await harness.page.locator('#content-discover-query').isVisible(), true);
    assert.equal(await harness.page.locator('#content-discover-empty').isVisible(), true);

    await harness.page.evaluate(`(() => {
      window.ContentDiscoverPage.renderView({
        headline: '发现',
        lead: '根据你刚说的话找的内容，保留来源链接，不是中心推荐。',
        cards: [{
          itemId: 'web_1',
          title: 'Fusion progress this week',
          text: 'A lab published new confinement results.',
          url: 'https://example.org/fusion',
          reason: '公开网页来源，不是目录推荐。',
          source: 'web',
        }],
        preferences: [],
        notice: '',
      });
    })()`);
    await harness.page.locator('.content-discover-card', { hasText: 'Fusion progress this week' }).waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    assert.equal(await harness.page.locator('.content-discover-card a, .content-discover-actions button', { hasText: '打开' }).count() >= 1, true);
    await harness.page.locator('.content-discover-actions button', { hasText: '稍后看' }).click();
    await harness.page.locator('#content-discover-later').waitFor({ state: 'visible', timeout: 10_000 });
    assert.match(await harness.page.locator('#content-discover-later').innerText(), /Fusion progress this week/);

    const loc = (await harness.page.evaluate(`(async () => window.digitalMe.getDefaultSubjectDir())()`)) as { dir?: string };
    assert.ok(loc && loc.dir);
    const pkgDir = loc.dir;
    const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
    const ingested = await ingestSource({
      sourceUrl: 'https://example.org/feed.xml',
      store,
      now: '2026-09-14T07:00:00.000Z',
      fetchImpl: async () => ({ status: 200, body: RSS, finalUrl: 'https://example.org/feed.xml' }),
    });
    const firstItem = ingested.items[0];
    assert.ok(firstItem);
    const itemId = firstItem.itemId;
    await harness.page.evaluate(`(async (id) => {
      return window.digitalMe.invoke('content', { action: 'open', itemId: id });
    })(${JSON.stringify(itemId)})`);
    await harness.page.evaluate(`(async (id) => {
      return window.digitalMe.invoke('content', { action: 'later', itemId: id });
    })(${JSON.stringify(itemId)})`);
    const prefPath = path.join(pkgDir, 'content', 'content-preferences.json');
    assert.equal(await fs.access(prefPath).then(() => true, () => false), false);
    await harness.page.evaluate(`(async (id) => {
      return window.digitalMe.invoke('content', { action: 'boost', itemId: id });
    })(${JSON.stringify(itemId)})`);
    const prefs = await listContentPreferences(pkgDir);
    assert.equal(prefs.length, 1);
    const firstPref = prefs[0];
    assert.ok(firstPref);
    assert.equal(firstPref.origin, 'user_action');
    await harness.page.evaluate(`(() => window.ContentDiscoverPage.refresh())()`);
    await harness.page.locator('.discover-switch[data-discover-section="prefs"]').click();
    await harness.page.locator('#content-discover-prefs').waitFor({ state: 'visible', timeout: 10_000 });
    assert.match(await harness.page.locator('#content-discover-prefs').innerText(), /加推类似|更想看到类似/);
    await harness.page.locator('#content-discover-pref-list button', { hasText: '撤销' }).click();
    await harness.page.waitForTimeout(400);
    assert.equal((await listContentPreferences(pkgDir)).length, 0);

    await harness.page.locator('#content-discover-query').fill('最近有什么值得看的 fusion 内容？');
    await harness.page.locator('#btn-content-discover-search').click();
    await harness.page.locator('#panel-discover').waitFor({ state: 'visible' });

    await harness.page.locator('#nav-subject').click();
    await harness.page.locator('#digital-self-page').waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(await harness.page.locator('#ds-overview').isVisible(), false);
    assert.equal(await harness.page.locator('#ds-ledger').isVisible().catch(() => false), false);
    await harness.page.locator('#btn-ds-tell').click();
    await harness.page.locator('#ds-tell-input').fill('我叫张三');
    await harness.page.locator('#btn-ds-tell-submit').click();
    await harness.page.locator('#ds-overview-body .ds-text', { hasText: '张三' }).waitFor({
      state: 'visible',
      timeout: 20_000,
    });
    assert.equal(await harness.page.locator('#ds-overview').isVisible(), true);
    assert.equal(await harness.page.locator('#ds-ledger').isVisible().catch(() => false), false);
    await harness.page.locator('#btn-ds-open-ledger').click();
    await harness.page.locator('#ds-ledger').waitFor({ state: 'visible', timeout: 10_000 });
    const openGroups = await harness.page.locator('#ds-groups details[open]').count();
    assert.equal(openGroups, 0);
    assert.equal(await harness.page.locator('#digital-self-page .ds-item button[data-act="correct"]').count() >= 1, true);
    assert.equal(await harness.page.locator('#digital-self-page .ds-item button[data-act="delete"]').count() >= 1, true);
    await harness.page.locator('#btn-ds-close-ledger').click();
    await harness.page.locator('#ds-overview').waitFor({ state: 'visible' });

    await harness.page.setViewportSize({ width: 1280, height: 900 });
    await harness.page.locator('#nav-settings').click();
    await harness.page.locator('#view-settings').waitFor({ state: 'visible', timeout: 15_000 });
    const wide = await harness.page.evaluate(`(() => {
      const el = document.querySelector('#view-settings .settings-panel');
      return el ? getComputedStyle(el).gridTemplateColumns : '';
    })()`);
    assert.equal(String(wide).split(' ').filter(Boolean).length >= 2, true, `desktop grid was ${wide}`);
    assert.match(await harness.page.locator('#view-settings').innerText(), /AI 连接/);
    assert.match(await harness.page.locator('#view-settings').innerText(), /联网搜索/);
    assert.equal(await harness.page.locator('#model-provider').isVisible(), true);
    assert.equal(await harness.page.locator('#gemini-search-api-key').isVisible(), true);
    await harness.page.setViewportSize({ width: 520, height: 900 });
    const narrow = await harness.page.evaluate(`(() => {
      const el = document.querySelector('#view-settings .settings-panel');
      return el ? getComputedStyle(el).gridTemplateColumns : '';
    })()`);
    assert.equal(String(narrow).split(' ').filter(Boolean).length, 1, `narrow grid was ${narrow}`);
  } finally {
    await harness.close();
  }
});
