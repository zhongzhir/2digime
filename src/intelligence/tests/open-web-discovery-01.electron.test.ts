/**
 * OPEN-WEB-CONTENT-DISCOVERY-01：Owner 打开一级发现，不指定网站。
 * 复用本机已加密 SecretStore 副本（不明文导出密钥）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
  isolatedUserDataDir,
  officialAppUserDataPath,
  REPO_ROOT,
} from '../../runtime/tests/electron-harness';

const EVIDENCE = path.join(REPO_ROOT, 'build', 'evidence', 'open-web-content-discovery-01');

async function copyEncryptedSecrets(userData: string): Promise<{ model: string; copied: boolean }> {
  const official = officialAppUserDataPath();
  const cfgPath = path.join(official, 'model-config.json');
  const secretsPath = path.join(official, 'secrets.v2.json');
  if (!existsSync(cfgPath) || !existsSync(secretsPath)) {
    return { model: '', copied: false };
  }
  await fs.copyFile(cfgPath, path.join(userData, 'model-config.json'));
  await fs.copyFile(secretsPath, path.join(userData, 'secrets.v2.json'));
  const localState = path.join(official, 'Local State');
  if (existsSync(localState)) {
    await fs.copyFile(localState, path.join(userData, 'Local State'));
  }
  const cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8')) as { model?: string };
  return { model: String(cfg.model || ''), copied: true };
}

test('Electron Discover cold start uses live Gemini + DeepSeek without specifying a website', { timeout: 360_000 }, async (t) => {
  if (!String(process.env.GEMINI_API_KEY || '').trim()) {
    t.skip('GEMINI_API_KEY missing');
    return;
  }
  const userData = await isolatedUserDataDir('dm-open-web-gate-');
  const copied = await copyEncryptedSecrets(userData);
  if (!copied.copied) {
    t.skip('official encrypted SecretStore missing');
    return;
  }
  assert.equal(copied.model, 'deepseek-v4-flash');
  const harness = await launchDigitalMeElectron({
    userData,
    extraEnv: {
      DIGITALME_V2_UX_ACCEPTANCE: '0',
      DIGITALME_V2_DIGITAL_SELF_STUB: '0',
      DIGITALME_V2_TALK_STUB: '0',
      DIGITALME_V2_OPEN_WEB_DISCOVERY: '1',
    },
  });
  try {
    await skipWelcomeAndEnterShell(harness.page);
    const status = (await harness.page.evaluate(`(async () => window.digitalMe.getModelStatus())()`)) as {
      modelReady?: boolean;
      status?: { model?: string; geminiSearchConfigured?: boolean };
    };
    assert.equal(!!status.modelReady, true, 'DeepSeek SecretStore did not become modelReady');
    assert.equal(status.status?.model || copied.model, 'deepseek-v4-flash');

    await harness.page.locator('#nav-discover').click();
    await harness.page.locator('#panel-discover').waitFor({ state: 'visible', timeout: 15_000 });
    const deadline = Date.now() + 240_000;
    let view: { cards?: Array<{ title?: string; url?: string; reason?: string; itemId?: string }>; notice?: string } = {};
    while (Date.now() < deadline) {
      view = (await harness.page.evaluate(`(async () => {
        const result = await window.digitalMe.invoke('content', { action: 'discover' });
        return result && result.view ? result.view : {};
      })()`)) as typeof view;
      if ((view.cards || []).some((card) => /^https:\/\//i.test(String(card.url || '')))) break;
      await harness.page.waitForTimeout(3000);
    }
    const cards = view.cards || [];
    const shown = cards.filter((card) => /^https:\/\//i.test(String(card.url || '')));
    assert.ok(shown.length >= 1, `Discover produced no public URL cards: ${String(view.notice || '').slice(0, 180)}`);
    const first = shown[0]!;
    assert.ok(first.itemId && !String(first.itemId).startsWith('seek_'));
    assert.ok(String(first.reason || '').trim());
    assert.equal(JSON.stringify(view).toLowerCase().includes('preferencevector'), false);

    await harness.page.evaluate(`(() => {
      window.__openedUrls = [];
      window.open = (url) => { window.__openedUrls.push(String(url || '')); return null; };
      if (window.ContentDiscoverPage && typeof window.ContentDiscoverPage.renderView === 'function') {
        window.ContentDiscoverPage.renderView(${JSON.stringify({
          headline: '发现',
          lead: view && (view as { lead?: string }).lead,
          cards,
          preferences: [],
          notice: '',
        })});
      }
    })()`);
    await harness.page.locator('.content-discover-card .content-discover-actions button', { hasText: '打开' }).first().click();
    const opened = (await harness.page.evaluate(`window.__openedUrls || []`)) as string[];
    assert.match(String(opened[0] || first.url), /^https:\/\//);

    let viaSearch = false;
    const walk = async (dir: string) => {
      let entries: string[] = [];
      try {
        entries = await fs.readdir(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        const full = path.join(dir, name);
        const st = await fs.stat(full);
        if (st.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!name.endsWith('.json') || !dir.replace(/\\/g, '/').includes('network-items')) continue;
        const raw = JSON.parse(await fs.readFile(full, 'utf8')) as {
          provenance?: { via?: string };
          content?: { text?: string };
        };
        if (raw.provenance?.via === 'search') viaSearch = true;
        assert.equal(/<html[\s>]/i.test(String(raw.content?.text || '')), false);
      }
    };
    await walk(userData);

    await fs.mkdir(EVIDENCE, { recursive: true });
    await fs.writeFile(
      path.join(EVIDENCE, 'discover-cold-start.json'),
      `${JSON.stringify(
        {
          stub: false,
          model: 'deepseek-v4-flash',
          gemini: 'live',
          websiteSpecified: false,
          notice: view.notice || '',
          shown: shown.slice(0, 6).map((card) => ({
            itemId: card.itemId,
            title: String(card.title || '').slice(0, 120),
            url: card.url,
            reason: String(card.reason || '').slice(0, 80),
          })),
          openedUrl: opened[0] || first.url,
          directoryHasSearchProvenance: viaSearch,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  } finally {
    await harness.close();
  }
});
