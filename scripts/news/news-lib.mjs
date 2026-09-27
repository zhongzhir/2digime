import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const CATEGORIES = ['人的主体性', 'AI 与人', '兔机米进展'];
export const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://2digime.com';

export function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function assertText(value, name, min, max) {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  const text = value.trim();
  if (text.length < min || text.length > max) throw new Error(`${name} must be ${min}-${max} characters`);
  return text;
}

export function validateArticle(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('article must be an object');
  const allowed = new Set(['schemaVersion', 'id', 'slug', 'title', 'summary', 'category', 'publishedAt', 'author', 'production', 'body', 'sources']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`unsupported field: ${key}`);
  if (input.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  const id = assertText(input.id, 'id', 8, 100);
  const slug = assertText(input.slug, 'slug', 4, 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('slug must use lowercase letters, numbers and hyphens');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(id)) throw new Error('id contains unsupported characters');
  const title = assertText(input.title, 'title', 8, 120);
  const summary = assertText(input.summary, 'summary', 20, 240);
  if (!CATEGORIES.includes(input.category)) throw new Error(`category must be one of: ${CATEGORIES.join(', ')}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.publishedAt) || Number.isNaN(Date.parse(`${input.publishedAt}T00:00:00Z`))) throw new Error('publishedAt must be a valid YYYY-MM-DD date');
  const author = input.author === undefined ? '兔机米编辑部' : assertText(input.author, 'author', 2, 40);
  if (author !== '兔机米编辑部') throw new Error('author must be 兔机米编辑部');
  const production = input.production === undefined ? 'AI 协作整理' : assertText(input.production, 'production', 2, 40);
  if (!['AI 协作整理', '人工撰写'].includes(production)) throw new Error('unsupported production value');
  const body = assertText(input.body, 'body', 100, 20000);
  if (/<\/?[a-z][^>]*>/i.test(body)) throw new Error('raw HTML is not accepted');
  const sources = input.sources ?? [];
  if (!Array.isArray(sources) || sources.length > 12) throw new Error('sources must be an array with at most 12 entries');
  const safeSources = sources.map((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`sources[${index}] must be an object`);
    const label = assertText(source.label, `sources[${index}].label`, 2, 100);
    const url = assertText(source.url, `sources[${index}].url`, 10, 500);
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`sources[${index}].url must use http or https`);
    return { label, url };
  });
  return { schemaVersion: 1, id, slug, title, summary, category: input.category, publishedAt: input.publishedAt, author, production, body, sources: safeSources };
}

export function loadArticles(root = resolve('content/news')) {
  const seenIds = new Set();
  const seenSlugs = new Set();
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => validateArticle(JSON.parse(readFileSync(resolve(root, entry.name), 'utf8'))))
    .map((article) => {
      if (seenIds.has(article.id)) throw new Error(`duplicate article id: ${article.id}`);
      if (seenSlugs.has(article.slug)) throw new Error(`duplicate article slug: ${article.slug}`);
      seenIds.add(article.id);
      seenSlugs.add(article.slug);
      return article;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug));
}

function inline(text) {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

export function renderBody(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const out = [];
  let paragraph = [];
  let list = [];
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushParagraph(); flushList(); continue; }
    if (line.startsWith('### ')) { flushParagraph(); flushList(); out.push(`<h3>${inline(line.slice(4))}</h3>`); continue; }
    if (line.startsWith('## ')) { flushParagraph(); flushList(); out.push(`<h2>${inline(line.slice(3))}</h2>`); continue; }
    if (line.startsWith('- ')) { flushParagraph(); list.push(line.slice(2)); continue; }
    if (line.startsWith('> ')) { flushParagraph(); flushList(); out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); continue; }
    flushList(); paragraph.push(line);
  }
  flushParagraph(); flushList();
  return out.join('\n');
}

export function formatDate(value) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}
