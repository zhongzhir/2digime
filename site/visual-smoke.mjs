import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.env.SITE_BASE_URL || 'http://127.0.0.1:4173';
const routes = [
  ['home', '/'],
  ['personal', '/personal/'],
  ['institution', '/institution/'],
  ['download', '/download/'],
];
const viewports = [
  ['desktop', { width: 1440, height: 1000 }],
  ['mobile', { width: 390, height: 844 }],
];
const out = resolve('build/site-smoke');
mkdirSync(out, { recursive: true });
const report = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
});

for (const [size, viewport] of viewports) {
  const context = await browser.newContext({ viewport });
  for (const [name, route] of routes) {
    const page = await context.newPage();
    const consoleErrors = [];
    const requestFailures = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('requestfailed', (request) => requestFailures.push(`${request.url()}: ${request.failure()?.errorText}`));
    const response = await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
    const metrics = await page.evaluate(() => ({
      title: document.title,
      lang: document.documentElement.lang,
      width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      h1: document.querySelector('h1')?.textContent?.trim(),
    }));
    if (size === 'mobile') {
      await page.locator('.nav-toggle').click();
      if (!(await page.locator('.site-nav').isVisible())) consoleErrors.push('mobile navigation did not open');
    }
    await page.screenshot({ path: resolve(out, `${name}-${size}.png`), fullPage: true });
    report.push({ name, route, size, status: response?.status(), ...metrics, overflow: metrics.width > metrics.viewport + 1, consoleErrors, requestFailures });
    await page.close();
  }
  await context.close();
}

await browser.close();
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
const failures = report.filter((item) => item.status !== 200 || item.overflow || item.consoleErrors.length || item.requestFailures.length || item.lang !== 'zh-CN' || !item.h1);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log(`visual smoke passed: ${report.length} route/viewport combinations`);
