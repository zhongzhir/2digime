import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve('site');
function collectHtml(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? collectHtml(resolve(dir, entry.name), relative) : (entry.name.endsWith('.html') ? [relative] : []);
  });
}

const pages = collectHtml(root);
const errors = [];

for (const page of pages) {
  const file = resolve(root, page);
  const html = readFileSync(file, 'utf8');
  for (const required of ['lang="zh-CN"', '<title>', 'name="viewport"']) {
    if (!html.includes(required)) errors.push(`${page}: missing ${required}`);
  }
  if (page !== '404.html' && !html.includes('name="description"')) errors.push(`${page}: missing description`);
  if (page.startsWith('news/') && /<script\b(?![^>]*type="application\/ld\+json")/i.test(html.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/gi, ''))) errors.push(`${page}: unexpected inline script`);
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = match[1];
    if (/^(https?:|#|mailto:|\/)/.test(target)) continue;
    const clean = target.split('#')[0].split('?')[0];
    let local = resolve(dirname(file), clean);
    if (clean.endsWith('/')) local = resolve(local, 'index.html');
    if (!existsSync(local)) errors.push(`${page}: broken local reference ${target}`);
  }
}

const all = pages.map((page) => readFileSync(resolve(root, page), 'utf8')).join('\n');
const marketingPages = ['index.html', 'personal/index.html', 'institution/index.html', 'download/index.html'].map((page) => readFileSync(resolve(root, page), 'utf8')).join('\n');
for (const term of ['Digital Self', 'Core', 'Brand Kit', 'Adapter', 'entitlement', 'quota', 'usage', 'LiteLLM', 'L1', 'L2', 'L3', 'L4', 'L5', 'fork', 'runtime']) {
  if (marketingPages.includes(term)) errors.push(`engineering term in user page: ${term}`);
}
for (const forbidden of ['已服务中国电信', '已服务招商银行', '支持所有大模型', '银行级认证', '完全合规', '百万用户验证']) {
  if (all.includes(forbidden)) errors.push(`forbidden claim: ${forbidden}`);
}
for (const asset of ['tujimi-0.1.0-public-alpha-win-x64-setup.exe', 'tujimi-0.1.0-public-alpha-win-x64.zip']) {
  if (!all.includes(asset)) errors.push(`missing release asset: ${asset}`);
}
if (!existsSync(resolve(root, 'news/feed.xml'))) errors.push('missing news RSS feed');
if (!readFileSync(resolve(root, 'sitemap.xml'), 'utf8').includes('/news/')) errors.push('sitemap is missing news');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`site check passed: ${pages.length} pages, local links, news feed and truthfulness guard`);
