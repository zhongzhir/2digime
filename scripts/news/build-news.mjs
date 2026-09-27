import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { escapeHtml, formatDate, loadArticles, renderBody, SITE_ORIGIN } from './news-lib.mjs';

const site = resolve('site');
const output = resolve(site, 'news');
const articles = loadArticles();
const asset = (depth, file) => `${'../'.repeat(depth)}assets/${file}`;
const home = (depth) => '../'.repeat(depth);

function nav(depth, current = false) {
  const root = home(depth);
  return `<header class="site-header"><div class="nav-shell"><a class="brand" href="${root}" aria-label="兔机米首页"><img src="${asset(depth, 'brand-mark.svg')}" alt=""><span>兔机米 <small>2digime</small></span></a><button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="打开导航">菜单</button><nav class="site-nav" id="site-nav" aria-label="主导航"><a href="${root}personal/">个人版</a><a href="${root}institution/">机构合作</a><a href="${root}suppliers/">内容供应商</a><a${current ? ' aria-current="page"' : ''} href="${root}news/">资讯</a><a class="nav-download" href="${root}download/">下载</a></nav></div></header>`;
}

function footer(depth) {
  const root = home(depth);
  return `<footer class="site-footer"><div class="container"><div class="footer-grid"><div class="footer-brand"><a class="brand" href="${root}"><img src="${asset(depth, 'brand-mark.svg')}" alt=""><span>兔机米 <small>2digime</small></span></a><p>关于人的主体性、AI 与人的关系，以及兔机米的真实进展。</p></div><div class="footer-col"><strong>了解</strong><a href="${root}personal/">个人版</a><a href="${root}institution/">机构合作</a><a href="${root}news/">资讯</a><a href="${root}download/">下载</a></div><div class="footer-col"><strong>订阅</strong><a href="${root}news/feed.xml">RSS</a><a href="https://github.com/zhongzhir/2digime">GitHub</a></div></div><div class="footer-bottom"><span>© <span data-year>2026</span> 兔机米 / 2digime</span><span>事实、观点与探索保持区分。</span></div></div></footer>`;
}

function shell({ title, description, canonical, body, depth, type = 'website', jsonLd = '' }) {
  return `<!doctype html>
<html lang="zh-CN"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${canonical}"><link rel="alternate" type="application/rss+xml" title="兔机米资讯" href="${SITE_ORIGIN}/news/feed.xml">
  <meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="${type}"><meta property="og:url" content="${canonical}">
  <meta name="theme-color" content="#fffdf8"><link rel="icon" href="${asset(depth, 'brand-mark.svg')}" type="image/svg+xml"><link rel="stylesheet" href="${asset(depth, 'styles.css')}"><script src="${asset(depth, 'site.js')}" defer></script>${jsonLd}
</head><body><a class="skip-link" href="#main">跳到主要内容</a>${nav(depth, true)}${body}${footer(depth)}</body></html>
`;
}

