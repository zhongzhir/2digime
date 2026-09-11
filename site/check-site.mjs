import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve('site');
const pages = ['index.html', 'personal/index.html', 'institution/index.html', 'download/index.html', '404.html'];
const errors = [];

for (const page of pages) {
  const file = resolve(root, page);
  const html = readFileSync(file, 'utf8');
  for (const required of ['lang="zh-CN"', '<title>', 'name="viewport"']) {
    if (!html.includes(required)) errors.push(`${page}: missing ${required}`);
  }
  if (page !== '404.html' && !html.includes('name="description"')) errors.push(`${page}: missing description`);
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
for (const forbidden of ['已服务中国电信', '已服务招商银行', '支持所有大模型', '银行级认证', '完全合规', '百万用户验证']) {
  if (all.includes(forbidden)) errors.push(`forbidden claim: ${forbidden}`);
}
for (const asset of ['tujimi-0.1.0-public-alpha-win-x64-setup.exe', 'tujimi-0.1.0-public-alpha-win-x64.zip']) {
  if (!all.includes(asset)) errors.push(`missing release asset: ${asset}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`site check passed: ${pages.length} pages, local links and truthfulness guard`);
