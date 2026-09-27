import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateArticle } from './news-lib.mjs';

const eventPath = process.env.GITHUB_EVENT_PATH || process.argv[2];
if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');
const event = JSON.parse(readFileSync(eventPath, 'utf8'));
if (event.action !== 'publish_news') throw new Error('unsupported repository_dispatch action');
const article = validateArticle({ ...event.client_payload, schemaVersion: 1, author: '兔机米编辑部', production: event.client_payload?.production || 'AI 协作整理' });
const root = resolve('content/news');
mkdirSync(root, { recursive: true });
for (const name of readdirSync(root).filter((item) => item.endsWith('.json'))) {
  const current = JSON.parse(readFileSync(resolve(root, name), 'utf8'));
  if (current.id === article.id) {
    if (JSON.stringify(validateArticle(current)) === JSON.stringify(article)) {
      console.log(`article ${article.id} already exists with identical content`);
      process.exit(0);
    }
    throw new Error(`article id already exists: ${article.id}`);
  }
  if (current.slug === article.slug) throw new Error(`article slug already exists: ${article.slug}`);
}
const file = resolve(root, `${article.publishedAt}-${article.slug}.json`);
if (existsSync(file)) throw new Error(`target file already exists: ${file}`);
writeFileSync(file, `${JSON.stringify(article, null, 2)}\n`, { flag: 'wx' });
console.log(`accepted article ${article.id} -> ${file}`);