function card(article, href) {
  return `<article class="news-card"><div class="news-meta"><span>${escapeHtml(article.category)}</span><time datetime="${article.publishedAt}">${formatDate(article.publishedAt)}</time></div><h2><a href="${href}">${escapeHtml(article.title)}</a></h2><p>${escapeHtml(article.summary)}</p><a class="text-link" href="${href}">阅读全文 →</a></article>`;
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const cards = articles.map((article) => card(article, `${article.slug}/`)).join('\n');
const indexBody = `<main id="main"><section class="page-hero news-hero"><div class="container"><p class="eyebrow">兔机米资讯</p><h1>关注人的主体性，<br><span class="accent-text">也记录 AI 时代的真实进展。</span></h1><p class="lead">发布关于人的主体性、AI 与人的关系，以及兔机米产品与业务进展的文章。部分内容由 AI Agent 协作整理，并通过受控通道发布。</p><div class="meta-row"><span class="meta-pill">人的主体性</span><span class="meta-pill">AI 与人</span><span class="meta-pill">兔机米进展</span><a class="meta-pill" href="feed.xml">RSS 订阅</a></div></div></section><section class="section"><div class="container"><div class="news-grid">${cards}</div></div></section></main>`;
writeFileSync(resolve(output, 'index.html'), shell({ title: '资讯｜兔机米 2digime', description: '关于人的主体性、AI 与人的关系，以及兔机米产品与业务进展的公开文章。', canonical: `${SITE_ORIGIN}/news/`, body: indexBody, depth: 1 }));

for (const article of articles) {
  const dir = resolve(output, article.slug);
  mkdirSync(dir, { recursive: true });
  const sources = article.sources.length ? `<section class="article-sources"><h2>参考与来源</h2><ul>${article.sources.map((source) => `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.label)}</a></li>`).join('')}</ul></section>` : '';
  const articleBody = `<main id="main"><article class="article-shell"><header class="article-header"><a class="article-back" href="../">← 返回资讯</a><div class="news-meta"><span>${escapeHtml(article.category)}</span><time datetime="${article.publishedAt}">${formatDate(article.publishedAt)}</time></div><h1>${escapeHtml(article.title)}</h1><p class="article-deck">${escapeHtml(article.summary)}</p><p class="article-byline">${escapeHtml(article.author)} · ${escapeHtml(article.production)}</p></header><div class="article-body">${renderBody(article.body)}${sources}</div></article></main>`;
  const jsonLd = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: article.title, description: article.summary, datePublished: article.publishedAt, author: { '@type': 'Organization', name: article.author }, publisher: { '@type': 'Organization', name: '兔机米 2digime' }, mainEntityOfPage: `${SITE_ORIGIN}/news/${article.slug}/` }).replaceAll('<', '\\u003c')}</script>`;
  writeFileSync(resolve(dir, 'index.html'), shell({ title: `${article.title}｜兔机米资讯`, description: article.summary, canonical: `${SITE_ORIGIN}/news/${article.slug}/`, body: articleBody, depth: 2, type: 'article', jsonLd }));
}

const feedItems = articles.slice(0, 30).map((article) => `  <item><title>${escapeHtml(article.title)}</title><link>${SITE_ORIGIN}/news/${article.slug}/</link><guid isPermaLink="true">${SITE_ORIGIN}/news/${article.slug}/</guid><pubDate>${new Date(`${article.publishedAt}T00:00:00Z`).toUTCString()}</pubDate><description>${escapeHtml(article.summary)}</description><category>${escapeHtml(article.category)}</category></item>`).join('\n');
writeFileSync(resolve(output, 'feed.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>兔机米资讯</title><link>${SITE_ORIGIN}/news/</link><description>关于人的主体性、AI 与人的关系，以及兔机米的真实进展。</description><language>zh-CN</language>
${feedItems}
</channel></rss>
`);

const homeFile = resolve(site, 'index.html');
for (const page of ['index.html', 'personal/index.html', 'institution/index.html', 'download/index.html', 'suppliers/index.html']) {
  const file = resolve(site, page);
  let html = readFileSync(file, 'utf8');
  const root = page === 'index.html' ? '' : '../';
  if (!html.includes(`href="${root}news/">资讯</a>`)) {
    const supplierLink = page === 'suppliers/index.html'
      ? '<a aria-current="page" href="./">内容供应商</a>'
      : `<a href="${root}suppliers/">内容供应商</a>`;
    html = html.replace(supplierLink, `${supplierLink}<a href="${root}news/">资讯</a>`);
  }
  writeFileSync(file, html);
}
let homeHtml = readFileSync(homeFile, 'utf8');
const latest = articles.slice(0, 3).map((article) => card(article, `news/${article.slug}/`)).join('\n');
const latestBlock = `<!-- NEWS_LATEST_START --><section class="section paper"><div class="container"><div class="section-head"><p class="eyebrow">兔机米资讯</p><h2>关于人，也关于正在到来的世界</h2><p class="lead">我们持续讨论人的主体性、AI 与人的关系，并如实记录兔机米的产品与业务进展。</p></div><div class="news-grid news-grid-latest">${latest}</div><div class="actions"><a class="button button-primary" href="news/">查看全部资讯</a><a class="button" href="news/feed.xml">订阅 RSS</a></div></div></section><!-- NEWS_LATEST_END -->`;
if (!/<!-- NEWS_LATEST_START -->[\s\S]*<!-- NEWS_LATEST_END -->/.test(homeHtml)) {
  homeHtml = homeHtml.replace('  <section class="section dark">', '  <!-- NEWS_LATEST_START --><!-- NEWS_LATEST_END -->\n  <section class="section dark">');
}
if (!/<!-- NEWS_LATEST_START -->[\s\S]*<!-- NEWS_LATEST_END -->/.test(homeHtml)) throw new Error('could not place homepage news block');
homeHtml = homeHtml.replace(/<!-- NEWS_LATEST_START -->[\s\S]*<!-- NEWS_LATEST_END -->/, latestBlock);
writeFileSync(homeFile, homeHtml);

const staticPaths = ['', 'personal/', 'institution/', 'download/', 'suppliers/', 'news/'];
const urls = [...staticPaths, ...articles.map((article) => `news/${article.slug}/`)];
writeFileSync(resolve(site, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `  <url><loc>${SITE_ORIGIN}/${path}</loc></url>`).join('\n')}
</urlset>
`);
console.log(`built ${articles.length} news article(s)`);
