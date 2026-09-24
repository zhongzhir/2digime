const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
(async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'news-supply-ui-'));
  await fs.writeFile(
    path.join(userData, 'web-discovery.json'),
    JSON.stringify({ version: 1, enabled: true, path: 'byok' }),
  );
  await fs.writeFile(
    path.join(userData, 'ai-capability.json'),
    JSON.stringify({ version: 1, path: 'byok' }),
  );
  const env = {
    ...process.env,
    DIGITALME_V2_USER_DATA: userData,
    DIGITALME_V2_CREDENTIAL_IMPORT: process.env.DIGITALME_MODEL_RUNTIME_FILE,
    DIGITALME_V2_ELECTRON_TEST: '0',
    DIGITALME_V2_UX_ACCEPTANCE: '0',
    DIGITALME_V2_DIGITAL_SELF_STUB: '0',
    DIGITALME_V2_TALK_STUB: '0',
  };
  delete env.NODE_TEST_CONTEXT;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: process.env.DIGITALME_TEST_ELECTRON,
    args: [path.resolve('electron/main.cjs')],
    cwd: process.cwd(),
    env,
    timeout: 60000,
  });
  const rows = [];
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () => !!window.ContentDiscoverPage && !!window.digitalMe,
    );
    await page.evaluate(() =>
      window.ShellNav.setNav('discover', { skipRefresh: true }),
    );
    const queries = [
      '今天 AI 有什么重要新闻？',
      '最近有哪些关于具身智能的重要消息？',
      '找一篇少数派最近的普通图文文章，直接阅读正文',
      '找一个机核的音频节目听听',
    ];
    await fs.mkdir('build/evidence/news-supply-01', { recursive: true });
    for (let i = 0; i < queries.length; i++) {
      console.log('UI START', i + 1);
      const at = Date.now();
      // Call the exact handler bound to the user's search form. No response injection.
      await page.evaluate(
        (query) => window.ContentDiscoverPage.seek(query),
        queries[i],
      );
      const state = await page.evaluate(() => ({
        title: document.querySelector('#content-discover-title')?.textContent,
        notice: document.querySelector('#content-discover-notice')?.textContent,
        cards: [...document.querySelectorAll('.content-discover-card')].map(
          (el) => ({
            title: el.querySelector('h3')?.textContent,
            source: el.querySelector('.content-discover-source')?.textContent,
            type: el.querySelector('.content-discover-kind')?.textContent,
            reader: !![...el.querySelectorAll('summary')].find(
              (s) => s.textContent === '直接阅读',
            ),
          }),
        ),
      }));
      const reader = page
        .locator('summary')
        .filter({ hasText: '直接阅读' })
        .first();
      if (await reader.count()) await reader.click();
      await page.screenshot({
        path: `build/evidence/news-supply-01/ui-${i + 1}.png`,
        fullPage: true,
      });
      rows.push({
        case: i + 1,
        query: queries[i],
        ms: Date.now() - at,
        ...state,
      });
      console.log('UI END', i + 1, 'cards', state.cards.length);
      await fs.writeFile(
        'docs/audits/evidence/news-supply-01/ui.json',
        JSON.stringify(
          {
            entry:
              'Electron main.cjs / preload IPC / formal renderer seek handler',
            stub: false,
            rows,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e.name, String(e.message).slice(0, 300));
  process.exitCode = 1;
});
