import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repository = process.env.GITHUB_REPOSITORY || 'zhongzhir/2digime';
const token = process.env.GITHUB_TOKEN;
const pagePath = resolve('site/download/index.html');

async function loadRelease() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    if (event.release && !event.release.draft) return event.release;
  }

  const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=20`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub releases API returned ${response.status}`);
  const releases = await response.json();
  const release = releases
    .filter((item) => !item.draft && item.published_at)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
  if (!release) throw new Error('no published GitHub release found');
  return release;
}

function pickAsset(assets, extension) {
  const candidates = assets.filter((asset) => asset.state === 'uploaded' && asset.name.toLowerCase().endsWith(extension));
  candidates.sort((a, b) => {
    const score = (asset) => Number(/setup|portable|win|x64/i.test(asset.name)) + Number(/setup/i.test(asset.name));
    return score(b) - score(a);
  });
  return candidates[0];
}

function digest(asset) {
  const value = asset?.digest || '';
  if (!/^sha256:[0-9a-f]{64}$/i.test(value)) throw new Error(`missing SHA256 digest for ${asset?.name || 'asset'}`);
  return value.slice('sha256:'.length).toLowerCase();
}

function safeRelease(release) {
  const base = `https://github.com/${repository}/releases/`;
  const installer = pickAsset(release.assets || [], '.exe');
  const portable = pickAsset(release.assets || [], '.zip');
  if (!installer || !portable) throw new Error('release must contain a Windows installer and portable ZIP');
  for (const url of [release.html_url, installer.browser_download_url, portable.browser_download_url]) {
    if (!url?.startsWith(base)) throw new Error(`unexpected release URL: ${url}`);
  }
  if (!/^v[0-9A-Za-z._-]+$/.test(release.tag_name)) throw new Error(`unsafe release tag: ${release.tag_name}`);
  return { release, installer, portable };
}

function replaceAll(html, pattern, replacement, label) {
  const matches = [...html.matchAll(pattern)];
  if (!matches.length) throw new Error(`download page marker missing: ${label}`);
  return html.replace(pattern, replacement);
}

const { release, installer, portable } = safeRelease(await loadRelease());
const installerSha = digest(installer);
const portableSha = digest(portable);
let html = readFileSync(pagePath, 'utf8');

html = replaceAll(html, /(<a[^>]*data-release-download="installer"[^>]*href=")[^"]+("[^>]*>)/g, `$1${installer.browser_download_url}$2`, 'installer link');
html = replaceAll(html, /(<a[^>]*data-release-download="portable"[^>]*href=")[^"]+("[^>]*>)/g, `$1${portable.browser_download_url}$2`, 'portable link');
html = replaceAll(html, /(<a[^>]*data-release-link[^>]*href=")[^"]+("[^>]*>)/g, `$1${release.html_url}$2`, 'release link');
html = replaceAll(html, /(<span[^>]*data-release-version[^>]*>)[^<]+(<\/span>)/g, `$1${release.tag_name}$2`, 'release version');
html = replaceAll(html, /(<code[^>]*data-release-sha="installer"[^>]*>)[0-9a-f]+(<\/code>)/g, `$1${installerSha}$2`, 'installer digest');
html = replaceAll(html, /(<button[^>]*data-copy-sha="installer"[^>]*data-copy=")[0-9a-f]+("[^>]*>)/g, `$1${installerSha}$2`, 'installer copy digest');
html = replaceAll(html, /(<code[^>]*data-release-sha="portable"[^>]*>)[0-9a-f]+(<\/code>)/g, `$1${portableSha}$2`, 'portable digest');
html = replaceAll(html, /(<button[^>]*data-copy-sha="portable"[^>]*data-copy=")[0-9a-f]+("[^>]*>)/g, `$1${portableSha}$2`, 'portable copy digest');

writeFileSync(pagePath, html);
console.log(`synced download page to ${release.tag_name}: ${installer.name}, ${portable.name}`);
