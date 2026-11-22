#!/usr/bin/env node
/* Real Electron, real source, real model five-page and source-management gate. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FileNetworkItemStore } = require('../dist/relay-service/network-item-store.js');
const { writeDigitalSelf } = require('../dist/subject-core/digital-self/store.js');
const {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} = require('../dist/runtime/tests/electron-harness.js');
const { listStore, runCycle } = require('./discover-stage1-source-health-check.cjs');

const OUTPUT_DIR = path.resolve(
  process.env.DISCOVER_ELECTRON_OUTPUT_DIR ||
    'build/evidence/discover-stage1-electron-20261111',
);
const REPORT_FILE = path.join(OUTPUT_DIR, 'report.json');
const CUSTOM_SOURCE_URL = 'https://feeds.bbci.co.uk/zhongwen/simp/rss.xml';
const CUSTOM_SOURCE_LABEL = 'BBC 中文公开源验收';

function selfOf(subjectId, now) {
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: [
      ['about_me', '我长期关注人工智能产品、开放技术与数字内容。'],
      ['goals', '我希望发现有事实、有来源、能扩展视野的内容。'],
      ['preferences', '在文章之外，也愿意看优质图片、音频和视频。'],
    ].map(([facet, text], index) => ({
      id: `u_electron_discover_${index + 1}`,
      text,
      facet,
      status: 'current',
      confirmed: true,
      provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
      updatedAt: now,
    })),
  };
}

async function waitForCardCount(page, expected, timeout = 120_000) {
  await page.locator('#content-discover-list > li').nth(expected - 1).waitFor({
    state: 'attached',
    timeout,
  });
  return page.locator('#content-discover-list > li').count();
}

async function scrollFeedToEnd(page) {
  await page.locator('#panel-discover').hover();
  await page.mouse.wheel(0, 5000);
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const now = new Date().toISOString();
  const harness = await launchDigitalMeElectron({
    realProduct: true,
    extraEnv: {
      DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
      DIGITALME_V2_SEARCH_ENABLED: '0',
      DIGITALME_MODEL_API_KEY: '',
      OPENAI_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      DASHSCOPE_API_KEY: '',
    },
  });
  const { page, userData } = harness;
  try {
    await skipWelcomeAndEnterShell(page);
    const overview = await page.evaluate(() => window.digitalMe.invoke('subject.getOverview', {}));
    const packageRoot = path.join(userData, 'subjects', 'default');
    await writeDigitalSelf(packageRoot, selfOf(overview.subjectId, now));
    const store = new FileNetworkItemStore(path.join(packageRoot, 'content'));
    const sourceCycle = await runCycle({ packageRoot, store, cycle: 1 });
    const seeded = await listStore(store, now);
    assert.ok(seeded.length >= 72, `real source seed only produced ${seeded.length} items`);

    await page.locator('#nav-discover').click();
    await page.locator('#panel-discover').waitFor({ state: 'visible', timeout: 20_000 });
    const checkpoints = [];
    checkpoints.push(await waitForCardCount(page, 12));
    for (const expected of [24, 36, 48, 60]) {
      await scrollFeedToEnd(page);
      checkpoints.push(await waitForCardCount(page, expected, 180_000));
    }
    const cards = await page.locator('#content-discover-list > li').evaluateAll((rows) =>
      rows.slice(0, 60).map((row) => ({
        itemId: row.getAttribute('data-item-id') || '',
        title: row.querySelector('h3')?.textContent?.trim() || '',
        source: row.querySelector('.content-discover-source')?.textContent?.trim() || '',
        href: row.getAttribute('data-url') || '',
        openAction: Array.from(row.querySelectorAll('.content-discover-actions > button'))
          .map((button) => button.textContent?.trim() || '')
          .find((label) => /^(阅读原文|打开|去原站)/.test(label)) || '',
      })),
    );
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'feed-page-5.png'), fullPage: true });

    await page.getByRole('button', { name: '内容来源', exact: true }).click();
    await page.locator('#content-discover-sources').waitFor({ state: 'visible' });
    await page.locator('#content-source-list > li').nth(19).waitFor({
      state: 'attached',
      timeout: 30_000,
    });
    const sourcesBefore = await page.locator('#content-source-list > li').count();
    await page.locator('#content-source-url').fill(CUSTOM_SOURCE_URL);
    await page.locator('#content-source-label').fill(CUSTOM_SOURCE_LABEL);
    await page.locator('#btn-content-source-add').click();
    const customRow = page.locator('#content-source-list > li').filter({ hasText: CUSTOM_SOURCE_LABEL });
    await customRow.waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('#content-source-notice').filter({ hasText: /^已加入/ }).waitFor({
      state: 'visible',
      timeout: 30_000,
    });
    const statusAfterAdd = await customRow.locator('.content-source-status').innerText();
    await customRow.getByRole('button', { name: '停用', exact: true }).click();
    await customRow.getByRole('button', { name: '启用', exact: true }).waitFor({ state: 'visible' });
    await customRow.getByRole('button', { name: '启用', exact: true }).click();
    await customRow.getByRole('button', { name: '停用', exact: true }).waitFor({ state: 'visible' });
    const sourcesAfter = await page.locator('#content-source-list > li').count();
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'source-management.png'), fullPage: true });

    const uniqueItems = new Set(cards.map((card) => card.itemId)).size;
    const uniqueLinks = new Set(cards.map((card) => card.href).filter(Boolean)).size;
    const openActions = cards.filter((card) => card.href && card.openAction).length;
    const report = {
      version: 1,
      generatedAt: new Date().toISOString(),
      realProduct: true,
      isolatedUserData: userData,
      packageRoot,
      sourceCycle,
      seededItems: seeded.length,
      feed: {
        checkpoints,
        capturedCards: cards.length,
        uniqueItems,
        uniqueLinks,
        openActions,
      },
      sourceManagement: {
        sourcesBefore,
        sourcesAfter,
        customSourceUrl: CUSTOM_SOURCE_URL,
        customSourceLabel: CUSTOM_SOURCE_LABEL,
        statusAfterAdd,
        disableEnableRoundTrip: true,
      },
      gates: {
        fivePages: checkpoints.length === 5 && checkpoints.every((count, index) => count >= (index + 1) * 12),
        unique60: cards.length === 60 && uniqueItems === 60,
        linked60: uniqueLinks === 60 && openActions === 60,
        sourcePortfolioVisible: sourcesBefore >= 20,
        sourceAddWithoutCode: sourcesAfter === sourcesBefore + 1,
        sourceToggleRoundTrip: true,
      },
    };
    report.result = Object.values(report.gates).every(Boolean) ? 'PASS' : 'FAIL';
    await fs.writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ event: 'final', reportFile: REPORT_FILE, report }, null, 2)}\n`);
    if (report.result !== 'PASS') process.exitCode = 1;
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
